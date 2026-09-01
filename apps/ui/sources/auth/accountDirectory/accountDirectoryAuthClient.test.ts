import { beforeEach, describe, expect, it, vi } from 'vitest';

const pendingSet = vi.hoisted(() => vi.fn(async (_value: unknown) => true));
const pendingClear = vi.hoisted(() => vi.fn(async () => true));
const directoryCredentialsSet = vi.hoisted(() => vi.fn(async () => true));
const authGetTokenAtEndpointMock = vi.hoisted(() => vi.fn(async () => ({ token: 'restricted-directory-token' })));

vi.mock('@/auth/flows/getToken', () => ({
    authGetTokenAtEndpoint: authGetTokenAtEndpointMock,
}));

vi.mock('@/auth/storage/tokenStorage', async () => {
    const actual = await vi.importActual<typeof import('@/auth/storage/tokenStorage')>('@/auth/storage/tokenStorage');
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            accountDirectoryAuthCredentials: {
                ...actual.TokenStorage.accountDirectoryAuthCredentials,
                set: directoryCredentialsSet,
            },
            setPendingAccountDirectoryAuth: pendingSet,
            clearPendingAccountDirectoryAuth: pendingClear,
        },
    };
});

describe('accountDirectoryAuthClient', () => {
    it('does not expose a competing directory reconciliation operation', async () => {
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');
        expect(accountDirectoryAuthClient).not.toHaveProperty('reconcileHomes');
    });

    beforeEach(() => {
        pendingSet.mockClear();
        pendingClear.mockClear();
        directoryCredentialsSet.mockClear();
        directoryCredentialsSet.mockResolvedValue(true);
        authGetTokenAtEndpointMock.mockClear();
        authGetTokenAtEndpointMock.mockResolvedValue({ token: 'restricted-directory-token' });
        vi.unstubAllGlobals();
    });

    it('logs in by key through the restricted endpoint routes and stores only Directory credentials', async () => {
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');
        const secret = new Uint8Array(32).fill(11);

        await expect(accountDirectoryAuthClient.loginWithKey({
            endpointUrl: 'https://accounts.example.test/',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-directory.example.test/',
            secret,
        })).resolves.toEqual({ token: 'restricted-directory-token' });

        expect(authGetTokenAtEndpointMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts.example.test',
            canonicalServerUrl: 'https://canonical-directory.example.test',
            serverId: 'directory-1',
            serverIdentityId: 'directory-1',
            secret,
            requireKeyChallengeV2: true,
            credentialTarget: 'account_directory',
        });
        expect(directoryCredentialsSet).toHaveBeenCalledWith(
            {
                endpoint: 'https://accounts.example.test',
                serverIdentityId: 'directory-1',
            },
            { token: 'restricted-directory-token' },
        );
        expect(pendingSet).not.toHaveBeenCalled();
    });

    it('fails key login when restricted credential persistence fails', async () => {
        directoryCredentialsSet.mockResolvedValueOnce(false);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.loginWithKey({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-directory.example.test',
            secret: new Uint8Array(32).fill(12),
        })).rejects.toThrow('persist Account Service credentials');
    });

    it('starts OAuth against the explicit known-identity endpoint and persists only Directory pending state', async () => {
        const now = Date.now();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            expect(url).toContain('https://accounts.example.test/v1/auth/external/github/params?');
            expect(url).toContain('mode=keyless');
            expect(url).toContain('proofHash=');
            expect(url).toContain('purpose=account_directory');
            return new Response(JSON.stringify({
                url: 'https://oauth.example.test/authorize',
                purpose: 'account_directory',
                credentialTarget: 'account_directory',
                endpointUrl: 'https://accounts.example.test',
                endpointServerIdentityId: 'directory-1',
                expiresAt: new Date(now + 60_000).toISOString(),
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            providerId: 'github',
            mode: 'keyless',
            returnTo: '/settings/account',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
            provider: 'github',
            purpose: 'account_directory',
            proof: expect.any(String),
            returnTo: '/settings/account',
        }));
        const persisted = pendingSet.mock.calls[0]?.[0];
        expect(persisted).not.toHaveProperty('secret');
        expect(persisted).not.toHaveProperty('pending');
    });

    it('starts keyed Account Directory creation with a bound local signing key', async () => {
        const now = Date.now();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            expect(url).toContain('mode=keyed');
            expect(url).toContain('publicKey=');
            expect(url).not.toContain('proofHash=');
            return new Response(JSON.stringify({
                url: 'https://oauth.example.test/authorize',
                purpose: 'account_directory',
                credentialTarget: 'account_directory',
                endpointUrl: 'https://accounts.example.test',
                endpointServerIdentityId: 'directory-1',
                expiresAt: new Date(now + 60_000).toISOString(),
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            providerId: 'github',
            mode: 'keyed',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'keyed',
            secret: expect.any(String),
        }));
        expect(pendingSet.mock.calls[0]?.[0]).not.toHaveProperty('proof');
    });

    it('persists the captured authenticated Home identity intent without credential or descriptor material', async () => {
        const now = Date.now();
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            url: 'https://oauth.example.test/authorize',
            purpose: 'account_directory',
            credentialTarget: 'account_directory',
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            expiresAt: new Date(now + 60_000).toISOString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            providerId: 'github',
            mode: 'keyed',
            homeServerIdentityId: 'srv_home_a',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
            homeServerIdentityId: 'srv_home_a',
        }));
        const persisted = pendingSet.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(Object.keys(persisted)).not.toContain('credentials');
        expect(Object.keys(persisted)).not.toContain('connectionDescriptor');
    });

    it('refuses to start Account Directory OAuth without a known endpoint identity', async () => {
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: ' ',
            providerId: 'github',
            mode: 'keyless',
        })).rejects.toThrow('requires a known endpoint identity');
        expect(pendingSet).not.toHaveBeenCalled();
    });
});
