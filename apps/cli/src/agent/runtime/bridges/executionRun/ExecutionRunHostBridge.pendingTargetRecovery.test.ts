import { describe, expect, it, vi } from 'vitest';

import type { ExecutionRunState } from './executionRunTypes';
import { ExecutionRunHostBridge } from './ExecutionRunHostBridge';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { createBundledPluginPublicationFsFixture } = await import('@/plugins/projection/registry/builtIn/locators.testkit');
  return createBundledPluginPublicationFsFixture(actual);
});

vi.mock('./createExecutionRunBridgeRuntime', () => ({
  createExecutionRunBridgeRuntime: vi.fn(() => {
    throw new Error('pending target recovery must not create a runtime outside canonical ensure');
  }),
}));

const TEST_BACKEND_ID = `${'test'}.${'agent'}` as never;

function runState(overrides: Partial<ExecutionRunState> = {}): ExecutionRunState {
  return {
    runId: 'run-1',
    callId: 'call-1',
    sidechainId: 'sidechain-1',
    sessionId: 'session-1',
    depth: 0,
    intent: 'delegate',
    backendTarget: { kind: 'builtInAgent', agentId: TEST_BACKEND_ID },
    backendId: TEST_BACKEND_ID,
    instructions: 'Continue.',
    permissionMode: 'read_only',
    retentionPolicy: 'resumable',
    runClass: 'long_lived',
    ioMode: 'streaming',
    status: 'running',
    startedAtMs: 1,
    resumeHandle: {
      kind: 'provider_session.v1',
      backendTarget: { kind: 'backend', backendId: TEST_BACKEND_ID, sourceKind: 'built_in' },
      providerSessionId: 'provider-session-1',
    },
    ...overrides,
  };
}

function createHarness() {
  const listExecutionRunPendingDeliveryStatuses = vi.fn(async () => [
    { localId: 'queued-1', status: 'queued' as const, deliveryStatus: { status: 'queued' as const } },
    { localId: 'blocked-1', status: 'blocked' as const, deliveryStatus: { status: 'blocked' as const, reason: 'session_input_target_unavailable' as const } },
  ]);
  const blockExecutionRunPendingDelivery = vi.fn(async () => true);
  const enqueueAgentMessageCommitted = vi.fn(async () => ({ persisted: true, delivered: false }));
  const manager = new ExecutionRunHostBridge({
    parentProvider: TEST_BACKEND_ID,
    cwd: process.cwd(),
    sendAcp: async () => {},
    sessionInteractionHost: {
      session: {
        sessionId: 'session-1',
        getMetadataSnapshot: () => null,
        updateMetadata: vi.fn(),
        updateAgentState: vi.fn(),
        enqueueAgentMessageCommitted,
        listExecutionRunPendingDeliveryStatuses,
        blockExecutionRunPendingDelivery,
      },
      machineId: 'machine-1',
      permissionHandler: { handleToolCall: vi.fn() },
    },
  });
  const runs = (manager as unknown as { runs: Map<string, ExecutionRunState> }).runs;
  const controllers = (manager as unknown as { controllers: Map<string, unknown> }).controllers;
  return {
    manager,
    runs,
    controllers,
    listExecutionRunPendingDeliveryStatuses,
    blockExecutionRunPendingDelivery,
    enqueueAgentMessageCommitted,
  };
}

