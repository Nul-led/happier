import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerProfilesModuleMock } from '@/dev/testkit';

type IrohRuntimeOriginAcquire = typeof import('@/sync/runtime/nativeIrohTunnels')['acquireIrohHomeRuntimeOrigin'];
type IrohRuntimeOriginAcquireInput = Parameters<IrohRuntimeOriginAcquire>[0];
type ReachabilityAcquire = typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')['acquireServerReachabilitySupervisor'];
type ReachabilityAcquireInput = Parameters<ReachabilityAcquire>[0];

const acquireIrohHomeRuntimeOriginSpy = vi.fn<IrohRuntimeOriginAcquire>();
const releaseIrohHomeRuntimeOriginSpy = vi.fn(async () => undefined);
const startReachabilitySpy = vi.fn<(input: ReachabilityAcquireInput) => Promise<void>>(async () => undefined);
const ioSpy = vi.fn<(endpoint: string, options?: unknown) => ReturnType<typeof createSocketStub>>();

type ProfileFixture = Readonly<{
    id: string;
    name: string;
    serverUrl: string;
    serverIdentityId?: string;
    irohEndpoint?: Readonly<{ endpointId: string; relayUrls?: readonly string[] }>;
    connectionDescriptorRevision?: number;
}>;

const profileListeners = new Set<(generation: number) => void>();
let profiles: ProfileFixture[] = [];
let stopCache: (() => void) | null = null;
let networkAllowedListener: ((allowed: boolean) => void) | null = null;
let recoveryRequiredListener: ((event: Readonly<{
    leaseId: string;
    homeServerIdentityId: string;
    reason: 'terminal' | 'foreground_probe_failed';
    activePublication: boolean;
}>) => void) | null = null;

function createSocketStub() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const socket = {
        connected: false,
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
            const bucket = listeners.get(event) ?? new Set();
            bucket.add(listener);
            listeners.set(event, bucket);
            return socket;
        }),
        off: vi.fn(),
        onAny: vi.fn(),
        offAny: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(() => {
            socket.connected = true;
            for (const listener of listeners.get('connect') ?? []) listener();
        }),
        disconnect: vi.fn(() => {
            const wasConnected = socket.connected;
            socket.connected = false;
            if (wasConnected) {
                for (const listener of listeners.get('disconnect') ?? []) listener('io client disconnect');
            }
        }),
        removeAllListeners: vi.fn(() => listeners.clear()),
    };
    return socket;
}

function onlineState() {
    return {
        phase: 'online',
        reason: 'initial_connect',
        attempt: 0,
        nextRetryAt: null,
        lastConnectedAt: Date.now(),
        lastDisconnectedAt: null,
        lastErrorMessage: null,
    };
}

