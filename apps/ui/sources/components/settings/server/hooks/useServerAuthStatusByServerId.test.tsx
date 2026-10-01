import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const credentialBoundary = vi.hoisted(() => ({
    modeByServerId: new Map<string, 'present' | 'absent' | 'unavailable'>(),
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        getServerProfileById: (serverId: string) => ({
            id: serverId,
            name: serverId,
            serverUrl: `https://${serverId}.example.test`,
            serverIdentityId: serverId,
            createdAt: 1,
            updatedAt: 1,
            lastUsedAt: 1,
        }),
        getServerProfilesGeneration: () => 1,
        subscribeServerProfiles: () => () => undefined,
    };
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (_serverUrl: string, options: { serverId?: string | null }) => {
                const serverId = options.serverId ?? '';
                const mode = credentialBoundary.modeByServerId.get(serverId) ?? 'absent';
                if (mode === 'unavailable') throw new Error('secure_storage_unavailable');
                return mode === 'present'
                    ? { token: `header.${Buffer.from(JSON.stringify({ sub: `account-${serverId}` })).toString('base64')}.signature` }
                    : null;
            },
        },
        subscribeHomeCredentialMutations: () => () => undefined,
    });
});

describe('useServerAuthStatusByServerId', () => {
    beforeEach(() => {
        credentialBoundary.modeByServerId = new Map([
            ['home-a', 'absent'],
            ['home-b', 'present'],
            ['home-c', 'unavailable'],
        ]);
    });

    afterEach(() => {
        standardCleanup();
    });

    it('projects canonical Home credential facts without treating a storage failure as sign-out', async () => {
        const { useServerAuthStatusByServerId } = await import('./useServerAuthStatusByServerId');
        const servers = [
            { id: 'profile-a', serverIdentityId: 'home-a', serverUrl: 'https://a.example.test' },
            { id: 'profile-b', serverIdentityId: 'home-b', serverUrl: 'https://b.example.test' },
            { id: 'profile-c', serverIdentityId: 'home-c', serverUrl: 'https://c.example.test' },
        ];
        const hook = await renderHook(() => useServerAuthStatusByServerId(servers));

        await vi.waitFor(() => {
            expect(hook.getCurrent()).toEqual({
                'home-a': 'signedOut',
                'home-b': 'signedIn',
                'home-c': 'unknown',
            });
        });
    });
});
