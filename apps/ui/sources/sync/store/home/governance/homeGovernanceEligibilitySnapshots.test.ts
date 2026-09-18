import { afterEach, describe, expect, it } from 'vitest';

import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import {
    applyHomeGovernanceEligibility,
    applyHomeGovernanceEligibilityFailure,
    getHomeGovernanceEligibilitySnapshot,
    resetHomeGovernanceEligibilitySnapshotsForTests,
} from './homeGovernanceEligibilitySnapshots';

const scope = createServerAccountScope('home_a', 'account_a')!;

afterEach(() => {
    resetHomeGovernanceEligibilitySnapshotsForTests();
});

describe('home governance eligibility snapshots', () => {
    it('withdraws retained create-Team eligibility after an authoritative refusal', () => {
        applyHomeGovernanceEligibility({
            scope,
            eligibility: { teamsEnabled: true, createTeam: true },
            observedAt: 42,
        });

        applyHomeGovernanceEligibilityFailure({
            scope,
            error: { kind: 'forbidden', retryable: false },
        });

        expect(getHomeGovernanceEligibilitySnapshot(scope)).toMatchObject({
            status: 'error',
            data: null,
            lastObservedAt: null,
            stale: false,
            reachability: 'reachable',
            error: { kind: 'forbidden', retryable: false },
        });
    });
});
