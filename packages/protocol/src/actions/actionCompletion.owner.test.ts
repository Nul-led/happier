import { describe, expect, it } from 'vitest';

import { planStartCompletion, reviewStartCompletion } from './specs/executionRunCompletion.js';
import {
  freezeActionCompletionContractV1,
  prepareActionCompletionV1,
  resumeActionCompletionV1,
  type ActionCompletionStateV1,
} from './actionCompletion.js';

describe('Action completion owner', () => {
  it.each([
    { second: 'F-b', expected: 'F-b' },
    { second: 'F-c', expected: null },
    { second: null, expected: null },
    { second: undefined, expected: null },
  ])('certifies only an agreed final review panel ($second)', async ({ second, expected }) => {
    const prepared = prepareActionCompletionV1(reviewStartCompletion, { ok: true, result: {
      intent: 'review', sessionId: 'origin', results: [
        { key: 'a', ok: true, result: { runId: 'run-a' } },
        { key: 'b', ok: true, result: { runId: 'run-b' } },
      ],
    } });
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    expect(await resumeActionCompletionV1({ actionId: 'review.start',
      completion: freezeActionCompletionContractV1(reviewStartCompletion), state: prepared.state,
      resolveDeclaration: () => reviewStartCompletion,
      observeRun: async ({ key }) => ({ kind: 'completed', result: {},
        ...(key === 'a' ? { reviewedFingerprint: 'F-b' } : second === undefined ? {} : { reviewedFingerprint: second }),
        commentIds: [], materialization: { kind: 'complete' },
      }),
    })).toMatchObject({ kind: 'completed', value: { reviewedFingerprint: expected } });
  });

  it('does not certify a panel with a failed engine from the first completed engine', async () => {
    const prepared = prepareActionCompletionV1(reviewStartCompletion, { ok: true, result: {
      intent: 'review', sessionId: 'origin', results: [
        { key: 'a', ok: true, result: { runId: 'run-a' } },
        { key: 'b', ok: true, result: { runId: 'run-b' } },
      ],
    } });
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    expect(await resumeActionCompletionV1({ actionId: 'review.start',
      completion: freezeActionCompletionContractV1(reviewStartCompletion), state: prepared.state,
      resolveDeclaration: () => reviewStartCompletion,
      observeRun: async ({ key }) => key === 'a'
        ? { kind: 'completed', result: {}, reviewedFingerprint: 'F-b', commentIds: [], materialization: { kind: 'complete' } }
        : { kind: 'failed', code: 'review_failed' },
    })).toMatchObject({ kind: 'completed', value: { reviewedFingerprint: null } });
  });

  it('persists launch correspondence before observation and rejoins the same runs with partial failures as values', async () => {
    // The real fanoutStarts public output shape, retained as JSON across a restart.
    const executed = { ok: true as const, result: {
      intent: 'review', sessionId: 'session-1', results: [
        { key: 'codex', ok: true, result: { runId: 'run-codex', callId: 'call-codex', sidechainId: 'call-codex' } },
        { key: 'claude', ok: true, result: { runId: 'run-claude', callId: 'call-claude', sidechainId: 'call-claude' } },
        { key: 'gemini', ok: false, errorCode: 'engine_busy', error: 'engine_busy' },
      ],
    } };
    const frozen = freezeActionCompletionContractV1(reviewStartCompletion);
    const prepared = prepareActionCompletionV1(reviewStartCompletion, executed);
    expect(prepared.kind).toBe('awaiting');
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    // A restart opens only JSON state and resolves the current declaration by frozen id.
    const retained: ActionCompletionStateV1 = JSON.parse(JSON.stringify(prepared.state));
    const observed: string[] = [];
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const completing = resumeActionCompletionV1({
      actionId: 'review.start', completion: frozen, state: retained,
      resolveDeclaration: (actionId) => actionId === 'review.start' ? reviewStartCompletion : undefined,
      observeRun: async ({ runId }) => {
        observed.push(runId);
        if (runId === 'run-codex') {
          await delayed;
          return { kind: 'completed', result: {}, commentIds: ['comment-1'], materialization: { kind: 'complete' } };
        }
        return { kind: 'failed', code: 'review_failed' };
      },
    });
    await Promise.resolve();
    expect(observed).toEqual(['run-codex', 'run-claude']);
    let settled = false;
    void completing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await completing).toEqual({ kind: 'completed', value: {
      reviewedFingerprint: null, commentIds: ['comment-1'], perEngineOutcome: [
        { key: 'codex', runId: 'run-codex', outcome: 'completed', materialization: { kind: 'complete' } },
        { key: 'claude', runId: 'run-claude', outcome: 'failed', errorCode: 'review_failed' },
        { key: 'gemini', outcome: 'launch_failed', errorCode: 'engine_busy' },
      ],
    } });
  });

  it('applies the same owner to planning values, including JSON strings and cancellation', async () => {
    const declaration = planStartCompletion;
    const prepared = prepareActionCompletionV1(declaration, { ok: true, result: {
      intent: 'plan', sessionId: null, results: [
        { key: 'a', ok: true, result: { runId: 'run-a' } },
        { key: 'b', ok: true, result: { runId: 'run-b' } },
      ],
    } });
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    expect(await resumeActionCompletionV1({
      actionId: 'subagents.plan.start', completion: freezeActionCompletionContractV1(declaration), state: prepared.state,
      resolveDeclaration: () => declaration,
      observeRun: async ({ runId }) => runId === 'run-a'
        ? { kind: 'completed', result: '"already decoded"' }
        : { kind: 'cancelled', code: 'cancelled_by_user' },
    })).toEqual({ kind: 'completed', value: {
      plans: [{ key: 'a', runId: 'run-a', value: '"already decoded"' }],
      perEngineOutcome: [
        { key: 'a', runId: 'run-a', outcome: 'completed' },
        { key: 'b', runId: 'run-b', outcome: 'cancelled', errorCode: 'cancelled_by_user' },
      ],
    } });
  });

  it('keeps immediate Actions immediate, and fails on no launches or Action failure', () => {
    expect(prepareActionCompletionV1(undefined, { ok: true, result: { hello: true } }))
      .toEqual({ kind: 'completed', value: { hello: true } });
    const declaration = reviewStartCompletion;
    expect(prepareActionCompletionV1(declaration, { ok: false, errorCode: 'denied', error: 'denied' }))
      .toEqual({ kind: 'failed', errorCode: 'denied' });
    expect(prepareActionCompletionV1(declaration, { ok: true, result: {
      intent: 'review', sessionId: 's', results: [{ key: 'a', ok: false, errorCode: 'engine_busy' }],
    } })).toEqual({ kind: 'failed', errorCode: 'engine_busy' });
  });

  it('does not claim successful review materialization when the observation lacks that evidence', async () => {
    const declaration = reviewStartCompletion;
    const prepared = prepareActionCompletionV1(declaration, { ok: true, result: {
      intent: 'review', sessionId: 's', reviewedFingerprint: 'reviewed-at-launch',
      results: [{ key: 'a', ok: true, result: { runId: 'run-a' } }],
    } });
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    expect(await resumeActionCompletionV1({
      actionId: 'review.start', completion: freezeActionCompletionContractV1(declaration), state: prepared.state,
      resolveDeclaration: () => declaration,
      observeRun: async () => ({ kind: 'completed', result: { findings: [] } }),
    })).toEqual({ kind: 'completed', value: {
      reviewedFingerprint: 'reviewed-at-launch', commentIds: [], perEngineOutcome: [{
        key: 'a', runId: 'run-a', outcome: 'completed',
        materialization: { kind: 'failed', errorCode: 'review_materialization_unavailable' },
      }],
    } });
  });

  it.each([
    { retained: undefined, expected: 'observed-panel' },
    { retained: null, expected: null },
  ])('retains fingerprint $expected and ids from partial materialization', async ({ retained, expected }) => {
    const declaration = reviewStartCompletion;
    const prepared = prepareActionCompletionV1(declaration, { ok: true, result: {
      intent: 'review', sessionId: 's',
      ...(retained === undefined ? {} : { reviewedFingerprint: retained }),
      results: [{ key: 'a', ok: true, result: { runId: 'run-a' } }],
    } });
    if (prepared.kind !== 'awaiting') throw new Error('Expected persisted launch state');
    expect(await resumeActionCompletionV1({
      actionId: 'review.start', completion: freezeActionCompletionContractV1(declaration), state: prepared.state,
      resolveDeclaration: () => declaration,
      observeRun: async () => ({
        kind: 'completed', result: {}, reviewedFingerprint: 'observed-panel', commentIds: ['saved-comment'],
        materialization: { kind: 'partial', errorCode: 'findings_partially_saved' },
      }),
    })).toEqual({ kind: 'completed', value: {
      reviewedFingerprint: expected, commentIds: ['saved-comment'], perEngineOutcome: [{
        key: 'a', runId: 'run-a', outcome: 'completed',
        materialization: { kind: 'partial', errorCode: 'findings_partially_saved' },
      }],
    } });
  });

});
