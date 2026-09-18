import { describe, expect, it } from 'vitest';
import { TeamIdentityConnectionRemovalBlockerV1Schema } from '@happier-dev/protocol/teams';

import {
    identityAdministrationFailure,
    identityAdministrationFailureMessage,
    identityAdministrationFailureRecoveryLabel,
    isIdentityAdministrationFailureRetryable,
    type IdentityAdministrationFailureKind,
} from './identityAdministrationFailure';

/**
 * The identity/directory administration surfaces used to collapse every typed
 * server code into one "that did not go through" sentence, so a permission that
 * was revoked, a connection somebody else already removed, and an unreachable
 * Home all looked identical and none of them said what to do next. This proves
 * the one presenter distinguishes the outcomes that have different remedies.
 */
describe('identityAdministrationFailure', () => {
    it('separates the outcomes whose remedies differ', () => {
        const cases: ReadonlyArray<readonly [string, IdentityAdministrationFailureKind]> = [
            ['forbidden', 'forbidden'],
            ['team_forbidden', 'forbidden'],
            ['identity_provider_forbidden', 'forbidden'],
            ['team_identity_not_allowed', 'not_allowed'],
            ['team_authentication_required', 'authentication_required'],
            ['team_authentication_policy_unavailable', 'policy_unavailable'],
            ['identity_connection_policy_in_use', 'policy_in_use'],
            ['directory_cursor_expired', 'needs_attention'],
            ['directory_source_permission_lost', 'needs_attention'],
            ['revision_conflict', 'conflict'],
            ['identity_provider_revision_conflict', 'conflict'],
            ['identity_connection_conflict', 'conflict'],
            ['not_found', 'missing'],
            ['identity_connection_not_found', 'missing'],
            ['directory_source_not_found', 'missing'],
            ['identity_provider_in_use', 'in_use'],
            ['directory_source_in_use', 'in_use'],
            ['directory_group_already_bound', 'in_use'],
            ['identity_provider_unavailable', 'provider_unavailable'],
            ['workos_platform_unavailable', 'provider_unavailable'],
            ['directory_sync_unavailable', 'provider_unavailable'],
            ['home_unreachable', 'offline'],
            ['directory_sync_rate_limited', 'rate_limited'],
            ['identity_provider_invalid', 'invalid'],
            ['invalid_parameters', 'invalid'],
            ['workos_organization_mismatch', 'invalid'],
            ['oidc_discovery_failed', 'invalid'],
            ['identity_provider_unreadable', 'unreadable'],
        ];
        for (const [code, kind] of cases) {
            expect(identityAdministrationFailure(code).kind, code).toBe(kind);
        }
    });

    it('falls back to the generic outcome for a code this build does not know', () => {
        expect(identityAdministrationFailure('some_future_server_code').kind).toBe('unknown');
        expect(identityAdministrationFailure('').kind).toBe('unknown');
    });

    it('owns retryability so a client cannot disagree with what the screen shows', () => {
        // Only a transient transport/provider condition may offer Retry. A
        // permission loss or a conflicting write must not invite a blind retry.
        expect(isIdentityAdministrationFailureRetryable('home_unreachable')).toBe(true);
        expect(isIdentityAdministrationFailureRetryable('directory_sync_rate_limited')).toBe(true);
        expect(isIdentityAdministrationFailureRetryable('workos_platform_unavailable')).toBe(true);
        expect(isIdentityAdministrationFailureRetryable('forbidden')).toBe(false);
        expect(isIdentityAdministrationFailureRetryable('revision_conflict')).toBe(false);
        expect(isIdentityAdministrationFailureRetryable('identity_provider_in_use')).toBe(false);
        expect(isIdentityAdministrationFailureRetryable('some_future_server_code')).toBe(false);
    });

    it('does not invite a retry for a Team outcome that a retry cannot change', () => {
        // The Team policy being unevaluable, a missing Team sign-in, and a Home
        // that prohibits the provider kind each need a different screen, not
        // the same request again.
        expect(identityAdministrationFailure('team_authentication_policy_unavailable'))
            .toMatchObject({ retryable: false, recovery: 'authentication_policy' });
        expect(identityAdministrationFailure('team_authentication_required'))
            .toMatchObject({ retryable: false, recovery: 'team_authentication' });
        expect(identityAdministrationFailure('team_identity_not_allowed'))
            .toMatchObject({ retryable: false, recovery: 'contact_home_admin' });
        expect(identityAdministrationFailure('identity_connection_policy_in_use'))
            .toMatchObject({ retryable: false, recovery: 'authentication_policy' });
        expect(identityAdministrationFailure('directory_cursor_expired'))
            .toMatchObject({ retryable: false, recovery: 'directory' });
        expect(identityAdministrationFailure('home_unreachable').recovery).toBe('retry');
        expect(identityAdministrationFailure('revision_conflict').recovery).toBe('reload');
    });

    it('names a real recovery destination for every typed removal blocker', () => {
        const recoveries = Object.fromEntries(TeamIdentityConnectionRemovalBlockerV1Schema.options
            .map((code) => [code, identityAdministrationFailure(code).recovery]));
        expect(recoveries).toEqual({
            team_authentication_policy_in_use: 'authentication_policy',
            team_authentication_policy_unavailable: 'authentication_policy',
            account_would_lose_login: 'alternate_login',
            home_authentication_policy_unavailable: 'contact_home_admin',
            directory_source_in_use: 'directory',
            external_group_binding_in_use: 'group_mappings',
            managed_membership_in_use: 'none',
        });
        for (const code of TeamIdentityConnectionRemovalBlockerV1Schema.options) {
            const message = identityAdministrationFailureMessage(code);
            expect(message, code).not.toContain(code);
            const recovery = identityAdministrationFailure(code).recovery;
            const label = identityAdministrationFailureRecoveryLabel(recovery);
            if (recovery === 'none') expect(label, code).toBeNull();
            else expect(label, code).toBeTruthy();
        }
    });

    it('marks the conflict outcome as the one a refresh resolves', () => {
        expect(identityAdministrationFailure('revision_conflict').refreshResolves).toBe(true);
        expect(identityAdministrationFailure('forbidden').refreshResolves).toBe(false);
        expect(identityAdministrationFailure('home_unreachable').refreshResolves).toBe(false);
    });

    it('produces a distinct localized sentence per outcome and never the raw code', () => {
        const messages = new Set<string>();
        for (const code of [
            'forbidden', 'revision_conflict', 'not_found', 'identity_provider_in_use',
            'workos_platform_unavailable', 'home_unreachable', 'directory_sync_rate_limited',
            'identity_provider_invalid', 'identity_provider_unreadable', 'whatever',
        ]) {
            const message = identityAdministrationFailureMessage(code);
            expect(message.length, code).toBeGreaterThan(0);
            expect(message, code).not.toContain(code);
            messages.add(message);
        }
        expect(messages.size).toBe(10);
    });
});
