import { describe, expect, it, vi } from 'vitest';
import type { WorkflowProgressEnvelopeV1 } from '@happier-dev/protocol/workflows';
import { createWorkflowInvocationRecoveryObserver } from './invocationRecoveryObserver';
import { freezeActionCompletionContractV1, getActionSpec } from '@happier-dev/protocol/actions';

const progress: WorkflowProgressEnvelopeV1 = {
  kind: 'happier.workflow-progress.v1', blockKind: 'step',
  invocationPath: { blockId: 'step', scope: [] }, attempt: '0',
  logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
  execution: { kind: 'detached_run', runId: 'native-run', localInputId: 'input-1', runtimeSelection: {} },
};

describe('exact Workflow recovery observation', () => {
  it('reattaches an Action through its exact native runs without observing through Actions', async () => {
    const contract = freezeActionCompletionContractV1(getActionSpec('review.start').completion!);
    let reads = 0;
    const execution = { kind: 'action' as const, actionId: 'review.start', actionRequestId: 'request', localInputId: 'request', input: {},
      output: { intent: 'review', sessionId: null, results: [{ key: 'codex', ok: true, result: { runId: 'native-run' } }] },
      awaitedRuns: [{ key: 'codex', runId: 'native-run' }] };
    const observe = createWorkflowInvocationRecoveryObserver({ credentials: { token: 'token', encryption: null }, machineId: 'machine-1',
      actionExecutor: { execute: async () => { throw new Error('Action observation bypass'); } },
      nativeActionRuns: { get: async (runId) => { reads++; return { run: {
        runId, callId: 'call', sidechainId: 'side', intent: 'review', backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        permissionMode: 'default', retentionPolicy: 'resumable', runClass: 'bounded', ioMode: 'request_response', status: 'succeeded', startedAtMs: 1,
      }, latestToolResult: { output: { findings: [], reviewedFingerprint: 'fingerprint', commentIds: ['comment'], materialization: { kind: 'complete' } } } }; },
      stop: async () => { throw new Error('Observation-only stop'); } },
    });
    expect(await observe({ progress: { ...progress, blockKind: 'action', execution }, frozenActionContract: {
      inputSchema: {}, outputSchema: contract.terminalOutputSchema, completion: contract },
      terminalParent: false, cancellationRequested: false, observationOnly: true }))
      .toMatchObject({ kind: 'completed', result: { reviewedFingerprint: 'fingerprint', commentIds: ['comment'],
        perEngineOutcome: [{ key: 'codex', runId: 'native-run', outcome: 'completed' }] } });
    expect(reads).toBe(1);
  });
  it('never settles an invocation from another native execution run', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, result: { run: {
      runId: 'another-native-run', callId: 'call', sidechainId: 'sidechain', intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, permissionMode: 'default',
      retentionPolicy: 'resumable', runClass: 'long_lived', ioMode: 'streaming',
      status: 'running', startedAtMs: 1,
      inputTurns: { occurrenceId: 'occurrence', current: { turnId: 'turn', inputIds: ['input-1'], state: 'completed', result: { kind: 'text', value: 'wrong result' } } },
    } } }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token', encryption: null }, machineId: 'machine-1',
      actionExecutor: { execute } as Parameters<typeof createWorkflowInvocationRecoveryObserver>[0]['actionExecutor'],
    });
    expect(await observe({ progress, terminalParent: false, cancellationRequested: false }))
      .toEqual({ kind: 'outcome_uncertain', code: 'execution_run_correspondence_mismatch' });
  });
  it('reattaches a stop-pending input by observation without requesting another effect', async () => {
    // The native transport is the boundary; exact-turn classification remains real.
    const execute = vi.fn(async (_actionId: string, _input: unknown, _context: unknown) => ({ ok: true as const, result: { run: {
      runId: 'native-run', callId: 'call', sidechainId: 'sidechain', intent: 'delegate',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, permissionMode: 'default',
      retentionPolicy: 'resumable', runClass: 'long_lived', ioMode: 'streaming',
      status: 'running', startedAtMs: 1,
      inputTurns: { occurrenceId: 'occurrence', current: { turnId: 'turn', inputIds: ['input-1'], state: 'active' } },
    } } }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token', encryption: null }, machineId: 'machine-1',
      actionExecutor: { execute } as Parameters<typeof createWorkflowInvocationRecoveryObserver>[0]['actionExecutor'],
    });
    const result = await observe({ progress, terminalParent: false, cancellationRequested: true,
      ...{ observationOnly: true } });
    expect(result).toEqual({ kind: 'unresolved', code: 'execution_run_input_pending' });
    expect(execute.mock.calls.map((call) => call[0])).toEqual(['execution.run.get']);
  });
});
