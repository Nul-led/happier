import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSocketIoManagerBoundaryStub } from '@/dev/testkit/mocks/socketIo';

import {
    createMachineFixture,
    createServerProfilesModuleMock,
    createSessionFixture,
    createSessionListRenderableSessionFixture,
    createTokenStorageModuleMock,
} from '@/dev/testkit';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import type { SessionListFetchResult } from '@/sync/engine/sessions/sessionSnapshot';

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
    homeConnectionDescriptor?: Readonly<{
        v: 1;
        homeServerIdentityId: string;
        canonicalServerUrl: string;
        revision: number;
        endpoints: readonly Readonly<{
            kind: 'iroh';
            endpointId: string;
            relayUrls?: readonly string[];
        }>[];
    }>;
}>;

const profileListeners = new Set<(generation: number) => void>();
let profiles: ProfileFixture[] = [];
/** Mutable so one test can move a Home from failing acquisition to recovery. */
let acquisitionError: Error | null = null;
let sessionsForRefresh: Session[] = [];
let machinesForRefresh: Machine[] = [];
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
        io: createSocketIoManagerBoundaryStub(),
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
    additionalProfiles?: readonly ProfileFixture[];
}> = {}): Promise<{
    events: string[];
    fetchedUrls: string[];
}> {
    const events: string[] = [];
    const fetchedUrls: string[] = [];
    acquisitionError = params.acquisitionError ?? null;
    profiles = [
        { id: 'server-a', name: 'Server A', serverUrl: 'https://stack-a.example.test' },
        {
            id: 'server-b',
            name: 'Home B',
            serverUrl: 'https://home-b.example.test',
            serverIdentityId: 'srv_home_b',
            homeConnectionDescriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.example.test',
                revision: 7,
                endpoints: [{
                    kind: 'iroh',
                    endpointId: 'b'.repeat(64),
                    relayUrls: ['https://relay.example.test'],
                }],
            },
        },
        ...(params.additionalProfiles ?? []),
    ];

    acquireIrohHomeRuntimeOriginSpy.mockImplementation(async () => {
        events.push('acquire');
        if (acquisitionError) throw acquisitionError;
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
    }));
    // The canonical carrier policy imports these owner modules directly. Mock
    // the native boundary at the same module seams rather than bypassing the
    // policy with a mock of acquireEligibleHomeCarrier itself.
    vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
        acquireIrohHomeRuntimeOrigin: (input: IrohRuntimeOriginAcquireInput) => acquireIrohHomeRuntimeOriginSpy(input),
    }));
    vi.doMock('@/sync/runtime/nativeLoopbackTunnels/runtime', () => ({
        startNativeLoopbackTunnelRuntimeAppStateLifecycle: vi.fn(),
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
    vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => await createTokenStorageModuleMock({
        importOriginal: async <T,>() => await importOriginal<T>(),
        tokenStorage: {
            getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-b', secret: 'secret-b' })),
        },
    }));
    vi.doMock('@/sync/domains/server/serverProfiles', () => createServerProfilesModuleMock({
        // Supply the canonical testkit lookup owner as well as the raw list
        // projection. Explicit authenticated feature refresh resolves the
        // same secondary profile by stable identity after transport acquisition.
        listServerProfiles: () => profiles,
        overrides: {
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
        }): Promise<SessionListFetchResult> => {
            try {
                await request('/v1/sessions', { method: 'GET' });
            } catch (error) {
                events.push(`http-error:${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
            applySessions(sessionsForRefresh);
            return {
                sessionIds: sessionsForRefresh.map((session) => session.id),
                nextCursor: null,
                hasNext: false,
                attentionNextCursor: null,
                attentionHasNext: false,
                current: true,
                source: 'v2',
            };
        },
    }));
    vi.doMock('@/sync/engine/machines/syncMachines', () => ({
        fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) =>
            applyMachines(machinesForRefresh),
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
    const { resetServerFeaturesClientForTests } = await import(
        '@/sync/api/capabilities/serverFeaturesClient'
    );
    resetServerFeaturesClientForTests();

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
                serverIds: profiles.map((profile) => profile.id),
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
    acquisitionError = null;
    sessionsForRefresh = [];
    machinesForRefresh = [];
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
    it('starts an independent secondary Home while another Home transport acquisition is held', async () => {
        await configureHarness({
            additionalProfiles: [{
                id: 'server-c',
                name: 'Home C',
                serverUrl: 'https://home-c.example.test',
            }],
        });
        let releaseHeldAcquire!: () => void;
        acquireIrohHomeRuntimeOriginSpy.mockImplementationOnce(() => new Promise((resolve) => {
            releaseHeldAcquire = () => resolve({
                leaseId: 'lease-home-b-held',
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
            });
        }));
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
        expect(releaseHeldAcquire).toBeTypeOf('function');
        expect(startReachabilitySpy.mock.calls.map(([input]) => input.serverUrl))
            .toContain('https://home-c.example.test');
        releaseHeldAcquire();
    });

    it('does not stop a retained secondary Home when an older feature refresh settles after a newer reconcile', async () => {
        await configureHarness();
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        let finishFirstFeatureRefresh: ((response: Response) => void) | null = null;
        let authenticatedFeatureRequests = 0;
        setRuntimeFetch(async (input) => {
            const pathname = new URL(String(input)).pathname;
            if (pathname === '/v1/features/authenticated') {
                authenticatedFeatureRequests += 1;
                if (authenticatedFeatureRequests === 1) {
                    return await new Promise<Response>((resolve) => {
                        finishFirstFeatureRefresh = resolve;
                    });
                }
                return Response.json({ features: {}, capabilities: {} });
            }
            if (pathname === '/v1/sessions') {
                return Response.json({ sessions: [] });
            }
            throw new Error(`Unexpected request: ${pathname}`);
        });

        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(finishFirstFeatureRefresh).not.toBeNull());

        for (const listener of profileListeners) listener(2);
        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();

        finishFirstFeatureRefresh!(Response.json({ features: {}, capabilities: {} }));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();

        // A third reconciliation discriminates a retained entry from one the
        // stale first request incorrectly stopped by server id.
        for (const listener of profileListeners) listener(3);
        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();

        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1);
        expect(releaseIrohHomeRuntimeOriginSpy).not.toHaveBeenCalled();
    });

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
                kind: 'iroh',
                endpointId: 'b'.repeat(64),
                relayUrls: ['https://relay.example.test'],
            },
            canonicalServerUrl: 'https://home-b.example.test',
            verification: { kind: 'authenticated', token: 'token-b' },
        });
        expect(startReachabilitySpy).toHaveBeenCalledWith({
            serverUrl: 'https://home-b.example.test',
            token: 'token-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            homeCarrier: null,
        });
        expect(ioSpy).toHaveBeenCalledWith(
            'http://127.0.0.1:45991',
            expect.objectContaining({ transports: ['websocket'] }),
        );
        expect(fetchedUrls, `events=${JSON.stringify(events)}`).toContain(
            'http://127.0.0.1:45991/v1/features/authenticated',
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
            homeCarrier: null,
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

        // The periodic reconciliation may retry the same fail-closed carrier;
        // the invariant here is that none of those attempts opens an HTTPS,
        // HTTP, or Socket.IO bypass after identity verification fails.
        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalled();
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

describe('concurrent session cache Iroh Home transport acquisition failure', () => {
    const coldAcquisitionError = new Error('iroh_home_tunnel_probe_failed:identity-mismatch');
    const homeBScopeId = 'srv_home_b';

    async function seedLastKnownHomeBProjection(): Promise<void> {
        const { storage } = await import('@/sync/domains/state/storageStore');
        const staleSession = createSessionListRenderableSessionFixture({ id: 'session-stale' });
        storage.setState((state) => ({
            ...state,
            concurrentSessionListCacheByServerId: {
                ...state.concurrentSessionListCacheByServerId,
                [homeBScopeId]: {
                    serverName: 'Home B',
                    listObservation: {
                        phase: 'ready',
                        lastSuccessAt: Date.now(),
                    },
                },
            },
            sessionListRowsByServerId: {
                ...state.sessionListRowsByServerId,
                [homeBScopeId]: { [staleSession.id]: staleSession },
            },
            ordinarySessionListMembershipByServerId: {
                ...state.ordinarySessionListMembershipByServerId,
                [homeBScopeId]: [staleSession.id],
            },
            machineListByServerId: {
                ...state.machineListByServerId,
                [homeBScopeId]: [createMachineFixture({ id: 'machine-stale' })],
            },
            machineListStatusByServerId: {
                ...state.machineListStatusByServerId,
                [homeBScopeId]: 'idle',
            },
        }));
    }

    async function readHomeBProjection() {
        const { storage } = await import('@/sync/domains/state/storageStore');
        const state = storage.getState();
        const ordinarySessionIds = state.ordinarySessionListMembershipByServerId?.[homeBScopeId] ?? [];
        return {
            status: state.machineListStatusByServerId?.[homeBScopeId],
            machines: state.machineListByServerId?.[homeBScopeId],
            ordinarySessionRows: Object.fromEntries(ordinarySessionIds.flatMap((sessionId) => {
                const row = state.sessionListRowsByServerId?.[homeBScopeId]?.[sessionId];
                return row ? [[sessionId, row] as const] : [];
            })),
            ordinarySessionIds,
        };
    }

    async function settleReconcile(): Promise<void> {
        await vi.advanceTimersByTimeAsync(1);
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(601);
    }

    it('publishes an explicit target-local error status for a cold Home whose transport never resolved', async () => {
        const { fetchedUrls } = await configureHarness({ acquisitionError: coldAcquisitionError });
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await settleReconcile();

        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalled();
        const projection = await readHomeBProjection();
        // A cold failure must be legible as this Home's own failure, not as an
        // absent Home that consumers cannot distinguish from "never selected".
        expect(projection.status).toBe('error');
        // Fail closed: no HTTPS/user-socket/standard-relay substitution.
        expect(startReachabilitySpy).not.toHaveBeenCalled();
        expect(fetchedUrls).toEqual([]);
        expect(ioSpy).not.toHaveBeenCalled();
    });

    it('does not publish an acquisition error after a newer reconcile removed the Home', async () => {
        await configureHarness({ acquisitionError: coldAcquisitionError });
        acquireIrohHomeRuntimeOriginSpy.mockImplementationOnce(async () => {
            profiles = profiles.filter((profile) => profile.id !== 'server-b');
            for (const listener of profileListeners) listener(2);
            throw coldAcquisitionError;
        });
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await settleReconcile();

        expect((await readHomeBProjection()).status).toBeUndefined();
    });

    it('preserves last-known session and machine rows when a warm Home loses its transport', async () => {
        await configureHarness({ acquisitionError: coldAcquisitionError });
        await seedLastKnownHomeBProjection();
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await settleReconcile();

        const projection = await readHomeBProjection();
        expect(projection.status).toBe('error');
        expect(Object.keys(projection.ordinarySessionRows)).toEqual(['session-stale']);
        expect(projection.ordinarySessionIds).toEqual(['session-stale']);
        expect(projection.machines?.map((machine) => machine.id)).toEqual(['machine-stale']);
    });

    it('keeps another secondary Home healthy while one Home fails closed', async () => {
        const { fetchedUrls } = await configureHarness({
            acquisitionError: coldAcquisitionError,
            additionalProfiles: [{
                id: 'server-c',
                name: 'Home C',
                serverUrl: 'https://home-c.example.test',
            }],
        });
        machinesForRefresh = [createMachineFixture({ id: 'machine-c' })];
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await settleReconcile();
        await vi.waitFor(() => expect(fetchedUrls).toContain('https://home-c.example.test/v1/sessions'));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const state = storage.getState();
        expect(state.machineListStatusByServerId?.['server-c']).toBe('idle');
        expect(state.machineListByServerId?.['server-c']?.map((machine) => machine.id)).toEqual(['machine-c']);
        expect(state.machineListStatusByServerId?.[homeBScopeId]).toBe('error');
        expect(startReachabilitySpy).toHaveBeenCalledWith({
            serverUrl: 'https://home-c.example.test',
            token: 'token-b',
            homeCarrier: null,
        });
        expect(startReachabilitySpy.mock.calls.map(([input]) => input.serverUrl))
            .not.toContain('https://home-b.example.test');
    });

    it('reconciles a recovered Home to truthful current rows without duplicating preserved rows', async () => {
        await configureHarness({ acquisitionError: coldAcquisitionError });
        await seedLastKnownHomeBProjection();
        const cache = await import('./concurrentSessionCache');
        stopCache = cache.stopConcurrentSessionCacheSync;
        cache.startConcurrentSessionCacheSync();

        await settleReconcile();
        expect((await readHomeBProjection()).status).toBe('error');
        const failedAcquireCount = acquireIrohHomeRuntimeOriginSpy.mock.calls.length;

        acquisitionError = null;
        sessionsForRefresh = [createSessionFixture({ id: 'session-fresh' })];
        machinesForRefresh = [createMachineFixture({ id: 'machine-fresh' })];
        for (const listener of profileListeners) listener(2);

        await settleReconcile();
        await vi.waitFor(() => expect(acquireIrohHomeRuntimeOriginSpy.mock.calls.length).toBeGreaterThan(failedAcquireCount));
        await vi.advanceTimersByTimeAsync(601);

        await vi.waitFor(async () => {
            const projection = await readHomeBProjection();
            expect(projection.status).toBe('idle');
            expect(projection.machines?.map((machine) => machine.id)).toEqual(['machine-fresh']);
            expect(Object.keys(projection.ordinarySessionRows)).toEqual(['session-fresh']);
            expect(projection.ordinarySessionIds).toEqual(['session-fresh']);
        });
    });
});
