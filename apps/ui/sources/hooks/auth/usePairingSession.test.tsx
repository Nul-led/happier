import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { encodeBase64 } from '@/encryption/base64';

const appState = vi.hoisted(() => ({ currentState: 'active' as string }));
const enrollmentTransportCloseMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                Platform: { OS: 'web' },
                AppState: {
                    get currentState() {
                        return appState.currentState;
                    },
                },
            }
    );
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/auth/pairing/pairingSecret', () => ({
    createPairingSecret: vi.fn(async () => ({
        secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url'),
        secretHash: 'hash_test',
    })),
}));

const pairingStartMock = vi.fn(async () => ({ ok: true, data: { pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
const pairingStatusMock = vi.fn(async () => ({ ok: true, data: { state: 'pending', pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
const pairingConsumeMock = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingStart: pairingStartMock,
    pairingStatus: pairingStatusMock,
    pairingConsume: pairingConsumeMock,
}));

const endpointFetchMock = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 200 })));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: () => endpointFetchMock,
    serverFetch: vi.fn(() => { throw new Error('Focused Home request is forbidden'); }),
}));

const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn(async () => ({ token: 'captured-home-token' })));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentialsForServerUrl: getCredentialsForServerUrlMock,
        },
    };
});

let activeServerUrl = 'http://localhost:53288';
let activeShareableServerUrl: string | null = null;
let activeShareableServerUrlValidatedAgainstServerUrl: string | null = null;
let activeRuntimeOrigin: string | null = null;
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'srv-a',
        serverUrl: activeServerUrl,
        activeShareableServerUrl,
        activeShareableServerUrlValidatedAgainstServerUrl,
        runtimeOrigin: activeRuntimeOrigin,
        generation: 0,
    }),
}));

let cachedCanonicalServerUrl: string | null = null;
let cachedServerIdentityId: string | null = null;
let cachedSnapshotOnlyUnscoped = false;
let descriptorOverride: import('@happier-dev/protocol').HomeConnectionDescriptorV1 | null = null;
const serverProfileMocks = vi.hoisted(() => ({
    getServerProfileById: vi.fn(() => ({ id: 'srv-a' })),
    buildHomeConnectionDescriptorForProfile: vi.fn(),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getServerProfileById: serverProfileMocks.getServerProfileById,
    buildHomeConnectionDescriptorForProfile: serverProfileMocks.buildHomeConnectionDescriptorForProfile,
}));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getCachedServerFeaturesSnapshot: (params?: { serverId?: string }) =>
        cachedSnapshotOnlyUnscoped && params?.serverId
            ? null
            :
        cachedCanonicalServerUrl
            ? {
                status: 'ready',
                serverIdentityId: cachedServerIdentityId,
                features: { capabilities: { server: { canonicalServerUrl: cachedCanonicalServerUrl } } },
            }
            : null,
}));

vi.mock('@/auth/enrollment/homeEnrollmentTransport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/enrollment/homeEnrollmentTransport')>();
    return {
        ...actual,
        resolveHomeEnrollmentTransport: async (
            ...args: Parameters<typeof actual.resolveHomeEnrollmentTransport>
        ) => {
            const result = await actual.resolveHomeEnrollmentTransport(...args);
            if (!result.ok) return result;
            return {
                ok: true as const,
                transport: {
                    ...result.transport,
                    close: async () => {
                        await enrollmentTransportCloseMock();
                        await result.transport.close();
                    },
                },
            };
        },
    };
});

