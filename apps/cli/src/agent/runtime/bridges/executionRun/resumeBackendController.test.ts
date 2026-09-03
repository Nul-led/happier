import { describe, expect, it } from 'vitest';

import type { ExecutionRunState } from '@/agent/runtime/bridges/executionRun/executionRunTypes';
import { resumeBackendControllerForResumableRun } from '@/agent/runtime/bridges/executionRun/resumeBackendController';
import { createTestExecutionRunHostRuntime } from './testkit/runtime';
import { startExecutionRun } from './startExecutionRun';
import { VoiceAgentManager } from '@/agent/voice/agent/VoiceAgentManager';
import { ExecutionBudgetRegistry } from '@/daemon/executionBudget/ExecutionBudgetRegistry';

describe('resumeBackendControllerForResumableRun', () => {
  it('admits only one concurrent resume occurrence for the same run', async () => {
    let releaseResumeSupport!: () => void;
    const resumeSupportGate = new Promise<void>((resolve) => {
      releaseResumeSupport = resolve;
    });
    let runtimeCount = 0;
    let provisionCount = 0;
    const run: ExecutionRunState = {
      runId: 'run_concurrent',
      callId: 'call_concurrent',
      sidechainId: 'sidechain_concurrent',
      sessionId: 'parent_session_1',
      depth: 0,
      intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      backendId: 'codex',
      instructions: '',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'cancelled',
      startedAtMs: 1,
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        providerSessionId: 'vendor_session_1',
      },
    };
    const runs = new Map([[run.runId, run]]);
    const controllers = new Map();
    const common = {
      runId: run.runId,
      run,
      runs,
      controllers,
      budgetRegistry: null,
      createRuntime: () => {
        runtimeCount += 1;
        return createTestExecutionRunHostRuntime({
          readResumeSupport: async () => {
            await resumeSupportGate;
            return true;
          },
          provisionSession: async () => {
            provisionCount += 1;
            return { sessionId: `child_${runtimeCount}` };
          },
        }).runtime;
      },
      sendAcp: async () => undefined,
      parentProvider: 'codex' as const,
      streamedTranscriptSession: null,
      writeActivityMarker: async () => undefined,
      getNowMs: () => 1,
    };

    const first = resumeBackendControllerForResumableRun(common);
    await Promise.resolve();
    const second = resumeBackendControllerForResumableRun(common);
    releaseResumeSupport();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ ok: true });
    expect(secondResult).toMatchObject({ ok: false, errorCode: 'execution_run_not_allowed' });
    expect(runtimeCount).toBe(1);
    expect(provisionCount).toBe(1);
    expect(controllers.get(run.runId)?.kind).toBe('backend');
  });

  it('retires a provisioned child when the exact resume occurrence was stopped before provisioning settled', async () => {
    let releaseProvision!: () => void;
    let provisionStarted!: () => void;
    const provisionStartedPromise = new Promise<void>((resolve) => {
      provisionStarted = resolve;
    });
    const provisionGate = new Promise<void>((resolve) => {
      releaseProvision = resolve;
    });
    const cancelledChildren: string[] = [];
    const runtimeHarness = createTestExecutionRunHostRuntime({
      readResumeSupport: async () => true,
      provisionSession: async () => {
        provisionStarted();
        await provisionGate;
        return { sessionId: 'late_child' };
      },
      cancel: async (sessionId) => {
        cancelledChildren.push(sessionId);
      },
    });
    const run: ExecutionRunState = {
      runId: 'run_stopped',
      callId: 'call_stopped',
      sidechainId: 'sidechain_stopped',
      sessionId: 'parent_session_1',
      depth: 0,
      intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      backendId: 'codex',
      instructions: '',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'running',
      startedAtMs: 1,
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        providerSessionId: 'vendor_session_1',
      },
    };
    const stoppedRun = { ...run, status: 'cancelled' as const, finishedAtMs: 2 };
    const runs = new Map([[run.runId, run]]);
    const controllers = new Map();
    const publicUpdates: string[] = [];

    const resultPromise = resumeBackendControllerForResumableRun({
      runId: run.runId,
      run,
      runs,
      controllers,
      budgetRegistry: null,
      createRuntime: () => runtimeHarness.runtime,
      sendAcp: async () => undefined,
      parentProvider: 'codex',
      streamedTranscriptSession: null,
      writeActivityMarker: async () => undefined,
      getNowMs: () => 1,
      onPublicStateUpdated: (runId) => publicUpdates.push(runId),
    });
    await provisionStartedPromise;
    const provisionalController = controllers.get(run.runId);
    expect(provisionalController?.kind).toBe('backend');
    if (!provisionalController) throw new Error('resume controller was not registered');
    provisionalController.cancelled = true;
    controllers.delete(run.runId);
    runs.set(run.runId, stoppedRun);
    releaseProvision();

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      errorCode: 'execution_run_not_allowed',
    });
    expect(runs.get(run.runId)).toBe(stoppedRun);
    expect(cancelledChildren).toEqual(['late_child']);
    expect(publicUpdates).toEqual([]);
  });

  it('releases only the superseded resume occurrence budget after late provisioning settles', async () => {
    let releaseProvision!: () => void;
    let provisionStarted!: () => void;
    const provisionGate = new Promise<void>((resolve) => {
      releaseProvision = resolve;
    });
    const provisionStartedPromise = new Promise<void>((resolve) => {
      provisionStarted = resolve;
    });
    const cancelledChildren: string[] = [];
    const runtime = createTestExecutionRunHostRuntime({
      readResumeSupport: async () => true,
      provisionSession: async () => {
        provisionStarted();
        await provisionGate;
        return { sessionId: 'superseded_child' };
      },
      cancel: async (sessionId) => {
        cancelledChildren.push(sessionId);
      },
    }).runtime;
    const run: ExecutionRunState = {
      runId: 'run_superseded_budget',
      callId: 'call_superseded_budget',
      sidechainId: 'sidechain_superseded_budget',
      sessionId: 'parent_session_1',
      depth: 0,
      intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      backendId: 'codex',
      instructions: '',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'cancelled',
      startedAtMs: 1,
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        providerSessionId: 'vendor_session_1',
      },
    };
    const runs = new Map([[run.runId, run]]);
    const controllers = new Map();
    const budgetRegistry = new ExecutionBudgetRegistry({
      maxConcurrentExecutionRuns: 1,
      maxConcurrentOneShotTasks: null,
    });

    const resultPromise = resumeBackendControllerForResumableRun({
      runId: run.runId,
      run,
      runs,
      controllers,
      budgetRegistry,
      createRuntime: () => runtime,
      sendAcp: async () => undefined,
      parentProvider: 'codex',
      streamedTranscriptSession: null,
      writeActivityMarker: async () => undefined,
      getNowMs: () => 1,
    });
    await provisionStartedPromise;
    expect(budgetRegistry.getInFlightSnapshot().executionRuns).toBe(1);

    runs.set(run.runId, { ...run, summary: 'superseded occurrence' });
    releaseProvision();

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      errorCode: 'execution_run_not_allowed',
    });
    expect(cancelledChildren).toEqual(['superseded_child']);
    expect(controllers.has(run.runId)).toBe(false);
    expect(budgetRegistry.getInFlightSnapshot().executionRuns).toBe(0);
  });

  it('persists a cloned runtime account settings snapshot when starting a run', async () => {
    const runtime = createTestExecutionRunHostRuntime().runtime;
    const accountSettings: Record<string, unknown> = {
      customExecutionRunRuntimeSettings: {
        mode: 'start-time',
      },
    };
    const runs = new Map<string, ExecutionRunState>();
    const voiceAgentManager = new VoiceAgentManager({
      createRuntime: () => {
        throw new Error('voice runtime should not be used by this test');
      },
    });

    try {
      const started = await startExecutionRun({
        params: {
          sessionId: 'parent_session_1',
          intent: 'delegate',
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
          accountSettings,
          instructions: '',
          permissionMode: 'read_only',
          retentionPolicy: 'resumable',
          runClass: 'long_lived',
          ioMode: 'request_response',
        },
        parentProvider: 'codex',
        sendAcp: async () => undefined,
        streamedTranscriptSession: null,
        createRuntime: () => runtime,
        getNowMs: () => 1_700_000_000_000,
        budgetRegistry: null,
        runs,
        controllers: new Map(),
        enqueueMarkerWrite: async () => undefined,
        writeActivityMarker: async () => undefined,
        finishRun: async () => undefined,
        executeBoundedRun: async () => undefined,
        send: async () => ({ ok: true }),
        voiceAgentManager,
        getDepthByCallId: () => null,
      });

      (accountSettings.customExecutionRunRuntimeSettings as Record<string, unknown>).mode = 'current-settings';

      expect(runs.get(started.runId)?.runtimeSettings?.accountSettings).toEqual({
        customExecutionRunRuntimeSettings: {
          mode: 'start-time',
        },
      });
    } finally {
      await voiceAgentManager.dispose();
    }
  });

  it('resumes using loadSession when loadSessionWithReplayCapture is unavailable', async () => {
    let disposed = false;
    const runtime = createTestExecutionRunHostRuntime({
      async provisionSession(opts) {
        return { sessionId: opts?.resumeSessionId ? 'child_session_2' : 'child_session_1' };
      },
      async dispose() {
        disposed = true;
      },
    }).runtime;

    const run: ExecutionRunState = {
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'sidechain_1',
      sessionId: 'parent_session_1',
      depth: 0,
      intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      backendId: 'codex',
      instructions: '',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'cancelled',
      startedAtMs: 1_700_000_000_000,
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        providerSessionId: 'vendor_session_1',
      },
    };

    const controllers = new Map();
    const runs = new Map([[run.runId, run]]);
    const res = await resumeBackendControllerForResumableRun({
      runId: run.runId,
      run,
      runs,
      controllers,
      budgetRegistry: null,
      createRuntime: (_opts) => runtime,
      sendAcp: async () => undefined,
      parentProvider: 'codex',
      streamedTranscriptSession: null,
      writeActivityMarker: async () => undefined,
      getNowMs: () => 1,
    });

    expect(res).toEqual({ ok: true });
    expect(disposed).toBe(false);
    expect(runs.get(run.runId)?.status).toBe('running');
    expect(controllers.has(run.runId)).toBe(true);
  });

  it('passes persisted runtime account settings to the recreated backend runtime', async () => {
    const runtime = createTestExecutionRunHostRuntime({
      provisionSession: async (opts) => ({ sessionId: opts?.resumeSessionId ? 'child_session_2' : 'child_session_1' }),
    }).runtime;
    const runtimeOptions: Array<Readonly<Record<string, unknown>>> = [];

    const run: ExecutionRunState & {
      runtimeSettings: {
        accountSettings: Readonly<Record<string, unknown>>;
      };
    } = {
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'sidechain_1',
      sessionId: 'parent_session_1',
      depth: 0,
      intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      backendId: 'codex',
      instructions: '',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'cancelled',
      startedAtMs: 1_700_000_000_000,
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        providerSessionId: 'vendor_session_1',
      },
      runtimeSettings: {
        accountSettings: {
          customExecutionRunRuntimeSettings: {
            mode: 'start-time',
          },
        },
      },
    };

    const controllers = new Map();
    const runs = new Map([[run.runId, run]]);
    const res = await resumeBackendControllerForResumableRun({
      runId: run.runId,
      run,
      runs,
      controllers,
      budgetRegistry: null,
      createRuntime: (opts) => {
        runtimeOptions.push({ ...opts });
        return runtime;
      },
      sendAcp: async () => undefined,
      parentProvider: 'codex',
      streamedTranscriptSession: null,
      writeActivityMarker: async () => undefined,
      getNowMs: () => 1,
    });

    expect(res).toEqual({ ok: true });
    expect(runtimeOptions[0]?.accountSettings).toEqual({
      customExecutionRunRuntimeSettings: {
        mode: 'start-time',
      },
    });
  });
});
