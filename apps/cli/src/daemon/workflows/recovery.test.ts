import { describe, expect, it, vi } from 'vitest';
import {
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowCheckpointStoredEnvelopeV1,
  sealWorkflowFinalResultStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  type JsonValue,
} from '@happier-dev/protocol';

import { createWorkflowRunRecoveryReader } from './recovery';
import { projectWorkflowResultDeliverySettlement } from './production';

const accountId = 'account-1';
const machineId = 'machine-1';
const runId = '7be4d65c-d3b7-4868-a416-b18d9ee29c1c';
const now = '2026-09-08T12:00:00.000Z';
const availability = { pause: false, resumeBoundary: false, recoverSameConversation: false,
  recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: false, inspectExecution: true, disabledReasons: [] };

function isPlainAccountCurrentness(value: unknown): boolean {
  return value !== null && typeof value === 'object' && 'mode' in value && value.mode === 'plain';
}

function directAcceptedEnvelope() {
  return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
    mode: 'plain',
    binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId },
    acceptedSnapshot: {
      definition: { version: 1, inputs: [], defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'agent.test', localId: 'test' } } }, blocks: [{
        kind: 'step', id: 'step', document: { text: 'Work', references: [], attachments: [] }, input: [], result: { kind: 'text' },
      }] },
      source: { kind: 'inline' }, inputs: {}, machineId,
      executionTarget: { kind: 'session' },
      workspaceTarget: { project: { machineId, directory: '/repo', checkoutRootPath: '/repo', workspaceRefId: 'workspace-1' }, originalCommittedRevision: 'a'.repeat(40) },
      origin: { kind: 'direct', originSessionId: 'session-origin' },
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      resultDelivery: { kind: 'originating_session', originSessionId: 'session-origin', localInputId: `workflow-run:${runId}:result-delivery` },
    },
  }));
}

function finalResultEnvelope(result: { kind: 'text'; value: string } | { kind: 'json'; value: JsonValue } = { kind: 'text', value: 'selected result' }) {
  return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowFinalResultStoredEnvelopeV1({
    mode: 'plain', binding: { v: 1, purpose: 'final_result', accountId, runId },
    finalResult: {
      kind: 'happier.workflow-final-result.v1',
      result,
      producerInvocation: { recordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c' },
    },
  }));
}

function checkpointEnvelope() {
  return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
    mode: 'plain',
    binding: { v: 1, purpose: 'checkpoint', accountId, runId },
    checkpoint: {
      kind: 'happier.workflow-checkpoint.v1',
      rootRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
      nextSequence: '8',
      frontier: { nextBlockOrdinal: 1, paused: false },
    },
  }));
}