describe('usePairingSession (pairing deep link server URL)', () => {
    beforeEach(() => {
        pairingStartMock.mockClear();
        pairingStatusMock.mockReset();
        pairingStatusMock.mockImplementation(async () => ({
            ok: true,
            data: { state: 'pending', pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        }));
        pairingConsumeMock.mockClear();
        endpointFetchMock.mockReset();
        endpointFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
        getCredentialsForServerUrlMock.mockClear();
        enrollmentTransportCloseMock.mockClear();
        cachedCanonicalServerUrl = null;
        cachedServerIdentityId = null;
        cachedSnapshotOnlyUnscoped = false;
        activeServerUrl = 'http://localhost:53288';
        activeShareableServerUrl = null;
        activeShareableServerUrlValidatedAgainstServerUrl = null;
        activeRuntimeOrigin = null;
        descriptorOverride = null;
        serverProfileMocks.getServerProfileById.mockClear();
        serverProfileMocks.buildHomeConnectionDescriptorForProfile.mockReset();
        serverProfileMocks.buildHomeConnectionDescriptorForProfile.mockImplementation(() => {
            if (descriptorOverride) return descriptorOverride;
            if (!cachedCanonicalServerUrl || !cachedServerIdentityId) return null;
            const endpointUrl = activeShareableServerUrl
                && activeShareableServerUrlValidatedAgainstServerUrl === activeServerUrl
                ? activeShareableServerUrl
                : cachedCanonicalServerUrl.replace(/^https:\/\/[^@]+@/u, 'https://');
            return {
                v: 1,
                homeServerIdentityId: cachedServerIdentityId,
                canonicalServerUrl: cachedCanonicalServerUrl.replace(/^https:\/\/[^@]+@/u, 'https://'),
                revision: 1,
                endpoints: [{ kind: 'https', url: endpointUrl }],
            };
        });
        appState.currentState = 'active';
    });

    it('starts from the ready active runtime snapshot when no profile-scoped cache entry exists', async () => {
        cachedCanonicalServerUrl = 'http://localhost:53288';
        cachedServerIdentityId = 'srv_home_a';
        cachedSnapshotOnlyUnscoped = true;

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });
            expect(pairingStartMock).toHaveBeenCalledOnce();
            expect(hookApi!.presentation).toMatchObject({ phase: 'ready' });
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('preserves the canonical profile descriptor revision and Iroh endpoint', async () => {
        cachedCanonicalServerUrl = 'http://localhost:53288';
        cachedServerIdentityId = 'srv_home_a';
        activeRuntimeOrigin = 'http://127.0.0.1:59111';
        descriptorOverride = {
            v: 1,
            homeServerIdentityId: 'srv_home_a',
            canonicalServerUrl: 'http://localhost:53288',
            revision: 7,
            endpoints: [{
                kind: 'iroh',
                endpointId: 'a'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            }],
        };

        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });

            expect(serverProfileMocks.buildHomeConnectionDescriptorForProfile).toHaveBeenCalled();
            expect(parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '')?.invite.home).toEqual(descriptorOverride);
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('keeps the pairing live with the exact secret-bearing link when a valid invite exceeds QR capacity', async () => {
        const longRelayUrls = Array.from({ length: 4 }, (_, index) =>
            `https://relay-${index}.example.test/${'a'.repeat(470)}`,
        );
        const homeServerIdentityId = 'srv_home_a';
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = homeServerIdentityId;
        activeServerUrl = cachedCanonicalServerUrl;
        descriptorOverride = {
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl: cachedCanonicalServerUrl,
            revision: 1,
            endpoints: [
                {
                    kind: 'iroh',
                    endpointId: 'a'.repeat(64),
                    relayUrls: longRelayUrls,
                    directAddresses: ['192.0.2.10:443', '192.0.2.11:443'],
                },
                { kind: 'https', url: 'https://public.example.test' },
            ],
        };

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });
            expect(pairingConsumeMock).not.toHaveBeenCalled();
            const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            expect(parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '')?.invite.home).toEqual(descriptorOverride);
            expect(hookApi!.presentation).toMatchObject({ phase: 'ready', qrAvailable: false });
            expect(hookApi!.completionState).toBe('pending');
            // The pairing lifecycle stays live and remains cancellable.
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalled());
            await act(async () => {
                await expect(hookApi!.cancelPairing()).resolves.toEqual({ ok: true });
            });
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('cancels with a typed invalid invite when the invite cannot be encoded at all', async () => {
        const homeServerIdentityId = 'srv_home_a';
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = homeServerIdentityId;
        activeServerUrl = cachedCanonicalServerUrl;
        descriptorOverride = {
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl: cachedCanonicalServerUrl,
            revision: 1,
            endpoints: [
                {
                    kind: 'iroh',
                    endpointId: 'b'.repeat(64),
                    relayUrls: [`https://relay.example.test/${'r'.repeat(12_400)}`],
                },
                { kind: 'https', url: 'https://public.example.test' },
            ],
        };
        pairingStartMock.mockResolvedValueOnce({
            ok: true,
            data: { pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        });

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({
                    ok: false,
                    status: 422,
                    reason: 'invalid_invite',
                });
            });
            expect(pairingConsumeMock).toHaveBeenCalledWith(
                { pairId: 'pair_123', intent: 'cancel' },
                expect.objectContaining({ descriptor: descriptorOverride }),
            );
            expect(hookApi!.presentation).toEqual({ phase: 'invalid_request' });
            expect(hookApi!.deepLink).toBeNull();
            expect(enrollmentTransportCloseMock).toHaveBeenCalledTimes(1);
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('uses the post-start timestamp for the forward invite issuance window', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        let nowMs = 1_000_000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
        pairingStartMock.mockImplementationOnce(async () => {
            nowMs += 1_500;
            return {
                ok: true,
                data: { pairId: 'pair_123', expiresAt: new Date(nowMs + 600_000).toISOString() },
            };
        });

        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });

            const invite = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '')?.invite;
            expect(invite?.issuedAtMs).toBe(1_001_500);
            expect((invite?.expiresAtMs ?? 0) - (invite?.issuedAtMs ?? 0)).toBe(600_000);
        } finally {
            nowSpy.mockRestore();
            act(() => screen.tree.unmount());
        }
    });

    it('builds the production Add Phone payload as one strict V2 Home invite and targets that Home', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';

        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });

            const parsed = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '');
            expect(parsed?.invite).toMatchObject({
                v: 2,
                intent: 'home_device',
                pairId: 'pair_123',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_a',
                    canonicalServerUrl: 'https://home-a.test',
                },
            });
            expect(pairingStartMock).toHaveBeenCalledWith(
                expect.objectContaining({ secretHash: expect.any(String) }),
                expect.objectContaining({
                    endpointUrl: 'https://home-a.test',
                    serverId: 'srv-a',
                    descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_a' }),
                }),
            );
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('fails closed when the focused Home has no verified stable identity', async () => {
        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res).toEqual({ ok: false, status: 412 });
            });

            expect(hookApi!.deepLink).toBeNull();
            expect(pairingStartMock).not.toHaveBeenCalled();

            await act(async () => {
                hookApi!.clearSession();
            });
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('prefers a canonical server URL when available', async () => {
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';

        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res).toEqual({ ok: true });
            });

            const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            const parsed = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '');
            expect(parsed?.invite.home).toMatchObject({
                homeServerIdentityId: 'srv_home_a',
                canonicalServerUrl: 'https://api.example.test',
            });

            await act(async () => {
                hookApi!.clearSession();
            });
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('sanitizes credentials out of canonical server URLs before embedding', async () => {
        cachedCanonicalServerUrl = 'https://user:pass@api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://active.example.test';

        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res.ok).toBe(true);
            });

            const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            const parsed = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '');
            expect(parsed?.invite.home.canonicalServerUrl).toBe('https://api.example.test');
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('prefers an active shareable relay URL over the canonical server URL', async () => {
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://active.example.test';
        activeShareableServerUrl = 'https://relay.example.ts.net';
        activeShareableServerUrlValidatedAgainstServerUrl = 'https://active.example.test';

        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res.ok).toBe(true);
            });

            const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            const parsed = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '');
            expect(parsed?.invite.home).toMatchObject({
                canonicalServerUrl: 'https://api.example.test',
                endpoints: [{ kind: 'https', url: 'https://relay.example.ts.net' }],
            });
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('ignores an active shareable relay URL that was validated for a different upstream', async () => {
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://active.example.test';
        activeShareableServerUrl = 'https://relay.example.ts.net';
        activeShareableServerUrlValidatedAgainstServerUrl = 'https://other.example.test';

        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res.ok).toBe(true);
            });

            const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
            const parsed = parseHomeQrInviteDeepLink(hookApi!.deepLink ?? '');
            expect(parsed?.invite.home.endpoints).toEqual([{ kind: 'https', url: 'https://api.example.test' }]);
        } finally {
            act(() => {
                tree?.unmount();
            });
        }
    });

    it('does not publish a start that resolves after the session is disabled', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        let resolveStart!: () => void;
        pairingStartMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveStart = () => resolve({
                ok: true,
                data: {
                    pairId: 'pair_stale',
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                },
            });
        }));

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe(props: Readonly<{ enabled: boolean }>) {
            hookApi = usePairingSession({ enabled: props.enabled, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe enabled />);
        let startPromise!: ReturnType<ReturnType<typeof usePairingSession>['startPairing']>;
        await act(async () => {
            startPromise = hookApi!.startPairing();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(pairingStartMock).toHaveBeenCalledTimes(1));

        await act(async () => {
            screen.tree.update(<Probe enabled={false} />);
        });
        expect(hookApi!.deepLink).toBeNull();

        await act(async () => {
            resolveStart();
            await expect(startPromise).resolves.toEqual({ ok: false, status: 409 });
        });

        expect(hookApi!.deepLink).toBeNull();
        expect(hookApi!.status).toBeNull();
        expect(hookApi!.pairingContext).toBeNull();
        expect(hookApi!.isStarting).toBe(false);
        expect(enrollmentTransportCloseMock).toHaveBeenCalledTimes(1);
        act(() => screen.tree.unmount());
    });

    it('pauses pairing status polling while backgrounded', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        appState.currentState = 'active';
        const globalWithDocument = globalThis as unknown as { document?: { visibilityState?: string } };
        const previousDocument = globalWithDocument.document;
        const documentStub: { visibilityState: DocumentVisibilityState } = { visibilityState: 'hidden' };
        globalWithDocument.document = documentStub;

        const { usePairingSession } = await import('./usePairingSession');

        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Probe />)).tree;
        try {
            await act(async () => {
                const res = await hookApi!.startPairing();
                expect(res.ok).toBe(true);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_100);
            });

            expect(pairingStatusMock).toHaveBeenCalledTimes(0);

            documentStub.visibilityState = 'visible';
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_100);
            });

            expect(pairingStatusMock).toHaveBeenCalled();
        } finally {
            act(() => {
                tree?.unmount();
            });
            vi.useRealTimers();
            globalWithDocument.document = previousDocument;
        }
    });

    it('allows only one status request in flight and schedules the next poll after settlement', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        const pendingResult = {
            ok: true as const,
            data: { state: 'pending' as const, pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        };
        let resolveFirst!: () => void;
        pairingStatusMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveFirst = () => resolve(pendingResult);
        }));

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalledTimes(1));

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveFirst();
                await Promise.resolve();
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(999);
            });
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1);
            });
            expect(pairingStatusMock).toHaveBeenCalledTimes(2);
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });

    it('uses bounded backoff after a transient status failure', async () => {
        vi.useFakeTimers();
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        pairingStatusMock
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({
                ok: true,
                data: { state: 'pending', pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() },
            });

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true }); });
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalledTimes(1));

            await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            await act(async () => { await vi.advanceTimersByTimeAsync(249); });
            expect(pairingStatusMock).toHaveBeenCalledTimes(2);
        } finally {
            act(() => screen.tree.unmount());
            randomSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it('expires locally at the hard TTL ceiling without another status request', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        const expiresAt = new Date(Date.now() + 500).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        pairingStatusMock.mockRejectedValue(new Error('offline'));

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true }); });
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalledTimes(1));
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });

            expect(hookApi!.completionState).toBe('expired');
            expect(hookApi!.deepLink).toBeNull();
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            expect(enrollmentTransportCloseMock).toHaveBeenCalledTimes(1);
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });

    it('terminalizes a non-transient status rejection instead of polling again', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        pairingStatusMock.mockResolvedValue({ ok: false, reason: 'invalid_target', status: 403 });

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true }); });
            await vi.waitFor(() => expect(hookApi!.completionState).toBe('invalid_request'));
            await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            expect(hookApi!.deepLink).toBeNull();
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });

    it('ignores a stale status completion and cancels future polling when disabled', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://api.example.test';
        cachedServerIdentityId = 'srv_home_a';
        const staleResult = {
            ok: true as const,
            data: { state: 'requested' as const, pairId: 'pair_123', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        };
        let resolveStatus!: () => void;
        pairingStatusMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveStatus = () => resolve(staleResult);
        }));

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe(props: Readonly<{ enabled: boolean }>) {
            hookApi = usePairingSession({ enabled: props.enabled, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe enabled />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalledTimes(1));
            await act(async () => {
                screen.tree.update(<Probe enabled={false} />);
            });
            await act(async () => {
                resolveStatus();
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            expect(hookApi!.deepLink).toBeNull();
            expect(hookApi!.status).toBeNull();
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });

    it('automatically completes the first valid bound request once and stops polling without creating a successor QR', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        pairingStatusMock.mockResolvedValue({
            ok: true,
            data: {
                state: 'requested',
                pairId: 'pair_123',
                expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey),
                requestedDeviceLabel: 'Phone',
                homeServerIdentityId: 'srv_home_a',
                bindingProof: computeHomeQrBindingProofV2({
                    direction: 'trusted_home_displays',
                    qrSecret: new Uint8Array(32).fill(7),
                    pairId: 'pair_123',
                    homeServerIdentityId: 'srv_home_a',
                    requesterPublicKey: requestedPublicKey,
                    expiresAtMs: Date.parse(expiresAt),
                }),
            },
        });

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() {
            hookApi = usePairingSession({ enabled: true, isAuthenticated: true });
            return null;
        }

        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => {
                await expect(hookApi!.startPairing()).resolves.toEqual({ ok: true });
            });
            await vi.waitFor(() => expect(endpointFetchMock).toHaveBeenCalledTimes(1));
            expect(hookApi!.completionState).toBe('completed');
            expect(hookApi!.deepLink).toBeNull();
            expect(getCredentialsForServerUrlMock).toHaveBeenCalledWith(
                'https://home-a.test',
                { serverId: 'srv-a' },
            );
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });
            expect(pairingStatusMock).toHaveBeenCalledTimes(1);
            expect(endpointFetchMock).toHaveBeenCalledTimes(1);
            expect(pairingStartMock).toHaveBeenCalledTimes(1);
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });

    it('does not dispatch credential completion after the displaying screen unmounts', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        pairingStatusMock.mockResolvedValueOnce({
            ok: true,
            data: {
                state: 'requested', pairId: 'pair_123', expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: 'Phone',
                homeServerIdentityId: 'srv_home_a',
                bindingProof: computeHomeQrBindingProofV2({
                    direction: 'trusted_home_displays',
                    qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                    homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                    expiresAtMs: Date.parse(expiresAt),
                }),
            },
        });
        let resolveCredentials!: () => void;
        getCredentialsForServerUrlMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCredentials = () => resolve({ token: 'captured-home-token' });
        }));

        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        await act(async () => { await hookApi!.startPairing(); });
        await vi.waitFor(() => expect(getCredentialsForServerUrlMock).toHaveBeenCalledTimes(1));

        act(() => screen.tree.unmount());
        resolveCredentials();
        await vi.waitFor(() => expect(enrollmentTransportCloseMock).toHaveBeenCalledTimes(1));
        expect(endpointFetchMock).not.toHaveBeenCalled();
    });

    it('treats already_completed as successful completion', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        endpointFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'already_completed' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        }));
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        pairingStatusMock.mockResolvedValueOnce({
            ok: true,
            data: {
                state: 'requested', pairId: 'pair_123', expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
                homeServerIdentityId: 'srv_home_a',
                bindingProof: computeHomeQrBindingProofV2({
                    direction: 'trusted_home_displays',
                    qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                    homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                    expiresAtMs: Date.parse(expiresAt),
                }),
            },
        });
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await vi.waitFor(() => expect(hookApi!.completionState).toBe('completed'));
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it.each([
        ['wrong Home', { homeServerIdentityId: 'srv_home_b' }],
        ['wrong pair', { pairId: 'pair_other' }],
        ['wrong expiry', { expiresAt: new Date(Date.now() + 30_000).toISOString() }],
        ['invalid requester key', { requestedPublicKey: encodeBase64(new Uint8Array(31)) }],
        ['wrong proof', { bindingProof: encodeBase64(new Uint8Array(32).fill(4), 'base64url') }],
    ])('rejects %s before credential response and exposes one new-QR recovery', async (_label, override) => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        pairingStatusMock.mockResolvedValueOnce({
            ok: true,
            data: {
                state: 'requested', pairId: 'pair_123', expiresAt,
                requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
                homeServerIdentityId: 'srv_home_a',
                bindingProof: computeHomeQrBindingProofV2({
                    direction: 'trusted_home_displays',
                    qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                    homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                    expiresAtMs: Date.parse(expiresAt),
                }),
                ...override,
            },
        });
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await vi.waitFor(() => expect(hookApi!.completionState).toBe('invalid_request'));
            expect(endpointFetchMock).not.toHaveBeenCalled();
            expect(getCredentialsForServerUrlMock).not.toHaveBeenCalled();
            expect(pairingConsumeMock).toHaveBeenCalledTimes(1);
            expect(hookApi!.pairingContext).toBeNull();
            expect(hookApi!.deepLink).toBeNull();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('retries the same verified bound request after a transient completion failure', async () => {
        vi.useFakeTimers();
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        endpointFetchMock
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        const requested = {
            state: 'requested' as const, pairId: 'pair_123', expiresAt,
            requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
            homeServerIdentityId: 'srv_home_a',
            bindingProof: computeHomeQrBindingProofV2({
                direction: 'trusted_home_displays',
                qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                expiresAtMs: Date.parse(expiresAt),
            }),
        };
        pairingStatusMock.mockResolvedValue({ ok: true, data: requested });
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await act(async () => {
                await vi.waitFor(() => expect(hookApi!.completionState).toBe('retrying'));
            });
            await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
            await act(async () => {
                await vi.waitFor(() => expect(hookApi!.completionState).toBe('completed'));
            });
            expect(endpointFetchMock).toHaveBeenCalledTimes(2);
            expect(endpointFetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/account/response');
            const firstBody = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
            const retryBody = JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
            expect(retryBody).toMatchObject({
                pairId: firstBody.pairId,
                publicKey: firstBody.publicKey,
                homeServerIdentityId: firstBody.homeServerIdentityId,
                responseKind: firstBody.responseKind,
            });
            expect(pairingStartMock).toHaveBeenCalledTimes(1);
        } finally {
            act(() => screen.tree.unmount());
            randomSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it('allows cancellation only while pending and never submits a credential response', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await act(async () => { await expect(hookApi!.cancelPairing()).resolves.toEqual({ ok: true }); });
            expect(pairingConsumeMock).toHaveBeenCalledWith(
                { pairId: 'pair_123', intent: 'cancel' },
                expect.objectContaining({ descriptor: expect.objectContaining({ homeServerIdentityId: 'srv_home_a' }) }),
            );
            expect(endpointFetchMock).not.toHaveBeenCalled();
            expect(hookApi!.deepLink).toBeNull();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('honors a pending cancellation intent when requested status arrives concurrently', async () => {
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        let resolveStatus!: () => void;
        pairingStatusMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveStatus = () => resolve({
                ok: true,
                data: {
                    state: 'requested', pairId: 'pair_123', expiresAt,
                    requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
                    homeServerIdentityId: 'srv_home_a',
                    bindingProof: computeHomeQrBindingProofV2({
                        direction: 'trusted_home_displays',
                        qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                        homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                        expiresAtMs: Date.parse(expiresAt),
                    }),
                },
            });
        }));
        let resolveCancel!: () => void;
        pairingConsumeMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCancel = () => resolve({ ok: true });
        }));
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await vi.waitFor(() => expect(pairingStatusMock).toHaveBeenCalledTimes(1));
            let cancellation!: ReturnType<ReturnType<typeof usePairingSession>['cancelPairing']>;
            await act(async () => {
                cancellation = hookApi!.cancelPairing();
                await Promise.resolve();
            });
            await act(async () => { resolveStatus(); await Promise.resolve(); });
            expect(endpointFetchMock).not.toHaveBeenCalled();
            await act(async () => { resolveCancel(); await expect(cancellation).resolves.toEqual({ ok: true }); });
            expect(endpointFetchMock).not.toHaveBeenCalled();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('does not retry a terminal completion response and requires a new QR', async () => {
        vi.useFakeTimers();
        cachedCanonicalServerUrl = 'https://home-a.test';
        cachedServerIdentityId = 'srv_home_a';
        activeServerUrl = 'https://home-a.test';
        endpointFetchMock.mockResolvedValue(new Response(null, { status: 403 }));
        const requestedPublicKey = new Uint8Array(32).fill(9);
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        pairingStartMock.mockResolvedValueOnce({ ok: true, data: { pairId: 'pair_123', expiresAt } });
        const { computeHomeQrBindingProofV2 } = await import('@happier-dev/protocol');
        pairingStatusMock.mockResolvedValue({ ok: true, data: {
            state: 'requested', pairId: 'pair_123', expiresAt,
            requestedPublicKey: encodeBase64(requestedPublicKey), requestedDeviceLabel: null,
            homeServerIdentityId: 'srv_home_a',
            bindingProof: computeHomeQrBindingProofV2({
                direction: 'trusted_home_displays',
                qrSecret: new Uint8Array(32).fill(7), pairId: 'pair_123',
                homeServerIdentityId: 'srv_home_a', requesterPublicKey: requestedPublicKey,
                expiresAtMs: Date.parse(expiresAt),
            }),
        } });
        const { usePairingSession } = await import('./usePairingSession');
        let hookApi: ReturnType<typeof usePairingSession> | null = null;
        function Probe() { hookApi = usePairingSession({ enabled: true, isAuthenticated: true }); return null; }
        const screen = await renderScreen(<Probe />);
        try {
            await act(async () => { await hookApi!.startPairing(); });
            await vi.waitFor(() => expect(hookApi!.completionState).toBe('completion_failed'));
            await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
            expect(endpointFetchMock).toHaveBeenCalledTimes(1);
            expect(hookApi!.deepLink).toBeNull();
            expect(hookApi!.pairingContext).toBeNull();
        } finally {
            act(() => screen.tree.unmount());
            vi.useRealTimers();
        }
    });
});
