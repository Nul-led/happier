import { describe, expect, it } from 'vitest';

import { DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1 } from '../selection/selectConnectedServiceAuthGroupCandidate';
import { reconcileMemberRuntimeStateWithFreshQuotaEvidence } from './memberRuntimeState';

describe('reconcileMemberRuntimeStateWithFreshQuotaEvidence', () => {
  it('lets current quota evidence supersede a failure timestamp poisoned by a future clock', () => {
    expect(reconcileMemberRuntimeStateWithFreshQuotaEvidence({
      state: {
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: 100_000,
        quotaExhaustedUntilMs: 200_000,
      },
      quotaSnapshot: {
        capturedAtMs: 10_000,
        effectiveMeterId: 'weekly',
        effectiveRemainingPercent: 80,
        meters: [{
          meterId: 'weekly',
          limitCategory: 'usage_limit',
          remainingPct: 80,
          resetAtMs: null,
          providerLimitId: 'weekly',
        }],
      },
      policy: DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
      nowMs: 10_000,
    })).toEqual({});
  });
});
