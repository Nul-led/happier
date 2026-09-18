import { describe, expect, it } from 'vitest';
import type { TeamIdentityConnectionV1 } from '@happier-dev/protocol/teams';

import {
    beginIdentityAdministrationRefresh,
    INITIAL_IDENTITY_ADMINISTRATION_STATE,
    settleIdentityAdministrationRefresh,
} from './identityAdministrationState';

const admissionModeApplicability = {
    v: 1 as const,
    modes: {
        invite_only: { status: 'available' as const },
        provisioned: { status: 'unavailable' as const, reason: 'directory_source_required' as const },
        jit: { status: 'unavailable' as const, reason: 'team_connection_required' as const },
    },
};

function connection(id: string, displayName: string): TeamIdentityConnectionV1 {
    return {
        v: 1,
        id,
        teamId: 'team-1',
        provider: { id: `provider-${id}`, kind: 'oidc', displayName },
        externalReference: { v: 1, kind: 'oidc' },
        settings: { v: 1, kind: 'oidc', allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
        enabled: true,
        firstEnabledAt: 1,
        revision: 1,
        state: 'connected',
        allowedActions: [],
        lastObservation: { v: 1, kind: 'oidc' },
        lastSuccessfulTest: null,
        createdAt: 1,
        updatedAt: 1,
    };
}

describe('identityAdministrationState', () => {
    it('keeps the last exact-Team rows visible when a refresh fails', () => {
        const loaded = settleIdentityAdministrationRefresh(INITIAL_IDENTITY_ADMINISTRATION_STATE, {
            ok: true,
            items: [connection('z', 'Zulu'), connection('a', 'Alpha')],
            eligibleProviders: [{
                v: 1, providerId: 'provider-new', providerKind: 'oidc', owner: 'home', displayName: 'New OIDC',
                availability: { status: 'unavailable', code: 'provider_disabled' },
            }],
            admissionModeApplicability,
            memberSignInUrl: 'https://app.example.test/teams/team-1/sign-in?target=home',
        });
        const refreshing = beginIdentityAdministrationRefresh(loaded);
        const failed = settleIdentityAdministrationRefresh(refreshing, {
            ok: false,
            failure: { code: 'home_unreachable', retryable: true },
        });

        expect(failed).toEqual({
            kind: 'ready',
            items: [connection('a', 'Alpha'), connection('z', 'Zulu')],
            eligibleProviders: [{
                v: 1, providerId: 'provider-new', providerKind: 'oidc', owner: 'home', displayName: 'New OIDC',
                availability: { status: 'unavailable', code: 'provider_disabled' },
            }],
            // Applicability follows the same last-known-good/stale contract as
            // the connection rows; clients never recompute it while offline.
            admissionModeApplicability,
            // The member sign-in link an administrator was about to copy stays
            // readable through a failed refresh, like every other row here.
            memberSignInUrl: 'https://app.example.test/teams/team-1/sign-in?target=home',
            refreshing: false,
            stale: true,
            failure: { code: 'home_unreachable', retryable: true },
        });
    });

    it('shows an unavailable state when the first exact-Team load fails', () => {
        expect(settleIdentityAdministrationRefresh(INITIAL_IDENTITY_ADMINISTRATION_STATE, {
            ok: false,
            failure: { code: 'team_forbidden', retryable: false },
        })).toEqual({
            kind: 'unavailable',
            failure: { code: 'team_forbidden', retryable: false },
        });
    });
});
