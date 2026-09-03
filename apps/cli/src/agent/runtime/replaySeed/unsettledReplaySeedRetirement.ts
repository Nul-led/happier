import type { ReplaySeedSettlementOutcome } from './replaySeedV1';

/**
 * The per-resolution idempotent settler returned by `resolveProviderPromptWithReplaySeed`.
 * Calling it again after a `'failed'` outcome retries the same metadata retirement.
 */
export type ReplaySeedSettlement = () => Promise<ReplaySeedSettlementOutcome>;

/**
 * Session-scoped state for a replay seed the provider already ACCEPTED whose metadata
 * retirement has not succeeded.
 *
 * Retirement is what stops an accepted seed from being prefixed to a later provider input,
 * so while a settlement is unsettled here, no further provider input may be admitted. There
 * is deliberately no retry service, timer, or background loop: the outstanding retirement is
 * retried only when a provider input actually seeks admission, by that admission boundary
 * calling `settleBeforeAdmitting` once. The retry reuses the same idempotent settler whose
 * first attempt failed; the consume updater it writes no-ops once the seed is retired, so
 * retries are safe at any time and on any Session binding.
 */
export type UnsettledReplaySeedRetirement = Readonly<{
  /**
   * Begin retirement at the provider-acceptance boundary. The settler becomes admission-
   * blocking synchronously, before its asynchronous metadata write settles, so a concurrent
   * steer cannot reapply the accepted seed. Concurrent callers share the same write.
   */
  settleOnProviderAcceptance: (
    settlement: ReplaySeedSettlement,
  ) => Promise<ReplaySeedSettlementOutcome>;
  /**
   * One admission-boundary retry of the outstanding retirement. Returns `'settled'` and
   * clears the hold when the retirement succeeds, returns `'failed'` when the caller must
   * keep the input blocked, and returns `null` when nothing is outstanding.
   */
  settleBeforeAdmitting: () => Promise<ReplaySeedSettlementOutcome | null>;
}>;

export function createUnsettledReplaySeedRetirement(): UnsettledReplaySeedRetirement {
  let unsettled: ReplaySeedSettlement | null = null;
  let settlementInFlight: Promise<ReplaySeedSettlementOutcome> | null = null;

  const settle = (settlement: ReplaySeedSettlement): Promise<ReplaySeedSettlementOutcome> => {
    if (unsettled === settlement && settlementInFlight) {
      return settlementInFlight;
    }
    unsettled = settlement;
    const current = settlement().then((outcome) => {
      if (outcome !== 'failed' && unsettled === settlement) {
        unsettled = null;
      }
      return outcome;
    }).finally(() => {
      if (settlementInFlight === current) {
        settlementInFlight = null;
      }
    });
    settlementInFlight = current;
    return current;
  };

  return {
    settleOnProviderAcceptance(settlement) {
      return settle(settlement);
    },
    async settleBeforeAdmitting() {
      const settlement = unsettled;
      if (!settlement) return null;
      return await settle(settlement);
    },
  };
}
