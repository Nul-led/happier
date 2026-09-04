import { afterEach, describe, expect, it, vi } from 'vitest';

import { IrohError } from '@happier-dev/iroh-native';

const CANONICAL_URL = 'https://ingressless-home.example.test';
const HOME_ENDPOINT_ID = 'a'.repeat(64);
const RELAY_URLS = ['https://relay.happier.test/'];

const nativeRuntimeMock = {
    ensureHomeTunnel: vi.fn(async () => {
        throw new Error('a browser must never acquire the native loopback lease');
    }),
    releaseHomeTunnel: vi.fn(async () => undefined),
    releaseActiveHomeTunnels: vi.fn(async () => undefined),
    releaseLeasesForStaleTargets: vi.fn(async () => undefined),
    markSuspended: vi.fn(),
    markForeground: vi.fn(async () => undefined),
    listTunnels: vi.fn(() => ({ leases: [], platformLimitations: [] })),
    subscribeRecoveryRequired: vi.fn(() => () => undefined),
};

type Published = Readonly<{
    target: Readonly<{ serverId: string; generation: number }>;
    leaseId: string;
    runtimeOrigin?: string;
    homeCarrier?: unknown;
    carrier: 'https' | 'iroh';
}>;

const publishSpy = vi.fn((_publication: Published) => true);
const releasePublicationSpy = vi.fn(
    (_release: Readonly<{ target: Readonly<{ serverId: string; generation: number }>; leaseId: string }>) => true,
);
const acquireBrowserCarrierSpy = vi.fn();

function createBrowserCarrier(leaseId: string, release: () => Promise<void> = async () => {}) {
    return {
        leaseId,
        homeServerIdentityId: 'srv_home_a',
        endpointId: HOME_ENDPOINT_ID,
        appliedRelayUrls: RELAY_URLS,
        readObservedPath: () => 'relay' as const,
        request: async () => new Response(null, { status: 200 }),
        createWebSocket: () => ({}),
        release: vi.fn(release),
    };
}

function mockEnvironment(options: Readonly<{
    profile?: Record<string, unknown> | null;
    browserHost?: boolean;
    snapshot?: Record<string, unknown>;
}> = {}): Readonly<{ syncSwitchServer: ReturnType<typeof vi.fn> }> {
    const snapshot = options.snapshot ?? {
        serverId: 'srv_home_a',
        serverUrl: CANONICAL_URL,
        generation: 42,
    };
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: () => snapshot,
        getActiveServerHomeCarrier: () => null,
        captureActiveServerRuntimeTarget: () => ({
            serverId: String(snapshot.serverId ?? ''),
            generation: Number(snapshot.generation ?? 0),
        }),
        publishActiveServerRuntimeOrigin: publishSpy,
        releaseActiveServerRuntimeOrigin: releasePublicationSpy,
    }));
    vi.doMock('@/sync/domains/server/serverProfiles', () => ({
        getServerProfileById: () => (options.profile === undefined
            ? {
                id: 'profile-a',
                serverIdentityId: 'srv_home_a',
                serverUrl: CANONICAL_URL,
                irohEndpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: RELAY_URLS },
            }
            : options.profile),
    }));
    vi.doMock('@/auth/storage/tokenStorage', () => ({
        TokenStorage: {
            getCredentials: vi.fn(async () => ({ token: 'home-token', secret: 'home-secret' })),
            getCredentialsForServerUrl: vi.fn(async () => ({ token: 'home-token', secret: 'home-secret' })),
        },
    }));
    const syncSwitchServer = vi.fn(async () => {});
    vi.doMock('@/sync/sync', () => ({ syncSwitchServer, sync: { retryNow: vi.fn() }, syncRestore: vi.fn() }));
    vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));
    vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
        getIrohHomeTunnelRuntime: () => nativeRuntimeMock,
    }));
    vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
        startNativeSshTunnelRuntimeAppStateLifecycle: vi.fn(),
    }));
    vi.doMock('@/sync/runtime/browserIroh/hostEligibility', () => ({
        resolveBrowserIrohHostDecision: () => (
            options.browserHost === false ? { eligible: false, reason: 'not_web' } : { eligible: true }
        ),
    }));
    vi.doMock('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier', async (importOriginal) => {
        const actual = await importOriginal<
            typeof import('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier')
        >();
        return { ...actual, acquireBrowserIrohHomeCarrier: acquireBrowserCarrierSpy };
    });
    return { syncSwitchServer };
}

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // `mockClear` keeps queued one-shot values, so an assertion failure could
    // otherwise leak an unconsumed carrier into the next test.
    acquireBrowserCarrierSpy.mockReset();
    nativeRuntimeMock.ensureHomeTunnel.mockReset();
});

