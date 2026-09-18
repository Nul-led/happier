import { describe, expect, it, vi } from 'vitest';
import {
  AutomationStoredWorkflowDefinitionV2Schema,
  openWorkflowProgressStoredEnvelopeV1,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
} from '@happier-dev/protocol';

import {
  createProductionWorkflowRunCoordinator,
  DurableWorkflowCoordinatorStore,
  projectWorkflowTerminalCustodySettlement,
  projectWorkflowResultDeliverySettlement,
  projectWorkflowRootSettlementLifecycle,
  type WorkflowProductionExecutionDeps,
} from './production';
import { executeClaimedRun } from '@/daemon/automation/automationRunExecutor';
import { createWorkflowCoordinator, workflowInvocationKey } from './coordinator';
import { AgentStateRequestStore } from '@/agent/permissions/agentStateRequestStore';

const runId = '7be4d65c-d3b7-4868-a416-b18d9ee29c1c';
const accountId = 'account-1';
const machineId = 'machine-1';
const now = '2026-01-01T00:00:00.000Z';
const availability = { pause: true, resumeBoundary: false, recoverSameConversation: false,
  recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] };
/** The canonical definition requires at least one block, so fixtures cannot use an empty program. */
const onlyStep = {
  kind: 'step' as const, id: 'work', document: { text: 'work', references: [], attachments: [] },
  input: [], result: { kind: 'text' as const },
};

function productionExecution(
  sessionInput?: NonNullable<WorkflowProductionExecutionDeps['sessionInput']>,
): WorkflowProductionExecutionDeps {
  const actionExecutor = { execute: vi.fn(async () => ({ ok: false as const, errorCode: 'unused' })) };
  return {
    credentials: { token: 'token', encryption: null },
    serverId: 'server-1',
    resolveMachineOperationProtocolCapabilities: async () => ({
      sessionInputAdmission: { protocolVersions: [1, 2] },
    }),
    machineAdmissionTransport: vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' })),
    resolveExistingSessionConversation: async () => ({ sessionId: 'session-1', machineId, directory: '/repo' }),
    ...(sessionInput ? { sessionInput } : {}),
    detachedRun: {
      actionExecutor: actionExecutor as never,
      buildActionContext: () => ({ surface: 'agent' as const, authority: 'account_automation' as const }),
    },
    attachedRun: {
      actionExecutor: actionExecutor as never,
      buildActionContext: () => ({ surface: 'agent' as const, authority: 'account_automation' as const }),
      sendInput: vi.fn() as never,
    },
  };
}

