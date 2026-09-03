import { beforeEach, describe, expect, it, vi } from 'vitest';

const pendingSet = vi.hoisted(() => vi.fn(async (_value: unknown) => true));
const pendingClear = vi.hoisted(() => vi.fn(async () => true));
const directoryCredentialsSet = vi.hoisted(() => vi.fn(async () => true));
const getCredentialsMock = vi.hoisted(() => vi.fn(async () => null));
const activeServerSnapshotMock = vi.hoisted(() => vi.fn(() => ({
    serverId: 'focused-home',
    serverUrl: 'https://focused.example.test',
    generation: 1,
})));
const authGetTokenAtEndpointMock = vi.hoisted(() => vi.fn(async () => ({ token: 'restricted-directory-token' })));
const probeServerFeaturesAtUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/auth/flows/getToken', () => ({
    authGetTokenAtEndpoint: authGetTokenAtEndpointMock,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: probeServerFeaturesAtUrlMock,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: activeServerSnapshotMock,
}));

vi.mock('@/auth/storage/tokenStorage', async () => {
    const actual = await vi.importActual<typeof import('@/auth/storage/tokenStorage')>('@/auth/storage/tokenStorage');
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentials: getCredentialsMock,
            accountDirectoryAuthCredentials: {
                ...actual.TokenStorage.accountDirectoryAuthCredentials,
                set: directoryCredentialsSet,
            },
            setPendingAccountDirectoryAuth: pendingSet,
            clearPendingAccountDirectoryAuth: pendingClear,
        },
    };
});

