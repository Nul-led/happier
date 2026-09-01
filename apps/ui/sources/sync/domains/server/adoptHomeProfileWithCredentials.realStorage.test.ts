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
            credentialWrite: 'required',
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

    it('preserves an established Home credential when selected Directory data remains advisory', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_advisory_established_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const established = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_established_home',
                canonicalServerUrl: 'https://established-home.test',
                revision: 3,
                endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://established-home.test',
            { serverId: 'srv_established_home' },
            { token: 'established-home-token' },
        )).resolves.toBe(true);

        expect(profiles.preflightHomeProfileAdoption({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_established_home',
                canonicalServerUrl: 'https://directory-route.test',
                revision: 999,
                endpoints: [{ kind: 'https', url: 'https://directory-route.test' }],
            },
        })).toEqual({
            canonicalServerUrl: 'https://established-home.test',
            serverIdentityId: 'srv_established_home',
            credentialWrite: 'preserveExisting',
        });

        const adopted = await adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_established_home',
                canonicalServerUrl: 'https://directory-route.test',
                revision: 999,
                endpoints: [{ kind: 'https', url: 'https://directory-route.test' }],
            },
            credentials: { token: 'newly-issued-token' },
        });

        expect(adopted).toEqual(established);
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://established-home.test',
            { serverId: 'srv_established_home' },
        )).resolves.toEqual({ token: 'established-home-token' });
        for (const [, value] of localStorageMock.store.entries()) {
            expect(value).not.toContain('newly-issued-token');
        }
    });

    it('stores a newly issued credential for a signed-out established Home without accepting advisory routing changes', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_advisory_signed_out_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const established = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_signed_out_home',
                canonicalServerUrl: 'https://signed-out-home.test',
                revision: 4,
                endpoints: [{ kind: 'iroh', endpointId: 'b'.repeat(64) }],
            },
        });

        const adopted = await adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_signed_out_home',
                canonicalServerUrl: 'https://directory-signed-out-route.test',
                revision: 100,
                endpoints: [{ kind: 'https', url: 'https://directory-signed-out-route.test' }],
            },
            credentials: { token: 'newly-issued-token' },
        });

        expect(adopted).toEqual(established);
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://signed-out-home.test',
            { serverId: 'srv_signed_out_home' },
        )).resolves.toEqual({ token: 'newly-issued-token' });
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://directory-signed-out-route.test',
            { serverId: 'srv_signed_out_home' },
        )).resolves.toBeNull();
    });

    it('stores for an advisory-only placeholder without establishing new routing facts', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_advisory_placeholder_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const placeholder = await profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_coupled_storage_home',
                canonicalServerUrl: 'https://directory-route.test',
                revision: 50,
                endpoints: [{ kind: 'https', url: 'https://directory-route.test' }],
            },
        });

        const adopted = await adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_coupled_storage_home',
                canonicalServerUrl: 'https://directory-route.test',
                revision: 50,
                endpoints: [{ kind: 'https', url: 'https://directory-route.test' }],
            },
            credentials: { token: 'advisory-home-token' },
        });

        expect(adopted.id).toBe(placeholder.id);
        expect(adopted.descriptorProvenance).toBe('advisory-only');
        expect(adopted.canonicalServerUrl ?? adopted.serverUrl).toBe('https://directory-route.test');
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://directory-route.test',
            { serverId: 'srv_coupled_storage_home' },
        )).resolves.toEqual({ token: 'advisory-home-token' });
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

    it('does not expose Home A credentials through a conflicting Home B identity observed at the same URL', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `identity_conflict_storage_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const serverUrl = 'https://shared-home.test';

        profiles.upsertServerProfile({ serverUrl, source: 'manual' });
        expect(profiles.setServerProfileIdentityForUrl(serverUrl, 'srv_home_a')?.serverIdentityId)
            .toBe('srv_home_a');
        await expect(TokenStorage.setCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);

        expect(profiles.setServerProfileIdentityForUrl(serverUrl, 'srv_home_b')).toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_b' },
        )).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_a' },
        )).resolves.toEqual({ token: 'home-a-token' });
    });

});
