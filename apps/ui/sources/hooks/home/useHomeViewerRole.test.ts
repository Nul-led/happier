import { describe, expect, it } from 'vitest';
import type { HomeRoleV1 } from '@happier-dev/protocol/home/governance';

import { homeGovernanceProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import { resolveHomeGovernanceViewState } from '@/components/settings/home/governance/homeGovernanceViewState';
import type { HomeGovernanceSnapshot } from '@/sync/store/home/governance/homeGovernanceSnapshots';

import { resolveHomeViewerRole } from './resolveHomeViewerRole';

const scope = { serverId: 'home-a', accountId: 'account-ada' };

function bound(snapshot: HomeGovernanceSnapshot) {
    return {
        kind: 'bound' as const,
        scope,
        lifetime: null,
        homeName: 'Studio',
        state: resolveHomeGovernanceViewState(snapshot),
    };
}

function snapshot(role: HomeRoleV1, overrides: Partial<HomeGovernanceSnapshot> = {}): HomeGovernanceSnapshot {
    return {
        scope,
        status: 'ready',
        data: homeGovernanceProjectionFixture({ viewer: { accountId: scope.accountId, homeRole: role, status: 'active' } }),
        lastObservedAt: 1000,
        stale: false,
        reachability: 'reachable',
        error: null,
        ...overrides,
    };
}

describe('Home viewer role', () => {
    it('uses the exact bound projection for every Home role', () => {
        for (const role of ['owner', 'admin', 'member'] as const) {
            expect(resolveHomeViewerRole(bound(snapshot(role)))).toBe(role);
        }
    });

    it('retains the last observed role through a failed read and withdraws it when the Home refuses the account', () => {
        expect(resolveHomeViewerRole(bound(snapshot('admin', {
            status: 'error', stale: true, reachability: 'unreachable',
            error: { kind: 'unreachable', retryable: true },
        })))).toBe('admin');
        expect(resolveHomeViewerRole(bound(snapshot('admin', {
            status: 'error', error: { kind: 'forbidden', retryable: false },
        })))).toBeNull();
    });

    it('claims no role before observation, after sign-out, or when the Home requires owner setup', () => {
        expect(resolveHomeViewerRole({ kind: 'resolving' })).toBeNull();
        expect(resolveHomeViewerRole({ kind: 'signed_out', homeName: 'Studio' })).toBeNull();
        expect(resolveHomeViewerRole(bound(snapshot('owner', { data: null, status: 'loading' })))).toBeNull();
        expect(resolveHomeViewerRole(bound(snapshot('owner', {
            data: homeGovernanceProjectionFixture({ setupState: 'setup_required' }),
        })))).toBeNull();
    });
});
