import { describe, expect, it, vi } from 'vitest';

import { createUnsettledReplaySeedRetirement } from './unsettledReplaySeedRetirement';
import type { ReplaySeedSettlementOutcome } from './replaySeedV1';

function createSettler(outcomes: ReplaySeedSettlementOutcome[]) {
  const calls: number[] = [];
  const settle = vi.fn(async (): Promise<ReplaySeedSettlementOutcome> => {
    calls.push(calls.length);
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new Error('test settler exhausted its scripted outcomes');
    return outcome;
  });
  return { settle, calls };
}

describe('unsettledReplaySeedRetirement', () => {
  it('has nothing outstanding before any failed settlement', async () => {
    const gate = createUnsettledReplaySeedRetirement();
    await expect(gate.settleBeforeAdmitting()).resolves.toBeNull();
  });

  it('keeps a failed retirement outstanding and retries the same idempotent settler at admission', async () => {
    const gate = createUnsettledReplaySeedRetirement();
    const { settle, calls } = createSettler(['failed', 'failed', 'settled']);

    await expect(gate.settleOnProviderAcceptance(settle)).resolves.toBe('failed');
    await expect(gate.settleBeforeAdmitting()).resolves.toBe('failed');
    expect(settle).toHaveBeenCalledTimes(2);

    await expect(gate.settleBeforeAdmitting()).resolves.toBe('settled');
    // Success clears the hold, so later admissions retry nothing.
    await expect(gate.settleBeforeAdmitting()).resolves.toBeNull();
    expect(settle).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([0, 1, 2]);
  });

  it('blocks concurrent admission on the in-flight acceptance settlement without a second write', async () => {
    const gate = createUnsettledReplaySeedRetirement();
    let resolveSettlement!: (outcome: ReplaySeedSettlementOutcome) => void;
    const settlementResult = new Promise<ReplaySeedSettlementOutcome>((resolve) => {
      resolveSettlement = resolve;
    });
    const settle = vi.fn(() => settlementResult);

    const acceptance = gate.settleOnProviderAcceptance(settle);
    const admission = gate.settleBeforeAdmitting();
    expect(settle).toHaveBeenCalledTimes(1);

    resolveSettlement('settled');
    await expect(acceptance).resolves.toBe('settled');
    await expect(admission).resolves.toBe('settled');
    await expect(gate.settleBeforeAdmitting()).resolves.toBeNull();
  });

  it('clears the hold when the acceptance settlement finds no applied seed', async () => {
    const gate = createUnsettledReplaySeedRetirement();
    const notApplied = createSettler(['not_applied']).settle;

    await expect(gate.settleOnProviderAcceptance(notApplied)).resolves.toBe('not_applied');
    await expect(gate.settleBeforeAdmitting()).resolves.toBeNull();
  });

  it('does not let a stale settlement completion clear or resurrect a newer retirement', async () => {
    const gate = createUnsettledReplaySeedRetirement();
    let resolveStale!: (outcome: ReplaySeedSettlementOutcome) => void;
    const stale = vi.fn(() => new Promise<ReplaySeedSettlementOutcome>((resolve) => {
      resolveStale = resolve;
    }));
    const current = createSettler(['failed', 'settled']).settle;

    const staleResult = gate.settleOnProviderAcceptance(stale);
    await expect(gate.settleOnProviderAcceptance(current)).resolves.toBe('failed');
    resolveStale('settled');
    await expect(staleResult).resolves.toBe('settled');

    // The stale success did not clear the current failed settlement.
    await expect(gate.settleBeforeAdmitting()).resolves.toBe('settled');
    await expect(gate.settleBeforeAdmitting()).resolves.toBeNull();
  });
});
