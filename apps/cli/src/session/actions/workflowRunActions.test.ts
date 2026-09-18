import { describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import {
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  deriveWorkflowSessionInputLocalIdV2,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowCheckpointStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowCheckpointStoredEnvelopeV1,
  sealWorkflowFinalResultStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  validateWorkflowDefinition,
  measureExternalActionResultResponseEnvelopeUtf8BytesV1,
} from '@happier-dev/protocol';

import { createWorkflowRunActionOwner } from './workflowRunActions';
import { doesWorkflowImmediateEligibleStepTargetSession } from '@/daemon/workflows/coordinator';

const definition = {
  version: 1 as const,
  defaults: { agentTarget: { kind: 'agent' as const, identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
  blocks: ['work'],
};

describe('workflow Run Actions', () => {
  const checkpointEnvelope = (runId: string, rootRecordId: string, nextSequence: string) =>
    serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'checkpoint', accountId: 'account-1', runId },
      checkpoint: {
        kind: 'happier.workflow-checkpoint.v1', rootRecordId, nextSequence,
        frontier: { nextBlockOrdinal: Number(nextSequence), paused: false },
      },
    }));

  it('projects the exact final-output producer retained by the encrypted result owner', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition({
      ...definition,
      blocks: [{
        kind: 'step', id: 'work',
        document: { text: 'work', references: [], attachments: [] },
        input: [], result: { kind: 'text' },
      }],
      finalOutput: {
        kind: 'result', producer: { blockId: 'work', scope: { kind: 'current' } }, path: [],
      },
    }).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' },
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    }));
    const resultEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowFinalResultStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'final_result', accountId: 'account-1', runId },
      finalResult: {
        kind: 'happier.workflow-final-result.v1',
        result: { kind: 'text', value: 'done' },
        producerInvocation: { recordId: 'inv-final' },
      },
    }));
    const run = {
      id: runId, origin: { kind: 'direct' as const }, state: 'succeeded' as const, revision: 2,
      machineId: 'machine-1', workflowCustodyState: 'settled' as const, workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: false, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
    };
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1',
      storage: { execute: async () => ({ run, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope }) },
      definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.get', input: { runId }, context: {},
    })).resolves.toMatchObject({ result: 'done', finalOutputInvocationId: 'inv-final' });
  });

  it('recomputes exact Run usage from every private invocation page after owner restart', async () => {
    const runId = '12111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' },
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    }));
    const run = {
      id: runId, origin: { kind: 'direct' as const }, state: 'interrupted' as const, revision: 5,
      machineId: 'machine-1', workflowCustodyState: 'settled' as const, workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: true, retry: true, restoreWorkspace: false, cancel: false, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
    };
    const invocation = (
      id: string,
      sequence: string,
      lifecycle: 'completed' | 'failed' | 'cancelled' | 'skipped',
      usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined,
      admitted = true,
    ) => {
      const index = {
        id, runId, sequence, parentRecordId: null, memberOrdinal: sequence, attempt: '0', lifecycle,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
      } as const;
      const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        mode: 'plain',
        binding: {
          v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId,
          recordId: id, sequence, parentRecordId: null, memberOrdinal: sequence, attempt: '0',
        },
        progress: {
          kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
          blockKind: 'step', attempt: '0', logicalInvocationRecordId: id,
          ...(admitted ? { execution: { kind: 'session' as const, sessionId: `session-${sequence}`, localInputId: `input-${sequence}` } } : {}),
          ...(usage ? { usage } : {}),
        },
      }));
      return { index, contentEnvelope };
    };
    const completed = invocation('22111111-1111-4111-8111-111111111111', '1', 'completed', { inputTokens: 10, outputTokens: 5, costUsd: 0.1 });
    const failed = invocation('32111111-1111-4111-8111-111111111111', '2', 'failed', { inputTokens: 3, outputTokens: 2, costUsd: 0.03 });
    const cancelled = invocation('42111111-1111-4111-8111-111111111111', '3', 'cancelled', { inputTokens: 1, outputTokens: 1, costUsd: 0.01 });
    const skipped = invocation('52111111-1111-4111-8111-111111111111', '4', 'skipped', undefined, false);
    const byId = new Map([completed, failed, cancelled, skipped].map((value) => [value.index.id, value]));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return { run, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      if (operation.operation === 'invocations.list' && operation.cursor === undefined) {
        return { invocations: [completed.index], nextCursor: 'page-2', parentRevision: 5 };
      }
      if (operation.operation === 'invocations.list' && operation.cursor === 'page-2') {
        return { invocations: [failed.index, cancelled.index, skipped.index], nextCursor: undefined, parentRevision: 5 };
      }
      if (operation.operation === 'invocations.get') {
        const value = byId.get(String(operation.invocationId));
        if (!value) throw new Error('unexpected invocation');
        return { invocation: { index: value.index, contentEnvelope: value.contentEnvelope, parentRevision: 5 } };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deps = {
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available' as const, witness: { mode: 'plain' as const, version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true as const, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    };

    await expect(createWorkflowRunActionOwner(deps).execute({
      actionId: 'workflow.run.get', input: { runId }, context: {},
    })).resolves.toMatchObject({ usage: { inputTokens: 14, outputTokens: 8, costUsd: 0.14 } });
    await expect(createWorkflowRunActionOwner(deps).execute({
      actionId: 'workflow.run.get', input: { runId }, context: {},
    })).resolves.toMatchObject({ usage: { inputTokens: 14, outputTokens: 8, costUsd: 0.14 } });
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.list')).toHaveLength(4);
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.get')).toHaveLength(8);
  });

  it('does not turn an unreported invocation usage dimension into zero', async () => {
    const runId = '13111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    }));
    const run = {
      id: runId, origin: { kind: 'direct' as const }, state: 'succeeded' as const, revision: 2,
      machineId: 'machine-1', workflowCustodyState: 'settled' as const, workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: false, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
    };
    const entries = [
      { id: '23111111-1111-4111-8111-111111111111', sequence: '1', usage: { inputTokens: 4, outputTokens: 2, costUsd: 0.01 } },
      { id: '33111111-1111-4111-8111-111111111111', sequence: '2', usage: { inputTokens: 6 } },
    ].map(({ id, sequence, usage }) => {
      const index = { id, runId, sequence, parentRecordId: null, memberOrdinal: sequence, attempt: '0', lifecycle: 'completed' as const,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' };
      const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId,
          recordId: id, sequence, parentRecordId: null, memberOrdinal: sequence, attempt: '0' },
        progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step',
          attempt: '0', logicalInvocationRecordId: id, execution: { kind: 'session', sessionId: `session-${sequence}`, localInputId: `input-${sequence}` }, usage },
      }));
      return { index, contentEnvelope };
    });
    const byId = new Map(entries.map((value) => [value.index.id, value]));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return { run, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      if (operation.operation === 'invocations.list') return { invocations: entries.map(({ index }) => index), parentRevision: 2 };
      if (operation.operation === 'invocations.get') {
        const value = byId.get(String(operation.invocationId));
        if (!value) throw new Error('unexpected invocation');
        return { invocation: { index: value.index, contentEnvelope: value.contentEnvelope, parentRevision: 2 } };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    const result = await owner.execute({ actionId: 'workflow.run.get', input: { runId }, context: {} });
    expect(result).toMatchObject({ usage: { inputTokens: 10 } });
    expect((result as { usage?: unknown }).usage).not.toHaveProperty('outputTokens');
    expect((result as { usage?: unknown }).usage).not.toHaveProperty('costUsd');
  });

  it('rejoins an existing caller-id admission before resolving a mutable saved definition', async () => {
    const canonicalProjectDirectory = `${homedir()}/repo`;
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId: '11111111-1111-4111-8111-111111111111' },
      acceptedSnapshot: {
        definition: normalizedDefinition, metadata: { title: 'Frozen saved title' }, source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' }, workspaceTarget: { project: { machineId: 'machine-1', directory: canonicalProjectDirectory, checkoutRootPath: canonicalProjectDirectory } },
        origin: { kind: 'direct', originSessionId: 'deleted-session' },
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    }));
    const getDefinition = vi.fn(async () => { throw new Error('must_not_resolve_mutable_source'); });
    const execute = vi.fn(async (
      operation: Readonly<Record<string, unknown>>,
      _options?: Readonly<{ signal?: AbortSignal; publisherMachineId?: string }>,
    ) => {
      if (operation.operation === 'invocations.list') {
        return { invocations: [], nextCursor: undefined, parentRevision: 0 };
      }
      if (operation.operation !== 'get') throw new Error('must_not_readmit');
      return {
        run: { id: '11111111-1111-4111-8111-111111111111', origin: { kind: 'direct' }, state: 'queued', revision: 0,
          machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
          availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
            retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null,
      };
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: getDefinition },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    const result = await owner.execute({ actionId: 'workflow.run.start', input: {
      runId: '11111111-1111-4111-8111-111111111111', source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } },
    }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-1', project: { machineId: 'machine-1', directory: '~/repo' } },
      // Rejoin is an authorized read of the already accepted effect. The
      // originating turn and Session may no longer exist, so current transient
      // caller authority must not be substituted for their frozen provenance.
      callerPermissionMode: 'default',
    } });

    expect(result).toMatchObject({ admission: 'existing', run: { id: '11111111-1111-4111-8111-111111111111' } });
    expect(getDefinition).not.toHaveBeenCalled();

    await expect(owner.execute({ actionId: 'workflow.run.start', input: {
      runId: '11111111-1111-4111-8111-111111111111',
      source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } },
      executionTarget: { kind: 'detached_run' },
    }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-1', project: { machineId: 'machine-1', directory: '~/repo' } },
      callerPermissionMode: 'default',
    } })).rejects.toMatchObject({ code: 'currentness_conflict' });

    const publicRun = await owner.execute({
      actionId: 'workflow.run.get',
      input: { runId: '11111111-1111-4111-8111-111111111111' },
      context: {},
    });
    expect(publicRun).toMatchObject({
      acceptedContext: {
        source: { kind: 'saved', definitionId: 'def-1' },
        metadata: { title: 'Frozen saved title' },
        inputs: {},
        machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: canonicalProjectDirectory } },
        origin: { kind: 'direct', originSessionId: 'deleted-session' },
      },
    });
    expect(JSON.stringify(publicRun)).not.toContain('admittedPermissionCeiling');
    expect(JSON.stringify(publicRun)).not.toContain('authorization');
  });

  it('projects frozen private metadata beside structural list rows and preserves unreadable rows', async () => {
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const run = (id: string) => ({
      id, origin: { kind: 'direct' as const }, state: 'running' as const, revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability: { pause: true, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const availableId = '11111111-1111-4111-8111-111111111111';
    const unavailableId = '22222222-2222-4222-8222-222222222222';
    const untitledId = '44444444-4444-4444-8444-444444444444';
    const sealAccepted = (runId: string, metadata?: { title: string; description?: string }) =>
      serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
        acceptedSnapshot: {
          definition: normalizedDefinition, ...(metadata ? { metadata } : {}),
          source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
          workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
          origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
        },
      }));
    const acceptedEnvelope = sealAccepted(availableId, { title: 'Frozen inline title', description: 'Frozen summary' });
    const untitledEnvelope = sealAccepted(untitledId);
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'list') return { runs: [run(availableId), run(unavailableId), run(untitledId)], nextCursor: 'next-page' };
      if (operation.operation === 'get' && operation.runId === availableId) {
        return { run: run(availableId), acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      }
      if (operation.operation === 'get' && operation.runId === unavailableId) {
        return { run: run(unavailableId), acceptedEnvelope: 'not-an-envelope', checkpointEnvelope: null, resultEnvelope: null };
      }
      if (operation.operation === 'get' && operation.runId === untitledId) {
        return { run: run(untitledId), acceptedEnvelope: untitledEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    const page = await owner.execute({ actionId: 'workflow.run.list', input: {}, context: {} });
    expect(page).toMatchObject({
      runs: [{ id: availableId }, { id: unavailableId }, { id: untitledId }],
      metadataByRunId: {
        [availableId]: { kind: 'available', value: { title: 'Frozen inline title', description: 'Frozen summary' } },
        [unavailableId]: { kind: 'unavailable' },
      },
      nextCursor: 'next-page',
    });
    // A readable accepted snapshot without authored metadata is an untitled
    // Run, not private content this host failed to open: the sidecar omits it.
    expect(page).not.toHaveProperty(['metadataByRunId', untitledId]);
  });

  it('shortens after private projection at the exact Action response-byte boundary', async () => {
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const ids = Array.from({ length: 110 }, (_, index) => `33333333-3333-4333-8333-${index.toString().padStart(12, '0')}`);
    const run = (id: string) => ({ id, origin: { kind: 'direct' as const }, state: 'running' as const, revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
        retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    const description = 'x'.repeat(240_000);
    const envelopes = new Map(ids.map((runId) => [runId, serializeWorkflowStoredContentEnvelopeV1(
      sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
        acceptedSnapshot: { definition: normalizedDefinition, metadata: { title: 'Boundary', description },
          source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
          workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
          origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } } },
      }),
    )]));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'list') {
        const request = operation.request as { limit?: number };
        const selected = request.limit === undefined ? ids : ids.slice(0, request.limit);
        return { runs: selected.map(run), ...(selected.length < ids.length ? { nextCursor: 'replay-cursor' } : {}) };
      }
      if (operation.operation === 'get' && typeof operation.runId === 'string') return {
        run: run(operation.runId), acceptedEnvelope: envelopes.get(operation.runId), checkpointEnvelope: null, resultEnvelope: null,
      };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({ resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });
    const result = await owner.execute({ actionId: 'workflow.run.list', input: {}, context: {} });
    expect(result).toMatchObject({ nextCursor: 'replay-cursor' });
    expect((result as { runs: unknown[] }).runs.length).toBeGreaterThan(0);
    expect((result as { runs: unknown[] }).runs.length).toBeLessThan(ids.length);
    expect(measureExternalActionResultResponseEnvelopeUtf8BytesV1(result))
      .toBeLessThanOrEqual(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES);
  });

  it('rejoins a concurrent semantically identical admission after the storage create loses the race', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const semanticDefinition = {
      ...definition,
      inputs: [{ name: 'options', valueType: 'json' as const, required: false, default: { alpha: 1, beta: { first: true, second: false } } }],
    };
    const normalizedDefinition = validateWorkflowDefinition(semanticDefinition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' },
        inputs: { options: { alpha: 1, beta: { first: true, second: false } } },
        machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' },
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const run = {
      id: runId, origin: { kind: 'direct' }, state: 'queued', revision: 0,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
        retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const execute = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } }))
      .mockRejectedValueOnce(Object.assign(new Error('race'), {
        response: { status: 409, data: { error: 'currentness_conflict' } },
      }))
      .mockResolvedValueOnce({ run, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1',
      storage: { execute },
      definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.start',
      input: {
        runId,
        source: { kind: 'inline', definition: {
          ...semanticDefinition,
          inputs: [{ name: 'options', valueType: 'json', required: false, default: { beta: { second: false, first: true }, alpha: 1 } }],
        } },
        inputs: { options: { beta: { second: false, first: true }, alpha: 1 } },
      },
      context: {
        externalActionTarget: { kind: 'machine', machineId: 'machine-1', project: { machineId: 'machine-1', directory: '/repo' } },
        callerPermissionMode: 'default',
      },
    })).resolves.toEqual({ run, admission: 'existing' });
    expect(execute.mock.calls.map(([operation]) => operation.operation)).toEqual(['get', 'admit', 'get']);
  });

  it('preserves explicit JSON null through admission and same-id rejoin', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const semanticDefinition = {
      ...definition,
      inputs: [
        { name: 'requiredValue', valueType: 'json' as const, required: true },
        { name: 'defaultedValue', valueType: 'json' as const, required: false, default: { fallback: true } },
      ],
    };
    let acceptedEnvelope = '';
    const run = {
      id: runId, origin: { kind: 'direct' }, state: 'queued', revision: 0,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
        retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let admitted = false;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get' && !admitted) throw Object.assign(new Error('not found'), { response: { status: 404 } });
      if (operation.operation === 'admit') {
        acceptedEnvelope = String(operation.acceptedEnvelope);
        admitted = true;
        return { kind: 'created', run };
      }
      if (operation.operation === 'get') return { run, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });
    const request = {
      actionId: 'workflow.run.start' as const,
      input: {
        runId,
        source: { kind: 'inline' as const, definition: semanticDefinition },
        inputs: { requiredValue: null, defaultedValue: null },
      },
      context: { externalActionTarget: { kind: 'machine' as const, machineId: 'machine-1', project: { machineId: 'machine-1', directory: '/repo' } }, callerPermissionMode: 'default' },
    };

    await expect(owner.execute(request)).resolves.toMatchObject({ admission: 'created' });
    const opened = openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      envelope: parseWorkflowStoredContentEnvelopeV1(acceptedEnvelope)!,
    });
    expect(opened).toMatchObject({
      kind: 'available',
      content: { inputs: { requiredValue: null, defaultedValue: null } },
    });
    await expect(owner.execute(request)).resolves.toEqual({ run, admission: 'existing' });
  });

  it('rejects prompt-only non-Session inline admission before any storage or decryption', async () => {
    const execute = vi.fn();
    const resolveEncryption = vi.fn();
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: vi.fn(),
      storage: { execute },
      definitions: { get: vi.fn() },
      resolveEncryption,
      prepareWorkspace: vi.fn(),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.start',
      input: {
        runId: '22222222-2222-4222-8222-222222222222',
        source: { kind: 'inline', definition: { blocks: ['work'] } },
      },
      context: {
        surface: 'cli',
        externalActionTarget: {
          kind: 'machine',
          machineId: 'machine-1',
          project: { machineId: 'machine-1', directory: '/repo' },
        },
      },
    })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(execute).not.toHaveBeenCalled();
    expect(resolveEncryption).not.toHaveBeenCalled();
  });

  it('freezes trusted workspace and causal authorization into a direct admission', async () => {
    const admittedRunId = '11111111-1111-4111-8111-111111111111';
    const accountCurrentness = { mode: 'plain' as const, version: 7, contentKeyFingerprint: null };
    const execute = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } }))
      .mockResolvedValueOnce({ kind: 'created', run: {
        id: admittedRunId, origin: { kind: 'direct', originSessionId: 'session-1' }, state: 'queued', revision: 0,
        machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: 'pending',
        availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
          retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: accountCurrentness }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await owner.execute({ actionId: 'workflow.run.start', input: {
      runId: admittedRunId, source: { kind: 'inline', definition: {
        ...definition,
        defaults: { ...definition.defaults, permissionMode: 'read-only' as const },
      } },
      metadata: { title: 'Agent-created frozen title' },
      executionTarget: { kind: 'attached_run' },
      onComplete: { kind: 'originating_session' },
    }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-1', project: { machineId: 'machine-1', directory: '/repo' } },
      defaultSessionId: 'session-1', callerPermissionMode: 'yolo',
      causalPermissionAuthority: { kind: 'admittedSessionInputV1', admittedPermissionCeiling: 'read-only' },
    } });

    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: 'admit', runId: admittedRunId, machineId: 'machine-1',
      origin: { kind: 'direct', originSessionId: 'session-1' },
      accountCurrentness,
      acceptedEnvelope: expect.any(String),
    }), expect.anything());
    const admitted = execute.mock.calls.at(-1)?.[0];
    const envelope = parseWorkflowStoredContentEnvelopeV1(admitted?.acceptedEnvelope);
    expect(envelope).not.toBeNull();
    expect(openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId: admittedRunId },
      envelope: envelope!,
    })).toMatchObject({
      kind: 'available',
      content: {
        metadata: { title: 'Agent-created frozen title' },
        executionTarget: { kind: 'attached_run' },
        resultDelivery: {
          kind: 'originating_session',
          originSessionId: 'session-1',
          localInputId: deriveWorkflowSessionInputLocalIdV2({ purpose: 'result_delivery', runId: admittedRunId }),
        },
      },
    });
  });

  it('rejects boundary resume when complete current causal authority no longer dominates the Run ceiling', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct', originSessionId: 'session-1' },
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    }));
    const execute = vi.fn(async () => ({
      run: {
        id: runId, origin: { kind: 'direct', originSessionId: 'session-1' }, state: 'paused', revision: 4,
        machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
        availability: { pause: false, resumeBoundary: true, recoverSameConversation: false, recoverFreshAgent: false,
          retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
      acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null,
    }));
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 4 },
      context: {
        callerPermissionMode: 'yolo',
        causalPermissionAuthority: { kind: 'admittedSessionInputV1', admittedPermissionCeiling: 'read-only' },
      },
    })).rejects.toMatchObject({ code: 'run_access_denied' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects boundary resume before mutation when the admitted source or principal is no longer current', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const authorization = {
      admittedPermissionCeiling: 'default' as const,
      principal: {
        kind: 'api' as const,
        accountId: 'account-1',
        principalId: 'account-1',
        credentialId: 'credential-revoked',
      },
    };
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' },
        authorization,
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return {
        run: {
          id: runId, origin: { kind: 'direct' }, state: 'paused', revision: 4,
          machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
          availability: { pause: false, resumeBoundary: true, recoverSameConversation: false, recoverFreshAgent: false,
            retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
        acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null,
      };
      throw new Error(`unexpected mutation:${String(operation.operation)}`);
    });
    const isAcceptedAuthorizationCurrent = vi.fn(async () => false);
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
      isAcceptedAuthorizationCurrent,
    });

    await expect(owner.execute({
      actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 4 },
      context: {
        callerPermissionMode: 'yolo',
        externalActionCredential: {
          accountId: authorization.principal.accountId,
          principalId: authorization.principal.principalId,
          credentialId: authorization.principal.credentialId,
        },
        externalActionTarget: { kind: 'machine', machineId: 'machine-1' },
      },
    })).rejects.toMatchObject({ code: 'run_access_denied' });
    expect(isAcceptedAuthorizationCurrent).toHaveBeenCalledWith({ authorization, signal: undefined });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a work-releasing control whose live target or configuration policy does not admit the frozen Run', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition({
      ...definition,
      defaults: {
        ...definition.defaults,
        sessionConfigOptionOverrides: null,
        modelSelection: {
          v: 1,
          ref: { agentTargetKey: 'backend:codex', providerConnectionId: null, modelId: 'model-1' },
          updatedAt: 1,
        },
      },
    }).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition,
        source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' },
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return {
        run: {
          id: runId, origin: { kind: 'direct' }, state: 'paused', revision: 4,
          machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
          availability: { pause: false, resumeBoundary: true, recoverSameConversation: false, recoverFreshAgent: false,
            retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
        acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null,
      };
      throw new Error(`unexpected mutation:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 4 },
      context: {
        surface: 'agent',
        callerPermissionMode: 'default',
        defaultSessionMachineId: 'machine-1',
        externalActionTarget: { kind: 'machine', machineId: 'machine-2' },
        sessionAgentSpawnPolicyV1: { v: 1 },
      },
    })).rejects.toMatchObject({ code: 'target_unavailable' });
    await expect(owner.execute({
      actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 4 },
      context: {
        surface: 'agent',
        callerPermissionMode: 'default',
        defaultSessionMachineId: 'machine-1',
        externalActionTarget: { kind: 'machine', machineId: 'machine-1' },
        sessionAgentSpawnPolicyV1: { v: 1, allowModelOverride: false },
      },
    })).rejects.toMatchObject({ code: 'run_access_denied' });
    await expect(owner.execute({
      actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 4 },
      context: {
        surface: 'agent',
        callerPermissionMode: 'default',
        defaultSessionMachineId: 'machine-1',
        externalActionTarget: { kind: 'machine', machineId: 'machine-1' },
        sessionAgentSpawnPolicyV1: {
          v: 1,
          allowModelOverride: true,
          allowConfigOptionOverrides: false,
        },
      },
    })).rejects.toMatchObject({ code: 'run_access_denied' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('rejoins the exact retry replacement when the commit response is lost', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const logicalId = '22222222-2222-4222-8222-222222222220';
    const priorId = '22222222-2222-4222-8222-222222222222';
    const normalizedDefinition = validateWorkflowDefinition({
      ...definition,
      blocks: [{
        kind: 'step', id: 'work',
        document: { text: 'work', references: [], attachments: [] },
        input: [], result: { kind: 'text' },
      }],
    }).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const priorProgressEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '5', parentRecordId: null, memberOrdinal: '0', attempt: '1' },
      progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step',
        attempt: '1', logicalInvocationRecordId: logicalId, previousAttemptRecordId: logicalId,
        input: {
          document: { text: 'work', references: [], attachments: [] },
          input: ['recorded context'],
        },
        uncertainPriorEffects: { activity: 'stopped' },
        workspace: { descriptor: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
      },
    }));
    const possiblyActiveProgressEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '5', parentRecordId: null, memberOrdinal: '0', attempt: '1' },
      progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step',
        attempt: '1', logicalInvocationRecordId: logicalId, previousAttemptRecordId: logicalId,
        workspace: { descriptor: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
      },
    }));
    const missingPreparedInputEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '5', parentRecordId: null, memberOrdinal: '0', attempt: '1' },
      progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step',
        attempt: '1', logicalInvocationRecordId: logicalId, previousAttemptRecordId: logicalId,
        uncertainPriorEffects: { activity: 'stopped' },
        workspace: { descriptor: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
      },
    }));
    const runRow = { id: runId, origin: { kind: 'direct' }, state: 'failed', revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false, retry: true, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const priorIndex = { id: priorId, runId, sequence: '5', parentRecordId: null, memberOrdinal: '0', attempt: '1', lifecycle: 'needs_attention', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const checkpoint = checkpointEnvelope(runId, priorId, '6');
    let committedRetry: Readonly<Record<string, unknown>> | null = null;
    let provenStopped = false;
    let preparedInputAvailable = true;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return committedRetry
        ? { run: { ...runRow, revision: 2, state: 'queued' }, acceptedEnvelope, checkpointEnvelope: committedRetry.checkpointEnvelope, resultEnvelope: null }
        : { run: runRow, acceptedEnvelope, checkpointEnvelope: checkpoint, resultEnvelope: null };
      if (operation.operation === 'invocations.get') {
        if (operation.invocationId === priorId) return { invocation: { index: { ...priorIndex, lifecycle: committedRetry ? 'superseded' : provenStopped ? 'needs_attention' : 'outcome_uncertain' }, contentEnvelope: provenStopped ? (preparedInputAvailable ? priorProgressEnvelope : missingPreparedInputEnvelope) : possiblyActiveProgressEnvelope, parentRevision: committedRetry ? 2 : 1 } };
        if (committedRetry && operation.invocationId === committedRetry.newInvocationId) return { invocation: { index: { ...priorIndex, id: committedRetry.newInvocationId, sequence: '6', attempt: '2', lifecycle: 'pending' }, contentEnvelope: committedRetry.contentEnvelope, parentRevision: 2 } };
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      }
      if (operation.operation === 'invocations.retry') {
        committedRetry = operation;
        throw new Error('response lost after commit');
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const accountCurrentness = { mode: 'plain' as const, version: 8, contentKeyFingerprint: null };
    const resolveEncryption = vi.fn(async () => ({ kind: 'available' as const, witness: accountCurrentness }));
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption,
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' }, acknowledgeUncertainPriorEffects: true },
      context: { callerPermissionMode: 'default', actionRequestId: 'retry-request-1' },
    })).rejects.toMatchObject({ code: 'workflow_outcome_unresolved' });
    provenStopped = true;
    await expect(owner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' } },
      context: { callerPermissionMode: 'default', actionRequestId: 'retry-request-1' },
    })).rejects.toMatchObject({ code: 'workflow_outcome_unresolved' });
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.retry')).toBe(false);

    preparedInputAvailable = false;
    await expect(owner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' }, acknowledgeUncertainPriorEffects: true },
      context: { callerPermissionMode: 'default', actionRequestId: 'retry-request-missing-prepared-input' },
    })).rejects.toMatchObject({ code: 'content_unavailable' });
    preparedInputAvailable = true;

    const result = await owner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' }, acknowledgeUncertainPriorEffects: true },
      context: { callerPermissionMode: 'default', actionRequestId: 'retry-request-1' },
    });
    expect(result).toMatchObject({ disposition: 'accepted' });
    await expect(owner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' }, acknowledgeUncertainPriorEffects: true },
      context: { callerPermissionMode: 'default', actionRequestId: 'retry-request-1' },
    })).resolves.toMatchObject({ disposition: 'accepted' });
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.retry')).toHaveLength(1);
    const retryCall = execute.mock.calls.find(([op]) => op.operation === 'invocations.retry')?.[0] as Record<string, unknown>;
    expect(retryCall).toMatchObject({ runId, expectedRevision: 1, invocationId: priorId, accountCurrentness });
    expect(resolveEncryption).toHaveBeenCalledTimes(6);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.list')).toBe(false);
    expect(typeof retryCall.newInvocationId).toBe('string');
    expect(retryCall).not.toHaveProperty('newSequence');
    const retryEnvelope = parseWorkflowStoredContentEnvelopeV1(retryCall.contentEnvelope);
    expect(retryEnvelope).not.toBeNull();
    const opened = openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: String(retryCall.newInvocationId), sequence: '6', parentRecordId: null, memberOrdinal: '0', attempt: '2' },
      envelope: retryEnvelope!,
    });
    expect(opened).toMatchObject({
      kind: 'available',
      content: {
        attempt: '2',
        logicalInvocationRecordId: logicalId,
        previousAttemptRecordId: priorId,
        input: {
          document: { text: 'work', references: [], attachments: [] },
          input: ['recorded context'],
        },
        workspace: { descriptor: { machineId: 'machine-1', directory: '/repo' } },
        recovery: {
          conversation: 'same_conversation',
          input: {
            kind: 'replacement',
            value: {
              document: { text: 'work', references: [], attachments: [] },
              input: ['recorded context'],
            },
          },
        },
      },
    });
    const retryCheckpoint = parseWorkflowStoredContentEnvelopeV1(retryCall.checkpointEnvelope);
    expect(retryCheckpoint).not.toBeNull();
    expect(openWorkflowCheckpointStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'checkpoint', accountId: 'account-1', runId },
      envelope: retryCheckpoint!,
    })).toMatchObject({ kind: 'available', content: { nextSequence: '7' } });
  });

  it('rejoins the exact recovery batch when the commit response is lost', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const priorId = '33333333-3333-4333-8333-333333333333';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const priorProgressEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step', attempt: '0', logicalInvocationRecordId: priorId },
    }));
    const runRow = { id: runId, origin: { kind: 'direct' }, state: 'interrupted', revision: 2,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: true, recoverFreshAgent: true, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const priorIndex = { id: priorId, runId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'failed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const checkpoint = checkpointEnvelope(runId, priorId, '5');
    let committedRecovery: Readonly<Record<string, unknown>> | null = null;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return committedRecovery
        ? { run: { ...runRow, revision: 3, state: 'queued' }, acceptedEnvelope, checkpointEnvelope: committedRecovery.checkpointEnvelope, resultEnvelope: null }
        : { run: runRow, acceptedEnvelope, checkpointEnvelope: checkpoint, resultEnvelope: null };
      if (operation.operation === 'invocations.get') {
        if (operation.invocationId === priorId) return { invocation: { index: { ...priorIndex, ...(committedRecovery ? { lifecycle: 'superseded' } : {}) }, contentEnvelope: priorProgressEnvelope, parentRevision: committedRecovery ? 3 : 2 } };
        const replacement = committedRecovery
          ? (committedRecovery.recoveries as Array<Readonly<Record<string, unknown>>>).find((item) => item.newInvocationId === operation.invocationId)
          : undefined;
        if (replacement) return { invocation: { index: { ...priorIndex, id: replacement.newInvocationId, sequence: '5', attempt: '1', lifecycle: 'pending' }, contentEnvelope: replacement.contentEnvelope, parentRevision: 3 } };
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      }
      if (operation.operation === 'invocations.recover') {
        committedRecovery = operation;
        throw new Error('response lost after commit');
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const accountCurrentness = { mode: 'plain' as const, version: 9, contentKeyFingerprint: null };
    const resolveEncryption = vi.fn(async () => ({ kind: 'available' as const, witness: accountCurrentness }));
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption,
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    const result = await owner.execute({
      actionId: 'workflow.run.resume',
      input: { mode: 'recover', runId, expectedRevision: 2, invocations: [{ kind: 'continue', invocation: { recordId: priorId }, conversation: 'fresh_agent', input: { document: { text: 'Retry', references: [], attachments: [] }, input: [] } }] },
      context: { callerPermissionMode: 'default', actionRequestId: 'recover-request-1' },
    });
    expect(result).toMatchObject({ intent: expect.any(String) });
    await expect(owner.execute({
      actionId: 'workflow.run.resume',
      input: { mode: 'recover', runId, expectedRevision: 2, invocations: [{ kind: 'continue', invocation: { recordId: priorId }, conversation: 'fresh_agent', input: { document: { text: 'Retry', references: [], attachments: [] }, input: [] } }] },
      context: { callerPermissionMode: 'default', actionRequestId: 'recover-request-1' },
    })).resolves.toMatchObject({ intent: 'resumed' });
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.recover')).toHaveLength(1);
    const recoverCall = execute.mock.calls.find(([op]) => op.operation === 'invocations.recover')?.[0] as Record<string, unknown>;
    expect(recoverCall).toMatchObject({ runId, expectedRevision: 2, accountCurrentness });
    expect(resolveEncryption).toHaveBeenCalledTimes(3);
    const recoveries = recoverCall.recoveries as Array<Record<string, unknown>>;
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).not.toHaveProperty('newSequence');
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.list')).toBe(false);
  });

  it('lets a narrower authorized reader reattach without creating or superseding an attempt', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const priorId = '33333333-3333-4333-8333-333333333333';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const priorProgressEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step', attempt: '0', logicalInvocationRecordId: priorId,
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' } },
    }));
    const runRow = { id: runId, origin: { kind: 'direct' }, state: 'interrupted', revision: 2,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: true, recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const priorIndex = { id: priorId, runId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return { run: runRow, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      if (operation.operation === 'invocations.get') return { invocation: { index: priorIndex, contentEnvelope: priorProgressEnvelope, parentRevision: 2 } };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.resume',
      input: { mode: 'recover', runId, expectedRevision: 2, invocations: [{ kind: 'reattach', invocation: { recordId: priorId } }] },
      context: { callerPermissionMode: 'read-only' },
    })).resolves.toMatchObject({ intent: 'recovery_required', run: runRow });
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.recover')).toBe(false);
  });

  it('restores only on the accepted Machine before publishing the recovered attempt', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const priorId = '33333333-3333-4333-8333-333333333333';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const workspace = {
      creationIntent: {
        kind: 'git_worktree' as const, sourceDirectory: '/repo', baseRef: 'a'.repeat(40),
        displayName: 'workflow-run-work', branchMode: 'new' as const,
      },
      descriptor: {
        machineId: 'machine-1', directory: '/repo/.worktrees/workflow-run-work',
        checkoutRootPath: '/repo/.worktrees/workflow-run-work',
        checkout: { kind: 'git_worktree' as const, branchName: 'workflow-run-work' },
      },
    };
    const priorProgressEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: priorId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '0', logicalInvocationRecordId: priorId,
        input: {
          document: { text: 'work', references: [], attachments: [] },
          input: ['recorded context'],
        },
        workspace, reason: { code: 'workspace_unavailable' },
      },
    }));
    const runRow = {
      id: runId, origin: { kind: 'direct' }, state: 'interrupted', revision: 2,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: {
        pause: false, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: true,
        retry: false, restoreWorkspace: true, cancel: true, inspectExecution: true, disabledReasons: [],
      },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const priorIndex = {
      id: priorId, runId, sequence: '4', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const effects: string[] = [];
    const execute = vi.fn(async (
      operation: Readonly<Record<string, unknown>>,
      _options?: Readonly<{ signal?: AbortSignal; publisherMachineId?: string }>,
    ) => {
      if (operation.operation === 'get') return {
        run: runRow, acceptedEnvelope, checkpointEnvelope: checkpointEnvelope(runId, priorId, '5'), resultEnvelope: null,
      };
      if (operation.operation === 'invocations.get') return {
        invocation: { index: priorIndex, contentEnvelope: priorProgressEnvelope, parentRevision: 2 },
      };
      if (operation.operation === 'invocations.recover') {
        effects.push('publish');
        return { run: { ...runRow, state: 'running', revision: 3 } };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const restoreWorkspace = vi.fn(async () => {
      effects.push('restore');
      return { ok: true as const };
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
      restoreWorkspace,
    });
    const input = {
      mode: 'recover' as const, runId, expectedRevision: 2,
      invocations: [{
        kind: 'restore_workspace' as const, invocation: { recordId: priorId },
        conversation: 'fresh_agent' as const, input: { kind: 'original' as const },
      }],
    };

    await expect(owner.execute({
      actionId: 'workflow.run.resume', input,
      context: {
        callerPermissionMode: 'default', actionRequestId: 'restore-request-1',
        externalActionTarget: { kind: 'machine', machineId: 'machine-1' },
      },
    })).resolves.toMatchObject({ intent: 'resumed', run: { revision: 3 } });
    expect(effects).toEqual(['restore', 'publish']);
    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ publisherMachineId: 'machine-1' });
    const recoverCall = execute.mock.calls.find(([operation]) => operation.operation === 'invocations.recover')?.[0] as Record<string, unknown>;
    const recovery = (recoverCall.recoveries as Array<Record<string, unknown>>)[0]!;
    const openedRecovery = openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: {
        v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId,
        recordId: String(recovery.newInvocationId), sequence: '5', parentRecordId: null,
        memberOrdinal: '0', attempt: '1',
      },
      envelope: parseWorkflowStoredContentEnvelopeV1(String(recovery.contentEnvelope))!,
    });
    expect(openedRecovery).toMatchObject({
      kind: 'available',
      content: {
        input: {
          document: { text: 'work', references: [], attachments: [] },
          input: ['recorded context'],
        },
        recovery: {
          conversation: 'fresh_agent',
          input: {
            kind: 'replacement',
            value: {
              document: { text: 'work', references: [], attachments: [] },
              input: ['recorded context'],
            },
          },
        },
      },
    });

    restoreWorkspace.mockClear();
    await expect(owner.execute({
      actionId: 'workflow.run.resume', input,
      context: {
        callerPermissionMode: 'default', actionRequestId: 'wrong-machine-request',
        externalActionTarget: { kind: 'machine', machineId: 'machine-2' },
      },
    })).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(restoreWorkspace).not.toHaveBeenCalled();
  });

  it('checks every active-invocation page before allowing an agent to wait', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const invocationId = '55555555-5555-4555-8555-555555555555';
    const index = {
      id: invocationId, runId, sequence: '8', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: {
        v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId,
        recordId: invocationId, sequence: '8', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      },
      progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '0', logicalInvocationRecordId: invocationId,
        execution: { kind: 'session', sessionId: 'calling-session', localInputId: 'input-1' },
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.list' && operation.cursor === undefined) {
        return { invocations: [], nextCursor: 'page-2', parentRevision: 3 };
      }
      if (operation.operation === 'invocations.list' && operation.cursor === 'page-2') {
        return { invocations: [index], nextCursor: undefined, parentRevision: 3 };
      }
      if (operation.operation === 'invocations.get') {
        return { invocation: { index, contentEnvelope, parentRevision: 3 } };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    await expect(owner.execute({
      actionId: 'workflow.run.wait', input: { runId, timeoutSeconds: 1 },
      context: { surface: 'agent', defaultSessionId: 'calling-session' },
    })).rejects.toMatchObject({ code: 'workflow_wait_self_dependency' });
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.list'))
      .toHaveLength(2);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'wait')).toBe(false);
  });

  it('rechecks exact self-dependency after the structural wait observes a revision change', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const invocationId = '55555555-5555-4555-8555-555555555555';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const index = { id: invocationId, runId, sequence: '1', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'cancel_requested', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as const;
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: invocationId, sequence: '1', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step', attempt: '0', logicalInvocationRecordId: invocationId, execution: { kind: 'session', sessionId: 'calling-session', localInputId: 'input-1' } },
    }));
    let listed = 0;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.list') return { invocations: listed++ === 0 ? [] : [index], parentRevision: listed };
      if (operation.operation === 'invocations.get') return { invocation: { index, contentEnvelope, parentRevision: 1 } };
      if (operation.operation === 'get') return { run: { id: runId, origin: { kind: 'direct' }, state: 'running', revision: 0, machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null, availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      if (operation.operation === 'wait') return { observation: 'changed', run: { revision: 1 } };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({ resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() }, resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }), prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }), doesImmediateEligibleStepTargetSession: () => false });
    await expect(owner.execute({ actionId: 'workflow.run.wait', input: { runId }, context: { surface: 'agent', defaultSessionId: 'calling-session' } })).rejects.toMatchObject({ code: 'workflow_wait_self_dependency', details: { runId } });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'wait', afterRevision: 0 }), expect.anything());
  });

  it('propagates caller abort while waiting without an authored deadline', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const reason = new Error('caller stopped waiting');
    const controller = new AbortController();
    const execute = vi.fn(async (
      operation: Readonly<Record<string, unknown>>,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => {
      expect(operation).toEqual({ operation: 'wait', runId });
      expect(options?.signal).toBe(controller.signal);
      if (options?.signal?.aborted) throw options.signal.reason;
      return await new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      });
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });

    const waiting = owner.execute({
      actionId: 'workflow.run.wait', input: { runId }, context: { signal: controller.signal },
    });
    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an agent wait before rows exist when the persisted immediate Session step targets the caller', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const normalizedDefinition = validateWorkflowDefinition({
      ...definition,
      blocks: [
        {
          kind: 'step', id: 'completed', document: { text: 'completed', references: [], attachments: [] },
          execution: { conversation: { kind: 'existing_session', sessionId: 'another-session', machineId: 'machine-1' } },
          input: [], result: { kind: 'text' },
        },
        {
          kind: 'step', id: 'work', document: { text: 'work', references: [], attachments: [] },
          execution: { conversation: { kind: 'existing_session', sessionId: 'calling-session', machineId: 'machine-1' } },
          input: [], result: { kind: 'text' },
        },
      ],
    }).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct', originSessionId: 'calling-session' },
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 0 };
      if (operation.operation === 'get') return {
        run: {
          id: runId, origin: { kind: 'direct' }, state: 'queued', revision: 0, machineId: 'machine-1',
          workflowCustodyState: 'pending', workflowResultDeliveryState: null,
          availability: { pause: true, resumeBoundary: false, recoverSameConversation: false,
            recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
        acceptedEnvelope, checkpointEnvelope: checkpointEnvelope(runId, 'root-record', '1'), resultEnvelope: null,
      };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const owner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
      doesImmediateEligibleStepTargetSession: doesWorkflowImmediateEligibleStepTargetSession,
    });

    await expect(owner.execute({
      actionId: 'workflow.run.wait', input: { runId, timeoutSeconds: 1 },
      context: { surface: 'agent', defaultSessionId: 'calling-session' },
    })).rejects.toMatchObject({ code: 'workflow_wait_self_dependency' });
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'wait')).toBe(false);
  });

  it('refuses a narrower controller before mutation and preserves typed storage codes', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const priorId = '44444444-4444-4444-8444-444444444444';
    const normalizedDefinition = validateWorkflowDefinition(definition).normalizedDefinition!;
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition: normalizedDefinition, source: { kind: 'inline' },
        inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }));
    const runRow = { id: runId, origin: { kind: 'direct' }, state: 'failed', revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: false, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false, retry: true, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const getExecute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return { run: runRow, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const narrowOwner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute: getExecute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });
    await expect(narrowOwner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' } },
      context: { callerPermissionMode: 'read-only' },
    })).rejects.toMatchObject({ code: 'run_access_denied' });
    expect(getExecute).toHaveBeenCalledTimes(1);

    const deniedExecute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'get') return { run: runRow, acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null };
      if (operation.operation === 'invocations.get') throw Object.assign(new Error('ineligible'), { response: { status: 422, data: { error: 'ineligible_state' } } });
      if (operation.operation === 'invocations.list') return { invocations: [], nextCursor: undefined, parentRevision: 1 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deniedOwner = createWorkflowRunActionOwner({
      resolveAccountId: async () => 'account-1', storage: { execute: deniedExecute }, definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } } }),
    });
    await expect(deniedOwner.execute({
      actionId: 'workflow.run.invocations.retry',
      input: { runId, expectedRevision: 1, invocation: { recordId: priorId }, conversation: 'same_conversation', input: { kind: 'original' } },
      context: { callerPermissionMode: 'default' },
    })).rejects.toMatchObject({ code: 'ineligible_state' });
  });
});
