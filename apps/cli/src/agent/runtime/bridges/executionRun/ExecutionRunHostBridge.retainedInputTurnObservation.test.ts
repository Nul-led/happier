import { describe, expect, it, vi } from 'vitest';

import type { ExecutionRunBackendController } from '@/agent/executionRuns/controllers/types';
import type { ExecutionRunAdmittedPendingInputV1 } from '@/api/session/client/transport/sessionClientInteractionApi';
import type { ExecutionRunState } from './executionRunTypes';
import { ExecutionRunHostBridge } from './ExecutionRunHostBridge';
import { createExactTurnUsageAccumulator } from '@/usage/exactTurnUsage';

const TEST_BACKEND_ID = `${'test'}.${'agent'}` as never;

type RuntimeEvent = Parameters<NonNullable<ExecutionRunBackendController['backend']['subscribeRuntimeEvents']>>[0] extends (
    event: infer E,
) => void ? E : never;

/**
 * A Session-owned retained Run composed through the bridge's real retained
 * attachment: the canonical occurrence witness registration, retained input
 * delivery and public-state projection are all production code. Only the
 * provider runtime (its event stream) and the parent Session's Pending transport
 * are boundaries.
 */
function composeRetainedRun() {
    const runtimeLifetime = new AbortController();
    let emit: ((event: RuntimeEvent) => void) | null = null;
    const controller = {
        kind: 'backend',
        controllerOccurrenceId: 'retained-occurrence-1',
        backend: {
            interaction: {
                kind: 'retained_agent_session.v1',
                capabilities: { open: ['create', 'resume'], delivery: ['newTurn'], cancel: true },
            },
            deliverInput: async () => ({ status: 'admitted' as const }),
            subscribeRuntimeEvents: (handler: (event: RuntimeEvent) => void) => {
                emit = handler;
                return () => { emit = null; };
            },
            getRuntimeLifetimeSignal: () => runtimeLifetime.signal,
            subscribeMessages: () => () => undefined,
            readResumeSupport: async () => true,
            provisionRuntime: async () => ({ runtimeId: 'provider-session-1' }),
            cancel: async () => undefined,
            dispose: async () => undefined,
        },
        backendSupportsResume: true,
        runtimeId: 'provider-session-1',
        buffer: '',
        sidechainStreamBuffer: '',
        sidechainStreamKey: '',
        streamWriter: null,
        cancelled: false,
        turnCount: 0,
        turnEpoch: 0,
        turnInFlight: false,
        turnCancelReason: null,
        turnCancelEpoch: null,
        admittedLiveInterventions: [],
        admittedLiveInterventionsSignal: null,
        lastMarkerWriteAtMs: 0,
        terminalPromise: Promise.resolve(),
        resolveTerminal: () => undefined,
    } as unknown as ExecutionRunBackendController;
    const manager = new ExecutionRunHostBridge({
        parentProvider: TEST_BACKEND_ID,
        cwd: '/repo',
        sendAcp: async () => undefined,
        sessionInteractionHost: {
            session: {
                sessionId: 'session-1',
                getMetadataSnapshot: () => null,
                updateMetadata: vi.fn(),
                updateAgentState: vi.fn(),
                enqueueAgentMessageCommitted: vi.fn(async () => ({ persisted: true, delivered: false })),
                bindExecutionRunPendingInput: (_binding: { consume: (input: ExecutionRunAdmittedPendingInputV1) => boolean }) => ({
                    getMetadataSnapshot: () => null,
                    waitForMetadataUpdate: async () => await new Promise<boolean>(() => undefined),
                    shouldAttemptPendingMaterialization: () => false,
                    reconcilePendingProviderInputCustodyBeforeMaterialization: async () => true,
                    materializeNextPendingMessageSafely: async () => ({ type: 'no_pending' as const }),
                    observeProviderInputSettlement: async () => true,
                    readDurableProviderInputAcceptanceV1: async () => 'unknown' as const,
                    dispose: () => undefined,
                }),
            },
            machineId: 'machine-1',
            permissionHandler: { handleToolCall: vi.fn() },
        },
    } as ConstructorParameters<typeof ExecutionRunHostBridge>[0]);
    const internals = manager as unknown as {
        runs: Map<string, ExecutionRunState>;
        controllers: Map<string, ExecutionRunBackendController>;
        attachRetainedRunSessionInput(input: {
            runId: string; sidechainId: string; controller: ExecutionRunBackendController;
        }): { release(): Promise<void> } | null;
    };
    internals.runs.set('run-1', {
        runId: 'run-1', callId: 'call-1', sidechainId: 'sidechain-1', sessionId: 'session-1', depth: 0,
        intent: 'delegate', backendTarget: { kind: 'builtInAgent', agentId: TEST_BACKEND_ID },
        backendId: TEST_BACKEND_ID, instructions: 'Continue.', permissionMode: 'read_only',
        retentionPolicy: 'resumable', runClass: 'long_lived', ioMode: 'streaming', status: 'running', startedAtMs: 1,
    } as ExecutionRunState);
    internals.controllers.set('run-1', controller);
    const attachment = internals.attachRetainedRunSessionInput({ runId: 'run-1', sidechainId: 'sidechain-1', controller });
    const emitRuntimeEvent = (event: Record<string, unknown>) => {
        if (!emit) throw new Error('retained delivery did not subscribe to runtime events');
        emit(event as RuntimeEvent);
    };
    const acceptInput = (localId: string, turnId: string) => emitRuntimeEvent({
        kind: 'input-accepted', sessionId: 'session-1', sequence: 1, emittedAtMs: 1,
        inputIds: [localId], delivery: { kind: 'newTurn', turnId },
    });
    return { manager, internals, attachment, emitRuntimeEvent, acceptInput, runtimeLifetime };
}