function supportedFeatures(serverIdentityId = 'directory-1') {
    return {
        status: 'ready' as const,
        serverIdentityId,
        features: {
            features: {},
            capabilities: {
                accountDirectory: {
                    version: 1,
                    homeDirectory: true,
                    homeEnrollment: true,
                    homeLoginAssertion: {
                        keyId: 'a'.repeat(64),
                        publicKeyBase64Url: 'A'.repeat(43),
                    },
                },
                server: { canonicalServerUrl: 'https://canonical-directory.example.test' },
                serverIdentity: { serverIdentityId },
                auth: {
                    methods: [
                        { id: 'github', actions: [{ id: 'provision', enabled: true, mode: 'keyed' }] },
                    ],
                    keyChallenge: { v2: true },
                    signup: { methods: [] },
                    login: { methods: [], requiredProviders: [] },
                    recovery: { providerReset: { providers: [] } },
                    ui: { autoRedirect: { enabled: false, providerId: null } },
                    providers: {},
                    misconfig: [],
                },
                oauth: { providers: { github: { configured: true, enabled: true } } },
            },
        },
    };
}

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
        getCredentialsMock.mockClear();
        activeServerSnapshotMock.mockClear();
        activeServerSnapshotMock.mockReturnValue({
            serverId: 'focused-home',
            serverUrl: 'https://focused.example.test',
            generation: 1,
        });
        authGetTokenAtEndpointMock.mockClear();
        probeServerFeaturesAtUrlMock.mockReset();
        probeServerFeaturesAtUrlMock.mockResolvedValue(supportedFeatures());
        authGetTokenAtEndpointMock.mockResolvedValue({ token: 'restricted-directory-token' });
        vi.unstubAllGlobals();
    });

    it('discovers explicit endpoint methods with another Home focused without active credential or focus dependence', async () => {
        const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        const activeSnapshot = vi.mocked(getActiveServerSnapshot);
        activeSnapshot.mockReturnValue({
            serverId: 'focused-home-a',
            serverUrl: 'https://home-a.example.test',
            generation: 8,
        });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const getActiveCredentials = vi.mocked(TokenStorage.getCredentials);
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce(supportedFeatures('directory-b'));
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts-b.example.test/',
            requestedMethod: { kind: 'oauth', providerId: 'github' },
        })).resolves.toMatchObject({
            kind: 'supported_account_service',
            endpointUrl: 'https://accounts-b.example.test',
            serverIdentityId: 'directory-b',
            canonicalServerUrl: 'https://canonical-directory.example.test',
            keyLoginAvailable: true,
            oauthProviderIds: ['github'],
            preferredProvisionProviderId: 'github',
        });

        expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts-b.example.test',
            force: true,
        });
        expect(activeSnapshot).not.toHaveBeenCalled();
        expect(getActiveCredentials).not.toHaveBeenCalled();
        expect(directoryCredentialsSet).not.toHaveBeenCalled();
        expect(pendingSet).not.toHaveBeenCalled();
    });

    it('discovers explicit endpoint methods before any Home profile exists', async () => {
        const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        const activeSnapshot = vi.mocked(getActiveServerSnapshot);
        activeSnapshot.mockImplementation(() => { throw new Error('active Home must not be required'); });
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce(supportedFeatures('directory-b'));
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        const result = await accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts-b.example.test',
            requestedMethod: { kind: 'key' },
        });

        expect(result.kind).toBe('supported_account_service');
        expect(probeServerFeaturesAtUrlMock).toHaveBeenCalledWith({
            endpointUrl: 'https://accounts-b.example.test',
            force: true,
        });
        expect(activeSnapshot).not.toHaveBeenCalled();
    });

    it.each([
        '',
        'not a URL',
        'ftp://accounts.example.test',
        'https://user:pass@accounts.example.test',
        'https://accounts.example.test?tenant=other',
    ])('fails a malformed explicit endpoint closed before probing: %j', async (endpointUrl) => {
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl,
        })).resolves.toMatchObject({
            kind: 'endpoint_unavailable',
            endpointUrl: '',
            reason: 'invalid_endpoint',
        });
        expect(probeServerFeaturesAtUrlMock).not.toHaveBeenCalled();
    });

    it.each([
        ['endpoint_unavailable', { status: 'error', reason: 'network' }],
        ['endpoint_unavailable', { status: 'unsupported', reason: 'endpoint_missing' }],
    ])('returns %s for an unreachable or unsupported endpoint', async (kind, snapshot) => {
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce(snapshot);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts.example.test',
        })).resolves.toMatchObject({ kind, endpointUrl: 'https://accounts.example.test' });
    });

    it('returns identity_mismatch before exposing methods when a pinned endpoint observes a different identity', async () => {
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce(supportedFeatures('directory-other'));
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts.example.test',
            expectedServerIdentityId: 'directory-1',
        })).resolves.toMatchObject({
            kind: 'identity_mismatch',
            endpointUrl: 'https://accounts.example.test',
            expectedServerIdentityId: 'directory-1',
            observedServerIdentityId: 'directory-other',
        });
        expect(directoryCredentialsSet).not.toHaveBeenCalled();
        expect(pendingSet).not.toHaveBeenCalled();
    });

    it('returns not_account_service when endpoint capabilities lack Account Directory support', async () => {
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            ...supportedFeatures(),
            features: {
                ...supportedFeatures().features,
                capabilities: {
                    ...supportedFeatures().features.capabilities,
                    accountDirectory: undefined,
                },
            },
        });
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://home-only.example.test',
        })).resolves.toMatchObject({
            kind: 'not_account_service',
            endpointUrl: 'https://home-only.example.test',
            serverIdentityId: 'directory-1',
        });
    });

    it('requires an advertised canonical URL for a supported Account Service', async () => {
        const features = supportedFeatures();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            ...features,
            features: {
                ...features.features,
                capabilities: {
                    ...features.features.capabilities,
                    server: { canonicalServerUrl: null },
                },
            },
        });
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts.example.test',
        })).resolves.toMatchObject({
            kind: 'not_account_service',
            endpointUrl: 'https://accounts.example.test',
        });
    });

    it('exposes only configured, enabled OAuth providers with keyed provisioning advertised', async () => {
        const features = supportedFeatures();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            ...features,
            features: {
                ...features.features,
                capabilities: {
                    ...features.features.capabilities,
                    auth: {
                        ...features.features.capabilities.auth,
                        methods: [
                            { id: 'github', actions: [{ id: 'provision', enabled: true, mode: 'keyed' }] },
                            { id: 'gitlab', actions: [{ id: 'provision', enabled: true, mode: 'keyed' }] },
                            { id: 'google', actions: [{ id: 'login', enabled: true, mode: 'keyless' }] },
                            { id: 'oidc', actions: [{ id: 'provision', enabled: true, mode: 'either' }] },
                        ],
                    },
                    oauth: {
                        providers: {
                            github: { configured: true, enabled: true },
                            gitlab: { configured: false, enabled: true },
                            google: { configured: true, enabled: true },
                            oidc: { configured: true, enabled: false },
                        },
                    },
                },
            },
        });
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts.example.test',
        })).resolves.toMatchObject({
            kind: 'supported_account_service',
            oauthProviderIds: ['github'],
            preferredProvisionProviderId: 'github',
        });
    });

    it('returns requested_method_unavailable without falling back when the selected Account Service does not advertise that method', async () => {
        const features = supportedFeatures();
        probeServerFeaturesAtUrlMock.mockResolvedValueOnce({
            ...features,
            features: {
                ...features.features,
                capabilities: {
                    ...features.features.capabilities,
                    auth: {
                        ...features.features.capabilities.auth,
                        methods: [],
                        keyChallenge: { v2: false },
                        signup: { methods: [{ id: 'github', enabled: true }] },
                    },
                    oauth: { providers: { github: { configured: true, enabled: true } } },
                },
            },
        });
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: 'https://accounts.example.test',
            requestedMethod: { kind: 'oauth', providerId: 'github' },
        })).resolves.toMatchObject({
            kind: 'requested_method_unavailable',
            requestedMethod: { kind: 'oauth', providerId: 'github' },
            endpointUrl: 'https://accounts.example.test',
            keyLoginAvailable: false,
            oauthProviderIds: [],
            preferredProvisionProviderId: null,
        });
        expect(directoryCredentialsSet).not.toHaveBeenCalled();
        expect(pendingSet).not.toHaveBeenCalled();
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
            expect(url).toContain('canonicalServerUrl=https%3A%2F%2Fcanonical-directory.example.test');
            return new Response(JSON.stringify({
                url: 'https://oauth.example.test/authorize',
                purpose: 'account_directory',
                credentialTarget: 'account_directory',
                endpointUrl: 'https://accounts.example.test',
                endpointServerIdentityId: 'directory-1',
                canonicalServerUrl: 'https://canonical-directory.example.test',
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
            canonicalServerUrl: 'https://canonical-directory.example.test',
            providerId: 'github',
            mode: 'keyless',
            entryIntent: 'connect_service',
            returnTo: '/settings/account',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
            provider: 'github',
            purpose: 'account_directory',
            entryIntent: 'connect_service',
            canonicalServerUrl: 'https://canonical-directory.example.test',
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
            expect(url).toContain('canonicalServerUrl=https%3A%2F%2Fcanonical-directory.example.test');
            expect(url).not.toContain('proofHash=');
            return new Response(JSON.stringify({
                url: 'https://oauth.example.test/authorize',
                purpose: 'account_directory',
                credentialTarget: 'account_directory',
                endpointUrl: 'https://accounts.example.test',
                endpointServerIdentityId: 'directory-1',
                canonicalServerUrl: 'https://canonical-directory.example.test',
                expiresAt: new Date(now + 60_000).toISOString(),
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-directory.example.test',
            providerId: 'github',
            mode: 'keyed',
            entryIntent: 'connect_service',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'keyed',
            canonicalServerUrl: 'https://canonical-directory.example.test',
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
            canonicalServerUrl: 'https://canonical-directory.example.test',
            expiresAt: new Date(now + 60_000).toISOString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const { accountDirectoryAuthClient } = await import('./accountDirectoryAuthClient');

        await expect(accountDirectoryAuthClient.startOAuth({
            endpointUrl: 'https://accounts.example.test',
            endpointServerIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-directory.example.test',
            providerId: 'github',
            mode: 'keyed',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_a',
        })).resolves.toBe('https://oauth.example.test/authorize');

        expect(pendingSet).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'directory-1',
            canonicalServerUrl: 'https://canonical-directory.example.test',
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
            canonicalServerUrl: 'https://canonical-directory.example.test',
            providerId: 'github',
            mode: 'keyless',
            entryIntent: 'connect_service',
        })).rejects.toThrow('requires a known endpoint identity');
        expect(pendingSet).not.toHaveBeenCalled();
    });
});
