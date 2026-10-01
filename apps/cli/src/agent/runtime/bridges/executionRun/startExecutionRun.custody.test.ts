import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionRunInteractionV1,
  SessionInputAdmissionResultV1,
} from '@happier-dev/protocol';

import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';
import { VoiceAgentManager } from '@/agent/voice/agent/VoiceAgentManager';
import { ExecutionBudgetRegistry } from '@/daemon/executionBudget/ExecutionBudgetRegistry';

import { finishExecutionRun } from './finishExecutionRun';
import { startExecutionRun } from './startExecutionRun';
import { stopExecutionRun } from './executionRunStop';
import { sendBackendLongLivedRun } from './send/backendLongLivedPrompt';
import type { ExecutionRunState } from './executionRunTypes';
import { createTestExecutionRunHostRuntime } from './testkit';

// Only the marker's disk I/O is replaced; start and terminal settlement stay real.
const markerWrites = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/daemon/executionRunRegistry', () => ({ writeExecutionRunMarker: markerWrites }));

describe('execution run start transcript custody', () => {
  const retainedInteraction = {
    kind: 'retained_agent_session.v1',
    capabilities: {
      open: ['create', 'resume'],
      delivery: ['newTurn'],
      cancel: true,
    },
  } satisfies ExecutionRunInteractionV1;

  it('admits attached initial input before returning while backend provisioning remains pending', async () => {
    let releaseProvision!: () => void;
    let markProvisionStarted!: () => void;
    const provisionGate = new Promise<void>((resolve) => {
      releaseProvision = resolve;
    });
    const provisionStarted = new Promise<void>((resolve) => {
      markProvisionStarted = resolve;
    });
    const runs = new Map<string, ExecutionRunState>();
    const controllers = new Map<string, ExecutionRunController>();
    const runtime = Object.freeze({
      ...createTestExecutionRunHostRuntime({
        runtimeId: 'provider-session-1',
        resumeSupported: true,
        onProvisionRuntime: async () => {
          markProvisionStarted();
          await provisionGate;
        },
      }),
      interaction: retainedInteraction,
    });
    const enqueueRetainedRunInitialInput = vi.fn(async (input: { localId: string }): Promise<SessionInputAdmissionResultV1> => ({
      status: 'accepted' as const,
      localId: input.localId,
    }));
    const attachRetainedRunSessionInput = vi.fn(() => ({
      release: async () => {},
      awaitInputAdmission: async () => 'accepted' as const,
    }));
    const directSend = vi.fn(async () => ({ ok: true }));
    const voiceAgentManager = new VoiceAgentManager({ createRuntime: () => runtime });
    const startPromise = startExecutionRun({
      params: {
        sessionId: 'session-1',
        intent: 'delegate',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        instructions: 'Initial work.',
        localInputId: 'workflow-input-1',
        permissionMode: 'read_only',
        retentionPolicy: 'resumable',
        runClass: 'long_lived',
        ioMode: 'streaming',
      },
      parentProvider: 'claude',
      sendAcp: async () => {},
      streamedTranscriptSession: null,
      createRuntime: () => runtime,
      getNowMs: () => 1_700_000_000_000,
      budgetRegistry: null,
      runs,
      controllers,
      enqueueMarkerWrite: async (_runId, write) => { await write(); },
      writeActivityMarker: async () => {},
      finishRun: async (runId, next) => {
        const current = runs.get(runId);
        if (current) runs.set(runId, { ...current, ...next });
      },
      executeBoundedRun: async () => { throw new Error('retained run must not execute bounded work'); },
      send: directSend,
      enqueueRetainedRunInitialInput,
      attachRetainedRunSessionInput,
      voiceAgentManager,
    });

    try {
      await provisionStarted;
      const startOutcome = await Promise.race([
        startPromise.then((started) => ({ kind: 'started' as const, started })),
        new Promise<{ kind: 'still_waiting' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'still_waiting' }), 30);
        }),
      ]);
      const initialAdmissionCountBeforeProvision = enqueueRetainedRunInitialInput.mock.calls.length;
      releaseProvision();
      const started = await startPromise;

      expect(startOutcome).toMatchObject({ kind: 'started', started: { runId: started.runId } });
      expect(initialAdmissionCountBeforeProvision).toBe(1);
      expect(enqueueRetainedRunInitialInput).toHaveBeenCalledExactlyOnceWith({
        runId: started.runId,
        text: 'Initial work.',
        localId: 'workflow-input-1',
        requestedAction: { v: 1, kind: 'enqueue' },
      });
      expect(directSend).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(attachRetainedRunSessionInput).toHaveBeenCalledOnce());
    } finally {
      releaseProvision();
      for (const controller of controllers.values()) {
        if (controller.kind === 'backend') await controller.backend.dispose();
      }
      await voiceAgentManager.dispose();
    }
  });

  it('admits attached retained initial instructions through exact Run Pending once', async () => {
    const runs = new Map<string, ExecutionRunState>();
    const controllers = new Map<string, ExecutionRunController>();
    const runtime = Object.freeze({
      ...createTestExecutionRunHostRuntime({
        runtimeId: 'provider-session-1',
        resumeSupported: true,
      }),
      interaction: retainedInteraction,
    });
    const enqueueRetainedRunInitialInput = vi.fn(async (input: { localId: string }): Promise<SessionInputAdmissionResultV1> => ({
      status: 'accepted' as const,
      localId: input.localId,
    }));
    const directSend = vi.fn(async () => ({ ok: true }));
    const attachRetainedRunSessionInput = vi.fn(() => ({
      release: async () => {},
      awaitInputAdmission: async () => 'accepted' as const,
    }));
    const voiceAgentManager = new VoiceAgentManager({ createRuntime: () => runtime });
    const args: Parameters<typeof startExecutionRun>[0] = {
      params: {
        sessionId: 'session-1',
        intent: 'delegate',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        instructions: '  Continue through durable custody.  ',
        localInputId: 'workflow-input-1',
        resultContract: { kind: 'text' },
        permissionMode: 'read_only',
        retentionPolicy: 'resumable',
        runClass: 'long_lived',
        ioMode: 'streaming',
      },
      parentProvider: 'claude',
      sendAcp: async () => {},
      streamedTranscriptSession: null,
      createRuntime: () => runtime,
      getNowMs: () => 1_700_000_000_000,
      budgetRegistry: null,
      runs,
      controllers,
      enqueueMarkerWrite: async (_runId, write) => { await write(); },
      writeActivityMarker: async () => {},
      finishRun: async (runId, next) => {
        const current = runs.get(runId);
        if (current) runs.set(runId, { ...current, ...next });
      },
      executeBoundedRun: async () => { throw new Error('retained run must not execute bounded work'); },
      send: directSend,
      enqueueRetainedRunInitialInput,
      attachRetainedRunSessionInput,
      voiceAgentManager,
    };
    const result = await startExecutionRun(args);

    expect(enqueueRetainedRunInitialInput).toHaveBeenCalledExactlyOnceWith({
      runId: result.runId,
      text: '  Continue through durable custody.  ',
      localId: 'workflow-input-1',
      requestedAction: { v: 1, kind: 'enqueue' },
    });
    expect(directSend).not.toHaveBeenCalled();
    const firstController = controllers.get(result.runId);
    if (!firstController || firstController.kind !== 'backend') {
      throw new Error('first retained backend controller missing');
    }
    await firstController.provisioningPromise;
    enqueueRetainedRunInitialInput.mockClear();
    attachRetainedRunSessionInput.mockClear();
    directSend.mockClear();

    let resolveRecoveredAdmission!: (outcome: 'accepted') => void;
    const recoveredAdmission = new Promise<'accepted'>((resolve) => {
      resolveRecoveredAdmission = resolve;
    });
    let resolveRetryDisposition!: (outcome: SessionInputAdmissionResultV1) => void;
    const retryDisposition = new Promise<SessionInputAdmissionResultV1>((resolve) => {
      resolveRetryDisposition = resolve;
    });
    attachRetainedRunSessionInput.mockImplementationOnce(() => ({
      release: async () => {},
      awaitInputAdmission: async () => await recoveredAdmission,
    }));
    enqueueRetainedRunInitialInput
      .mockRejectedValueOnce(new Error('pending admission outcome unknown'))
      .mockImplementationOnce(async () => await retryDisposition);
    const existingRunIds = new Set(runs.keys());
    await expect(startExecutionRun(args)).rejects.toMatchObject({
      details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } },
    });
    const unresolvedRunId = [...runs.keys()].find((runId) => !existingRunIds.has(runId));
    expect(unresolvedRunId).toBeTruthy();
    expect(runs.get(unresolvedRunId!)?.status).toBe('running');
    expect(controllers.has(unresolvedRunId!)).toBe(true);
    const unresolvedController = controllers.get(unresolvedRunId!);
    if (!unresolvedController || unresolvedController.kind !== 'backend') {
      throw new Error('unresolved backend controller missing');
    }
    await vi.waitFor(() => expect(enqueueRetainedRunInitialInput).toHaveBeenCalledTimes(2));
    expect(unresolvedController.runtimeId).toBe('provider-session-1');
    expect(attachRetainedRunSessionInput).toHaveBeenCalledOnce();
    expect(runs.get(unresolvedRunId!)).toMatchObject({
      status: 'running',
      error: {
        code: 'execution_run_initial_input_outcome_unknown',
        message: 'pending admission outcome unknown',
      },
    });
    expect(directSend).not.toHaveBeenCalled();

    resolveRecoveredAdmission('accepted');
    await expect(unresolvedController.initialPendingInputAdmission).resolves.toBe('accepted');
    expect(runs.get(unresolvedRunId!)?.error).toBeUndefined();
    resolveRetryDisposition({
      status: 'outcomeUnknown',
      localId: 'workflow-input-1',
      code: 'session_input_admission_outcome_unknown',
    });
    await unresolvedController.provisioningPromise;
    expect(runs.get(unresolvedRunId!)?.error).toBeUndefined();

    await expect(sendBackendLongLivedRun({
      runId: unresolvedRunId!,
      params: { message: 'Follow-up after exact admission recovery.' },
      runs,
      controllers,
      budgetRegistry: null,
      createRuntime: () => runtime,
      maxTurns: null,
      getNowMs: () => 1_700_000_000_001,
      finishRun: async () => {},
      sendAcp: async () => {},
      parentProvider: 'claude',
      streamedTranscriptSession: null,
      writeActivityMarker: async () => {},
    })).resolves.toEqual({ ok: true });

    enqueueRetainedRunInitialInput.mockResolvedValueOnce({
      status: 'rejected',
      code: 'session_input_unauthorized',
    });
    const idsBeforeRejected = new Set(runs.keys());
    await expect(startExecutionRun(args)).rejects.toThrow('session_input_unauthorized');
    const rejectedRunId = [...runs.keys()].find((runId) => !idsBeforeRejected.has(runId));
    expect(rejectedRunId).toBeTruthy();
    expect(runs.get(rejectedRunId!)).toMatchObject({
      status: 'failed',
      error: { code: 'execution_run_failed' },
    });
    expect(controllers.has(rejectedRunId!)).toBe(false);

    for (const controller of controllers.values()) {
      if (controller.kind === 'backend') await controller.backend.dispose();
    }
    await voiceAgentManager.dispose();
  });

  it('keeps a lazy retained run recoverable when post-handle initial admission is outcome-unknown', async () => {
    let releaseResumeSupport!: () => void;
    const resumeSupport = new Promise<void>((resolve) => {
      releaseResumeSupport = resolve;
    });
    let interactionKnown = false;
    const provisionRuntime = vi.fn();
    const baseRuntime = createTestExecutionRunHostRuntime({
      onProvisionRuntime: provisionRuntime,
      resumeSupported: true,
      replayResumeSupported: true,
    });
    const runtime = Object.freeze({
      ...baseRuntime,
      get interaction() {
        return interactionKnown ? retainedInteraction : undefined;
      },
      async readResumeSupport() {
        await resumeSupport;
        interactionKnown = true;
        return true;
      },
    });
    const runs = new Map<string, ExecutionRunState>();
    const controllers = new Map<string, ExecutionRunController>();
    const enqueueRetainedRunInitialInput = vi.fn(async () => {
      throw new Error('pending admission outcome unknown');
    });
    const attachRetainedRunSessionInput = vi.fn(() => ({
      release: async () => {},
      awaitInputAdmission: async () => 'unknown' as const,
    }));
    const voiceAgentManager = new VoiceAgentManager({ createRuntime: () => runtime });

    try {
      const startPromise = startExecutionRun({
        params: {
          sessionId: 'session-1',
          intent: 'delegate',
          backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
          instructions: 'Initial lazy work.',
          localInputId: 'workflow-input-lazy',
          permissionMode: 'read_only',
          retentionPolicy: 'resumable',
          runClass: 'long_lived',
          ioMode: 'streaming',
        },
        parentProvider: 'claude',
        sendAcp: async () => {},
        streamedTranscriptSession: null,
        createRuntime: () => runtime,
        getNowMs: () => 1_700_000_000_000,
        budgetRegistry: null,
        runs,
        controllers,
        enqueueMarkerWrite: async (_runId, write) => { await write(); },
        writeActivityMarker: async () => {},
        finishRun: async () => {},
        executeBoundedRun: async () => { throw new Error('retained run must not execute bounded work'); },
        send: async () => ({ ok: true }),
        enqueueRetainedRunInitialInput,
        attachRetainedRunSessionInput,
        voiceAgentManager,
      });

      const startOutcome = await Promise.race([
        startPromise.then((started) => ({ kind: 'started' as const, started })),
        new Promise<{ kind: 'still_waiting' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'still_waiting' }), 30);
        }),
      ]);
      expect(startOutcome).toMatchObject({ kind: 'started' });
      if (startOutcome.kind !== 'started') throw new Error('run handle was withheld');

      releaseResumeSupport();
      const controller = controllers.get(startOutcome.started.runId);
      if (!controller || controller.kind !== 'backend') throw new Error('backend controller missing');
      await (controller as typeof controller & { provisioningPromise?: Promise<void> }).provisioningPromise;

      expect(enqueueRetainedRunInitialInput).toHaveBeenCalledTimes(2);
      expect(enqueueRetainedRunInitialInput).toHaveBeenNthCalledWith(1, {
        runId: startOutcome.started.runId,
        text: 'Initial lazy work.',
        localId: 'workflow-input-lazy',
        requestedAction: { v: 1, kind: 'enqueue' },
      });
      expect(enqueueRetainedRunInitialInput).toHaveBeenNthCalledWith(2, {
        runId: startOutcome.started.runId,
        text: 'Initial lazy work.',
        localId: 'workflow-input-lazy',
        requestedAction: { v: 1, kind: 'enqueue' },
      });
      expect(provisionRuntime).toHaveBeenCalledOnce();
      expect(attachRetainedRunSessionInput).toHaveBeenCalledOnce();
      expect(controller.runtimeId).toBe('child_runtime_1');
      expect(runs.get(startOutcome.started.runId)).toMatchObject({
        status: 'running',
        error: {
          code: 'execution_run_initial_input_outcome_unknown',
          message: 'pending admission outcome unknown',
        },
      });
      expect(controllers.has(startOutcome.started.runId)).toBe(true);
    } finally {
      releaseResumeSupport();
      for (const controller of controllers.values()) {
        if (controller.kind === 'backend') await controller.backend.dispose();
      }
      await voiceAgentManager.dispose();
    }
  });

  it('settles a materialized run and releases capacity when its initial durable publication rejects', async () => {
    const runs = new Map<string, ExecutionRunState>();
    const controllers = new Map<string, ExecutionRunController>();
    const budgetRegistry = new ExecutionBudgetRegistry({
      maxConcurrentExecutionRuns: 1,
      maxConcurrentOneShotTasks: 1,
    });
    // Agent execution and durable transcript I/O are the external boundaries.
    const createRuntime = vi.fn(() => createTestExecutionRunHostRuntime());
    const sendAcp = vi.fn(async (): Promise<void> => { throw new Error('execution_run_transcript_custody_unavailable'); });
    const voiceAgentManager = new VoiceAgentManager({ createRuntime });
    const terminalMarkerWritePromises = new Map<string, Promise<void>>();
    const enqueueMarkerWrite = async (_runId: string, write: () => Promise<void>) => { await write(); };
    const args: Parameters<typeof startExecutionRun>[0] = {
      params: {
        sessionId: 'session-1',
        intent: 'delegate',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        permissionMode: 'read_only',
        retentionPolicy: 'ephemeral',
        runClass: 'long_lived',
        ioMode: 'request_response',
      },
      parentProvider: 'claude',
      sendAcp,
      streamedTranscriptSession: null,
      createRuntime,
      getNowMs: () => 1_700_000_000_000,
      budgetRegistry,
      runs,
      controllers,
      enqueueMarkerWrite,
      writeActivityMarker: async () => {},
      finishRun: async (runId, next, toolResult, structuredMeta) => {
        await finishExecutionRun({
          runId, next, toolResult, structuredMeta, runs, controllers, budgetRegistry,
          parentProvider: 'claude', sendAcp, enqueueMarkerWrite, terminalMarkerWritePromises,
        });
      },
      executeBoundedRun: async () => { throw new Error('Long-lived start must not execute bounded work'); },
      send: async () => { throw new Error('No initial instructions were supplied'); },
      voiceAgentManager,
    };
    try {
      await expect(startExecutionRun(args)).rejects.toMatchObject({
        details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } },
      });
      expect([...runs.values()]).toEqual([expect.objectContaining({ status: 'failed' })]);
      expect(controllers.size).toBe(0);
      expect(createRuntime).not.toHaveBeenCalled();
      expect(budgetRegistry.getInFlightSnapshot().executionRuns).toBe(0);
      expect(markerWrites).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));

      sendAcp.mockResolvedValue(undefined);
      const successor = await startExecutionRun(args);
      expect(runs.get(successor.runId)?.status).toBe('running');
      expect(createRuntime).toHaveBeenCalledOnce();
      await stopExecutionRun({ ...args, runId: successor.runId });
      expect(budgetRegistry.getInFlightSnapshot().executionRuns).toBe(0);
    } finally {
      for (const controller of controllers.values()) {
        if (controller.kind === 'backend') await controller.backend.dispose();
      }
      await voiceAgentManager.dispose();
    }
  });
});
