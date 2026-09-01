import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeFetchMock = vi.hoisted(() => vi.fn());
const activeSnapshotMock = vi.hoisted(() => vi.fn(() => ({
    serverId: 'focused-home',
    serverUrl: 'https://focused.example.test',
    generation: 1,
    kind: 'custom',
})));

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: activeSnapshotMock,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: vi.fn(async () => null),
        getCredentialsForServerUrl: vi.fn(async () => null),
        invalidateCredentialsTokenForServerUrl: vi.fn(async () => false),
    },
}));

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function keyChallengeV2Capabilities(serverIdentityId: string) {
    return {
        auth: {
            methods: [],
            keyChallenge: { v2: true },
            signup: { methods: [] },
            login: { methods: [], requiredProviders: [] },
            recovery: { providerReset: { providers: [] } },
            ui: { autoRedirect: { enabled: false, providerId: null } },
            providers: {},
            misconfig: [],
        },
        serverIdentity: { serverIdentityId },
    };
}

afterEach(() => {
    runtimeFetchMock.mockReset();
    activeSnapshotMock.mockReset();
    activeSnapshotMock.mockReturnValue({
        serverId: 'focused-home',
        serverUrl: 'https://focused.example.test',
        generation: 1,
        kind: 'custom',
    });
    vi.resetModules();
});

