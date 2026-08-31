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
vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingStart: pairingStartMock,
    pairingStatus: pairingStatusMock,
}));

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
    getCachedServerFeaturesSnapshot: () =>
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
        enrollmentTransportCloseMock.mockClear();
        cachedCanonicalServerUrl = null;
        cachedServerIdentityId = null;
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
        expect(hookApi!.approvalContext).toBeNull();
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
});
