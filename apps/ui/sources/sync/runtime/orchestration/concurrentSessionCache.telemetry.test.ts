import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';

const secureStore = vi.hoisted(() => new Map<string, string>());
const socketState = vi.hoisted(() => ({
    byUrl: new Map<string, ReturnType<typeof createSocketStub>>(),
}));
let restoreLocalStorage: (() => void) | null = null;

vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => secureStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { secureStore.set(key, value); },
    deleteItemAsync: async (key: string) => { secureStore.delete(key); },
}));

vi.mock('socket.io-client', () => ({
    io: (serverUrl: string) => {
        const socket = createSocketStub();
        socketState.byUrl.set(serverUrl, socket);
        return socket;
    },
}));

type SocketListener = (...args: unknown[]) => void;

function createSocketStub() {
    const listeners = new Map<string, Set<SocketListener>>();
    const socket = {
        connected: false,
        on(event: string, listener: SocketListener) {
            const bucket = listeners.get(event) ?? new Set<SocketListener>();
            bucket.add(listener);
            listeners.set(event, bucket);
            return socket;
        },
        off(event: string, listener?: SocketListener) {
            if (listener) listeners.get(event)?.delete(listener);
            else listeners.delete(event);
            return socket;
        },
        emit: vi.fn(),
        connect() {
            socket.connected = true;
            for (const listener of listeners.get('connect') ?? []) listener();
            return socket;
        },
        disconnect() {
            socket.connected = false;
            return socket;
        },
        removeAllListeners() {
            listeners.clear();
            return socket;
        },
        dispatch(event: string, payload: unknown) {
            for (const listener of listeners.get(event) ?? []) listener(payload);
        },
    };
    return socket;
}

afterEach(async () => {
    try {
        const cache = await import('./concurrentSessionCache');
        cache.stopConcurrentSessionCacheSync();
    } catch {
        // The module may fail before loading in a RED run.
    }
    restoreLocalStorage?.();
    restoreLocalStorage = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    secureStore.clear();
    socketState.byUrl.clear();
    delete process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT;
    delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    const { syncPerformanceTelemetry } = await import('@/sync/runtime/syncPerformanceTelemetry');
    syncPerformanceTelemetry.configure({ enabled: false });
});

