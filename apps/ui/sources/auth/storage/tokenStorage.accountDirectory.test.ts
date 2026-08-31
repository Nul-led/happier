import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTokenStorageWebPlatformMocks } from './tokenStorage.testHelpers';
import { installLocalStorageMock } from './tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

describe('TokenStorage Account Directory namespaces', () => {
    let restoreLocalStorage: (() => void) | null = null;

    beforeEach(() => {
        vi.resetModules();
        restoreLocalStorage = installLocalStorageMock().restore;
    });

    afterEach(() => {
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        vi.restoreAllMocks();
    });

    it('writes Home credentials through the symmetric explicit endpoint setter', async () => {
        const { TokenStorage } = await import('./tokenStorage');

        await expect(
            TokenStorage.setCredentialsForServerUrl(
                'https://home-a.example.test',
                { serverId: 'home-a' },
                { token: 'home-token', secret: 'home-secret' },
            ),
        ).resolves.toBe(true);

        await expect(
            TokenStorage.getCredentialsForServerUrl('https://home-a.example.test', { serverId: 'home-a' }),
        ).resolves.toEqual({ token: 'home-token', secret: 'home-secret' });
    });

    it('strictly parses ordinary typed Home credentials at enrollment boundaries', async () => {
        const { parseAuthCredentials } = await import('./tokenStorage');

        expect(parseAuthCredentials({ token: 'home-token' })).toEqual({ token: 'home-token' });
        expect(parseAuthCredentials({
            token: 'home-token',
            encryption: { publicKey: 'public-key', machineKey: 'machine-key' },
        })).toEqual({
            token: 'home-token',
            encryption: { publicKey: 'public-key', machineKey: 'machine-key' },
        });
        expect(parseAuthCredentials({ token: 'home-token', outcome: 'authorized' })).toBeNull();
        expect(parseAuthCredentials({ token: 'home-token', secret: 'legacy', encryption: { publicKey: 'p', machineKey: 'm' } })).toBeNull();
    });

    it('rejects Account Service endpoints that contain credentials, a query, or a fragment', async () => {
        const { normalizeAccountDirectoryEndpoint } = await import('./tokenStorage');

        expect(normalizeAccountDirectoryEndpoint('https://user:pass@directory.example.test')).toBeNull();
        expect(normalizeAccountDirectoryEndpoint('https://directory.example.test?tenant=other')).toBeNull();
        expect(normalizeAccountDirectoryEndpoint('https://directory.example.test#other')).toBeNull();
        expect(normalizeAccountDirectoryEndpoint('https://directory.example.test/base///')).toBe(
            'https://directory.example.test/base',
        );
    });

    it('isolates Account Directory credentials by endpoint and identity', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const directory = TokenStorage.accountDirectoryAuthCredentials;

        await expect(
            directory.set(
                { endpoint: 'https://directory.example.test', serverIdentityId: 'directory-a' },
                { token: 'directory-token-a' },
            ),
        ).resolves.toBe(true);
        await expect(
            directory.set(
                { endpoint: 'https://directory.example.test', serverIdentityId: 'directory-b' },
                { token: 'directory-token-b' },
            ),
        ).resolves.toBe(true);

        await expect(
            directory.get({ endpoint: 'https://directory.example.test', serverIdentityId: 'directory-a' }),
        ).resolves.toEqual({ token: 'directory-token-a' });
        await expect(
            directory.get({ endpoint: 'https://directory.example.test', serverIdentityId: 'directory-b' }),
        ).resolves.toEqual({ token: 'directory-token-b' });

        await expect(
            directory.remove({ endpoint: 'https://directory.example.test', serverIdentityId: 'directory-a' }),
        ).resolves.toBe(true);
        await expect(
            directory.get({ endpoint: 'https://directory.example.test', serverIdentityId: 'directory-a' }),
        ).resolves.toBeNull();
        await expect(
            directory.get({ endpoint: 'https://directory.example.test', serverIdentityId: 'directory-b' }),
        ).resolves.toEqual({ token: 'directory-token-b' });
    });

    it('keeps Directory pending OAuth records endpoint/identity scoped and expires them strictly', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const now = 1_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const pending = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            provider: 'github',
            purpose: 'account_directory' as const,
            pending: 'oauth-pending-a',
            createdAt: now - 100,
            expiresAt: now + 10_000,
            returnTo: '/settings/account',
        };

        await expect(TokenStorage.setPendingAccountDirectoryAuth(pending)).resolves.toBe(true);
        await expect(
            TokenStorage.getPendingAccountDirectoryAuth({ endpoint: pending.endpoint, serverIdentityId: pending.serverIdentityId }),
        ).resolves.toEqual(pending);
        await expect(
            TokenStorage.getPendingAccountDirectoryAuth({ endpoint: pending.endpoint, serverIdentityId: 'directory-other' }),
        ).resolves.toBeNull();

        vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
        await expect(
            TokenStorage.getPendingAccountDirectoryAuth({ endpoint: pending.endpoint, serverIdentityId: pending.serverIdentityId }),
        ).resolves.toBeNull();
        await expect(
            TokenStorage.getPendingAccountDirectoryAuth(
                { endpoint: pending.endpoint, serverIdentityId: pending.serverIdentityId },
                { includeExpired: true },
            ),
        ).resolves.toEqual(pending);
    });

    it('persists only the canonical pre-redirect Directory target fields without inventing a server pending handle', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const now = 1_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const continuation = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            credentialTarget: 'account_directory' as const,
            provider: 'github',
            purpose: 'account_directory' as const,
            createdAt: now,
            expiresAt: now + 10_000,
            mode: 'keyless' as const,
            proof: 'proof-bound-before-redirect',
        };

        await expect(TokenStorage.setPendingAccountDirectoryAuth(continuation)).resolves.toBe(true);
        await expect(TokenStorage.getPendingAccountDirectoryAuth({
            endpoint: continuation.endpoint,
            serverIdentityId: continuation.serverIdentityId,
        })).resolves.toEqual(expect.objectContaining({
            endpoint: continuation.endpoint,
            serverIdentityId: continuation.serverIdentityId,
            provider: 'github',
            purpose: 'account_directory',
            proof: 'proof-bound-before-redirect',
        }));
        const stored = await TokenStorage.getPendingAccountDirectoryAuth({
            endpoint: continuation.endpoint,
            serverIdentityId: continuation.serverIdentityId,
        });
        expect(stored).not.toHaveProperty('endpointUrl');
        expect(stored).not.toHaveProperty('endpointServerIdentityId');
        expect(stored).not.toHaveProperty('pending');

        const setUntrustedPending = TokenStorage.setPendingAccountDirectoryAuth as (
            value: unknown,
        ) => Promise<boolean>;
        await expect(setUntrustedPending({
            ...continuation,
            endpointUrl: continuation.endpoint,
        })).resolves.toBe(false);
        await expect(setUntrustedPending({
            ...continuation,
            endpointServerIdentityId: continuation.serverIdentityId,
        })).resolves.toBe(false);
        await expect(setUntrustedPending({
            ...continuation,
            secret: 'unused-keyless-secret',
        })).resolves.toBe(false);
    });

    it('round-trips the canonical keyed pre-redirect continuation through the real storage owner', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const now = 1_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const continuation = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            credentialTarget: 'account_directory' as const,
            provider: 'github',
            purpose: 'account_directory' as const,
            createdAt: now,
            expiresAt: now + 10_000,
            mode: 'keyed' as const,
            secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        };

        await expect(TokenStorage.setPendingAccountDirectoryAuth(continuation)).resolves.toBe(true);
        await expect(TokenStorage.getPendingAccountDirectoryAuth({
            endpoint: continuation.endpoint,
            serverIdentityId: continuation.serverIdentityId,
        })).resolves.toEqual(continuation);
    });

    it('persists a captured Home identity intent on the Directory continuation and stays strict about credentials/descriptors', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const now = 1_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const base = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            credentialTarget: 'account_directory' as const,
            provider: 'github',
            purpose: 'account_directory' as const,
            createdAt: now,
            expiresAt: now + 10_000,
            mode: 'keyless' as const,
            proof: 'proof-bound-before-redirect',
        };

        await expect(TokenStorage.setPendingAccountDirectoryAuth({
            ...base,
            homeServerIdentityId: 'srv_home_a',
        })).resolves.toBe(true);
        const stored = await TokenStorage.getPendingAccountDirectoryAuth({
            endpoint: base.endpoint,
            serverIdentityId: base.serverIdentityId,
        });
        expect(stored).toEqual(expect.objectContaining({
            endpoint: base.endpoint,
            serverIdentityId: base.serverIdentityId,
            homeServerIdentityId: 'srv_home_a',
        }));
        // The continuation carries only the stable identity intent — never Home credential
        // or descriptor material.
        expect(stored).not.toHaveProperty('connectionDescriptor');
        expect(stored).not.toHaveProperty('credentials');
        expect(stored).not.toHaveProperty('secret');

        // The strict allowed-key validator stays strict: Home credential or descriptor
        // material is rejected rather than silently stored beside the identity intent.
        const extra = { connectionDescriptor: { v: 1 } };
        await expect(TokenStorage.setPendingAccountDirectoryAuth({
            ...base,
            homeServerIdentityId: 'srv_home_a',
            ...extra,
        })).resolves.toBe(false);
    });

    it('continues to parse legacy Directory pending records without a Home identity intent', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const now = 1_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const pending = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            provider: 'github',
            purpose: 'account_directory' as const,
            pending: 'oauth-pending-a',
            createdAt: now - 100,
            expiresAt: now + 10_000,
        };

        await expect(TokenStorage.setPendingAccountDirectoryAuth(pending)).resolves.toBe(true);
        await expect(
            TokenStorage.getPendingAccountDirectoryAuth({ endpoint: pending.endpoint, serverIdentityId: pending.serverIdentityId }),
        ).resolves.toEqual(pending);
    });

    it('continues to parse the legacy Home pending shape without a target discriminator', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const homePending = { provider: 'github', proof: 'home-proof' };

        await expect(TokenStorage.setPendingExternalAuth(homePending)).resolves.toBe(true);
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toEqual({
            value: homePending,
            serverMismatch: true,
        });
        expect(homePending).not.toHaveProperty('purpose');
        expect(homePending).not.toHaveProperty('target');
    });

    it('logs out the Directory namespace without removing Home credentials or pending state', async () => {
        const { TokenStorage } = await import('./tokenStorage');
        const directory = TokenStorage.accountDirectoryAuthCredentials;
        const endpoint = 'https://directory.example.test';
        const pending = {
            endpoint,
            serverIdentityId: 'directory-a',
            provider: 'github',
            purpose: 'account_directory' as const,
            pending: 'oauth-pending-a',
            createdAt: Date.now() - 100,
            expiresAt: Date.now() + 10_000,
        };

        await TokenStorage.setCredentialsForServerUrl(
            'https://home.example.test',
            {},
            { token: 'home-token', secret: 'home-secret' },
        );
        await TokenStorage.setPendingExternalAuth({ provider: 'github', proof: 'home-proof' });
        await directory.set({ endpoint, serverIdentityId: 'directory-a' }, { token: 'directory-token' });
        await TokenStorage.setPendingAccountDirectoryAuth(pending);

        await expect(directory.logout({ endpoint, serverIdentityId: 'directory-a' })).resolves.toBe(true);
        await expect(directory.get({ endpoint, serverIdentityId: 'directory-a' })).resolves.toBeNull();
        await expect(TokenStorage.getPendingAccountDirectoryAuth({ endpoint, serverIdentityId: 'directory-a' })).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl('https://home.example.test')).resolves.toEqual({
            token: 'home-token',
            secret: 'home-secret',
        });
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toEqual({
            value: { provider: 'github', proof: 'home-proof' },
            serverMismatch: true,
        });
    });

    it('removes every Home credential without clearing dedicated Account Service state', async () => {
        const { upsertServerProfile } = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('./tokenStorage');
        const directory = TokenStorage.accountDirectoryAuthCredentials;
        const homeA = upsertServerProfile({
            serverUrl: 'https://home-a.example.test',
            name: 'Home A',
            source: 'manual',
        });
        const homeB = upsertServerProfile({
            serverUrl: 'https://home-b.example.test',
            name: 'Home B',
            source: 'manual',
        });
        const pending = {
            endpoint: 'https://directory.example.test',
            serverIdentityId: 'directory-a',
            provider: 'github',
            purpose: 'account_directory' as const,
            pending: 'oauth-pending-a',
            createdAt: Date.now() - 100,
            expiresAt: Date.now() + 10_000,
        };

        await TokenStorage.setCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: homeA.id },
            { token: 'home-token-a' },
        );
        await TokenStorage.setCredentialsForServerUrl(
            homeB.serverUrl,
            { serverId: homeB.id },
            { token: 'home-token-b' },
        );
        await directory.set(
            { endpoint: pending.endpoint, serverIdentityId: pending.serverIdentityId },
            { token: 'directory-token' },
        );
        await TokenStorage.setPendingAccountDirectoryAuth(pending);

        await expect(TokenStorage.removeCredentials()).resolves.toBe(true);
        await expect(TokenStorage.getCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: homeA.id },
        )).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            homeB.serverUrl,
            { serverId: homeB.id },
        )).resolves.toBeNull();
        await expect(directory.get({
            endpoint: pending.endpoint,
            serverIdentityId: pending.serverIdentityId,
        })).resolves.toEqual({ token: 'directory-token' });
        await expect(TokenStorage.getPendingAccountDirectoryAuth({
            endpoint: pending.endpoint,
            serverIdentityId: pending.serverIdentityId,
        })).resolves.toEqual(pending);
    });
});
