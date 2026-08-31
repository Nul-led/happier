import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';

// Real TokenStorage + real serverProfiles storage: no credential-owner mocks. The web
// platform mocks below only stand in for genuine device boundaries (secure store/OS).
installTokenStorageWebPlatformMocks();

const HOME_B_DESCRIPTOR = {
    v: 1 as const,
    homeServerIdentityId: 'srv_home_b',
    canonicalServerUrl: 'https://home-b.test',
    revision: 1,
    endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
};

describe('adoptHomeProfileWithCredentials (real storage integration)', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    let restoreLocalStorage: (() => void) | null = null;

    afterEach(() => {
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.resetModules();
    });

    it('preflights Home B, writes B credentials before adoption, adopts without focus change, and reads B by stable identity while Home A stays byte-identical', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_real_storage_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        // Focused Home A with its own typed data-key credential and visible group.
        const homeACreated = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        const homeA = profiles.setServerProfileIdentityForUrl(homeACreated.serverUrl, 'srv_home_a') ?? homeACreated;
        profiles.setActiveServerId(homeA.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
            groups: [{ id: 'homes', name: 'Homes', serverIds: [homeA.id] }],
        });
        const homeACredentials = {
            token: 'home-a-token',
            encryption: { machineKey: 'home-a-machine-key', publicKey: 'home-a-public-key' },
        } as const;
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://home-a.test',
            { serverId: 'srv_home_a' },
            homeACredentials,
        )).resolves.toBe(true);

        const focusBefore = profiles.getActiveServerSnapshot();
        const groupsBefore = profiles.loadHomeViewState();
        const homeARawEntries = [...localStorageMock.store.entries()]
            .filter(([, value]) => value.includes('"home-a-token"'));
        expect(homeARawEntries.length).toBeGreaterThanOrEqual(1);

        // Read-only preflight resolves the exact explicit target before any write.
        expect(profiles.preflightHomeProfileAdoption({
            descriptor: HOME_B_DESCRIPTOR,
            source: 'qr',
            preserveUserLabel: true,
        })).toEqual({
            canonicalServerUrl: 'https://home-b.test',
            serverIdentityId: 'srv_home_b',
        });
        expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_home_b' }),
        ]));

        const adopted = await adoptHomeProfileWithCredentials({
            descriptor: HOME_B_DESCRIPTOR,
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'home-b-token' },
        });

        expect(adopted.serverIdentityId).toBe('srv_home_b');
        expect(adopted.canonicalServerUrl ?? adopted.serverUrl).toBe('https://home-b.test');

        // The pre-profile credential write lands under the URL-hash scope; reading by
        // stable identity must migrate it, and the second read must be served by the
        // adopted identity scope alone.
        const readB = { serverId: 'srv_home_b' } as const;
        await expect(TokenStorage.getCredentialsForServerUrl('https://home-b.test', readB))
            .resolves.toEqual({ token: 'home-b-token' });
        await expect(TokenStorage.getCredentialsForServerUrl('https://home-b.test', readB))
            .resolves.toEqual({ token: 'home-b-token' });

        // Focus, groups, and Home A's stored credential bytes are untouched.
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()).toEqual(groupsBefore);
        await expect(TokenStorage.getCredentialsForServerUrl('https://home-a.test', { serverId: 'srv_home_a' }))
            .resolves.toEqual(homeACredentials);
        for (const [key, value] of homeARawEntries) {
            expect(localStorageMock.store.get(key)).toBe(value);
        }
    });

    it('reads a pre-adoption loopback credential through the adopted stable identity', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_loopback_storage_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_loopback_home',
            canonicalServerUrl: 'http://127.0.0.1:43123',
            revision: 1,
            endpoints: [{ kind: 'https' as const, url: 'http://127.0.0.1:43123' }],
        };

        const adopted = await adoptHomeProfileWithCredentials({
            descriptor,
            source: 'qr',
            credentials: { token: 'loopback-home-token' },
        });

        await expect(TokenStorage.getCredentialsForServerUrl(
            adopted.canonicalServerUrl ?? adopted.serverUrl,
            { serverId: 'srv_loopback_home' },
        )).resolves.toEqual({ token: 'loopback-home-token' });
    });
});
