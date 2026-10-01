import { describe, expect, it } from 'vitest';

import { TeamCredentialBrokerPresentationV1Schema } from './resourceV1';

describe('TeamCredentialBrokerPresentationV1Schema', () => {
  it('accepts a valid full Machine Pool name without applying a Machine-label limit', () => {
    const displayName = 'p'.repeat(121);
    const result = TeamCredentialBrokerPresentationV1Schema.safeParse({
      selectedTarget: null,
      eligibleTargets: [],
      selectedPool: {
        poolId: 'pool-1',
        displayName,
        availability: 'not_verified',
        availableMachineCount: null,
      },
      eligiblePools: [],
    });

    expect(result.success).toBe(true);
  });
});
