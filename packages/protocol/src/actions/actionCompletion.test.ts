import { describe, expect, it } from 'vitest';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';

import { getActionSpec } from './actionSpecs.js';
import { serializeActionSpec } from './actionCatalog.js';
import { readActionCompletionRunObservationV1 } from './actionCompletion.js';

describe('Action completion contract', () => {
  it('reads terminal native output and materialized review evidence without inventing comments', () => {
    expect(readActionCompletionRunObservationV1({ run: { status: 'succeeded' }, latestToolResult: { output: {
      reviewedFingerprint: 'fingerprint', commentIds: ['comment-1'], materialization: { kind: 'complete' }, findings: [],
    } } })).toMatchObject({ kind: 'completed', result: { findings: [] }, reviewedFingerprint: 'fingerprint',
      commentIds: ['comment-1'], materialization: { kind: 'complete' } });
    expect(readActionCompletionRunObservationV1({ run: { status: 'timeout', error: { code: 'budget' } } }))
      .toEqual({ kind: 'failed', code: 'budget' });
    expect(readActionCompletionRunObservationV1({ run: { status: 'succeeded' }, latestToolResult: { output: undefined } }))
      .toMatchObject({ kind: 'outcome_uncertain' });
  });
  it.each(['review.start', 'subagents.plan.start'] as const)('declares execution-run completion for %s', (actionId) => {
    const spec = getActionSpec(actionId);
    expect(spec).toMatchObject({ completion: { awaits: 'execution_runs' } });
    expect(serializeActionSpec(spec)).not.toHaveProperty('completion');
  });

  it('starts explicit detached plans in the supplied workspace, without manufacturing a session', async () => {
    const starts: unknown[] = [];
    const executor = createActionExecutor({
      executionRunCheckProtocolV2: async () => ({ ok: true }),
      executionRunStart: async (sessionId, request, opts) => {
        starts.push({ sessionId, request, opts });
        return { runId: 'plan-1', callId: 'call-1', sidechainId: 'call-1' };
      },
    } as ActionExecutorDeps); // Only the execution-run transport is exercised.
    const input = { target: { kind: 'detached' }, backendTargetKeys: ['agent:codex'], instructions: 'Plan' };
    const context = {
      surface: 'cli' as const,
      defaultSessionId: 'irrelevant-default',
      externalActionTarget: { kind: 'machine' as const, machineId: 'machine-1', project: { directory: '/workspace' } },
    };
    expect(await executor.execute('subagents.plan.start', input, context)).toMatchObject({ ok: true });
    expect(starts).toEqual([{
      sessionId: null,
      request: expect.objectContaining({ intent: 'plan', cwd: '/workspace' }),
      opts: expect.objectContaining({ targetMachineId: 'machine-1' }),
    }]);
    expect(await executor.execute('subagents.plan.start', { ...input, target: undefined }, { surface: 'cli' }))
      .toMatchObject({ ok: false, errorCode: 'session_not_selected' });
  });

  it('requires the detached protocol rather than routing a detached plan through a session', async () => {
    const executor = createActionExecutor({} as ActionExecutorDeps);
    expect(await executor.execute('subagents.plan.start', {
      target: { kind: 'detached' }, backendTargetKeys: ['agent:codex'], instructions: 'Plan',
    }, { surface: 'cli' })).toMatchObject({ ok: false, errorCode: 'execution_run_protocol_unsupported' });
  });

  it('sets the explicitly bound origin goal even when the caller has a different default session', async () => {
    const mutations: unknown[] = [];
    const executor = createActionExecutor({
      sessionGoalSet: async (input) => { mutations.push(input); return { ok: true }; },
    } as ActionExecutorDeps);
    expect(await executor.execute('session.goal.set', {
      sessionId: 'authorized-origin', status: 'complete',
    }, { surface: 'cli', defaultSessionId: 'different-session' })).toMatchObject({ ok: true });
    expect(mutations).toEqual([{ sessionId: 'authorized-origin', status: 'complete' }]);
    expect(await executor.execute('session.goal.set', { status: 'complete' }, { surface: 'cli' }))
      .toMatchObject({ ok: false });
  });

  it('refuses contradictory detached and explicit session targets before starting a run', async () => {
    let starts = 0;
    const executor = createActionExecutor({
      executionRunCheckProtocolV2: async () => ({ ok: true }),
      executionRunStart: async () => { starts++; return { runId: 'r', callId: 'c', sidechainId: 'c' }; },
    } as ActionExecutorDeps);
    expect(await executor.execute('subagents.plan.start', {
      target: { kind: 'detached' }, sessionId: 'explicit-session',
      backendTargetKeys: ['agent:codex'], instructions: 'Plan',
    }, { surface: 'cli' })).toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(starts).toBe(0);
  });
});
