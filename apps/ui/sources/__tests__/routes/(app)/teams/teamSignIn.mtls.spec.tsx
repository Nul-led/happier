import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const boundary = vi.hoisted(() => ({
    entryProps: null as null | Record<string, unknown>,
    authenticationProps: null as null | Record<string, unknown>,
    surfaceProps: null as null | Record<string, unknown>,
    params: { teamId: 'team-1', target: 'home-identity' } as Record<string, string>,
    scopeResolution: { kind: 'signed_out' } as Record<string, unknown>,
    readPending: vi.fn(),
    clearPending: vi.fn(),
    joinProps: null as null | Record<string, unknown>,
    joinRenderCount: 0,
}));

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => boundary.params,
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/components/teams/entry/TeamAuthEntrySurface', () => ({
    TeamAuthEntrySurface: (props: Record<string, unknown>) => {
        boundary.entryProps = props;
        return null;
    },
}));

vi.mock('@/components/account/auth/HomeAuthenticationFlow', () => ({
    HomeAuthenticationFlow: (props: Record<string, unknown>) => {
        boundary.authenticationProps = props;
        return null;
    },
}));

vi.mock('@/components/teams/entry/teamSignInHome', () => ({
    resolveTeamSignInHome: () => ({
        kind: 'resolved',
        savedProfileId: 'profile-home',
        target: {
            kind: 'descriptor',
            authority: 'trusted_enrollment',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'home-identity',
                canonicalServerUrl: 'https://home.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
            },
        },
    }),
    teamSignInReturnPath: (params: Readonly<{ postAuthInvitation?: boolean }>) =>
        `/teams/team-1/sign-in?target=home-identity${params.postAuthInvitation ? '&postAuthInvitation=1' : ''}`,
}));

vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: () => boundary.scopeResolution,
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        readPendingExternalAuthContinuationState: boundary.readPending,
        clearPendingExternalAuth: boundary.clearPending,
    },
}));

vi.mock('@/components/teams/join/TeamJoinScreen', () => ({
    TeamJoinScreen: (props: Record<string, unknown>) => {
        boundary.joinProps = props;
        boundary.joinRenderCount += 1;
        return null;
    },
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 0,
}));

vi.mock('@/components/settings/teams/teamsRoutes', () => ({
    teamSessionsPath: () => '/settings/teams/home-identity/team-1/sessions',
}));

vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => ({
    SurfaceStateCard: (props: Record<string, unknown>) => {
        boundary.surfaceProps = props;
        return null;
    },
}));
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());

describe('TeamSignInRoute native mTLS', () => {
    beforeEach(() => {
        boundary.entryProps = null;
        boundary.authenticationProps = null;
        boundary.surfaceProps = null;
        boundary.params = { teamId: 'team-1', target: 'home-identity' };
        boundary.scopeResolution = { kind: 'signed_out' };
        boundary.readPending.mockReset();
        boundary.clearPending.mockReset();
        boundary.joinProps = null;
        boundary.joinRenderCount = 0;
    });

    afterEach(() => standardCleanup());

    it('carries direct Home-origin mTLS through the exact Team continuation', async () => {
        const { default: TeamSignInRoute } = await import('@/app/(app)/teams/[teamId]/sign-in');
        await renderScreen(<TeamSignInRoute />);

        const onSelectAction = boundary.entryProps?.onSelectAction as ((selection: unknown) => void) | undefined;
        expect(onSelectAction).toBeTypeOf('function');
        await act(async () => {
            onSelectAction?.({
                action: {
                    kind: 'authenticate',
                    methodId: 'mtls',
                    action: 'login',
                    mode: 'keyless',
                    origin: 'home',
                    presentation: { displayName: 'Certificate' },
                },
                teamId: 'team-1',
                teamName: 'Native Team',
                target: { kind: 'url', url: 'https://home.example.test' },
            });
        });

        expect(boundary.authenticationProps).toEqual(expect.objectContaining({
            teamAdmission: { teamId: 'team-1' },
        }));
    });

    it('leaves post-auth invitation custody unclaimed and presents exact Team sign-in after resolving becomes signed out', async () => {
        boundary.params = {
            teamId: 'team-1',
            target: 'home-identity',
            postAuthInvitation: '1',
        };
        boundary.scopeResolution = { kind: 'resolving' };
        const { default: TeamSignInRoute } = await import('@/app/(app)/teams/[teamId]/sign-in');
        const rendered = await renderScreen(<TeamSignInRoute />);
        expect(boundary.surfaceProps).toEqual(expect.objectContaining({
            testID: 'team-sign-in-resolving',
        }));

        boundary.surfaceProps = null;
        boundary.scopeResolution = { kind: 'signed_out' };
        await act(async () => {
            rendered.tree.update(<TeamSignInRoute />);
        });

        expect(boundary.entryProps).toEqual(expect.objectContaining({
            teamId: 'team-1',
            target: expect.objectContaining({ kind: 'descriptor' }),
        }));
        expect(boundary.surfaceProps?.testID).not.toBe('team-sign-in-post-auth-loading');
        expect(boundary.readPending).not.toHaveBeenCalled();
        expect(boundary.clearPending).not.toHaveBeenCalled();

        const onSelectAction = boundary.entryProps?.onSelectAction as ((selection: unknown) => void) | undefined;
        await act(async () => {
            onSelectAction?.({
                action: {
                    kind: 'authenticate', methodId: 'email_password', action: 'login',
                    mode: 'either', origin: 'home', presentation: { displayName: 'Email' },
                },
                teamId: 'team-1',
                teamName: 'Team One',
                target: { kind: 'url', url: 'https://home.example.test' },
            });
        });
        expect(boundary.authenticationProps).toEqual(expect.objectContaining({
            returnTo: '/teams/team-1/sign-in?target=home-identity&postAuthInvitation=1',
        }));
    });

    it('claims the exact server-held invitation continuation and mounts explicit Join once', async () => {
        const continuation = {
            v: 1,
            kind: 'post_auth_invitation',
            reference: 'mtls_claim_mtls-admission-1',
            teamId: 'team-1',
        } as const;
        boundary.params = {
            teamId: 'team-1',
            target: 'home-identity',
            postAuthInvitation: '1',
        };
        boundary.scopeResolution = {
            kind: 'bound',
            scope: { serverId: 'profile-home', accountId: 'account-1' },
        };
        const pending = {
            provider: 'mtls',
            serverId: 'profile-home',
            serverUrl: 'https://home.example.test',
            teamContinuation: {
                v: 1,
                purpose: 'team_admission',
                admissionReference: 'mtls-admission-1',
                teamId: 'team-1',
                homeServerIdentityId: 'home-identity',
                destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
            postAuthInvitation: continuation,
        };
        boundary.readPending.mockResolvedValue({ value: pending, serverMismatch: false });
        boundary.clearPending.mockResolvedValue(true);

        const { default: TeamSignInRoute } = await import('@/app/(app)/teams/[teamId]/sign-in');
        await act(async () => { await renderScreen(<TeamSignInRoute />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(boundary.clearPending).toHaveBeenCalledTimes(1);
        expect(boundary.clearPending).toHaveBeenCalledWith({
            serverUrl: 'https://home.example.test',
            serverId: 'profile-home',
            removeExact: pending,
        });
        expect(boundary.joinRenderCount).toBe(1);
        expect(boundary.joinProps).toEqual({
            postAuthContinuation: continuation,
            homeTarget: 'home-identity',
        });
        expect(boundary.entryProps).toBeNull();
    });
});
