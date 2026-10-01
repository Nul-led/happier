import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import {
    installLocalStorageMock,
    installWebLockManagerMock,
    type WebLockManagerMockHandle,
} from '@/auth/storage/tokenStorage.web.testHelpers';

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
    let webLocks: WebLockManagerMockHandle | null = null;

    beforeEach(() => {
        webLocks = installWebLockManagerMock();
    });

    afterEach(() => {
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        webLocks?.restore();
        webLocks = null;
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.resetModules();
    });

    it('publishes a usable Home after credential-first adoption to an already-started projection', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_usable_home_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const projection = await import('@/sync/domains/scope/usableHomeServerIds');
        const seen: Array<readonly string[] | null> = [];
        const unsubscribe = projection.subscribeUsableHomeServerIds(() => {
            seen.push(projection.readUsableHomeServerIds());
        });
        try {
            await vi.waitFor(() => expect(projection.readUsableHomeServerIds()).toEqual([]));
            const payload = Buffer.from(JSON.stringify({ sub: 'home-b-account' })).toString('base64url');
            await adoptHomeProfileWithCredentials({
                descriptor: HOME_B_DESCRIPTOR,
                source: 'qr',
                credentials: { token: `header.${payload}.signature` },
            });

            await vi.waitFor(() => expect(projection.readUsableHomeServerIds()).toEqual(['srv_home_b']));
            expect(seen).toContainEqual(['srv_home_b']);
        } finally {
            unsubscribe();
        }
    });

    it('preflights Home B, writes B credentials before adoption, adopts without focus change, and reads B by stable identity while Home A stays byte-identical', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_real_storage_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        // Focused Home A with its own typed data-key credential and visible group.
        const homeACreated = await profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        const homeA = (await profiles.setServerProfileIdentityForUrl(homeACreated.serverUrl, 'srv_home_a')) ?? homeACreated;
        await profiles.setActiveServerId(homeA.id);
        await profiles.saveHomeViewState({
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


    it('rejects credentials for an advisory-only placeholder until a current Home observation establishes routing', async () => {
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

        expect(profiles.preflightHomeProfileAdoption({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_coupled_storage_home',
                canonicalServerUrl: 'https://directory-route.test',
                revision: 50,
                endpoints: [{ kind: 'https', url: 'https://directory-route.test' }],
            },
        })).toEqual({
            canonicalServerUrl: 'https://directory-route.test',
            serverIdentityId: 'srv_coupled_storage_home',
            credentialWrite: 'requiresCurrentObservation',
        });

        await expect(adoptHomeProfileWithCredentials({
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
        })).rejects.toMatchObject({
            code: 'home_profile_adoption_requires_current_observation',
            canonicalServerUrl: 'https://directory-route.test',
            serverIdentityId: 'srv_coupled_storage_home',
        });

        const retained = profiles.getServerProfileById(placeholder.id);
        expect(retained?.id).toBe(placeholder.id);
        expect(retained?.descriptorProvenance).toBe('advisory-only');
        expect(retained?.canonicalServerUrl ?? retained?.serverUrl).toBe('https://directory-route.test');
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://directory-route.test',
            { serverId: 'srv_coupled_storage_home' },
        )).resolves.toBeNull();
        for (const [, value] of localStorageMock.store.entries()) {
            expect(value).not.toContain('advisory-home-token');
        }
    });

    it('writes a credential only after the advisory profile receives exact Home observation authority', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_assertion_bound_advisory_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const {
            adoptHomeProfileWithCredentials,
        } = await import('./adoptHomeProfile');
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_assertion_bound_home',
            canonicalServerUrl: 'https://canonical.assertion-bound.test',
            revision: 7,
            endpoints: [{ kind: 'https' as const, url: 'https://ingress.assertion-bound.test' }],
        };
        await profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor,
        });

        const adopted = await adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'current_connection_observation',
            descriptor,
            credentials: { token: 'assertion-bound-token' },
        });

        expect(adopted.descriptorProvenance).not.toBe('advisory-only');
        await expect(TokenStorage.getCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
        )).resolves.toEqual({ token: 'assertion-bound-token' });

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

    it('moves the canonical URL and credential slot of one established identity while preserving label, aliases, pointers and unrelated Homes', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `canonical_url_migration_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        const other = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_unrelated_home',
                canonicalServerUrl: 'https://unrelated-home.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://unrelated-home.test' }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://unrelated-home.test',
            { serverId: 'srv_unrelated_home' },
            { token: 'unrelated-home-token' },
        )).resolves.toBe(true);

        const moving = await profiles.adoptHomeProfile({
            source: 'qr',
            suggestedName: 'Workshop Home',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_moving_home',
                canonicalServerUrl: 'https://moving-home-old.test',
                revision: 3,
                endpoints: [{ kind: 'https', url: 'https://moving-home-old.test' }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://moving-home-old.test',
            { serverId: 'srv_moving_home' },
            { token: 'moving-home-token' },
        )).resolves.toBe(true);
        await profiles.setActiveServerId(other.id);
        await profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'group',
            activeTargetId: 'homes',
            groups: [{ id: 'homes', name: 'Homes', serverIds: [other.id, moving.id] }],
        });
        const focusBefore = profiles.getActiveServerSnapshot();
        const groupsBefore = profiles.loadHomeViewState();
        const otherBefore = profiles.getServerProfileById(other.id);

        const migrated = await adoptHomeProfileWithCredentials({
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'moving-home-new-token' },
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_moving_home',
                canonicalServerUrl: 'https://moving-home-new.test',
                revision: 4,
                endpoints: [{ kind: 'https', url: 'https://moving-home-new.test' }],
            },
        });

        expect(migrated.id).toBe(moving.id);
        expect(migrated.name).toBe('Workshop Home');
        expect(migrated.serverIdentityId).toBe('srv_moving_home');
        expect(migrated.canonicalServerUrl ?? migrated.serverUrl)
            .toBe('https://moving-home-new.test');

        // The exact bearer follows the identity to its destination and is no longer
        // addressable through the obsolete URL.
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://moving-home-new.test',
            { serverId: 'srv_moving_home' },
        )).resolves.toEqual({ token: 'moving-home-new-token' });
        await expect(TokenStorage.getCredentialsForServerUrl('https://moving-home-old.test'))
            .resolves.toBeNull();

        // Pointers, groups and the unrelated Home are untouched.
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()).toEqual(groupsBefore);
        expect(profiles.getServerProfileById(other.id)).toEqual(otherBefore);
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://unrelated-home.test',
            { serverId: 'srv_unrelated_home' },
        )).resolves.toEqual({ token: 'unrelated-home-token' });
    });

    it('reports a truthful partial commit when the obsolete credential slot cannot be cleaned up', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `canonical_url_partial_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        const moving = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_partial_home',
                canonicalServerUrl: 'https://partial-old.test',
                revision: 2,
                endpoints: [{ kind: 'https', url: 'https://partial-old.test' }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://partial-old.test',
            { serverId: 'srv_partial_home' },
            { token: 'partial-home-token' },
        )).resolves.toBe(true);

        localStorageMock.removeItemMock.mockImplementation(() => {
            throw new Error('storage removal unavailable');
        });

        await expect(adoptHomeProfileWithCredentials({
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'partial-home-new-token' },
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_partial_home',
                canonicalServerUrl: 'https://partial-new.test',
                revision: 3,
                endpoints: [{ kind: 'https', url: 'https://partial-new.test' }],
            },
        })).rejects.toMatchObject({
            code: 'home_profile_canonical_url_migration_partial_commit',
            stage: 'obsolete_credential_cleanup',
            serverIdentityId: 'srv_partial_home',
            fromCanonicalServerUrl: 'https://partial-old.test',
            toCanonicalServerUrl: 'https://partial-new.test',
        });

        // The destination is already committed; the caller is told so rather than
        // being handed a clean failure that hides the retained obsolete slot.
        expect(profiles.getServerProfileById(moving.id)?.canonicalServerUrl)
            .toBe('https://partial-new.test');
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://partial-new.test',
            { serverId: 'srv_partial_home' },
        )).resolves.toEqual({ token: 'partial-home-new-token' });
    });

    it('moves an identity-scoped credential without a conflicting destination rewrite', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `canonical_url_destination_failure_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');

        const moving = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_destination_failure_home',
                canonicalServerUrl: 'https://destination-failure-old.test',
                revision: 2,
                endpoints: [{ kind: 'https', url: 'https://destination-failure-old.test' }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://destination-failure-old.test',
            { serverId: 'srv_destination_failure_home' },
            { token: 'destination-failure-token' },
        )).resolves.toBe(true);
        const destinationWrite = vi.spyOn(TokenStorage, 'setCredentialsForServerUrlWithRollback');

        await expect(adoptHomeProfileWithCredentials({
            source: 'qr',
            preserveUserLabel: true,
            credentials: { token: 'destination-failure-token' },
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_destination_failure_home',
                canonicalServerUrl: 'https://destination-failure-new.test',
                revision: 3,
                endpoints: [{ kind: 'https', url: 'https://destination-failure-new.test' }],
            },
        })).resolves.toMatchObject({
            canonicalServerUrl: 'https://destination-failure-new.test',
            serverIdentityId: 'srv_destination_failure_home',
        });

        expect(profiles.getServerProfileById(moving.id)?.canonicalServerUrl)
            .toBe('https://destination-failure-new.test');
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://destination-failure-new.test',
            { serverId: 'srv_destination_failure_home' },
        )).resolves.toEqual({ token: 'destination-failure-token' });
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://destination-failure-old.test',
        )).resolves.toBeNull();
        expect(destinationWrite).not.toHaveBeenCalled();
    });

    it('holds one browser-wide Home authority across reassignment snapshot and obsolete credential cleanup', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `canonical_url_cross_tab_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { digest } = await import('@/platform/digest');
        const { encodeBase64 } = await import('@/encryption/base64');
        const { readStorageScopeFromEnv, scopedStorageId } = await import('@/utils/system/storageScope');
        const { adoptHomeProfileWithCredentials } = await import('./adoptHomeProfile');
        const oldUrl = 'https://cross-tab-old.test';
        const newUrl = 'https://cross-tab-new.test';
        const oldUrlHash = encodeBase64(
            await digest('SHA-256', new TextEncoder().encode(oldUrl)),
            'base64url',
        );
        const oldUrlCredentialKey = scopedStorageId(
            `auth_credentials__srv_${oldUrlHash}`,
            readStorageScopeFromEnv(),
        );

        await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_cross_tab_home',
                canonicalServerUrl: oldUrl,
                revision: 1,
                endpoints: [{ kind: 'https', url: oldUrl }],
            },
        });
        await expect(TokenStorage.setCredentialsForServerUrl(
            oldUrl,
            { serverId: 'srv_cross_tab_home' },
            { token: 'cross-tab-old-token' },
        )).resolves.toBe(true);

        let cleanupRemovalCount = 0;
        let competingAdoption: Promise<unknown> | null = null;
        let competingAdoptionCompleted = false;
        localStorageMock.removeItemMock.mockImplementation((key: string) => {
            localStorageMock.store.delete(key);
            if (key !== oldUrlCredentialKey) return;
            cleanupRemovalCount += 1;
            // The first removal belongs to destination credential write alias
            // cleanup. The later URL-only removal is the obsolete-slot sweep
            // after the profile reassignment snapshot.
            if (cleanupRemovalCount !== 2) return;
            expect(webLocks?.isHeld()).toBe(true);
            competingAdoption = profiles.adoptHomeProfile({
                source: 'qr',
                descriptor: {
                    v: 1,
                    homeServerIdentityId: 'srv_competing_home',
                    canonicalServerUrl: oldUrl,
                    revision: 1,
                    endpoints: [{ kind: 'https', url: oldUrl }],
                },
            }).then((profile) => {
                competingAdoptionCompleted = true;
                return profile;
            });
        });

        const migrated = await adoptHomeProfileWithCredentials({
            source: 'qr',
            credentials: { token: 'cross-tab-new-token' },
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_cross_tab_home',
                canonicalServerUrl: newUrl,
                revision: 2,
                endpoints: [{ kind: 'https', url: newUrl }],
            },
        });

        expect(migrated.serverIdentityId).toBe('srv_cross_tab_home');
        expect(competingAdoption).not.toBeNull();
        expect(competingAdoptionCompleted).toBe(false);
        await expect(competingAdoption!).resolves.toMatchObject({
            serverIdentityId: 'srv_competing_home',
            canonicalServerUrl: oldUrl,
        });
        await expect(TokenStorage.getCredentialsForServerUrl(
            newUrl,
            { serverId: 'srv_cross_tab_home' },
        )).resolves.toEqual({ token: 'cross-tab-new-token' });
        await expect(TokenStorage.getCredentialsForServerUrl(
            oldUrl,
            { serverId: 'srv_competing_home' },
        )).resolves.toBeNull();
    });

    it('does not expose Home A credentials through a conflicting Home B identity observed at the same URL', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `identity_conflict_storage_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const serverUrl = 'https://shared-home.test';

        await profiles.upsertServerProfile({ serverUrl, source: 'manual' });
        expect((await profiles.setServerProfileIdentityForUrl(serverUrl, 'srv_home_a'))?.serverIdentityId)
            .toBe('srv_home_a');
        await expect(TokenStorage.setCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);

        expect(await profiles.setServerProfileIdentityForUrl(serverUrl, 'srv_home_b')).toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_b' },
        )).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            serverUrl,
            { serverId: 'srv_home_a' },
        )).resolves.toEqual({ token: 'home-a-token' });
    });

    it('does not expose an established Home credential when an unrelated URL advertises its identity', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `public_identity_collision_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        const unrelated = await profiles.upsertServerProfile({ serverUrl: 'https://unrelated.test', source: 'manual' });
        expect(await profiles.setServerProfileIdentityForUrl(homeA.serverUrl, 'srv_home_a')).not.toBeNull();
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);

        expect(await profiles.setServerProfileIdentityForUrl(unrelated.serverUrl, 'srv_home_a')).toBeNull();
        expect(profiles.getServerProfileById(unrelated.id)).not.toHaveProperty('serverIdentityId');
        await expect(TokenStorage.getCredentialsForServerUrl(
            unrelated.serverUrl,
            { serverId: unrelated.id },
        )).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: 'srv_home_a' },
        )).resolves.toEqual({ token: 'home-a-token' });
    });

});
