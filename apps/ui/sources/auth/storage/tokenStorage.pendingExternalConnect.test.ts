import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTokenStorageWebPlatformMocks } from './tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from './tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

describe('TokenStorage pending external connect (web)', () => {
    let restoreLocalStorage: (() => void) | null = null;
    let localStorageHandle: LocalStorageMockHandle | null = null;

    beforeEach(() => {
        vi.resetModules();
        localStorageHandle = installLocalStorageMock();
        restoreLocalStorage = localStorageHandle.restore;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        localStorageHandle = null;
    });

    it('round-trips pending external connect state and falls back to the global record for the same active server', async () => {
        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
            return {
                ...actual,
                getActiveServerId: () => 'server-a',
                getActiveServerUrl: () => 'https://relay.example.test',
                listServerProfiles: () => [{ id: 'server-a', serverUrl: 'https://relay.example.test', name: 'Server A' }],
            };
        });

        const { TokenStorage } = await import('./tokenStorage');

        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toBeNull();
        await expect(
            (TokenStorage as any).setPendingExternalConnect({ provider: 'github', returnTo: '/friends' }),
        ).resolves.toBe(true);
        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://relay.example.test',
        });

        if (!localStorageHandle) {
            throw new Error('Expected localStorage mock handle');
        }
        const pendingKeys = [...localStorageHandle.store.keys()].filter((key) => key.includes('pending_external_connect'));
        expect(pendingKeys.length).toBe(2);
        expect(pendingKeys.some((key) => key.includes('__srv_'))).toBe(true);
        expect(pendingKeys.some((key) => key.includes('__global'))).toBe(true);

        for (const key of pendingKeys) {
            if (key.includes('__srv_')) {
                localStorageHandle.store.delete(key);
            }
        }

        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://relay.example.test',
        });

        await expect((TokenStorage as any).clearPendingExternalConnect()).resolves.toBe(true);
        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toBeNull();
        vi.doUnmock('@/sync/domains/server/serverProfiles');
    });

    it('keeps a pending connect bound to the exact Home that started it after focus moves', async () => {
        // A connect continuation belongs to the Home whose credential started it
        // (teams-lane-03/02 TA-R14/TA-R16). Focus moving to another Home — even one
        // sharing the same origin — must neither hide it nor retarget it.
        const state = {
            activeServerId: 'server-a',
            activeServerUrl: 'https://shared.example.test',
            profiles: [
                { id: 'server-a', serverUrl: 'https://shared.example.test', name: 'Server A' },
                { id: 'server-b', serverUrl: 'https://shared.example.test', name: 'Server B' },
            ],
        };

        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
            return {
                ...actual,
                getActiveServerId: () => state.activeServerId,
                getActiveServerUrl: () => state.activeServerUrl,
                listServerProfiles: () => state.profiles,
            };
        });

        const { TokenStorage } = await import('./tokenStorage');

        await expect(
            (TokenStorage as any).setPendingExternalConnect({
                provider: 'github',
                returnTo: '/friends',
                serverUrl: state.activeServerUrl,
                serverId: state.activeServerId,
            }),
        ).resolves.toBe(true);

        state.activeServerId = 'server-b';

        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://shared.example.test',
        });
        vi.doUnmock('@/sync/domains/server/serverProfiles');
    });

    it('records a Team connect started for a non-focused Home under that exact Home', async () => {
        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
            return {
                ...actual,
                getActiveServerId: () => 'server-a',
                getActiveServerUrl: () => 'https://a.example.test',
                listServerProfiles: () => [
                    { id: 'server-a', serverUrl: 'https://a.example.test', name: 'Server A' },
                    { id: 'server-b', serverUrl: 'https://b.example.test', name: 'Server B' },
                ],
            };
        });

        const { TokenStorage } = await import('./tokenStorage');

        await expect((TokenStorage as any).setPendingExternalConnect({
            provider: 'workos-team',
            returnTo: '/teams/team-1/sign-in',
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
        })).resolves.toBe(true);

        // A fresh return document (no in-memory state) still recovers the exact target.
        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toEqual({
            provider: 'workos-team',
            returnTo: '/teams/team-1/sign-in',
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
        });
        if (!localStorageHandle) throw new Error('Expected localStorage mock handle');
        const storedTargets = [...localStorageHandle.store.entries()]
            .filter(([key]) => key.includes('pending_external_connect'))
            .map(([, value]) => JSON.parse(String(value)).serverId);
        expect(storedTargets.every((serverId) => serverId === 'server-b')).toBe(true);

        await expect((TokenStorage as any).clearPendingExternalConnect()).resolves.toBe(true);
        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toBeNull();
        expect([...localStorageHandle.store.keys()].filter((key) => key.includes('pending_external_connect'))).toEqual([]);
        vi.doUnmock('@/sync/domains/server/serverProfiles');
    });

    it('clears the original scoped pending external connect key even after the active server changes', async () => {
        const state = {
            activeServerId: 'server-a',
            activeServerUrl: 'https://shared.example.test',
            profiles: [
                { id: 'server-a', serverUrl: 'https://shared.example.test', name: 'Server A' },
                { id: 'server-b', serverUrl: 'https://shared.example.test', name: 'Server B' },
            ],
        };

        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
            return {
                ...actual,
                getActiveServerId: () => state.activeServerId,
                getActiveServerUrl: () => state.activeServerUrl,
                listServerProfiles: () => state.profiles,
            };
        });

        const { TokenStorage } = await import('./tokenStorage');

        await expect(
            (TokenStorage as any).setPendingExternalConnect({
                provider: 'github',
                returnTo: '/friends',
                serverUrl: state.activeServerUrl,
                serverId: state.activeServerId,
            }),
        ).resolves.toBe(true);

        state.activeServerId = 'server-b';

        await expect((TokenStorage as any).clearPendingExternalConnect()).resolves.toBe(true);

        if (!localStorageHandle) {
            throw new Error('Expected localStorage mock handle');
        }
        const remainingScopedKeys = [...localStorageHandle.store.keys()].filter(
            (key) => key.includes('pending_external_connect') && key.includes('__srv_'),
        );
        expect(remainingScopedKeys).toEqual([]);
        vi.doUnmock('@/sync/domains/server/serverProfiles');
    });

    it('accepts scoped pending external connect records that omit explicit server context', async () => {
        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
            return {
                ...actual,
                getActiveServerId: () => 'server-a',
                getActiveServerUrl: () => 'https://relay.example.test',
                listServerProfiles: () => [{ id: 'server-a', serverUrl: 'https://relay.example.test', name: 'Server A' }],
            };
        });

        const { TokenStorage } = await import('./tokenStorage');

        await expect(
            (TokenStorage as any).setPendingExternalConnect({ provider: 'github', returnTo: '/friends' }),
        ).resolves.toBe(true);

        if (!localStorageHandle) {
            throw new Error('Expected localStorage mock handle');
        }

        for (const key of [...localStorageHandle.store.keys()]) {
            if (key.includes('pending_external_connect') && key.includes('__srv_')) {
                localStorageHandle.store.set(key, JSON.stringify({ provider: 'github', returnTo: '/friends' }));
            }
            if (key.includes('pending_external_connect') && key.includes('__global')) {
                localStorageHandle.store.delete(key);
            }
        }

        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
        });
        vi.doUnmock('@/sync/domains/server/serverProfiles');
    });

    it('returns null for malformed pending external connect payloads', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        ((localStorage as any).getItem as any).mockReturnValueOnce(JSON.stringify({ provider: 'github', returnTo: 123 }));

        await expect((TokenStorage as any).getPendingExternalConnect()).resolves.toBeNull();
    });
});
