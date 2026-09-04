import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createHomeCredentialDestinationDigestV1 } from '@happier-dev/protocol';

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

    it('allows only a destination-bound assertion to write a credential while retaining advisory profile authority', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `adopt_assertion_bound_advisory_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const {
            adoptHomeProfileWithCredentials,
            createHomeProfileCredentialWriteAuthorization,
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

        const credentialWriteAuthorization = createHomeProfileCredentialWriteAuthorization({
            descriptor,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(descriptor),
            selectedDestination: {
                kind: 'https',
                applicationUrl: 'https://ingress.assertion-bound.test',
            },
        });
        expect(credentialWriteAuthorization).not.toBeNull();
        if (!credentialWriteAuthorization) return;

        const adopted = await adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor,
            credentials: { token: 'assertion-bound-token' },
            credentialWriteAuthorization,
        });

        expect(adopted.descriptorProvenance).toBe('advisory-only');
        await expect(TokenStorage.getCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
        )).resolves.toEqual({ token: 'assertion-bound-token' });

        const mismatchedAuthorization = createHomeProfileCredentialWriteAuthorization({
            descriptor,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(descriptor),
            selectedDestination: {
                kind: 'https',
                applicationUrl: 'https://ingress.assertion-bound.test',
            },
        });
        expect(mismatchedAuthorization).not.toBeNull();
        if (!mismatchedAuthorization) return;
        await expect(adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: { ...descriptor, revision: 8 },
            credentials: { token: 'retargeted-token' },
            credentialWriteAuthorization: mismatchedAuthorization,
        })).rejects.toMatchObject({
            code: 'home_profile_adoption_requires_current_observation',
        });

        const forgedAuthorization = createHomeProfileCredentialWriteAuthorization({
            descriptor,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(descriptor),
            selectedDestination: {
                kind: 'https',
                applicationUrl: 'https://ingress.assertion-bound.test',
            },
        });
        expect(forgedAuthorization).not.toBeNull();
        if (!forgedAuthorization) return;
        await expect(adoptHomeProfileWithCredentials({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor,
            credentials: { token: 'forged-token' },
            credentialWriteAuthorization: { ...forgedAuthorization },
        })).rejects.toMatchObject({
            code: 'home_profile_adoption_requires_current_observation',
        });
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
        const { adoptHomeProfileWithCanonicalUrlMigration } = await import('./adoptHomeProfile');

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
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_moving_home',
                canonicalServerUrl: 'https://moving-home-old.test',
                revision: 3,
                endpoints: [{ kind: 'https', url: 'https://moving-home-old.test' }],
            },
        });
        profiles.renameServerProfile(moving.id, 'Workshop Home');
        await expect(TokenStorage.setCredentialsForServerUrl(
            'https://moving-home-old.test',
            { serverId: 'srv_moving_home' },
            { token: 'moving-home-token' },
        )).resolves.toBe(true);
        profiles.setActiveServerId(other.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'group',
            activeTargetId: 'homes',
            groups: [{ id: 'homes', name: 'Homes', serverIds: [other.id, moving.id] }],
        });
        const focusBefore = profiles.getActiveServerSnapshot();
        const groupsBefore = profiles.loadHomeViewState();
        const otherBefore = profiles.getServerProfileById(other.id);

        const migrated = await adoptHomeProfileWithCanonicalUrlMigration({
            source: 'qr',
            preserveUserLabel: true,
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_moving_home',
                canonicalServerUrl: 'https://moving-home-new.test',
                revision: 4,
                endpoints: [{ kind: 'https', url: 'https://moving-home-new.test' }],
            },
        });

        expect(migrated).toMatchObject({
            kind: 'migrated',
            fromCanonicalServerUrl: 'https://moving-home-old.test',
            toCanonicalServerUrl: 'https://moving-home-new.test',
        });
        expect(migrated.profile.id).toBe(moving.id);
        expect(migrated.profile.name).toBe('Workshop Home');
        expect(migrated.profile.serverIdentityId).toBe('srv_moving_home');
        expect(migrated.profile.canonicalServerUrl ?? migrated.profile.serverUrl)
            .toBe('https://moving-home-new.test');

        // The exact bearer follows the identity to its destination and is no longer
        // addressable through the obsolete URL.
        await expect(TokenStorage.getCredentialsForServerUrl(
            'https://moving-home-new.test',
            { serverId: 'srv_moving_home' },
        )).resolves.toEqual({ token: 'moving-home-token' });
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
        const { adoptHomeProfileWithCanonicalUrlMigration } = await import('./adoptHomeProfile');

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

        await expect(adoptHomeProfileWithCanonicalUrlMigration({
            source: 'qr',
            preserveUserLabel: true,
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
        )).resolves.toEqual({ token: 'partial-home-token' });
    });

    it('moves an identity-scoped credential without a conflicting destination rewrite', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `canonical_url_destination_failure_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const { adoptHomeProfileWithCanonicalUrlMigration } = await import('./adoptHomeProfile');

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

        await expect(adoptHomeProfileWithCanonicalUrlMigration({
            source: 'qr',
            preserveUserLabel: true,
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_destination_failure_home',
                canonicalServerUrl: 'https://destination-failure-new.test',
                revision: 3,
                endpoints: [{ kind: 'https', url: 'https://destination-failure-new.test' }],
            },
        })).resolves.toMatchObject({ kind: 'migrated' });

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

    it('does not expose an established Home credential when an unrelated URL advertises its identity', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `public_identity_collision_${Date.now()}_${Math.random()}`;
        const localStorageMock = installLocalStorageMock();
        restoreLocalStorage = localStorageMock.restore;

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const homeA = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        const unrelated = profiles.upsertServerProfile({ serverUrl: 'https://unrelated.test', source: 'manual' });
        expect(profiles.setServerProfileIdentityForUrl(homeA.serverUrl, 'srv_home_a')).not.toBeNull();
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: 'srv_home_a' },
            { token: 'home-a-token' },
        )).resolves.toBe(true);

        expect(profiles.setServerProfileIdentityForUrl(unrelated.serverUrl, 'srv_home_a')).toBeNull();
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