describe('focused-Home browser Iroh carrier selection', () => {
    it('publishes the semantic carrier with no runtime origin and never acquires a native lease', async () => {
        const carrier = createBrowserCarrier('browser-lease-1');
        acquireBrowserCarrierSpy.mockResolvedValue(carrier);
        const { syncSwitchServer } = mockEnvironment();

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(nativeRuntimeMock.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(acquireBrowserCarrierSpy).toHaveBeenCalledWith({
            purpose: 'authenticated_home',
            homeServerIdentityId: 'srv_home_a',
            endpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: RELAY_URLS },
            canonicalServerUrl: CANONICAL_URL,
            credentials: { token: 'home-token', secret: 'home-secret' },
        });
        const published = publishSpy.mock.calls[0]?.[0] as Published;
        expect(published.carrier).toBe('iroh');
        expect(published.homeCarrier).toBe(carrier);
        // No loopback listener exists in a browser, so no origin is invented.
        expect(published.runtimeOrigin).toBeUndefined();
        expect(publishSpy.mock.invocationCallOrder[0])
            .toBeLessThan(syncSwitchServer.mock.invocationCallOrder[0]);
    });

    it('keeps a native host on the native lease', async () => {
        nativeRuntimeMock.ensureHomeTunnel.mockResolvedValue({
            leaseId: 'native-lease',
            endpointId: HOME_ENDPOINT_ID,
            status: 'ready',
            runtimeOrigin: 'http://127.0.0.1:43123',
            release: vi.fn(async () => undefined),
        } as never);
        mockEnvironment({ browserHost: false });

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(nativeRuntimeMock.ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(acquireBrowserCarrierSpy).not.toHaveBeenCalled();
    });

    it('falls back to independent HTTPS ingress when the browser carrier is unavailable', async () => {
        acquireBrowserCarrierSpy.mockRejectedValue(new IrohError('unavailable', 'worker script missing'));
        mockEnvironment({
            profile: {
                id: 'profile-a',
                serverIdentityId: 'srv_home_a',
                serverUrl: CANONICAL_URL,
                publicServerUrl: 'https://public.example.test',
                irohEndpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: RELAY_URLS },
            },
        });

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        const published = publishSpy.mock.calls[0]?.[0] as Published;
        expect(published.carrier).toBe('https');
        expect(published.runtimeOrigin).toBe('https://public.example.test');
        expect(published.homeCarrier).toBeUndefined();
    });

    it('returns the typed unavailable result for an ingress-less Home with no usable carrier', async () => {
        acquireBrowserCarrierSpy.mockRejectedValue(new IrohError('unavailable', 'worker script missing'));
        mockEnvironment();

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await expect(switchConnectionToActiveServer())
            .rejects.toThrow('No verified transport is available for the target Home');
        expect(publishSpy).not.toHaveBeenCalled();
    });

    it('never falls back after an identity or authorization failure', async () => {
        acquireBrowserCarrierSpy.mockRejectedValue(new IrohError('identity_mismatch', 'proved another endpoint'));
        mockEnvironment({
            profile: {
                id: 'profile-a',
                serverIdentityId: 'srv_home_a',
                serverUrl: CANONICAL_URL,
                publicServerUrl: 'https://public.example.test',
                irohEndpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: RELAY_URLS },
            },
        });

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await expect(switchConnectionToActiveServer()).rejects.toThrow('proved another endpoint');
        expect(publishSpy).not.toHaveBeenCalled();
    });
});

describe('focused-Home browser carrier release custody', () => {
    it('releases only the previous focused-Home lease across a reconnect', async () => {
        const first = createBrowserCarrier('browser-lease-1');
        const second = createBrowserCarrier('browser-lease-2');
        acquireBrowserCarrierSpy.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        mockEnvironment();

        const { switchConnectionToActiveServer, retryActiveServerConnection } = await import('./connectionManager');
        await switchConnectionToActiveServer();
        await retryActiveServerConnection();

        expect(first.release).toHaveBeenCalledTimes(1);
        expect(second.release).not.toHaveBeenCalled();
        expect(releasePublicationSpy).toHaveBeenCalledWith({
            target: { serverId: 'srv_home_a', generation: 42 },
            leaseId: 'browser-lease-1',
        });
    });

    it('retains a lease whose release failed, and acquiring the next carrier does not drop that custody', async () => {
        // The failure mode this guards: holding the focused carrier in a single
        // slot lets the next acquisition overwrite a lease whose release failed,
        // so nothing ever retries it and the worker keeps the lease forever.
        let failNext = true;
        const stubborn = createBrowserCarrier('browser-lease-1', async () => {
            if (failNext) {
                failNext = false;
                throw new Error('worker release failed');
            }
        });
        const replacement = createBrowserCarrier('browser-lease-2');
        const third = createBrowserCarrier('browser-lease-3');
        acquireBrowserCarrierSpy
            .mockResolvedValueOnce(stubborn)
            .mockResolvedValueOnce(replacement)
            .mockResolvedValueOnce(third);
        mockEnvironment();

        const { switchConnectionToActiveServer, retryActiveServerConnection } = await import('./connectionManager');
        await switchConnectionToActiveServer();
        await retryActiveServerConnection();

        expect(stubborn.release).toHaveBeenCalledTimes(1);
        expect(replacement.release).not.toHaveBeenCalled();

        await retryActiveServerConnection();

        // The retained lease is retried, and the replacement is released as the
        // ordinary superseded carrier — neither is lost.
        expect(stubborn.release).toHaveBeenCalledTimes(2);
        expect(replacement.release).toHaveBeenCalledTimes(1);
        expect(third.release).not.toHaveBeenCalled();
    });

    it('releases the focused-Home carrier when the credential is gone', async () => {
        const carrier = createBrowserCarrier('browser-lease-1');
        acquireBrowserCarrierSpy.mockResolvedValue(carrier);
        mockEnvironment();

        const { switchConnectionToActiveServer, disconnectActiveServerConnection } = await import('./connectionManager');
        await switchConnectionToActiveServer();
        await disconnectActiveServerConnection();

        expect(carrier.release).toHaveBeenCalledTimes(1);
        expect(nativeRuntimeMock.releaseActiveHomeTunnels).toHaveBeenCalled();
    });
});