describe('workflow Run startup/reconnect recovery', () => {
  it.each([
    ['absent', null],
    ['object', { answer: 42 }],
    ['array', [1, 2]],
    ['null', null],
  ] as const)('settles configured non-text result delivery as workflow_outcome_unresolved for %s output', async (kind, value) => {
    const run = { id: runId, origin: { kind: 'direct' as const, originSessionId: 'session-origin' }, state: 'succeeded' as const,
      revision: 9, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: 'pending' as const,
      availability, createdAt: now, updatedAt: now };
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 3 }] };
      if (operation.operation === 'get') return {
        run,
        acceptedEnvelope: directAcceptedEnvelope(),
        checkpointEnvelope: null,
        resultEnvelope: kind === 'absent' ? null : finalResultEnvelope({ kind: 'json', value }),
      };
      if (operation.operation === 'result-delivery.settle') return { run: { ...run, revision: 10 } };
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 10 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deliverResult = vi.fn();
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult,
      reconcileInvocation: vi.fn(async () => ({ kind: 'unresolved' as const })),
    });

    await recover('startup');

    expect(deliverResult).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'result-delivery.settle',
      state: 'unavailable',
      reason: 'workflow_outcome_unresolved',
    }), {});
  });

  it('pages recovery candidates and rejoins exact direct result delivery before CAS settlement', async () => {
    const run = { id: runId, origin: { kind: 'direct' as const, originSessionId: 'session-origin' }, state: 'succeeded' as const,
      revision: 9, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: 'pending' as const,
      availability, createdAt: now, updatedAt: now };
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') {
        return operation.cursor ? { candidates: [] } : { candidates: [{ run, parentAttempt: 3 }], nextCursor: 'page-2' };
      }
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: null, resultEnvelope: finalResultEnvelope() };
      if (operation.operation === 'result-delivery.settle') return { ...run, revision: 10, workflowCustodyState: 'settled', workflowResultDeliveryState: operation.state };
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 10 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deliverResult = vi.fn(async () => ({ status: 'accepted' as const, localId: 'stable' }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult,
      reconcileInvocation: vi.fn(async () => ({ kind: 'unresolved' as const })),
    });

    await recover('startup');

    expect(deliverResult).toHaveBeenCalledWith(expect.objectContaining({ runId, sessionId: 'session-origin', text: 'selected result' }));
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'result-delivery.settle'
      && operation.runId === runId && operation.parentAttempt === 3
      && operation.expectedRevision === 9 && operation.state === 'accepted')).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'recovery.list' && operation.cursor === 'page-2')).toBe(true);
  });

  it('opens only lifecycle-selected invocation rows and never coordinates or starts terminal parents', async () => {
    const invocationId = '2aaf1a39-4c48-4904-83a4-7eae318dfc2c';
    const run = { id: runId, origin: { kind: 'automation' as const, automationId: 'automation-1' }, state: 'cancelled' as const,
      revision: 4, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability, createdAt: now, updatedAt: now };
    const index = { id: invocationId, runId, sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'cancel_requested' as const, createdAt: now, updatedAt: now };
    const progress = { kind: 'happier.workflow-progress.v1' as const, invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step' as const,
      attempt: '0', logicalInvocationRecordId: invocationId, execution: { kind: 'session' as const, sessionId: 'session-1', localInputId: 'input-1' } };
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: invocationId,
        sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0' }, progress,
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 2 }] };
      if (operation.operation === 'invocations.list' && operation.limit === 1) {
        return { invocations: [], parentRevision: 4 };
      }
      if (operation.operation === 'invocations.list') {
        expect(operation.lifecycles).toEqual(['pending', 'waiting_for_capacity', 'admitting', 'running', 'waiting_for_approval', 'needs_attention', 'cancel_requested', 'outcome_uncertain']);
        return operation.cursor ? { invocations: [], parentRevision: 4 } : { invocations: [index], parentRevision: 4, nextCursor: 'inv-2' };
      }
      if (operation.operation === 'invocations.get') return { invocation: { index, contentEnvelope, parentRevision: 4 } };
      if (operation.operation === 'invocations.fact') return { ...index, lifecycle: operation.lifecycle };
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: checkpointEnvelope(), resultEnvelope: null };
      if (operation.operation === 'transition') return { ...run, revision: 5, workflowCustodyState: 'settled' };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const reconcileInvocation = vi.fn(async () => ({ kind: 'cancelled' as const, code: 'session_input_turn_cancel_requested' }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult: vi.fn(), reconcileInvocation,
    });

    await recover('reconnect');

    expect(reconcileInvocation).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({ id: run.id, state: run.state, revision: run.revision }),
      index,
      progress,
      terminalParent: true,
      cancellationRequested: true,
      parentAttempt: 2,
      trigger: 'reconnect',
    }));
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'invocations.get')).toHaveLength(1);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.fact'
      && operation.runId === runId && operation.parentAttempt === 2
      && isPlainAccountCurrentness(operation.accountCurrentness)
      && operation.invocationId === invocationId && operation.invocationAttempt === '0'
      && operation.expectedLifecycle === 'cancel_requested' && operation.lifecycle === 'cancelled')).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'transition'
      && operation.runId === runId && operation.parentAttempt === 2
      && isPlainAccountCurrentness(operation.accountCurrentness)
      && operation.expectedRevision === 4 && operation.state === 'cancelled'
      && operation.custodyState === 'settled'
      && Array.isArray(operation.invocationTransitions)
      && operation.invocationTransitions.some((transition: Readonly<Record<string, unknown>>) => transition.id === invocationId
        && transition.expectedLifecycle === 'cancelled' && transition.lifecycle === 'cancelled'))).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'initialize')).toBe(false);
  });

  it('retains pending custody after an ambiguous direct-delivery error for later stable rejoin', async () => {
    const run = { id: runId, origin: { kind: 'direct' as const, originSessionId: 'session-origin' }, state: 'succeeded' as const,
      revision: 9, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: 'pending' as const,
      availability, createdAt: now, updatedAt: now };
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 3 }] };
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: null, resultEnvelope: finalResultEnvelope() };
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 9 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult: async () => { throw new Error('connection reset after write'); },
      reconcileInvocation: vi.fn(async () => ({ kind: 'unresolved' as const })),
    });

    await expect(recover('reconnect')).resolves.toBeUndefined();
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'result-delivery.settle')).toBe(false);
  });

  it('keeps outcome-unknown direct delivery pending and discoverable for a later recovery pass', async () => {
    const run = { id: runId, origin: { kind: 'direct' as const, originSessionId: 'session-origin' }, state: 'succeeded' as const,
      revision: 9, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: 'pending' as const,
      availability, createdAt: now, updatedAt: now };
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 3 }] };
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: null, resultEnvelope: finalResultEnvelope() };
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 9 };
      if (operation.operation === 'result-delivery.settle') return { ...run, revision: 10 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deliverResult = vi.fn(async () => ({
      status: projectWorkflowResultDeliverySettlement('outcomeUnknown') ?? 'unresolved' as const,
    }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult,
      reconcileInvocation: vi.fn(async () => ({ kind: 'unresolved' as const })),
    });

    await recover('startup');
    await recover('reconnect');

    expect(deliverResult).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.filter(([operation]) => operation.operation === 'recovery.list')).toHaveLength(2);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'result-delivery.settle')).toBe(false);
  });

  it('rejoins a concurrent CAS settlement without redelivering or reopening execution', async () => {
    const pendingRun = { id: runId, origin: { kind: 'direct' as const, originSessionId: 'session-origin' }, state: 'succeeded' as const,
      revision: 9, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: 'pending' as const,
      availability, createdAt: now, updatedAt: now };
    const settledRun = { ...pendingRun, revision: 10, workflowCustodyState: 'settled' as const, workflowResultDeliveryState: 'accepted' as const };
    let getCount = 0;
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run: pendingRun, parentAttempt: 3 }] };
      if (operation.operation === 'get') {
        getCount += 1;
        return getCount === 1
          ? { run: pendingRun, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: null, resultEnvelope: finalResultEnvelope() }
          : { run: settledRun, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: null, resultEnvelope: finalResultEnvelope() };
      }
      if (operation.operation === 'result-delivery.settle') throw new Error('currentness_conflict');
      if (operation.operation === 'invocations.list') return { invocations: [], parentRevision: 10 };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const deliverResult = vi.fn(async () => ({ status: 'accepted' as const }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult, reconcileInvocation: vi.fn(async () => ({ kind: 'unresolved' as const })),
    });

    await expect(recover('reconnect')).resolves.toBeUndefined();
    expect(deliverResult).toHaveBeenCalledTimes(1);
    expect(getCount).toBe(3);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'initialize' || operation.operation === 'transition')).toBe(false);
  });

  it('reconciles a terminal structural row without native observation or rewriting its truth', async () => {
    const invocationId = '2aaf1a39-4c48-4904-83a4-7eae318dfc2c';
    const run = { id: runId, origin: { kind: 'automation' as const, automationId: 'automation-1' }, state: 'outcome_uncertain' as const,
      revision: 6, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability, createdAt: now, updatedAt: now };
    const index = { id: invocationId, runId, sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'outcome_uncertain' as const, createdAt: now, updatedAt: now };
    const progress = { kind: 'happier.workflow-progress.v1' as const, invocationPath: { blockId: '$root', scope: [] }, blockKind: 'root' as const,
      attempt: '0', logicalInvocationRecordId: invocationId,
      result: { retained: true }, reason: { code: 'delivery_ambiguous' } };
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: invocationId,
        sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0' }, progress,
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 4 }] };
      if (operation.operation === 'invocations.list') return { invocations: [index], parentRevision: 6 };
      if (operation.operation === 'invocations.get') return { invocation: { index, contentEnvelope, parentRevision: 6 } };
      if (operation.operation === 'invocations.fact') return { ...index, lifecycle: operation.lifecycle };
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: checkpointEnvelope(), resultEnvelope: null };
      if (operation.operation === 'transition') return { ...run, revision: 7, workflowCustodyState: 'settled' };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const reconcileInvocation = vi.fn(async () => ({ kind: 'unresolved' as const }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult: vi.fn(), reconcileInvocation,
    });

    await recover('startup');

    const fact = execute.mock.calls.find(([operation]) => operation.operation === 'invocations.fact')?.[0];
    expect(fact).toEqual(expect.objectContaining({
      expectedLifecycle: 'outcome_uncertain', lifecycle: 'outcome_uncertain', invocationAttempt: '0',
    }));
    const reopened = parseWorkflowStoredContentEnvelopeV1(fact?.contentEnvelope);
    const learned = reopened && openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: invocationId,
        sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0' }, envelope: reopened,
    });
    expect(learned?.kind === 'available' ? learned.content : null).toEqual(progress);
    expect(reconcileInvocation).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'transition'
      && Array.isArray(operation.invocationTransitions)
      && operation.invocationTransitions.some((transition: Readonly<Record<string, unknown>>) => transition.id === invocationId
        && transition.expectedLifecycle === 'outcome_uncertain' && transition.lifecycle === 'outcome_uncertain'))).toBe(true);
  });

  it('marks an uncertain step retryable only after its exact execution owner proves it stopped', async () => {
    const invocationId = '5aaf1a39-4c48-4904-83a4-7eae318dfc2c';
    const run = { id: runId, origin: { kind: 'direct' as const }, state: 'interrupted' as const,
      revision: 6, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability, createdAt: now, updatedAt: now };
    const index = { id: invocationId, runId, sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0',
      lifecycle: 'outcome_uncertain' as const, createdAt: now, updatedAt: now };
    const progress = { kind: 'happier.workflow-progress.v1' as const, invocationPath: { blockId: 'work', scope: [] }, blockKind: 'step' as const,
      attempt: '0', logicalInvocationRecordId: invocationId,
      execution: { kind: 'session' as const, sessionId: 'session-1', localInputId: 'input-1' } };
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: invocationId,
        sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0' }, progress,
    }));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 4 }] };
      if (operation.operation === 'invocations.list') return { invocations: [index], parentRevision: 6 };
      if (operation.operation === 'invocations.get') return { invocation: { index, contentEnvelope, parentRevision: 6 } };
      if (operation.operation === 'invocations.fact') return { ...index, lifecycle: operation.lifecycle };
      if (operation.operation === 'get') return { run, acceptedEnvelope: directAcceptedEnvelope(), checkpointEnvelope: checkpointEnvelope(), resultEnvelope: null };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult: vi.fn(), reconcileInvocation: vi.fn(async () => ({ kind: 'cancelled' as const, code: 'observed_stopped' })),
    });

    await recover('reconnect');

    const fact = execute.mock.calls.find(([operation]) => operation.operation === 'invocations.fact')?.[0];
    expect(fact).toMatchObject({
      expectedLifecycle: 'outcome_uncertain', lifecycle: 'needs_attention', resolution: 'observed_terminal_execution',
    });
    const reopened = parseWorkflowStoredContentEnvelopeV1(fact?.contentEnvelope);
    const resolved = reopened && openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: invocationId,
        sequence: '7', parentRecordId: null, memberOrdinal: '0', attempt: '0' }, envelope: reopened,
    });
    expect(resolved?.kind === 'available' ? resolved.content : null).toMatchObject({
      uncertainPriorEffects: { activity: 'stopped' }, reason: { code: 'observed_stopped' },
    });
  });

  it('settles a running cancellation through structural and executable row facts before parent custody', async () => {
    const rootId = '2aaf1a39-4c48-4904-83a4-7eae318dfc2c';
    const childId = '5ebde945-7386-438c-9bc0-12f1f7c76e76';
    const run = { id: runId, origin: { kind: 'automation' as const, automationId: 'automation-1' }, state: 'running' as const,
      revision: 8, machineId, workflowCustodyState: 'pending' as const, workflowResultDeliveryState: null,
      availability, createdAt: now, updatedAt: now };
    const indexes = [
      { id: rootId, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0', lifecycle: 'cancel_requested' as const, createdAt: now, updatedAt: now },
      { id: childId, runId, sequence: '1', parentRecordId: rootId, memberOrdinal: '0', attempt: '0', lifecycle: 'cancel_requested' as const, createdAt: now, updatedAt: now },
    ];
    const progresses = [
      { kind: 'happier.workflow-progress.v1' as const, invocationPath: { blockId: '$root', scope: [] }, blockKind: 'root' as const,
        attempt: '0', logicalInvocationRecordId: rootId },
      { kind: 'happier.workflow-progress.v1' as const, invocationPath: { blockId: 'step', scope: [] }, blockKind: 'step' as const,
        attempt: '0', logicalInvocationRecordId: childId,
        execution: { kind: 'session' as const, sessionId: 'session-1', localInputId: 'input-1' } },
    ];
    const envelopes = indexes.map((index, ordinal) => serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId, runId, recordId: index.id,
        sequence: index.sequence, parentRecordId: index.parentRecordId, memberOrdinal: '0', attempt: '0' }, progress: progresses[ordinal]!,
    })));
    const lifecycleById = new Map<string, string>(indexes.map((index) => [index.id, index.lifecycle]));
    const execute = vi.fn(async (operation: Readonly<Record<string, unknown>>) => {
      if (operation.operation === 'recovery.list') return { candidates: [{ run, parentAttempt: 5 }] };
      if (operation.operation === 'invocations.list') return { invocations: indexes };
      if (operation.operation === 'invocations.get') {
        const ordinal = indexes.findIndex((index) => index.id === operation.invocationId);
        const index = indexes[ordinal]!;
        return { invocation: { index: { ...index, lifecycle: lifecycleById.get(index.id) }, contentEnvelope: envelopes[ordinal] } };
      }
      if (operation.operation === 'invocations.fact') {
        lifecycleById.set(String(operation.invocationId), String(operation.lifecycle));
        return { lifecycle: operation.lifecycle };
      }
      if (operation.operation === 'get') return { run, checkpointEnvelope: checkpointEnvelope() };
      if (operation.operation === 'transition') return { ...run, state: 'cancelled', workflowCustodyState: 'settled' };
      throw new Error(`unexpected:${String(operation.operation)}`);
    });
    const reconcileInvocation = vi.fn(async () => ({ kind: 'completed' as const, result: 'completed-before-stop' }));
    const recover = createWorkflowRunRecoveryReader({
      accountId, machineId, storage: { execute },
      resolveAccountEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      deliverResult: vi.fn(), reconcileInvocation,
    });

    await recover('control');

    expect(reconcileInvocation).toHaveBeenCalledTimes(1);
    expect(reconcileInvocation).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'control',
      cancellationRequested: true,
    }));
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.fact'
      && operation.invocationId === rootId && operation.expectedLifecycle === 'cancel_requested' && operation.lifecycle === 'cancelled')).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'invocations.fact'
      && operation.invocationId === childId && operation.expectedLifecycle === 'cancel_requested' && operation.lifecycle === 'completed')).toBe(true);
    expect(execute.mock.calls.some(([operation]) => operation.operation === 'transition'
      && operation.state === 'cancelled' && operation.custodyState === 'settled'
      && Array.isArray(operation.invocationTransitions) && operation.invocationTransitions.length === 2)).toBe(true);
  });
});
