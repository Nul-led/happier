import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const executeMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const requirementsMock = vi.hoisted(() => ({
    value: undefined as undefined | {
        permissions: Record<string, 'read' | 'write'>;
        events: string[];
        missingPermissions: Array<{ permission: string; required: 'read' | 'write' }>;
        missingEvents: string[];
    },
}));

vi.mock('@/utils/ui/clipboard', () => ({ setClipboardStringSafe: vi.fn(async () => true) }));
vi.mock('expo-router', () => ({
    useNavigation: () => ({ isFocused: () => true, addListener: () => () => {}, dispatch: vi.fn() }),
    useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/ui/forms/FieldItem', () => ({ FieldItem: 'FieldItem' }));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ui/text/Text', () => ({ TextInput: 'TextInput' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/url/openExternalUrl', () => ({ openExternalUrl: vi.fn(async () => true) }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), alertAsync: vi.fn(async () => {}), confirm: vi.fn(async () => true) } }));
vi.mock('./useManagedGitHubApps', () => ({
    HOME_GITHUB_APP_OWNER: { kind: 'home' },
    useManagedGitHubAppsClient: () => ({ execute: executeMock }),
    useManagedGitHubApps: () => ({
        refresh: refreshMock,
        state: {
            kind: 'ready',
            stale: false,
            registrations: [{
                id: 'registration-1',
                owner: { kind: 'home' },
                githubHost: 'https://github.com',
                githubAppId: '12',
                githubClientId: 'Iv1.client',
                githubAppSlug: 'happier',
                githubOwnerId: '22',
                githubOwnerLogin: 'happier-dev',
                revision: 2,
                securityRevision: 1,
                state: 'verified',
                secretHealth: { clientSecretConfigured: true, privateKeyConfigured: true, webhookSecretConfigured: true },
                lastVerifiedAt: '2026-09-01T10:00:00.000Z',
                createdAt: '2026-08-01T10:00:00.000Z',
                updatedAt: '2026-09-01T10:00:00.000Z',
            }],
            installations: [{
                id: 'installation-1',
                registrationId: 'registration-1',
                githubInstallationId: '99',
                githubOrganizationId: '77',
                githubOrganizationLogin: 'happier-dev',
                repositorySelection: 'all',
                revision: 1,
                state: 'verified',
                verifiedPermissions: {},
                verifiedEvents: [],
                suspendedAt: null,
                lastVerifiedAt: '2026-09-01T10:00:00.000Z',
                teamConsumers: [],
                ...(requirementsMock.value === undefined ? {} : { requirements: requirementsMock.value }),
            }],
        },
    }),
}));

import { ManagedGitHubAppDetailContent } from './ManagedGitHubAppDetailScreen';

const surface = {
    scope: { serverId: 'home-1', accountId: 'account-1' },
    owner: { kind: 'home' as const },
    mutationsAvailable: true,
    routes: {
        detail: (id: string) => `/registrations/${id}`,
        edit: (id: string) => `/registrations/${id}/edit`,
        signIn: '/settings/home/home-1/policies',
    },
} as const;

beforeEach(() => {
    standardCleanup();
    executeMock.mockReset();
    refreshMock.mockReset();
    requirementsMock.value = {
        permissions: { members: 'read' },
        events: ['membership'],
        missingPermissions: [{ permission: 'members', required: 'read' }],
        missingEvents: [],
    };
});

describe('managed GitHub App required access', () => {
    it('names each required permission and event and marks the ones GitHub has not granted', async () => {
        const screen = await renderScreen(
            <ManagedGitHubAppDetailContent surface={surface} registrationId="registration-1" />,
        );

        expect(screen.findByTestId('github-app-requirement:installation-1:permission:members')?.props.detail)
            .toBe('identityAdministration.githubRequirementMissing');
        expect(screen.findByTestId('github-app-requirement:installation-1:event:membership')?.props.detail)
            .toBe('identityAdministration.githubRequirementGranted');
    });

    it('renders nothing when the Home publishes no requirement projection', async () => {
        requirementsMock.value = undefined;
        const screen = await renderScreen(
            <ManagedGitHubAppDetailContent surface={surface} registrationId="registration-1" />,
        );

        expect(screen.findByTestId('github-app-requirement:installation-1:permission:members')).toBeNull();
    });
});