async function configureHarness(params: Readonly<{
    acquisitionError?: Error;
}> = {}): Promise<{
    events: string[];
    fetchedUrls: string[];
}> {
    const events: string[] = [];
    const fetchedUrls: string[] = [];
    profiles = [
        { id: 'server-a', name: 'Server A', serverUrl: 'https://stack-a.example.test' },
        {
            id: 'server-b',
            name: 'Home B',
            serverUrl: 'https://home-b.example.test',
            serverIdentityId: 'srv_home_b',
            irohEndpoint: {
                endpointId: 'b'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            connectionDescriptorRevision: 7,
        },
    ];

    acquireIrohHomeRuntimeOriginSpy.mockImplementation(async () => {
        events.push('acquire');
        if (params.acquisitionError) throw params.acquisitionError;
        return {
            leaseId: 'lease-home-b',
            key: 'home-b-key',
            remoteHostId: 'srv_home_b',
            localUrl: 'http://127.0.0.1:45991',
            runtimeOrigin: 'http://127.0.0.1:45991',
            channelMode: 'loopback-port',
            purpose: 'home',
            status: 'ready',
            startedAt: '2026-08-30T00:00:00.000Z',
            homeServerIdentityId: 'srv_home_b',
            endpointId: 'b'.repeat(64),
            carrier: 'iroh',
            observedPath: 'relay',
            release: releaseIrohHomeRuntimeOriginSpy,
        };
    });
    startReachabilitySpy.mockImplementation(async (input: ReachabilityAcquireInput) => {
        events.push(`reachability:${input.runtimeOrigin ?? 'canonical'}`);
    });
    ioSpy.mockImplementation((endpoint: string) => {
        events.push(`socket:${endpoint}`);
        return createSocketStub();
    });

    vi.doMock('@/sync/runtime/nativeIrohTunnels', () => ({
        acquireIrohHomeRuntimeOrigin: (input: IrohRuntimeOriginAcquireInput) => acquireIrohHomeRuntimeOriginSpy(input),
        subscribeIrohHomeTunnelRecoveryRequired: (listener: typeof recoveryRequiredListener) => {
            recoveryRequiredListener = listener;
            return () => {
                if (recoveryRequiredListener === listener) recoveryRequiredListener = null;
            };
        },
        classifyIrohHomeTunnelSwitchFailure: (error: unknown) => {
            const message = error instanceof Error ? error.message : '';
            return {
                fallbackAllowed: message.includes('health-unavailable'),
                failureClass: message.includes('identity-mismatch') ? 'identity-auth' : 'carrier-unavailable',
            };
        },
    }));
    vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
        startNativeSshTunnelRuntimeAppStateLifecycle: vi.fn(),
    }));
    vi.doMock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', () => ({
        subscribeServerReachabilityNetworkAllowed: (listener: (allowed: boolean) => void) => {
            networkAllowedListener = listener;
            listener(true);
            return () => {
                if (networkAllowedListener === listener) networkAllowedListener = null;
            };
        },
        setServerReachabilityNetworkAllowed: vi.fn(),
        subscribeServerReachabilityState: (_serverUrl: string, listener: (state: ReturnType<typeof onlineState>) => void) => {
            const timer = setTimeout(() => listener(onlineState()), 0);
            return () => clearTimeout(timer);
        },
        acquireServerReachabilitySupervisor: async (input: ReachabilityAcquireInput) => {
            await startReachabilitySpy(input);
            return { release: async () => undefined };
        },
        reportServerUnreachable: vi.fn(),
        peekServerReachabilityToken: () => null,
        invalidateServerReachabilitySupervisor: async () => {},
        waitForServerReachable: async () => {},
        ServerReachabilityWaitTimeoutError: class ServerReachabilityWaitTimeoutError extends Error {},
        resetServerReachabilitySupervisors: async () => {},
    }));
    vi.doMock('socket.io-client', () => ({
        io: (endpoint: string, options?: unknown) => ioSpy(endpoint, options),
    }));
    vi.doMock('@/auth/storage/tokenStorage', () => ({
        TokenStorage: {
            getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-b', secret: 'secret-b' })),
        },
        subscribeHomeCredentialMutations: () => () => {},
        isLegacyAuthCredentials: () => true,
        isDataKeyAuthCredentials: () => false,
        isTokenOnlyAuthCredentials: () => false,
    }));
    vi.doMock('@/sync/domains/server/serverProfiles', () => createServerProfilesModuleMock({
        overrides: {
            listServerProfiles: () => profiles as never,
            loadHomeViewState: () => null,
            subscribeHomeViewState: () => () => {},
            subscribeServerProfiles: (listener) => {
                profileListeners.add(listener);
                return () => profileListeners.delete(listener);
            },
        },
    }));
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: () => ({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        }),
        subscribeActiveServer: () => () => {},
    }));
    vi.doMock('@/sync/encryption/encryption', () => ({ Encryption: { create: async () => ({}) } }));
    vi.doMock('@/encryption/base64', () => ({ decodeBase64: () => new Uint8Array(32) }));
    vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
        fetchAndApplySessions: async ({ request, applySessions }: {
            request: (path: string, init: RequestInit) => Promise<Response>;
            applySessions: (sessions: unknown[]) => void;
        }) => {
            try {
                await request('/v1/sessions', { method: 'GET' });
            } catch (error) {
                events.push(`http-error:${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
            applySessions([]);
        },
    }));
    vi.doMock('@/sync/engine/machines/syncMachines', () => ({
        fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => applyMachines([]),
    }));

    const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
    setRuntimeFetch(async (input) => {
        const url = String(input);
        fetchedUrls.push(url);
        events.push(`http:${url}`);
        return new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    });

    const { storage } = await import('@/sync/domains/state/storageStore');
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    storage.setState((state) => ({
        ...state,
        settings: {
            ...state.settings,
            ...settingsDefaults,
            serverSelectionGroups: [{
                id: 'group-main',
                name: 'Main',
                serverIds: ['server-a', 'server-b'],
                presentation: 'grouped',
            }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'group-main',
        },
    }));
    return { events, fetchedUrls };
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
    acquireIrohHomeRuntimeOriginSpy.mockReset();
    releaseIrohHomeRuntimeOriginSpy.mockClear();
    startReachabilitySpy.mockReset();
    ioSpy.mockReset();
    profileListeners.clear();
    stopCache = null;
    networkAllowedListener = null;
    recoveryRequiredListener = null;
});

afterEach(async () => {
    stopCache?.();
    stopCache = null;
    const { resetRuntimeFetch } = await import('@/utils/system/runtimeFetch');
    resetRuntimeFetch();
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT;
});

describe('concurrent session cache Iroh Home routing', () => {
    it('acquires before use and routes reachability, HTTP, and WebSocket-only Socket.IO through one runtime origin', async () => {
        const { events, fetchedUrls } = await configureHarness();
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        await vi.waitFor(() => expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(startReachabilitySpy).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(ioSpy).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(601);
        await vi.waitFor(() => expect(fetchedUrls, `events=${JSON.stringify(events)}`).toContain('http://127.0.0.1:45991/v1/sessions'));

        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledWith({
            homeServerIdentityId: 'srv_home_b',
            endpoint: {
                endpointId: 'b'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            descriptorRevision: 7,
            canonicalServerUrl: 'https://home-b.example.test',
            verification: { kind: 'authenticated', token: 'token-b' },
        });
        expect(startReachabilitySpy).toHaveBeenCalledWith({
            serverUrl: 'https://home-b.example.test',
            token: 'token-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
        });
        expect(ioSpy).toHaveBeenCalledWith(
            'http://127.0.0.1:45991',
            expect.objectContaining({ transports: ['websocket'] }),
        );
        expect(events.indexOf('acquire')).toBeLessThan(events.findIndex((event) => event.startsWith('reachability:')));
        expect(events.indexOf('acquire')).toBeLessThan(events.findIndex((event) => event.startsWith('http:')));
        expect(events.indexOf('acquire')).toBeLessThan(events.findIndex((event) => event.startsWith('socket:')));

        startReachabilitySpy.mockClear();
        networkAllowedListener?.(false);
        networkAllowedListener?.(true);
        await vi.waitFor(() => expect(startReachabilitySpy).toHaveBeenCalledTimes(1));
        expect(startReachabilitySpy).toHaveBeenCalledWith({
            serverUrl: 'https://home-b.example.test',
            token: 'token-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
        });
        expect(startReachabilitySpy.mock.calls).not.toContainEqual([{
            serverUrl: 'https://home-b.example.test',
            token: 'token-b',
        }]);

        profiles = profiles.filter((profile) => profile.id !== 'server-b');
        for (const listener of profileListeners) listener(1);
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(releaseIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1));
    });

    it('does not bypass an identity-verification failure through HTTPS reachability, HTTP, or Socket.IO', async () => {
        const { fetchedUrls } = await configureHarness({
            acquisitionError: new Error('iroh_home_tunnel_probe_failed:identity-mismatch'),
        });
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(601);

        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1);
        expect(startReachabilitySpy).not.toHaveBeenCalled();
        expect(fetchedUrls).toEqual([]);
        expect(ioSpy).not.toHaveBeenCalled();
    });

    it('drops a terminal secondary lease and reacquires it through the existing reconciliation owner', async () => {
        await configureHarness();
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(startReachabilitySpy).toHaveBeenCalledTimes(1));
        expect(recoveryRequiredListener).toBeTypeOf('function');

        recoveryRequiredListener?.({
            leaseId: 'lease-home-b',
            homeServerIdentityId: 'srv_home_b',
            reason: 'terminal',
            activePublication: false,
        });
        await vi.advanceTimersByTimeAsync(1);

        await vi.waitFor(() => expect(releaseIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(2));
    });
});
