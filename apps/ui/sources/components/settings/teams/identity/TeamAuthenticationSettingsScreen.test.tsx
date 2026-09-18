import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const executeMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const teamGitHubAppsSectionMock = vi.hoisted(() => vi.fn((_props: Readonly<{
    createAvailable: boolean;
}>) => null));
const teamContextMock = vi.hoisted(() => ({ canMutate: false }));
const identityStateMock = vi.hoisted(() => ({
    current: {
        kind: 'ready' as const,
        refreshing: false,
        stale: false,
        failure: null,
        items: [] as Array<Record<string, unknown>>,
        memberSignInUrl: null as string | null,
        admissionModeApplicability: {
            v: 1 as const,
            modes: {
                invite_only: { status: 'available' as const },
                provisioned: { status: 'unavailable' as const, reason: 'directory_source_required' as const },
                jit: { status: 'unavailable' as const, reason: 'team_connection_required' as const },
            },
        },
        eligibleProviders: [{
            v: 1 as const, providerId: 'provider-1', providerKind: 'oidc' as const, owner: 'home' as const, displayName: 'OIDC',
            availability: {
                status: 'available' as const,
                setupChoice: {
                    kind: 'use_existing' as const, providerInstanceId: 'provider-1',
                    connectionDraft: {
                        externalReference: { v: 1 as const, kind: 'oidc' as const },
                        settings: { v: 1 as const, kind: 'oidc' as const, allowedUsers: [] as string[], allowedEmailDomains: [] as string[], groupsAny: [] as string[], groupsAll: [] as string[] },
                    },
                },
            },
        }] as Array<Record<string, unknown>>,
    },
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPushMock }) }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./TeamGitHubAppScreens', () => ({ TeamGitHubAppsSection: teamGitHubAppsSectionMock }));
vi.mock('./TeamMemberSignInLinkSection', () => ({ TeamMemberSignInLinkSection: () => null }));
vi.mock('./TeamAuthenticationPolicySections', () => ({ TeamAuthenticationPolicySections: () => null }));
vi.mock('./identityAdministrationClient', () => ({
    createIdentityAdministrationClient: () => ({ execute: executeMock }),
}));
vi.mock('./useIdentityAdministration', () => ({
    useIdentityAdministration: () => ({
        refresh: vi.fn(),
        state: identityStateMock.current,
    }),
}));
vi.mock('../TeamSection', async () => {
    const { teamPolicyFixture } = await import('@/dev/testkit/fixtures/teamFixtures');
    return {
        TeamSection: (props: Readonly<{ children: (context: unknown) => React.ReactNode }>) => props.children({
            // The Team policy is part of every Team projection this screen reads;
            // the authentication policy editor renders from it.
            team: { capabilities: { manageAuthentication: true }, policy: teamPolicyFixture() },
            scope: { serverId: 'home-1', accountId: 'account-1' },
            address: { serverId: 'home-1', teamId: 'team-1' },
            canMutate: teamContextMock.canMutate,
            approvalPending: false,
            requestApproval: vi.fn(),
            refresh: vi.fn(),
        }),
    };
});

import { TeamAuthenticationSettingsScreen } from './TeamAuthenticationSettingsScreen';

beforeEach(() => {
    standardCleanup();
    executeMock.mockReset();
    routerPushMock.mockReset();
    teamGitHubAppsSectionMock.mockClear();
    identityStateMock.current.refreshing = false;
    identityStateMock.current.stale = false;
    identityStateMock.current.items = [];
    identityStateMock.current.eligibleProviders = [{
        v: 1,
        providerId: 'provider-1',
        providerKind: 'oidc',
        owner: 'home',
        displayName: 'OIDC',
        availability: {
            status: 'available',
            setupChoice: {
                kind: 'use_existing',
                providerInstanceId: 'provider-1',
                connectionDraft: {
                    externalReference: { v: 1, kind: 'oidc' },
                    settings: {
                        v: 1,
                        kind: 'oidc',
                        allowedUsers: [],
                        allowedEmailDomains: [],
                        groupsAny: [],
                        groupsAll: [],
                    },
                },
            },
        },
    }];
    teamContextMock.canMutate = false;
});

