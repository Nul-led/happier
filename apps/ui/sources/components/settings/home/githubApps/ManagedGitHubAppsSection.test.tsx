import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const pushMock = vi.hoisted(() => vi.fn());
const githubAppsStateMock = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./useManagedGitHubApps', () => ({
    HOME_GITHUB_APP_OWNER: { kind: 'home' },
    useManagedGitHubApps: () => ({
        refresh: vi.fn(),
        state: githubAppsStateMock.current ?? {
            kind: 'ready',
            stale: false,
            registrations: [{
                id: 'registration-1',
                owner: { kind: 'team', teamId: 'team-1' },
                githubHost: 'https://github.com',
                githubAppId: '12',
                githubClientId: 'Iv1.client',
                githubAppSlug: 'acme-happier',
                githubOwnerId: '42',
                githubOwnerLogin: 'acme',
                revision: 3,
                securityRevision: 2,
                state: 'needs_attention',
                secretHealth: {
                    clientSecretConfigured: true,
                    privateKeyConfigured: true,
                    webhookSecretConfigured: false,
                },
                lastVerifiedAt: null,
                createdAt: '2026-09-01T10:00:00.000Z',
                updatedAt: '2026-09-01T10:00:00.000Z',
            }],
            installations: [],
        },
    }),
}));

import { ManagedGitHubAppsSection } from './ManagedGitHubAppsSection';

beforeEach(() => {
    standardCleanup();
    pushMock.mockReset();
    githubAppsStateMock.current = null;
});

describe('ManagedGitHubAppsSection', () => {
    it('keeps retained registrations reachable while policy disables only creation', async () => {
        const screen = await renderScreen(<ManagedGitHubAppsSection
            surface={{
                scope: { serverId: 'home-1', accountId: 'account-1' },
                owner: { kind: 'team', teamId: 'team-1' },
                mutationsAvailable: true,
                routes: {
                    detail: (id) => `/teams/team-1/github-apps/${id}`,
                    edit: (id) => `/teams/team-1/github-apps/${id}/edit`,
                    signIn: '/teams/team-1/sign-in',
                    directory: '/teams/team-1/directory',
                },
            }}
            createPath="/teams/team-1/github-apps/new"
            createAvailable={false}
        />);

        expect(screen.findByTestId('home-github-app:registration-1')).not.toBeNull();
        expect(screen.findByTestId('home-github-app-add')?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('home-github-app:registration-1');
        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith('/teams/team-1/github-apps/registration-1');
    });

    it('presents a typed lifecycle failure through the canonical localized owner', async () => {
        githubAppsStateMock.current = {
            kind: 'unavailable',
            failure: { code: 'github_installation_unverified', retryable: false },
        };
        const screen = await renderScreen(<ManagedGitHubAppsSection
            surface={{
                scope: { serverId: 'home-1', accountId: 'account-1' },
                owner: { kind: 'home' },
                mutationsAvailable: true,
                routes: {
                    detail: (id) => `/github-apps/${id}`,
                    edit: (id) => `/github-apps/${id}/edit`,
                    signIn: '/sign-in',
                },
            }}
            createPath="/github-apps/new"
        />);

        const unavailableItem = screen.findByTestId('managed-github-apps-unavailable');
        expect(unavailableItem?.props.title).toBe('identityAdministration.error');
        expect(unavailableItem?.props.title).not.toBe('github_installation_unverified');
    });
});