describe('explicit endpoint authentication foundations', () => {
    it('sends an explicit target request through runtimeOrigin without consulting focused Home state', async () => {
        runtimeFetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        const { createServerFetchAtEndpoint } = await import('@/sync/http/client');
        const request = createServerFetchAtEndpoint({
            endpointUrl: 'https://home-b.example.test',
            runtimeOrigin: 'http://127.0.0.1:4312',
            serverId: 'srv_home_b',
            credentials: { token: 'home-b-token' },
        });
        activeSnapshotMock.mockReturnValue({
            serverId: 'focused-home-after-switch',
            serverUrl: 'https://focused-after-switch.example.test',
            generation: 2,
            kind: 'custom',
        });

        await expect(request('/v1/account/profile', { method: 'GET' }, { retry: 'none' })).resolves.toMatchObject({
            ok: true,
        });

        expect(String(runtimeFetchMock.mock.calls[0]?.[0])).toBe(
            'http://127.0.0.1:4312/v1/account/profile',
        );
        const init = runtimeFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer home-b-token');
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('probes a supplied endpoint and returns observed features without adopting a profile or changing focus', async () => {
        runtimeFetchMock.mockResolvedValue(jsonResponse({
            features: {},
            capabilities: {
                serverIdentity: { serverIdentityId: 'srv_home_b' },
            },
        }));

        const { probeServerFeaturesAtUrl } = await import('@/sync/api/capabilities/serverFeaturesClient');
        const result = await probeServerFeaturesAtUrl('https://home-b.example.test', {
            force: true,
            timeoutMs: 100,
        });

        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.features.capabilities.serverIdentity.serverIdentityId).toBe('srv_home_b');
            expect(result.serverIdentityId).toBe('srv_home_b');
        }
        expect(String(runtimeFetchMock.mock.calls[0]?.[0])).toBe(
            'https://home-b.example.test/v1/features',
        );
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('authenticates at an explicit endpoint while signing the stable canonical audience', async () => {
        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/features')) {
                return jsonResponse({
                    features: {},
                    capabilities: keyChallengeV2Capabilities('srv_home_b'),
                });
            }
            if (url.endsWith('/health')) {
                return jsonResponse({ status: 'ok' });
            }
            if (url.endsWith('/v1/auth/challenge')) {
                return jsonResponse({
                    challengeId: 'challenge-home-b',
                    nonce: 'nonce-home-b',
                    issuedAt: '2026-08-22T12:00:00.000Z',
                    expiresAt: '2026-08-22T12:05:00.000Z',
                    audience: {
                        origin: 'https://home-b.example.test',
                        serverIdentityId: 'srv_home_b',
                    },
                });
            }
            if (url.endsWith('/v1/auth')) {
                return jsonResponse({ token: 'home-b-token' });
            }
            throw new Error(`Unexpected test request: ${url}`);
        });

        const { authGetTokenAtEndpoint } = await import('./getToken');
        await expect(authGetTokenAtEndpoint({
            endpointUrl: 'https://home-b.example.test/api',
            canonicalServerUrl: 'https://home-b.example.test/api',
            serverIdentityId: 'srv_home_b',
            secret: new Uint8Array(32).fill(7),
            requireKeyChallengeV2: true,
        })).resolves.toEqual({ token: 'home-b-token' });
        expect(runtimeFetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
            'https://home-b.example.test/api/v1/features',
            'https://home-b.example.test/api/health',
            'https://home-b.example.test/api/v1/auth/challenge',
            'https://home-b.example.test/api/v1/auth',
        ]);
        const authInit = runtimeFetchMock.mock.calls[3]?.[1] as RequestInit;
        const authBody = JSON.parse(String(authInit.body)) as Record<string, unknown>;
        expect(authBody).toMatchObject({
            challengeId: 'challenge-home-b',
            publicKey: expect.any(String),
            signature: expect.any(String),
        });
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('uses the dedicated v2-only Account Directory key routes for a restricted credential target', async () => {
        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/features')) {
                return jsonResponse({
                    features: {},
                    capabilities: keyChallengeV2Capabilities('srv_directory'),
                });
            }
            if (url.endsWith('/health')) {
                return jsonResponse({ status: 'ok' });
            }
            if (url.endsWith('/v1/auth/account-directory/challenge')) {
                return jsonResponse({
                    challengeId: 'account-directory:challenge-1',
                    nonce: 'nonce-directory',
                    issuedAt: '2026-08-22T12:00:00.000Z',
                    expiresAt: '2026-08-22T12:05:00.000Z',
                    audience: {
                        origin: 'https://accounts.example.test',
                        serverIdentityId: 'srv_directory',
                    },
                });
            }
            if (url.endsWith('/v1/auth/account-directory')) {
                return jsonResponse({ token: 'restricted-directory-token' });
            }
            throw new Error(`Unexpected test request: ${url}`);
        });

        const { authGetTokenAtEndpoint } = await import('./getToken');
        await expect(authGetTokenAtEndpoint({
            endpointUrl: 'https://accounts.example.test',
            canonicalServerUrl: 'https://accounts.example.test',
            serverIdentityId: 'srv_directory',
            secret: new Uint8Array(32).fill(9),
            requireKeyChallengeV2: true,
            credentialTarget: 'account_directory',
        })).resolves.toEqual({ token: 'restricted-directory-token' });

        expect(runtimeFetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
            'https://accounts.example.test/v1/features',
            'https://accounts.example.test/health',
            'https://accounts.example.test/v1/auth/account-directory/challenge',
            'https://accounts.example.test/v1/auth/account-directory',
        ]);
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('keeps explicit require-v2 authentication fail closed when feature discovery is unavailable', async () => {
        runtimeFetchMock.mockRejectedValue(new Error('feature endpoint unavailable'));

        const { authGetTokenAtEndpoint } = await import('./getToken');
        await expect(authGetTokenAtEndpoint({
            endpointUrl: 'https://home-b.example.test',
            canonicalServerUrl: 'https://home-b.example.test',
            serverIdentityId: 'srv_home_b',
            secret: new Uint8Array(32).fill(7),
            requireKeyChallengeV2: true,
        })).rejects.toMatchObject({
            name: 'HappyError',
            canTryAgain: true,
        });

        expect(runtimeFetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
            'https://home-b.example.test/v1/auth',
        );
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });

    it('rejects an endpoint whose observed identity does not match the expected Home before authentication', async () => {
        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/features')) {
                return jsonResponse({
                features: {},
                capabilities: {
                    serverIdentity: { serverIdentityId: 'srv_other_home' },
                },
                });
            }
            if (url.endsWith('/health')) return jsonResponse({ status: 'ok' });
            return jsonResponse({ token: 'must-not-authenticate' });
        });

        const { authGetTokenAtEndpoint } = await import('./getToken');
        await expect(authGetTokenAtEndpoint({
            endpointUrl: 'https://home-b.example.test',
            serverIdentityId: 'srv_home_b',
            secret: new Uint8Array(32).fill(7),
            requireKeyChallengeV2: false,
        })).rejects.toMatchObject({
            name: 'HappyError',
            kind: 'auth',
            canTryAgain: false,
        });

        const requestedUrls = runtimeFetchMock.mock.calls.map((call) => String(call[0]));
        expect(requestedUrls).toContain('https://home-b.example.test/v1/features');
        expect(requestedUrls).not.toContain('https://home-b.example.test/v1/auth/challenge');
        expect(requestedUrls).not.toContain('https://home-b.example.test/v1/auth');
        expect(activeSnapshotMock).not.toHaveBeenCalled();
    });
});