describe('ExecutionRunHostBridge retained exact input observation', () => {
    it('projects the exact native acceptance timestamp for a retained Workflow input', async () => {
        const { internals, attachment, emitRuntimeEvent } = composeRetainedRun();
        const controller = internals.controllers.get('run-1')!;
        const observations: unknown[] = [];
        controller.workflowObservation = {
            localInputId: 'workflow-retained', usage: createExactTurnUsageAccumulator(),
            sink: { commit: async (observation) => { observations.push(observation); } },
        };
        try {
            emitRuntimeEvent({ kind: 'input-accepted', sessionId: 'session-1', sequence: 1, emittedAtMs: 100,
                inputIds: ['unrelated-input'], delivery: { kind: 'newTurn', turnId: 'unrelated-turn' } });
            emitRuntimeEvent({ kind: 'input-accepted', sessionId: 'session-1', sequence: 2, emittedAtMs: 2_000,
                inputIds: ['workflow-retained'], delivery: { kind: 'newTurn', turnId: 'workflow-turn' } });
            await controller.pendingHostBarrier;
            expect(observations).toEqual([{ kind: 'input_accepted', runId: 'run-1',
                localInputId: 'workflow-retained', acceptedAtMs: 2_000 }]);
        } finally {
            await attachment?.release();
        }
    });

    it('observes a completed retained input under the same occurrence the public state exposes', async () => {
        const { manager, attachment, emitRuntimeEvent, acceptInput } = composeRetainedRun();
        try {
            acceptInput('input-1', 'turn-1');
            let observed: unknown = 'pending';
            const waiting = manager.waitForInputTurn('run-1', 'input-1').then((value) => { observed = value; });
            await Promise.resolve();
            expect(observed).toBe('pending');
            emitRuntimeEvent({ kind: 'turn-complete', sessionId: 'session-1', sequence: 2, emittedAtMs: 2, turnId: 'turn-1' });
            await vi.waitFor(() => expect(observed).not.toBe('pending'), { timeout: 1_000 });
            await waiting;
            const publicTurns = manager.getPublic('run-1')?.inputTurns;
            expect(publicTurns).toMatchObject({
                occurrenceId: 'retained-occurrence-1',
                last: { turnId: 'turn-1', inputIds: ['input-1'], state: 'completed' },
            });
            // The blocking exact observation and the public state agree on one occurrence.
            expect(observed).toEqual({ occurrenceId: publicTurns?.occurrenceId, turn: publicTurns?.last });
        } finally {
            await attachment?.release();
        }
    });

    it('retains the cancelled retained input under the canonical occurrence when the Run is stopped', async () => {
        const { manager, internals, attachment, acceptInput } = composeRetainedRun();
        try {
            acceptInput('input-2', 'turn-2');
            expect(manager.getPublic('run-1')?.inputTurns).toMatchObject({
                occurrenceId: 'retained-occurrence-1',
                current: { turnId: 'turn-2', state: 'active' },
            });
            await manager.stop('run-1');
            expect(internals.controllers.has('run-1')).toBe(false);
            expect(internals.runs.get('run-1')?.inputTurns).toEqual({
                occurrenceId: 'retained-occurrence-1',
                last: { turnId: 'turn-2', inputIds: ['input-2'], state: 'cancelled' },
            });
            await expect(manager.waitForInputTurn('run-1', 'input-2')).resolves.toEqual({
                occurrenceId: 'retained-occurrence-1',
                turn: { turnId: 'turn-2', inputIds: ['input-2'], state: 'cancelled' },
            });
        } finally {
            await attachment?.release();
        }
    });
});
