import { describe, expect, it } from 'vitest';
import { composeWorkflowRunWorkerUpdateV1, renderWorkerUpdatePromptBlockV1, type WorkerUpdateV1 } from '@happier-dev/protocol';
import { fitWorkerUpdateWithinHostContextAllowance } from './hostContextOnlyInput';

describe('optional WorkerUpdate input allowance', () => {
  const update: WorkerUpdateV1 = {
    v: 1, workerKind: 'session', workerId: 'worker-1', ownerState: 'settled', wake: 'finished',
    headline: 'Worker finished', result: 'é'.repeat(4_000), canInspect: true,
    transcriptPointer: { kind: 'session', sessionId: 'worker-1', seq: 12 },
  };
  it('fits the complete rendered block inside the existing optional allowance while preserving its pointer', () => {
    const fitted = fitWorkerUpdateWithinHostContextAllowance(update, 4_096);
    expect(fitted).not.toBeNull();
    expect(Buffer.byteLength(renderWorkerUpdatePromptBlockV1(fitted!), 'utf8')).toBeLessThanOrEqual(4_096);
    expect(fitted!.result!.length).toBeLessThan(update.result!.length);
    expect(fitted!.truncated).toBe(true);
    expect(fitted!.transcriptPointer).toEqual(update.transcriptPointer);
  });
  it('does not invent a truncated block without an inspection pointer', () => {
    const { transcriptPointer: _pointer, ...withoutPointer } = update;
    expect(fitWorkerUpdateWithinHostContextAllowance(withoutPointer, 4_096)).toBeNull();
    expect(fitWorkerUpdateWithinHostContextAllowance(update, 0)).toBeNull();
    expect(fitWorkerUpdateWithinHostContextAllowance(update, 20_000)).toBe(update);
  });
  it('keeps the exact already-started follow-up when optional result text is truncated', () => {
    const update = composeWorkflowRunWorkerUpdateV1({
      run: { id: 'review-run', state: 'succeeded', attentionRequired: false },
      finalResult: { kind: 'happier.workflow-final-result.v1', result: { kind: 'text', value: 'x'.repeat(7_000) },
        producerInvocation: { recordId: 'review-invocation' } },
      finalProducerReview: { decision: { kind: 'use_result', requestedFromContentRevision: '1',
        followUp: { kind: 'run_started', runId: 'already-started-run' } } },
    });
    if (!update) throw new Error('expected terminal workflow update');
    const fitted = fitWorkerUpdateWithinHostContextAllowance(update, 1_024);
    expect(fitted).not.toBeNull();
    expect(renderWorkerUpdatePromptBlockV1(fitted!)).toContain('already-started-run');
    expect(fitted?.truncated).toBe(true);
  });
});