describe('concurrent session cache telemetry', () => {
    it('measures real secondary snapshots and socket coalescing without Home attribution', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `cache_telemetry_${Date.now()}`;
        const localStorageHandle = installLocalStorageMock();
        restoreLocalStorage = localStorageHandle.restore;
        let blockNextSessionSnapshot = false;
        const snapshotGate: { release?: () => void } = {};
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/v1/auth/ping')) {
                return Response.json({ ok: true });
            }
            if (url.includes('/v2/sessions')) {
                if (blockNextSessionSnapshot) {
                    blockNextSessionSnapshot = false;
                    await new Promise<void>((resolve) => { snapshotGate.release = resolve; });
                }
                const body = JSON.stringify({ sessions: [], nextCursor: null, hasNext: false });
                return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
            }
            if (url.includes('/v1/machines')) {
                return new Response('[]', { status: 200, headers: { 'content-length': '2' } });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchSpy);

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const runtime = await import('@/sync/domains/server/serverRuntime');
        const active = runtime.upsertAndActivateServer({ serverUrl: 'https://home-a.example.test', scope: 'tab' });
        const secondary = await profiles.upsertServerProfile({ serverUrl: 'https://home-b.example.test', name: 'Home B' });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await TokenStorage.setCredentialsForServerUrl(
            secondary.serverUrl,
            { serverId: secondary.id },
            { token: 'secondary-token' },
        );
        await profiles.saveHomeViewState({
            version: 1,
            groups: [{ id: 'global-group', name: 'Global Group', serverIds: [active.id, secondary.id] }],
            activeTargetKind: 'group',
            activeTargetId: 'global-group',
        });
        const { storage } = await import('@/sync/domains/state/storageStore');
        // Simulate a late focused-account projection carrying the pre-migration
        // selection. Once HomeView exists, this scoped copy has no authority.
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                serverSelectionGroups: [{
                    id: 'stale-group',
                    name: 'Stale Group',
                    serverIds: [active.id],
                    presentation: 'grouped',
                }],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'stale-group',
            },
        }));

        const { syncPerformanceTelemetry } = await import('@/sync/runtime/syncPerformanceTelemetry');
        const cache = await import('./concurrentSessionCache');
        // Loading the real graph instantiates focused Sync, which applies the
        // runtime telemetry setting. Enable capture after that production
        // composition side effect so the test observes the cache owner itself.
        syncPerformanceTelemetry.configure({ enabled: true });
        expect(syncPerformanceTelemetry.isEnabled()).toBe(true);
        expect(await TokenStorage.getCredentialsForServerUrl(
            secondary.serverUrl,
            { serverId: secondary.id },
        )).toMatchObject({ token: 'secondary-token' });
        cache.startConcurrentSessionCacheSync();
        const reachability = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
        await vi.waitFor(() => {
            expect(reachability.peekServerReachabilityState(secondary.serverUrl)).toMatchObject({ phase: 'online' });
        }, { timeout: 5_000 });
        await vi.waitFor(() => {
            expect(syncPerformanceTelemetry.snapshot().events.some((event) =>
                event.name === 'sync.concurrent.refresh')).toBe(true);
        }, { timeout: 15_000 });
        syncPerformanceTelemetry.reset();
        vi.useFakeTimers();

        blockNextSessionSnapshot = true;
        const secondarySocket = socketState.byUrl.get(secondary.serverUrl);
        secondarySocket?.dispatch('update', { body: { t: 'update-session' } });
        secondarySocket?.dispatch('update', { body: { t: 'update-session' } });
        await vi.advanceTimersByTimeAsync(601);
        await Promise.resolve();
        secondarySocket?.dispatch('update', { body: { t: 'update-session' } });
        await vi.advanceTimersByTimeAsync(601);
        snapshotGate.release?.();
        await vi.waitFor(() => {
            expect(syncPerformanceTelemetry.snapshot().events.some((event) =>
                event.name === 'sync.concurrent.refresh')).toBe(true);
        }, { timeout: 5_000 });

        const summary = syncPerformanceTelemetry.snapshot();
        const refresh = summary.events.find((event) => event.name === 'sync.concurrent.refresh');
        const socket = summary.events.find((event) => event.name === 'sync.concurrent.refresh.socket');
        expect(refresh?.fields.responseBytes).toBeGreaterThan(2);
        expect(refresh?.count).toBeGreaterThanOrEqual(1);
        expect(socket?.fields).toMatchObject({ enqueued: 2, coalesced: 1, inFlightQueued: 1 });
        expect(JSON.stringify(summary)).not.toContain(secondary.id);
        expect(JSON.stringify(summary)).not.toContain(secondary.serverUrl);

        const replacement = await profiles.upsertServerProfile({
            serverUrl: 'https://home-c.example.test',
            name: 'Home C',
        });
        await TokenStorage.setCredentialsForServerUrl(
            replacement.serverUrl,
            { serverId: replacement.id },
            { token: 'replacement-token' },
        );
        await profiles.saveHomeViewState({
            version: 1,
            groups: [{ id: 'global-next', name: 'Global Next', serverIds: [active.id, replacement.id] }],
            activeTargetKind: 'group',
            activeTargetId: 'global-next',
        });
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(601);
        await vi.waitFor(() => {
            expect(storage.getState().concurrentSessionListCacheByServerId[secondary.id]).toBeUndefined();
            expect(storage.getState().concurrentSessionListCacheByServerId[replacement.id]).toBeDefined();
        }, { timeout: 5_000 });

        cache.stopConcurrentSessionCacheSync();
        localStorageHandle.restore();
        restoreLocalStorage = null;
    });
});