describe('TeamAuthenticationSettingsScreen', () => {
    it('keeps every connection and eligible provider mounted beyond 100 rows', async () => {
        identityStateMock.current.items = Array.from({ length: 101 }, (_, index) => ({
            v: 1,
            id: `connection-${index}`,
            teamId: 'team-1',
            provider: {
                id: `provider-${index}`,
                kind: 'oidc',
                displayName: `Provider ${index}`,
            },
            externalReference: { v: 1, kind: 'oidc' },
            settings: {
                v: 1,
                kind: 'oidc',
                allowedUsers: [],
                allowedEmailDomains: [],
                groupsAny: [],
                groupsAll: [],
            },
            enabled: true,
            firstEnabledAt: 1,
            revision: 1,
            state: 'connected',
            allowedActions: [],
            lastObservation: { v: 1, kind: 'oidc' },
            lastSuccessfulTest: null,
            createdAt: index,
            updatedAt: index,
        }));
        identityStateMock.current.eligibleProviders = Array.from({ length: 101 }, (_, index) => ({
            v: 1,
            providerId: `eligible-provider-${index}`,
            providerKind: 'oidc',
            owner: 'home',
            displayName: `Eligible provider ${index}`,
            availability: {
                status: 'available',
                setupChoice: {
                    kind: 'use_existing',
                    providerInstanceId: `eligible-provider-${index}`,
                    connectionDraft: {
                        externalReference: { v: 1, kind: 'oidc' },
                        settings: {
                            v: 1,
                            kind: 'oidc',
                            allowedUsers: [],
                            allowedEmailDomains: [],
                            groupsAny: [],
                            groupsAll: [],
                        },
                    },
                },
            },
        }));

        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(screen.findByTestId('team-authentication-connection-connection-100')).toBeTruthy();
        expect(screen.findByTestId('team-eligible-provider:eligible-provider-100')).toBeTruthy();
    });

    it('keeps provider setup visible but disables it for a read-only Team', async () => {
        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(screen.findByTestId('team-eligible-provider:provider-1')).toMatchObject({
            props: { disabled: true },
        });
        await screen.pressByTestIdAsync('team-eligible-provider:provider-1');
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('blocks setup from a stale allowed-action projection while refreshing', async () => {
        identityStateMock.current.refreshing = true;
        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(screen.findByTestId('team-eligible-provider:provider-1')).toMatchObject({
            props: { disabled: true },
        });
        await screen.pressByTestIdAsync('team-eligible-provider:provider-1');
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('binds an eligible GitHub installation through the shared Team connection action', async () => {
        teamContextMock.canMutate = true;
        identityStateMock.current.eligibleProviders = [{
            v: 1,
            providerId: 'github-provider-1',
            providerKind: 'github_app_identity',
            owner: 'team',
            displayName: 'Acme GitHub',
            availability: {
                status: 'available',
                setupChoice: {
                    kind: 'use_existing',
                    providerInstanceId: 'github-provider-1',
                    connectionDraft: {
                        externalReference: {
                            v: 1,
                            kind: 'github_app_identity',
                            installationId: 'installation-1',
                        },
                        settings: {
                            v: 1,
                            kind: 'github_app_identity',
                            organizationLogin: 'Acme',
                        },
                    },
                },
            },
        }];
        executeMock.mockResolvedValueOnce({
            ok: true,
            value: { connection: { id: 'connection-1' } },
        });
        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        await screen.pressByTestIdAsync('team-eligible-provider:github-provider-1');

        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledWith('teams.identity.connections.create', {
            v: 1,
            teamId: 'team-1',
            providerInstanceId: 'github-provider-1',
            externalReference: {
                v: 1,
                kind: 'github_app_identity',
                installationId: 'installation-1',
            },
            settings: {
                v: 1,
                kind: 'github_app_identity',
                organizationLogin: 'Acme',
            },
        }, expect.any(Object));
    });

    it('navigates to the created connection when a use-existing Action finishes after approval', async () => {
        teamContextMock.canMutate = true;
        let complete: ((value: Readonly<{ connection: Readonly<{ id: string }> }>) => void | Promise<void>) | undefined;
        executeMock.mockImplementationOnce(async (
            _actionId: string,
            _input: unknown,
            options?: Readonly<{ onApprovalSucceeded?: typeof complete }>,
        ) => {
            complete = options?.onApprovalSucceeded;
            return {
                ok: false,
                approvalPending: true,
                artifactId: 'approval-create-1',
                failure: { code: 'approval_pending', retryable: false },
            };
        });
        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        await screen.pressByTestIdAsync('team-eligible-provider:provider-1');
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(complete).toBeTypeOf('function');

        await complete?.({ connection: { id: 'connection-approved' } });
        expect(routerPushMock).toHaveBeenCalledWith(
            '/settings/teams/home-1/team-1/authentication/connection-approved',
        );
    });

    it('keeps retained GitHub App registrations reachable when Home policy disables new setup', async () => {
        teamContextMock.canMutate = true;
        identityStateMock.current.eligibleProviders = [{
            v: 1,
            providerId: null,
            providerKind: 'github_app_identity',
            owner: 'team',
            displayName: null,
            availability: {
                status: 'unavailable',
                code: 'home_policy_prohibited',
                setupChoice: { kind: 'create_managed', actionId: 'identity.githubApps.manifestSetup.start' },
            },
        }];

        await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(teamGitHubAppsSectionMock).toHaveBeenCalledTimes(1);
        expect(teamGitHubAppsSectionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            createAvailable: false,
        }));
    });

    it('disables generic GitHub setup and Add App for provider_setup_unavailable', async () => {
        teamContextMock.canMutate = true;
        identityStateMock.current.eligibleProviders = [{
            v: 1,
            providerId: null,
            providerKind: 'github_app_identity',
            owner: 'team',
            displayName: null,
            availability: {
                status: 'unavailable',
                code: 'provider_setup_unavailable',
                setupChoice: { kind: 'create_managed', actionId: 'identity.githubApps.manifestSetup.start' },
            },
        }];

        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(screen.findByTestId('team-eligible-provider:github_app_identity')).toMatchObject({
            props: { disabled: true },
        });
        expect(teamGitHubAppsSectionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            createAvailable: false,
        }));
    });

    it('enables generic GitHub setup and Add App only for an available create-managed catalog row', async () => {
        teamContextMock.canMutate = true;
        identityStateMock.current.eligibleProviders = [{
            v: 1,
            providerId: null,
            providerKind: 'github_app_identity',
            owner: 'team',
            displayName: null,
            availability: {
                status: 'available',
                setupChoice: { kind: 'create_managed', actionId: 'identity.githubApps.manifestSetup.start' },
            },
        }];

        const screen = await renderScreen(<TeamAuthenticationSettingsScreen serverId="home-1" teamId="team-1" />);

        expect(screen.findByTestId('team-eligible-provider:github_app_identity')).toMatchObject({
            props: { disabled: false },
        });
        expect(teamGitHubAppsSectionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            createAvailable: true,
        }));
    });
});