describe('ExecutionRunHostBridge pending target recovery', () => {
  it('leaves an unknown target queued without ensure or block', async () => {
    const harness = createHarness();
    const ensure = vi.spyOn(harness.manager, 'ensure');

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(ensure).not.toHaveBeenCalled();
    expect(harness.blockExecutionRunPendingDelivery).not.toHaveBeenCalled();
  });

  it('uses canonical ensure for a proven resumable unloaded target and leaves it queued', async () => {
    const harness = createHarness();
    harness.runs.set('run-1', runState());
    const ensure = vi.spyOn(harness.manager, 'ensure').mockResolvedValue({
      ok: false,
      errorCode: 'execution_run_failed',
      error: 'temporarily unavailable',
      resumeFailureKind: 'indeterminate',
    });

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(ensure).toHaveBeenCalledWith('run-1', { resume: true });
    expect(harness.blockExecutionRunPendingDelivery).not.toHaveBeenCalled();
    harness.runs.clear();
  });

  it('blocks when canonical backend ensure proves the retained target cannot resume', async () => {
    const harness = createHarness();
    harness.runs.set('run-1', runState());
    const ensure = vi.spyOn(harness.manager, 'ensure').mockResolvedValue({
      ok: false,
      errorCode: 'execution_run_not_allowed',
      error: 'Backend does not support resume',
      resumeFailureKind: 'permanent',
    });

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(ensure).toHaveBeenCalledWith('run-1', { resume: true });
    expect(harness.enqueueAgentMessageCommitted).not.toHaveBeenCalled();
    expect(harness.blockExecutionRunPendingDelivery).toHaveBeenCalledOnce();
    expect(harness.blockExecutionRunPendingDelivery).toHaveBeenCalledWith('run-1', 'queued-1');
    harness.runs.clear();
  });

  it('does not block when a concurrent resume installs the target controller', async () => {
    const harness = createHarness();
    harness.runs.set('run-1', runState());
    vi.spyOn(harness.manager, 'ensure').mockImplementation(async () => {
      harness.controllers.set('run-1', {
        kind: 'backend',
        cancelled: false,
        backend: { interaction: {} },
      });
      return {
        ok: false,
        errorCode: 'execution_run_not_allowed',
        error: 'Resume already in progress',
        resumeFailureKind: 'indeterminate',
      };
    });

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(harness.blockExecutionRunPendingDelivery).not.toHaveBeenCalled();
    harness.controllers.clear();
    harness.runs.clear();
  });

  it('keeps a superseded resume queued after its provisional controller has retired', async () => {
    const harness = createHarness();
    harness.runs.set('run-1', runState());
    vi.spyOn(harness.manager, 'ensure').mockResolvedValue({
      ok: false,
      errorCode: 'execution_run_not_allowed',
      error: 'Resume was superseded',
      resumeFailureKind: 'indeterminate',
    });

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(harness.controllers.has('run-1')).toBe(false);
    expect(harness.blockExecutionRunPendingDelivery).not.toHaveBeenCalled();
    harness.runs.clear();
  });

  it('keeps a Voice target queued when its resume attempt is not currently allowed', async () => {
    const harness = createHarness();
    harness.runs.set('run-1', runState({ intent: 'voice_agent' }));
    vi.spyOn(harness.manager, 'ensure').mockResolvedValue({
      ok: false,
      errorCode: 'execution_run_not_allowed',
      error: 'Voice runtime is retiring',
      resumeFailureKind: 'indeterminate',
    });

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(harness.blockExecutionRunPendingDelivery).not.toHaveBeenCalled();
    harness.runs.clear();
  });

  it.each([
    ['terminal', { status: 'failed' as const }],
    ['wrong Session', { sessionId: 'session-2' }],
    ['noninteractive', { runClass: 'bounded' as const, retentionPolicy: 'ephemeral' as const }],
    ['permanently unavailable', { resumeHandle: null }],
  ])('blocks only the queued exact row for a proven %s target', async (_label, overrides) => {
    const harness = createHarness();
    harness.runs.set('run-1', runState(overrides));
    const ensure = vi.spyOn(harness.manager, 'ensure');

    await harness.manager.reconcilePendingExecutionRunTarget('run-1');

    expect(ensure).not.toHaveBeenCalled();
    expect(harness.enqueueAgentMessageCommitted).not.toHaveBeenCalled();
    expect(harness.blockExecutionRunPendingDelivery).toHaveBeenCalledTimes(1);
    expect(harness.blockExecutionRunPendingDelivery).toHaveBeenCalledWith('run-1', 'queued-1');
    harness.runs.clear();
  });
});