describe('production workflow coordinator', () => {
  it('reloads the exact previous attempt for same-conversation retry preparation after restart', async () => {
    const rootId = 'root-retry';
    const previousId = 'attempt-0';
    const retryId = 'attempt-1';
    const workspace = { machineId, directory: '/repo/retry', checkoutRootPath: '/repo/retry' };
    const execution = { kind: 'session' as const, sessionId: 'session-previous', localInputId: 'input-previous' };
    const rootIndex = {
      id: rootId, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'running' as const, createdAt: now, updatedAt: now,
    };
    const previousIndex = {
      id: previousId, runId, sequence: '1', parentRecordId: rootId, memberOrdinal: '0', attempt: '0',
      lifecycle: 'failed' as const, createdAt: now, updatedAt: now,
    };
    let retryIndex = {
      id: retryId, runId, sequence: '2', parentRecordId: rootId, memberOrdinal: '0', attempt: '1',
      lifecycle: 'admitting' as const, createdAt: now, updatedAt: now,
    };
    const sealProgress = (
      index: typeof rootIndex | typeof previousIndex | typeof retryIndex,
      progress: import('@happier-dev/protocol').WorkflowProgressEnvelopeV1,
    ) => serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: {
        v: 1, purpose: 'invocation_progress', accountId, runId,
        recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
        memberOrdinal: index.memberOrdinal, attempt: index.attempt,
      },
      progress,
    }));
    const rows = new Map([
      [rootId, { index: rootIndex, contentEnvelope: sealProgress(rootIndex, {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: rootId,
      }) }],
      [previousId, { index: previousIndex, contentEnvelope: sealProgress(previousIndex, {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '0', logicalInvocationRecordId: previousId,
        execution, workspace: { descriptor: workspace },
        usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
      }) }],
      [retryId, { index: retryIndex, contentEnvelope: sealProgress(retryIndex, {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '1', logicalInvocationRecordId: previousId,
        previousAttemptRecordId: previousId,
        recovery: { conversation: 'same_conversation', input: { kind: 'original' } },
      }) }],
    ]);
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.list') {
        // The parent-slot projection intentionally contains only the newest attempt.
        return { invocations: [retryIndex], parentRevision: 3 };
      }
      if (operation.operation === 'invocations.get') {
        const row = rows.get(operation.invocationId as string);
        if (!row) throw new Error('unexpected_invocation');
        return { invocation: row, parentRevision: 3 };
      }
      if (operation.operation === 'invocations.fact') {
        const row = rows.get(retryId)!;
        retryIndex = { ...retryIndex, lifecycle: operation.lifecycle as typeof retryIndex.lifecycle };
        row.index = retryIndex;
        row.contentEnvelope = operation.contentEnvelope as string;
        return retryIndex;
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const store = await DurableWorkflowCoordinatorStore.load({
      accountId, runId, parentAttempt: 0, storage: { execute },
      encryption: { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } },
      rootRecordId: rootId,
      checkpoint: { kind: 'happier.workflow-checkpoint.v1', rootRecordId: rootId, nextSequence: '3', frontier: { nextBlockOrdinal: 0, paused: false } },
      revision: 3, kinds: new Map([['work', 'step']]),
    });
    const prepareStep = vi.fn(async () => ({ failure: { kind: 'needs_attention' as const, code: 'stop_after_prepare' } }));
    const executeStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-replay' }));
    const coordinator = createWorkflowCoordinator({
      store,
      prepareStep,
      executeStep,
      resolveWorkspace: async () => ({ ok: true, workspace }),
      isAcceptedAuthorizationCurrent: async () => true,
    });

    await expect(coordinator.run({
      runId,
      definition: {
        version: 1, inputs: [],
        defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
        blocks: [onlyStep],
      },
      inputs: {}, executionTarget: { kind: 'session' },
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
    })).resolves.toEqual({ state: 'interrupted', reason: 'stop_after_prepare' });
    expect(prepareStep).toHaveBeenCalledWith(expect.objectContaining({
      invocationRecordId: retryId,
      recoveryPreviousExecution: execution,
      recoveryPreviousWorkspace: workspace,
    }));
    expect(executeStep).not.toHaveBeenCalled();
    expect(execute.mock.calls
      .map(([operation]) => operation)
      .filter((operation) => operation.operation === 'invocations.get')
      .map((operation) => operation.invocationId)).toEqual([rootId, retryId, previousId]);
    await expect(store.readByLogicalInvocation(previousId)).resolves.toMatchObject({
      usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
    });
  });

  it('keeps exact prior-attempt Account and row binding validation on cache-miss reload', async () => {
    const rootId = 'root-binding';
    const previousId = 'attempt-binding';
    const rootIndex = {
      id: rootId, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'running' as const, createdAt: now, updatedAt: now,
    };
    const previousIndex = {
      id: previousId, runId, sequence: '1', parentRecordId: rootId, memberOrdinal: '0', attempt: '0',
      lifecycle: 'failed' as const, createdAt: now, updatedAt: now,
    };
    const rootEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: rootId,
        sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: rootId },
    }));
    const wronglyBoundPreviousEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-other', runId,
        recordId: previousId, sequence: '1', parentRecordId: rootId, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '0', logicalInvocationRecordId: previousId },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation !== 'invocations.get') throw new Error(`unexpected:${String(operation.operation)}`);
      return operation.invocationId === rootId
        ? { invocation: { index: rootIndex, contentEnvelope: rootEnvelope }, parentRevision: 0 }
        : { invocation: { index: previousIndex, contentEnvelope: wronglyBoundPreviousEnvelope }, parentRevision: 0 };
    });
    const store = await DurableWorkflowCoordinatorStore.load({
      accountId, runId, parentAttempt: 0, storage: { execute },
      encryption: { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } },
      rootRecordId: rootId,
      checkpoint: { kind: 'happier.workflow-checkpoint.v1', rootRecordId: rootId, nextSequence: '2', frontier: { nextBlockOrdinal: 0, paused: false } },
      revision: 0, kinds: new Map([['work', 'step']]),
    });

    await expect(store.readByLogicalInvocation(previousId)).rejects.toThrow('workflow_invocation_content_unavailable');
  });

  it('persists an exact invocation permission request without replacing its result', async () => {
    const rootId = 'root-interaction';
    const rootIndex = {
      id: rootId, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'running' as const, createdAt: now, updatedAt: now,
    };
    const binding = {
      v: 1 as const, purpose: 'invocation_progress' as const, accountId, runId,
      recordId: rootId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0',
    };
    let persistedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding, progress: {
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: rootId, result: { changed: true },
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.get') {
        return { invocation: { index: rootIndex, contentEnvelope: persistedEnvelope }, parentRevision: 0 };
      }
      if (operation.operation === 'invocations.fact') {
        persistedEnvelope = operation.contentEnvelope as string;
        return { ...rootIndex, lifecycle: operation.lifecycle };
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const store = await DurableWorkflowCoordinatorStore.load({
      accountId, runId, parentAttempt: 0, storage: { execute },
      encryption: { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } },
      rootRecordId: rootId,
      checkpoint: { kind: 'happier.workflow-checkpoint.v1', rootRecordId: rootId, nextSequence: '1', frontier: { nextBlockOrdinal: 0, paused: false } },
      revision: 0, kinds: new Map(),
    });
    const rootKey = workflowInvocationKey({ runId, blockId: '$root', scope: [], attempt: 0 });
    const requestStore = new AgentStateRequestStore({
      target: store.createInteractionPersistenceTarget(rootKey),
      logPrefix: '[WORKFLOW TEST]',
    });

    await requestStore.publishRequestAndWait({
      requestId: 'permission-1', toolName: 'Write', toolInput: { path: '/repo/file.txt' }, createdAt: 1,
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'invocations.fact',
      lifecycle: 'waiting_for_approval',
    }));

    const opened = openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding, envelope: parseWorkflowStoredContentEnvelopeV1(persistedEnvelope),
    });
    expect(opened).toMatchObject({
      kind: 'available',
      content: {
        result: { changed: true },
        interaction: { requests: { 'permission-1': { tool: 'Write', arguments: { path: '/repo/file.txt' } } } },
      },
    });

    await expect(requestStore.publishRequestAndWait({
      requestId: 'permission-too-large',
      toolName: 'Write',
      toolInput: { content: 'x'.repeat(512 * 1024) },
      createdAt: 2,
    })).rejects.toMatchObject({
      code: 'workflow_interaction_capacity_exceeded',
      recoverable: true,
    });
    const afterOverflow = openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding, envelope: parseWorkflowStoredContentEnvelopeV1(persistedEnvelope),
    });
    expect(afterOverflow).toMatchObject({
      kind: 'available',
      content: {
        result: { changed: true },
        interaction: { requests: { 'permission-1': expect.any(Object) } },
      },
    });
    if (afterOverflow.kind === 'available') {
      expect(afterOverflow.content.interaction).not.toHaveProperty('requests.permission-too-large');
    }

    await expect(requestStore.completeRequest({
      requestId: 'permission-1',
      status: 'approved',
      decision: 'approved',
    })).resolves.toBe(true);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: 'invocations.fact',
      lifecycle: 'running',
    }));

    await store.commitFact({ key: rootKey, lifecycle: 'completed' });
    await requestStore.publishRequestAndWait({
      requestId: 'permission-late', toolName: 'Write', toolInput: { path: '/repo/late.txt' }, createdAt: 3,
    });
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: 'invocations.fact',
      lifecycle: 'completed',
    }));
  });

  it('serializes facts for one invocation row so concurrent workspace commits cannot erase each other', async () => {
    const rootId = 'root-1';
    const rootIndex = {
      id: rootId,
      runId,
      sequence: '0',
      parentRecordId: null,
      memberOrdinal: '0',
      attempt: '0',
      lifecycle: 'running' as const,
      createdAt: now,
      updatedAt: now,
    };
    const rootProgress = {
      kind: 'happier.workflow-progress.v1' as const,
      invocationPath: { blockId: '$root', scope: [] },
      blockKind: 'root' as const,
      attempt: '0',
      logicalInvocationRecordId: rootId,
    };
    const rootEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: {
        v: 1,
        purpose: 'invocation_progress',
        accountId,
        runId,
        recordId: rootId,
        sequence: '0',
        parentRecordId: null,
        memberOrdinal: '0',
        attempt: '0',
      },
      progress: rootProgress,
    }));
    let persistedEnvelope = rootEnvelope;
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let factCalls = 0;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'invocations.get') {
        return { invocation: { index: rootIndex, contentEnvelope: persistedEnvelope }, parentRevision: 0 };
      }
      if (operation.operation === 'invocations.fact') {
        factCalls += 1;
        if (factCalls === 1) await firstRelease;
        persistedEnvelope = operation.contentEnvelope as string;
        return rootIndex;
      }
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const store = await DurableWorkflowCoordinatorStore.load({
      accountId,
      runId,
      parentAttempt: 0,
      storage: { execute },
      encryption: { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } },
      rootRecordId: rootId,
      checkpoint: {
        kind: 'happier.workflow-checkpoint.v1',
        rootRecordId: rootId,
        nextSequence: '1',
        frontier: { nextBlockOrdinal: 0, paused: false },
      },
      revision: 0,
      kinds: new Map(),
    });
    const rootKey = workflowInvocationKey({ runId, blockId: '$root', scope: [], attempt: 0 });
    const creationIntent = {
      kind: 'git_worktree' as const,
      sourceDirectory: '/repo',
      baseRef: 'a'.repeat(40),
      displayName: 'workflow-root',
      branchMode: 'new' as const,
    };
    const descriptor = { machineId, directory: '/worktree', checkoutRootPath: '/worktree' };

    const first = store.commitFact({ key: rootKey, lifecycle: 'running', workspace: { creationIntent } });
    await Promise.resolve();
    const second = store.commitFact({ key: rootKey, lifecycle: 'running', workspace: { descriptor } });
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    const opened = openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: {
        v: 1,
        purpose: 'invocation_progress',
        accountId,
        runId,
        recordId: rootId,
        sequence: '0',
        parentRecordId: null,
        memberOrdinal: '0',
        attempt: '0',
      },
      envelope: parseWorkflowStoredContentEnvelopeV1(persistedEnvelope),
    });
    expect(opened).toMatchObject({
      kind: 'available',
      content: { workspace: { creationIntent, descriptor } },
    });
  });

  it('derives Automation host authority only from the normalized frozen program', () => {
    // The definition itself is valid, so the rejection isolates the caller
    // supplied `authorization` rather than an empty block list.
    const stored = {
      definition: { version: 1, inputs: [], defaults: {}, blocks: [onlyStep] },
      project: { machineId, directory: '/repo' },
    };
    expect(AutomationStoredWorkflowDefinitionV2Schema.safeParse(stored).success).toBe(true);
    expect(AutomationStoredWorkflowDefinitionV2Schema.safeParse({
      ...stored,
      authorization: { admittedPermissionCeiling: 'yolo', principal: { kind: 'host' } },
    }).success).toBe(false);
  });

  it('keeps the structural root running when the parent is recoverably interrupted', () => {
    expect(projectWorkflowRootSettlementLifecycle('interrupted', 'running')).toBe('running');
    expect(projectWorkflowRootSettlementLifecycle('failed', 'running')).toBe('failed');
  });

  it('keeps result-delivery custody pending when Session admission is uncertain', () => {
    expect(projectWorkflowResultDeliverySettlement('accepted')).toBe('accepted');
    expect(projectWorkflowResultDeliverySettlement('alreadyAccepted')).toBe('accepted');
    expect(projectWorkflowResultDeliverySettlement('outcomeUnknown')).toBeNull();
    expect(projectWorkflowResultDeliverySettlement('rejected')).toBe('unavailable');
    expect(projectWorkflowResultDeliverySettlement('update_required')).toBe('unavailable');
  });

  it('requests same-transition custody settlement for every terminal result with no pending delivery', () => {
    expect(projectWorkflowTerminalCustodySettlement('succeeded', false)).toBe('settled');
    expect(projectWorkflowTerminalCustodySettlement('failed', false)).toBe('settled');
    expect(projectWorkflowTerminalCustodySettlement('cancelled', false)).toBe('settled');
    expect(projectWorkflowTerminalCustodySettlement('outcome_uncertain', false)).toBe('settled');
    expect(projectWorkflowTerminalCustodySettlement('interrupted', false)).toBeUndefined();
    expect(projectWorkflowTerminalCustodySettlement('paused', false)).toBeUndefined();
    expect(projectWorkflowTerminalCustodySettlement('succeeded', true)).toBeUndefined();
  });

  it('rejects a Run admitted for another Machine before initializing workflow progress', async () => {
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain',
      binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId },
      acceptedSnapshot: {
        definition: { version: 1, inputs: [], defaults: {}, blocks: [onlyStep] },
        inputs: {},
        machineId: 'machine-other',
        executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-other', directory: '/repo', checkoutRootPath: '/repo' } },
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
        source: { kind: 'automation', automationId: 'automation-1' },
      },
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation !== 'get') throw new Error(`unexpected:${String(operation.operation)}`);
      return {
        run: {
          id: runId, origin: { kind: 'automation', automationId: 'automation-1' }, state: 'queued', revision: 0,
          machineId: 'machine-other', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
          availability, createdAt: now, updatedAt: now,
        },
        acceptedEnvelope,
        checkpointEnvelope: null,
        resultEnvelope: null,
      };
    });
    const coordinate = createProductionWorkflowRunCoordinator({
      token: 'token', accountId, machineId,
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      isAcceptedAuthorizationCurrent: async () => true,
      execution: productionExecution(),
      onCommittedTransition: vi.fn(),
      storage: { execute },
    });
    await expect(coordinate({ runId, attempt: 0, expectedRevision: 0,
      accountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null }, acceptedEnvelope,
      automationEvidenceEnvelope: null })).resolves.toEqual({ state: 'failed', reason: 'workspace_conflict' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('resolves an Automation workspace reference from current settings at claim admission', async () => {
    const oldRef: import('@happier-dev/protocol').WorkspaceRefV1 = {
      id: 'workspace-1', serverId: 'server-1', machineId,
      rootPath: '/old-root', createdAtMs: 1,
    };
    const currentRef: import('@happier-dev/protocol').WorkspaceRefV1 = {
      id: 'workspace-1', serverId: 'server-1', machineId,
      rootPath: '/current-root', createdAtMs: 2,
    };
    let currentWorkspaceRefs: readonly import('@happier-dev/protocol').WorkspaceRefV1[] = [oldRef];
    let resolvedRef: import('@happier-dev/protocol').WorkspaceRefV1 | null = null;
    const coordinate = createProductionWorkflowRunCoordinator({
      token: 'token', accountId, machineId,
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      isAcceptedAuthorizationCurrent: async () => true,
      execution: productionExecution(),
      resolveCurrentWorkspaceRefs: async () => currentWorkspaceRefs,
      prepareAcceptedWorkspaceTarget: async ({ resolveWorkspaceRef }) => {
        resolvedRef = resolveWorkspaceRef?.('workspace-1') ?? null;
        return { ok: false as const, code: 'workspace_unavailable' as const };
      },
      onCommittedTransition: vi.fn(),
      storage: { execute: vi.fn() },
    });
    currentWorkspaceRefs = [currentRef];

    await expect(coordinate({
      runId,
      attempt: 0,
      expectedRevision: 0,
      accountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null },
      automationId: 'automation-1',
      automationCause: { kind: 'manual', invokedAt: 1 },
      definitionEnvelope: JSON.stringify({
        t: 'plain',
        v: {
          definition: { version: 1, inputs: [], defaults: {}, blocks: [onlyStep] },
          project: { machineId, directory: '/old-root', workspaceRefId: 'workspace-1' },
        },
      }),
      automationEvidenceEnvelope: null,
    })).resolves.toEqual({ state: 'failed', reason: 'workspace_unavailable' });
    expect(resolvedRef).toEqual(currentRef);

    currentWorkspaceRefs = [];
    resolvedRef = oldRef;
    await expect(coordinate({
      runId: '1d4dd16c-d69b-4115-a3b0-e3c92f47f3bd',
      attempt: 0,
      expectedRevision: 0,
      accountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null },
      automationId: 'automation-1',
      automationCause: { kind: 'manual', invokedAt: 2 },
      definitionEnvelope: JSON.stringify({
        t: 'plain',
        v: {
          definition: { version: 1, inputs: [], defaults: {}, blocks: [onlyStep] },
          project: { machineId, directory: '/old-root', workspaceRefId: 'workspace-1' },
        },
      }),
      automationEvidenceEnvelope: null,
    })).resolves.toEqual({ state: 'failed', reason: 'workspace_unavailable' });
    expect(resolvedRef).toBeNull();
  });

  it('freezes an Automation definition and evidence before durable row admission, Session execution, and parent settlement', async () => {
    const definition = {
      version: 1 as const,
      inputs: [
        { name: 'request', valueType: 'string' as const, required: true },
        { name: 'permissionMode', valueType: 'string' as const, required: false },
        { name: 'authorization', valueType: 'json' as const, required: false },
      ],
      defaults: {
        agentTarget: { kind: 'agent' as const, identity: { pluginId: 'happier.agent.test', localId: 'test' } },
        conversation: { kind: 'existing_session' as const, sessionId: 'session-1', machineId },
      },
      blocks: [{ kind: 'step' as const, id: 'work', document: { text: 'work', references: [], attachments: [] }, input: [], result: { kind: 'text' as const } }],
      finalOutput: { kind: 'result' as const, producer: { blockId: 'work', scope: { kind: 'current' as const } }, path: [] },
    };
    const definitionEnvelope = JSON.stringify({ t: 'plain', v: {
      definition,
      project: { machineId, directory: '/repo' },
    } });
    const automationEvidenceEnvelope = JSON.stringify({
      t: 'plain',
      v: { request: 'ship it', permissionMode: 'yolo', authorization: { admittedPermissionCeiling: 'yolo' } },
    });
    let acceptedEnvelope: string | null = null;
    let revision = 0;
    let checkpointEnvelope: string | null = null;
    let persistedResultEnvelope: string | null = null;
    let durableState = 'queued';
    let durableCustody: 'pending' | 'settled' = 'pending';
    let lostFinalTransitionResponse = false;
    const rows = new Map<string, { index: Record<string, unknown>; contentEnvelope: string }>();
    const summary = (state: string) => ({ id: runId, origin: { kind: 'automation', automationId: 'automation-1' }, state,
      revision, machineId, workflowCustodyState: durableCustody, workflowResultDeliveryState: null,
      availability, createdAt: now, updatedAt: now });
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      switch (operation.operation) {
        case 'accepted-snapshot.resolve': {
          expect(operation).toMatchObject({
            automationId: 'automation-1', expectedAttempt: 0, expectedRevision: 0, definitionEnvelope,
          });
          const candidate = operation.acceptedEnvelope;
          expect(typeof candidate).toBe('string');
          const opened = openWorkflowAcceptedSnapshotStoredEnvelopeV1({
            mode: 'plain',
            binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId },
            envelope: parseWorkflowStoredContentEnvelopeV1(candidate),
          });
          expect(opened).toMatchObject({ kind: 'available', content: {
            definition,
            inputs: {
              request: 'ship it',
              permissionMode: 'yolo',
              authorization: { admittedPermissionCeiling: 'yolo' },
            },
            machineId,
            executionTarget: { kind: 'session' },
            workspaceTarget: { project: { machineId, directory: '/repo', checkoutRootPath: '/repo' } },
            authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
            source: { kind: 'automation', automationId: 'automation-1' },
          } });
          acceptedEnvelope = candidate as string;
          revision = 1;
          return { disposition: 'created', acceptedEnvelope, run: summary('queued') };
        }
        case 'get': return { run: summary(durableState), acceptedEnvelope, checkpointEnvelope, resultEnvelope: persistedResultEnvelope };
        case 'initialize': {
          revision = 1;
          durableState = 'running';
          checkpointEnvelope = operation.checkpointEnvelope as string;
          const root = operation.rootInvocation as { id: string; contentEnvelope: string };
          rows.set(root.id, { index: { id: root.id, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'pending', createdAt: now, updatedAt: now }, contentEnvelope: root.contentEnvelope });
          return { initialization: 'created', run: summary('running') };
        }
        case 'invocations.list': return { invocations: [...rows.values()].map((row) => row.index).filter((index) => {
          if (operation.parentRecordId !== undefined && index.parentRecordId !== operation.parentRecordId) return false;
          const lifecycles = operation.lifecycles;
          return !Array.isArray(lifecycles) || lifecycles.includes(index.lifecycle);
        }), parentRevision: revision };
        case 'invocations.get': return { invocation: { index: rows.get(operation.invocationId as string)!.index,
          contentEnvelope: rows.get(operation.invocationId as string)!.contentEnvelope, parentRevision: revision } };
        case 'invocations.admit': {
          const item = (operation.invocations as Array<Record<string, unknown>>)[0]!;
          expect(item.sequence).toBe('1');
          revision += 1;
          checkpointEnvelope = operation.checkpointEnvelope as string;
          const index = { id: item.id, runId, sequence: item.sequence, parentRecordId: item.parentRecordId,
            memberOrdinal: item.memberOrdinal, attempt: '0', lifecycle: 'pending', createdAt: now, updatedAt: now };
          rows.set(item.id as string, { index, contentEnvelope: item.contentEnvelope as string });
          return { disposition: 'created', parentRevision: revision, invocations: [index] };
        }
        case 'invocations.fact': {
          const row = rows.get(operation.invocationId as string)!;
          row.index = { ...row.index, lifecycle: operation.lifecycle };
          row.contentEnvelope = operation.contentEnvelope as string;
          return row.index;
        }
        case 'transition': {
          expect(operation.expectedRevision).toBe(revision);
          revision += 1;
          durableState = operation.state as string;
          checkpointEnvelope = operation.checkpointEnvelope as string;
          if (typeof operation.resultEnvelope === 'string') persistedResultEnvelope = operation.resultEnvelope;
          if (operation.custodyState === 'settled') durableCustody = 'settled';
          for (const item of (operation.invocationTransitions ?? []) as Array<Record<string, unknown>>) {
            const row = rows.get(item.id as string)!;
            row.index = { ...row.index, lifecycle: item.lifecycle };
          }
          if (typeof operation.resultEnvelope === 'string' && !lostFinalTransitionResponse) {
            lostFinalTransitionResponse = true;
            throw new Error('simulated_lost_transition_response');
          }
          return summary(durableState);
        }
        default: throw new Error(`unexpected:${String(operation.operation)}`);
      }
    });
    const enqueue = vi.fn(async (input: Readonly<Record<string, unknown>>) => {
      expect(input).toMatchObject({
        sessionId: 'session-1',
        workflow: { purpose: 'invocation', runId, invocationRecordId: expect.any(String) },
      });
      return { status: 'accepted' as const, localId: 'local-1' };
    });
    const observe = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'local-1',
      result: { kind: 'final_text' as const, text: 'done' },
    }));
    const onCommittedTransition = vi.fn();
    const coordinate = createProductionWorkflowRunCoordinator({
      token: 'token', accountId, machineId,
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      isAcceptedAuthorizationCurrent: async () => true,
      execution: productionExecution({ preflight: () => ({ ok: true }), enqueue, observe }),
      prepareAcceptedWorkspaceTarget: async () => ({
        ok: true,
        workspaceTarget: { project: { machineId, directory: '/repo', checkoutRootPath: '/repo' } },
      }),
      // Recorded-workspace verification reaches the SCM owner through the
      // daemon-applied plugin runtime, which no unit process provides.
      workspaceScm: { verifyRecordedWorkspace: async () => 'available' as const },
      onCommittedTransition,
      storage: { execute },
    });
    const claimClient = {
      startRun: vi.fn(), heartbeatRun: vi.fn(async () => {}), succeedRun: vi.fn(), failRun: vi.fn(),
    };
    await executeClaimedRun({
      token: 'token', machineId, claimClient: claimClient as never, spawnSession: vi.fn(),
      heartbeatMs: 60_000, leaseDurationMs: 120_000, coordinateWorkflowRun: coordinate,
      claimed: {
        protocol: 'v3', accountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null },
        automation: { id: 'automation-1' },
        run: {
          id: runId, automationId: 'automation-1', attempt: 0, revision: 0,
          origin: { kind: 'automation', automationId: 'automation-1' }, recipeKind: 'workflow-v2',
          executionInputEnvelope: definitionEnvelope, automationEvidenceEnvelope,
          cause: { kind: 'conversation', occurrenceKey: 'A'.repeat(43), occurredAt: 1 }, triggerId: null,
        },
      } as never,
    });
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ operation: 'accepted-snapshot.resolve' });
    expect(claimClient.startRun).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.admit')).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'transition')).toBe(true);
    for (const [operation] of execute.mock.calls) {
      if (['accepted-snapshot.resolve', 'initialize', 'invocations.admit', 'invocations.fact', 'transition']
        .includes(String(operation.operation))) {
        expect(operation.accountCurrentness).toEqual({ mode: 'plain', version: 1, contentKeyFingerprint: null });
      }
    }
    const transitions = execute.mock.calls.map(([operation]) => operation).filter((operation) => operation.operation === 'transition');
    expect(transitions.at(-1)).toMatchObject({
      resultEnvelope: expect.any(String),
      invocationTransitions: [expect.objectContaining({ expectedLifecycle: 'running', lifecycle: 'completed' })],
    });
    expect(onCommittedTransition).toHaveBeenCalledOnce();
    expect(lostFinalTransitionResponse).toBe(true);
  });
});
