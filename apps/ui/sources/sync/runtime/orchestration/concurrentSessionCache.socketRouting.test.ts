import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerProfilesModuleMock } from '@/dev/testkit';

const ioSpy = vi.fn();
const getCredentialsForServerUrlSpy = vi.fn();
const listServerProfilesSpy = vi.fn();
const getActiveServerSnapshotSpy = vi.fn();
const invalidateCachedTransferRoutesForServerSpy = vi.fn();
const serverProfileListeners = new Set<(generation: number) => void>();
const homeViewStateListeners = new Set<() => void>();
let serverProfilesGeneration = 0;
let previousTransferRoutePositiveTtlMs: string | undefined;
const REFRESH_DEBOUNCE_TEST_MS = 600;
type ConcurrentCacheStorage = typeof import('@/sync/domains/state/storageStore')['storage'];

type SocketEventHandler = (...args: unknown[]) => void;

function createSocketStub() {
    const listeners = new Map<string, Set<SocketEventHandler>>();
    const socket = {
        connected: false,
        on: vi.fn((event: string, handler: SocketEventHandler) => {
            const bucket = listeners.get(event) ?? new Set<SocketEventHandler>();
            bucket.add(handler);
            listeners.set(event, bucket);
            return socket;
        }),
        off: vi.fn((event: string, handler?: SocketEventHandler) => {
            if (!handler) {
                listeners.delete(event);
                return socket;
            }
            listeners.get(event)?.delete(handler);
            return socket;
        }),
        onAny: vi.fn(),
        connect: vi.fn(() => {
            socket.connected = true;
            for (const listener of listeners.get('connect') ?? []) {
                listener();
            }
        }),
        disconnect: vi.fn(() => {
            const wasConnected = socket.connected;
            socket.connected = false;
            if (!wasConnected) {
                return;
            }
            for (const listener of listeners.get('disconnect') ?? []) {
                listener('io client disconnect');
            }
        }),
        removeAllListeners: vi.fn(() => {
            listeners.clear();
        }),
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

function mockReachabilityOnline() {
    vi.doMock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>();
        return {
            ...actual,
            subscribeServerReachabilityNetworkAllowed: (listener: (allowed: boolean) => void) => {
                listener(true);
                return () => {};
            },
            subscribeServerReachabilityState: (_serverUrl: string, listener: (state: any) => void) => {
                const timer = setTimeout(() => {
                    listener(onlineState());
                }, 0);
                return () => clearTimeout(timer);
            },
            acquireServerReachabilitySupervisor: async () => ({
                release: async () => {},
            }),
            reportServerUnreachable: () => {},
            resetServerReachabilitySupervisors: async () => {},
        };
    });
}

function mockServerProfiles() {
    vi.doMock('@/sync/domains/server/serverProfiles', () => createServerProfilesModuleMock({
        listServerProfiles: () => listServerProfilesSpy(),
        overrides: {
            loadHomeViewState: () => null,
            subscribeHomeViewState: (listener) => {
                homeViewStateListeners.add(listener);
                return () => homeViewStateListeners.delete(listener);
            },
            subscribeServerProfiles: (listener) => {
                serverProfileListeners.add(listener);
                return () => serverProfileListeners.delete(listener);
            },
        },
    }));
}

function emitServerProfilesChanged(): void {
    serverProfilesGeneration += 1;
    for (const listener of serverProfileListeners) listener(serverProfilesGeneration);
}

async function flushConcurrentCacheStartup(timerCount = 4): Promise<void> {
    await vi.advanceTimersByTimeAsync(1);
    for (let index = 0; index < timerCount; index += 1) {
        await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_TEST_MS + 1);
}

async function flushConcurrentCacheReconcileOnly(): Promise<void> {
    await vi.advanceTimersToNextTimerAsync();
}

async function flushConcurrentCachePeriodicRefresh(): Promise<void> {
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    await vi.advanceTimersToNextTimerAsync();
}

async function waitForConcurrentServerCacheMaterialization(
    storage: ConcurrentCacheStorage,
    serverId: string,
): Promise<void> {
    await vi.waitFor(() => {
        expect(storage.getState().concurrentSessionListCacheByServerId).toHaveProperty(serverId);
        expect(storage.getState().machineListByServerId).toHaveProperty(serverId);
    });
}

beforeEach(() => {
    previousTransferRoutePositiveTtlMs = process.env.EXPO_PUBLIC_HAPPIER_MACHINE_TRANSFER_ROUTE_CACHE_POSITIVE_TTL_MS;
    vi.resetModules();
    vi.useFakeTimers();
    ioSpy.mockReset();
    getCredentialsForServerUrlSpy.mockReset();
    listServerProfilesSpy.mockReset();
    getActiveServerSnapshotSpy.mockReset();
    invalidateCachedTransferRoutesForServerSpy.mockReset();
    serverProfileListeners.clear();
    homeViewStateListeners.clear();
    serverProfilesGeneration = 0;

});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT;
    if (previousTransferRoutePositiveTtlMs === undefined) {
        delete process.env.EXPO_PUBLIC_HAPPIER_MACHINE_TRANSFER_ROUTE_CACHE_POSITIVE_TTL_MS;
    } else {
        process.env.EXPO_PUBLIC_HAPPIER_MACHINE_TRANSFER_ROUTE_CACHE_POSITIVE_TTL_MS = previousTransferRoutePositiveTtlMs;
    }
});

describe('concurrent session cache socket routing', () => {
    it('reuses per-server session data key caches across concurrent refreshes', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));

        const seenExistingKeys: number[] = [];
        const seenExistingEnvelopes: Array<string | null> = [];
        const sessionDataKeysArgs: Array<Map<string, Uint8Array>> = [];
        const sessionDataKeyEnvelopesArgs: Array<Map<string, string> | undefined> = [];
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                sessionDataKeys,
                sessionDataKeyEnvelopes,
                applySessions,
            }: {
                sessionDataKeys: Map<string, Uint8Array>;
                sessionDataKeyEnvelopes?: Map<string, string>;
                applySessions: (sessions: unknown[]) => void;
            }) => {
                seenExistingKeys.push(sessionDataKeys.get('session-b')?.[0] ?? 0);
                seenExistingEnvelopes.push(sessionDataKeyEnvelopes?.get('session-b') ?? null);
                sessionDataKeysArgs.push(sessionDataKeys);
                sessionDataKeyEnvelopesArgs.push(sessionDataKeyEnvelopes);
                sessionDataKeys.set('session-b', new Uint8Array([sessionDataKeysArgs.length]));
                sessionDataKeyEnvelopes?.set('session-b', `envelope-${sessionDataKeysArgs.length}`);
                applySessions([]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();

        await flushConcurrentCacheStartup();
        await flushConcurrentCachePeriodicRefresh();

        expect(getCredentialsForServerUrlSpy).toHaveBeenCalled();
        expect(ioSpy).toHaveBeenCalled();
        expect(sessionDataKeysArgs.length).toBeGreaterThanOrEqual(2);
        expect(sessionDataKeysArgs[1]).toBe(sessionDataKeysArgs[0]);
        expect(sessionDataKeyEnvelopesArgs[0]).toBeInstanceOf(Map);
        expect(sessionDataKeyEnvelopesArgs[1]).toBe(sessionDataKeyEnvelopesArgs[0]);
        expect(seenExistingKeys.slice(0, 2)).toEqual([0, 1]);
        expect(seenExistingEnvelopes.slice(0, 2)).toEqual([null, 'envelope-1']);

        stopConcurrentSessionCacheSync();
    });

    it('replaces stale machine entries when an authoritative refresh omits a removed machine', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));
        const fetchAndApplyMachinesSpy = vi.fn(async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
            const call = fetchAndApplyMachinesSpy.mock.calls.length;
            if (call === 1) {
                applyMachines([
                    {
                        id: 'machine-1',
                        seq: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        active: true,
                        activeAt: 1,
                        metadata: { host: 'one' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                    {
                        id: 'machine-2',
                        seq: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        active: false,
                        activeAt: 1,
                        metadata: { host: 'two' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ]);
                return;
            }

            // Authoritative refresh response: machine-2 has been removed.
            applyMachines([
                {
                    id: 'machine-1',
                    seq: 2,
                    createdAt: 1,
                    updatedAt: 2,
                    active: true,
                    activeAt: 2,
                    metadata: { host: 'one' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                },
            ]);
        });
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: (...args: any[]) => (fetchAndApplyMachinesSpy as any)(...args),
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                sessionListActiveGroupingV1: 'project',
                sessionListInactiveGroupingV1: 'project',
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();

        await flushConcurrentCacheStartup();

        const initial = (storage.getState() as any).machineListByServerId?.['server-b'] ?? [];
        expect(initial.map((m: any) => m.id).sort()).toEqual(['machine-1', 'machine-2']);

        // Trigger periodic refresh (default is 5 minutes).
        await flushConcurrentCachePeriodicRefresh();

        const after = (storage.getState() as any).machineListByServerId?.['server-b'] ?? [];
        expect(after.map((m: any) => m.id)).toEqual(['machine-1']);
        expect(after[0]?.seq).toBe(2);

        stopConcurrentSessionCacheSync();
    });

    it('invalidates only the non-active server machine route when daemon state advances', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        process.env.EXPO_PUBLIC_HAPPIER_MACHINE_TRANSFER_ROUTE_CACHE_POSITIVE_TTL_MS = '3600000';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doUnmock('@/sync/domains/transfers/runtime/transferRouteCache');
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));

        let daemonStateVersion = 1;
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([{
                    id: 'machine-b',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2000,
                    active: true,
                    activeAt: 2000,
                    metadata: { host: 'b-host' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion,
                }]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup();
        expect(storage.getState().machineListByServerId['server-b']?.[0]?.daemonStateVersion).toBe(1);

        const {
            readCachedMachineRpcDirectRoute,
            recordCachedMachineRpcDirectRouteViable,
            subscribeCachedMachineRpcDirectRoute,
        } = await import('@/sync/domains/transfers/runtime/transferRouteCache');
        recordCachedMachineRpcDirectRouteViable({ serverId: 'server-b', remoteMachineId: 'machine-b' });
        recordCachedMachineRpcDirectRouteViable({ serverId: 'server-b', remoteMachineId: 'machine-other' });
        recordCachedMachineRpcDirectRouteViable({ serverId: 'server-c', remoteMachineId: 'machine-b' });
        const serverBRouteListener = vi.fn();
        const serverCRouteListener = vi.fn();
        const unsubscribeServerB = subscribeCachedMachineRpcDirectRoute(
            { serverId: 'server-b', remoteMachineId: 'machine-b' },
            serverBRouteListener,
        );
        const unsubscribeServerC = subscribeCachedMachineRpcDirectRoute(
            { serverId: 'server-c', remoteMachineId: 'machine-b' },
            serverCRouteListener,
        );

        await flushConcurrentCachePeriodicRefresh();
        expect(serverBRouteListener).not.toHaveBeenCalled();
        expect(readCachedMachineRpcDirectRoute({ serverId: 'server-b', remoteMachineId: 'machine-b' }))
            .toMatchObject({ status: 'viable' });

        daemonStateVersion = 2;
        await flushConcurrentCachePeriodicRefresh();

        expect(storage.getState().machineListByServerId['server-b']?.[0]?.daemonStateVersion).toBe(2);
        expect(serverBRouteListener).toHaveBeenCalledTimes(1);
        expect(serverCRouteListener).not.toHaveBeenCalled();
        expect(readCachedMachineRpcDirectRoute({ serverId: 'server-b', remoteMachineId: 'machine-b' }))
            .toEqual({ status: 'unknown' });
        expect(readCachedMachineRpcDirectRoute({ serverId: 'server-b', remoteMachineId: 'machine-other' }))
            .toMatchObject({ status: 'viable' });
        expect(readCachedMachineRpcDirectRoute({ serverId: 'server-c', remoteMachineId: 'machine-b' }))
            .toMatchObject({ status: 'viable' });

        unsubscribeServerB();
        unsubscribeServerC();
        stopConcurrentSessionCacheSync();
    });

    it('keeps the cached session list reference stable when an identical periodic refresh arrives', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        let sessionRefreshCount = 0;
        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                credentials,
                applySessions,
            }: {
                credentials: { token: string };
                applySessions: (sessions: unknown[]) => void;
            }) => {
                sessionRefreshCount += 1;
                if (credentials.token !== 'token-b') {
                    applySessions([]);
                    return;
                }
                applySessions([{
                    id: 'session-b',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2000,
                    active: true,
                    activeAt: 2000,
                    metadata: { machineId: 'machine-b', path: '/workspace/b', host: 'b-host' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                }]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({
                credentials,
                applyMachines,
            }: {
                credentials: { token: string };
                applyMachines: (machines: unknown[]) => void;
            }) => {
                if (credentials.token !== 'token-b') {
                    applyMachines([]);
                    return;
                }
                applyMachines([{
                    id: 'machine-b',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2000,
                    active: true,
                    activeAt: 2000,
                    metadata: { host: 'b-host', path: '/workspace/b' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                }]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup();

        const beforeState = storage.getState();
        const before = storage.getState().concurrentSessionListCacheByServerId['server-b'];
        expect(before?.sessions?.['session-b']).toBeDefined();
        expect(storage.getState().sessionListRowStateByServerId?.['server-b']).toBe(before?.sessions);
        expect(Array.isArray(storage.getState().sessionListIndexByServerId?.['server-b'])).toBe(true);
        expect(storage.getState().sessionListIndexByServerId?.['server-b']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'header',
                    headerKind: 'project',
                    machine: expect.objectContaining({
                        metadata: expect.objectContaining({
                            host: 'b-host',
                        }),
                    }),
                }),
            ]),
        );
        expect(sessionRefreshCount).toBeGreaterThan(0);

        await flushConcurrentCachePeriodicRefresh();

        expect(storage.getState()).toBe(beforeState);
        const after = storage.getState().concurrentSessionListCacheByServerId['server-b'];
        expect(after).toBe(before);

        stopConcurrentSessionCacheSync();
    });

    it('keeps sessionListIndexByServerId stable when only non-structural fields change', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        let sessionRefreshCount = 0;
        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));

        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                credentials,
                applySessions,
            }: {
                credentials: { token: string };
                applySessions: (sessions: unknown[]) => void;
            }) => {
                sessionRefreshCount += 1;
                if (credentials.token !== 'token-b') {
                    applySessions([]);
                    return;
                }
                const updatedAt = sessionRefreshCount === 1 ? 2000 : 3000;
                applySessions([{
                    id: 'session-b',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt,
                    active: true,
                    activeAt: 2000,
                    metadata: { machineId: 'machine-b', path: '/workspace/b', host: 'b-host' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                }]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({
                credentials,
                applyMachines,
            }: {
                credentials: { token: string };
                applyMachines: (machines: unknown[]) => void;
            }) => {
                if (credentials.token !== 'token-b') {
                    applyMachines([]);
                    return;
                }
                applyMachines([{
                    id: 'machine-b',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2000,
                    active: true,
                    activeAt: 2000,
                    metadata: { host: 'b-host', path: '/workspace/b' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                }]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup();

        const beforeIndex = storage.getState().sessionListIndexByServerId?.['server-b'] ?? null;
        const beforeRows = storage.getState().sessionListRowStateByServerId?.['server-b'] ?? null;
        expect(Array.isArray(beforeIndex)).toBe(true);
        expect(beforeRows && typeof beforeRows === 'object').toBe(true);

        await flushConcurrentCachePeriodicRefresh();

        const afterIndex = storage.getState().sessionListIndexByServerId?.['server-b'] ?? null;
        const afterRows = storage.getState().sessionListRowStateByServerId?.['server-b'] ?? null;
        expect(afterIndex).toBe(beforeIndex);
        expect(afterRows).not.toBe(beforeRows);
        expect(storage.getState().sessionListRowStateByServerId?.['server-b']?.['session-b']?.updatedAt).toBe(3000);
        expect(sessionRefreshCount).toBeGreaterThanOrEqual(2);

        stopConcurrentSessionCacheSync();
    });

    it('invalidates cached transfer routes when a concurrent server is removed from the desired set', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocket = createSocketStub();
        ioSpy.mockReturnValue(fakeSocket);
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/domains/transfers/runtime/transferRouteCache', () => ({
            invalidateCachedTransferRoutesForServer: (...args: unknown[]) => invalidateCachedTransferRoutesForServerSpy(...args),
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup();

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
        ]);
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        await vi.waitFor(() => {
            expect(invalidateCachedTransferRoutesForServerSpy).toHaveBeenCalledWith({ serverId: 'server-b' });
        });

        stopConcurrentSessionCacheSync();
    });

    it('keeps concurrent session cache updates isolated per server when two servers refresh concurrently', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocketB = createSocketStub();
        const fakeSocketC = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return fakeSocketB;
            if (serverUrl === 'https://stack-c.example.test') return fakeSocketC;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return { token: 'token-b', secret: 'secret-b' };
            if (serverUrl === 'https://stack-c.example.test') return { token: 'token-c', secret: 'secret-c' };
            return null;
        });

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
            { id: 'server-c', serverUrl: 'https://stack-c.example.test', name: 'Server C' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                credentials,
                applySessions,
            }: {
                credentials: { token: string };
                applySessions: (sessions: unknown[]) => void;
            }) => {
                if (credentials.token === 'token-b') {
                    applySessions([{
                        id: 'session-b',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 2000,
                        active: true,
                        activeAt: 2000,
                        metadata: { machineId: 'machine-b', path: '/workspace/b', host: 'b-host' },
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 0,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    }]);
                    return;
                }
                applySessions([{
                    id: 'session-c',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2100,
                    active: true,
                    activeAt: 2100,
                    metadata: { machineId: 'machine-c', path: '/workspace/c', host: 'c-host' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                }]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({
                credentials,
                applyMachines,
            }: {
                credentials: { token: string };
                applyMachines: (machines: unknown[]) => void;
            }) => {
                if (credentials.token === 'token-b') {
                    applyMachines([{
                        id: 'machine-b',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 2000,
                        active: true,
                        activeAt: 2000,
                        metadata: { host: 'b-host', path: '/workspace/b' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    }]);
                    return;
                }
                applyMachines([{
                    id: 'machine-c',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2100,
                    active: true,
                    activeAt: 2100,
                    metadata: { host: 'c-host', path: '/workspace/c' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                }]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b', 'server-c'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await waitForConcurrentServerCacheMaterialization(storage, 'server-c');

        const cacheByServer = storage.getState().concurrentSessionListCacheByServerId;
        const serverBSessionIds = Object.keys(cacheByServer['server-b']?.sessions ?? {});
        const serverCSessionIds = Object.keys(cacheByServer['server-c']?.sessions ?? {});

        expect(serverBSessionIds).toContain('session-b');
        expect(serverBSessionIds).not.toContain('session-c');
        expect(serverCSessionIds).toContain('session-c');
        expect(serverCSessionIds).not.toContain('session-b');

        const machinesByServer = (storage.getState() as any).machineListByServerId as undefined | Record<string, any>;
        expect(machinesByServer).toBeDefined();
        expect(Array.isArray(machinesByServer?.['server-b'])).toBe(true);
        expect(Array.isArray(machinesByServer?.['server-c'])).toBe(true);
        expect((machinesByServer?.['server-b'] ?? []).map((m: any) => m.id)).toContain('machine-b');
        expect((machinesByServer?.['server-c'] ?? []).map((m: any) => m.id)).toContain('machine-c');

        stopConcurrentSessionCacheSync();
    });

    it('scopes same-url concurrent cache refreshes by server id when alternate profiles share credentials storage', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const sharedServerUrl = 'https://shared-stack.example.test';
        const fakeSocketB = createSocketStub();
        const fakeSocketC = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string, options?: { auth?: { token?: string } }) => {
            if (serverUrl !== sharedServerUrl) {
                return createSocketStub();
            }
            if (options?.auth?.token === 'token-b') return fakeSocketB;
            if (options?.auth?.token === 'token-c') return fakeSocketC;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (
            serverUrl: string,
            options?: { serverId?: string | null },
        ) => {
            if (serverUrl !== sharedServerUrl) {
                return null;
            }
            if (options?.serverId === 'srv-b') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            if (options?.serverId === 'server-c') {
                return { token: 'token-c', secret: 'secret-c' };
            }
            return { token: 'token-c', secret: 'secret-c' };
        });

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            {
                id: 'server-b',
                serverIdentityId: 'srv-b',
                legacyServerIds: ['legacy-server-b'],
                serverUrl: sharedServerUrl,
                name: 'Server B',
            },
            { id: 'server-c', serverUrl: sharedServerUrl, name: 'Server C' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) => Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                credentials,
                applySessions,
            }: {
                credentials: { token: string };
                applySessions: (sessions: unknown[]) => void;
            }) => {
                if (credentials.token === 'token-b') {
                    applySessions([{
                        id: 'session-b',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 2000,
                        active: true,
                        activeAt: 2000,
                        metadata: { machineId: 'machine-b', path: '/workspace/b', host: 'b-host' },
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 0,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    }]);
                    return;
                }
                applySessions([{
                    id: 'session-c',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2100,
                    active: true,
                    activeAt: 2100,
                    metadata: { machineId: 'machine-c', path: '/workspace/c', host: 'c-host' },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                }]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({
                credentials,
                applyMachines,
            }: {
                credentials: { token: string };
                applyMachines: (machines: unknown[]) => void;
            }) => {
                if (credentials.token === 'token-b') {
                    applyMachines([{
                        id: 'machine-b',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 2000,
                        active: true,
                        activeAt: 2000,
                        metadata: { host: 'b-host', path: '/workspace/b' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    }]);
                    return;
                }
                applyMachines([{
                    id: 'machine-c',
                    seq: 1,
                    createdAt: 1000,
                    updatedAt: 2100,
                    active: true,
                    activeAt: 2100,
                    metadata: { host: 'c-host', path: '/workspace/c' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                }]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'legacy-server-b', 'server-c'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await waitForConcurrentServerCacheMaterialization(storage, 'server-c');

        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith(sharedServerUrl, { serverId: 'srv-b' });
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith(sharedServerUrl, { serverId: 'server-c' });

        const cacheByServer = storage.getState().concurrentSessionListCacheByServerId;
        const serverBSessionIds = Object.keys(cacheByServer['srv-b']?.sessions ?? {});
        const serverCSessionIds = Object.keys(cacheByServer['server-c']?.sessions ?? {});

        expect(serverBSessionIds).toContain('session-b');
        expect(serverBSessionIds).not.toContain('session-c');
        expect(cacheByServer['server-b']).toBeUndefined();
        expect(serverCSessionIds).toContain('session-c');
        expect(serverCSessionIds).not.toContain('session-b');

        const machinesByServer = storage.getState().machineListByServerId;
        expect((machinesByServer['srv-b'] ?? []).map((machine: any) => machine.id)).toEqual(['machine-b']);
        expect(machinesByServer['server-b']).toBeUndefined();
        expect((machinesByServer['server-c'] ?? []).map((machine: any) => machine.id)).toEqual(['machine-c']);

        stopConcurrentSessionCacheSync();
    });

    it('clears stale non-active server cache entries when a server is removed from the concurrent selection', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocketB = createSocketStub();
        const fakeSocketC = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return fakeSocketB;
            if (serverUrl === 'https://stack-c.example.test') return fakeSocketC;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return { token: 'token-b', secret: 'secret-b' };
            if (serverUrl === 'https://stack-c.example.test') return { token: 'token-c', secret: 'secret-c' };
            return null;
        });

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
            { id: 'server-c', serverUrl: 'https://stack-c.example.test', name: 'Server C' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) =>
                Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b', 'server-c'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await waitForConcurrentServerCacheMaterialization(storage, 'server-c');

        expect(Object.keys(storage.getState().concurrentSessionListCacheByServerId)).toEqual(
            expect.arrayContaining(['server-b', 'server-c']),
        );

        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
            },
        }));

        await flushConcurrentCacheStartup();

        expect(storage.getState().concurrentSessionListCacheByServerId['server-c']).toBeUndefined();
        expect((storage.getState() as any).machineListByServerId?.['server-c']).toBeUndefined();

        stopConcurrentSessionCacheSync();
    });

    it('reconciles a renamed secondary profile without a selection or focus change', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocketB = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return fakeSocketB;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return { token: 'token-b', secret: 'secret-b' };
            return null;
        });

        const profilesWithName = (name: string) => [
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name },
        ];
        listServerProfilesSpy.mockReturnValue(profilesWithName('Server B'));
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) =>
                Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup(3);

        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']?.serverName).toBe('Server B');

        // The profile owner learns a rename (e.g. adoption refresh). Selection
        // settings and the focused Home are untouched: only the profile registry
        // changed.
        listServerProfilesSpy.mockReturnValue(profilesWithName('Renamed B'));
        emitServerProfilesChanged();
        await flushConcurrentCacheReconcileOnly();

        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']?.serverName).toBe('Renamed B');

        stopConcurrentSessionCacheSync();
    });

    it('stops a secondary entry and clears its caches when its profile disappears without a selection change', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocketB = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return fakeSocketB;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return { token: 'token-b', secret: 'secret-b' };
            return null;
        });

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) =>
                Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => {
                applySessions([]);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup(3);

        // The secondary entry exists: its socket was created through the transport
        // boundary and its projection rows are scoped under its server id.
        expect(ioSpy.mock.calls.some(([url]) => String(url).includes('stack-b'))).toBe(true);
        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']).toBeDefined();

        // The profile is removed from the registry while the selection settings
        // still reference it; the resolver must intersect and stop the entry.
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
        ]);
        emitServerProfilesChanged();
        await flushConcurrentCacheReconcileOnly();

        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']).toBeUndefined();
        expect((storage.getState() as any).machineListByServerId?.['server-b']).toBeUndefined();

        stopConcurrentSessionCacheSync();
    });

    it('does not create a removed secondary from a superseded deferred credential lookup', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        let releaseCredentials!: (credentials: { token: string; secret: string }) => void;
        const deferredCredentials = new Promise<{ token: string; secret: string }>((resolve) => {
            releaseCredentials = resolve;
        });
        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return await deferredCredentials;
            return null;
        });
        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({ io: (...args: unknown[]) => ioSpy(...args) }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) =>
                Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({ Encryption: { create: async () => ({}) as unknown } }));
        vi.doMock('@/encryption/base64', () => ({ decodeBase64: () => new Uint8Array(32) }));
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({ applySessions }: { applySessions: (sessions: unknown[]) => void }) => applySessions([]),
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => applyMachines([]),
        }));

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

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(1);
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith('https://stack-b.example.test', { serverId: 'server-b' });

        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                serverSelectionGroups: [{
                    id: 'group-main',
                    name: 'Main',
                    serverIds: ['server-a'],
                    presentation: 'grouped',
                }],
            },
        }));
        releaseCredentials({ token: 'stale-token-b', secret: 'stale-secret-b' });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1);

        expect(ioSpy.mock.calls.some(([url]) => String(url).includes('stack-b'))).toBe(false);
        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']).toBeUndefined();
        expect((storage.getState() as any).machineListByServerId?.['server-b']).toBeUndefined();

        stopConcurrentSessionCacheSync();
    });

    it('does not write a stale snapshot when a refresh finishes after its server entry was replaced', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        mockReachabilityOnline();

        const fakeSocketB = createSocketStub();
        ioSpy.mockImplementation((serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return fakeSocketB;
            return createSocketStub();
        });

        getCredentialsForServerUrlSpy.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === 'https://stack-b.example.test') return { token: 'token-b', secret: 'secret-b' };
            return null;
        });

        listServerProfilesSpy.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
            { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
        ]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        });

        vi.doMock('socket.io-client', () => ({
            io: (...args: unknown[]) => ioSpy(...args),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlSpy(...args),
            },
            subscribeHomeCredentialMutations: () => () => {},
            isLegacyAuthCredentials: (credentials: any) =>
                Boolean(credentials && typeof credentials === 'object' && typeof credentials.secret === 'string'),
            isDataKeyAuthCredentials: () => false,
            isTokenOnlyAuthCredentials: () => false,
        }));
        mockServerProfiles();
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => getActiveServerSnapshotSpy(),
            subscribeActiveServer: () => () => {},
        }));
        vi.doMock('@/sync/encryption/encryption', () => ({
            Encryption: {
                create: async () => ({}) as unknown,
            },
        }));
        vi.doMock('@/encryption/base64', () => ({
            decodeBase64: () => new Uint8Array(32),
        }));

        // Hold server-b's refresh in flight until the test releases it, so the
        // refresh completion lands after the entry has been torn down.
        let releaseSessionsForB!: (value: unknown[]) => void;
        const sessionsForBReleased = new Promise<unknown[]>((resolve) => {
            releaseSessionsForB = resolve;
        });
        vi.doMock('@/sync/engine/sessions/sessionSnapshot', () => ({
            fetchAndApplySessions: async ({
                credentials,
                applySessions,
            }: {
                credentials: { token: string };
                applySessions: (sessions: unknown[]) => void;
            }) => {
                if (credentials.token !== 'token-b') {
                    applySessions([]);
                    return;
                }
                const sessions = await sessionsForBReleased;
                applySessions(sessions);
            },
        }));
        vi.doMock('@/sync/engine/machines/syncMachines', () => ({
            fetchAndApplyMachines: async ({ applyMachines }: { applyMachines: (machines: unknown[]) => void }) => {
                applyMachines([]);
            },
        }));

        const { storage } = await import('@/sync/domains/state/storageStore');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                ...settingsDefaults,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a', 'server-b'],
                        presentation: 'grouped',
                    },
                ],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'group-main',
            },
        }));

        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        startConcurrentSessionCacheSync();
        await flushConcurrentCacheStartup(3);

        // The deferred refresh for server-b is now in flight.
        expect(releaseSessionsForB).toBeTypeOf('function');

        // Remove server-b from the concurrent selection: the entry is stopped and
        // its cache rows are cleared.
        storage.setState((state) => ({
            ...state,
            settings: {
                ...state.settings,
                serverSelectionGroups: [
                    {
                        id: 'group-main',
                        name: 'Main',
                        serverIds: ['server-a'],
                        presentation: 'grouped',
                    },
                ],
            },
        }));
        await flushConcurrentCacheStartup();

        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']).toBeUndefined();
        expect((storage.getState() as any).machineListByServerId?.['server-b']).toBeUndefined();

        // The stale refresh completes only after teardown: the runtime-origin fence
        // (entry identity) must drop it instead of resurrecting the removed rows.
        releaseSessionsForB([{
            id: 'session-b-stale',
            seq: 1,
            createdAt: 1000,
            updatedAt: 2000,
            active: true,
            activeAt: 2000,
            metadata: { machineId: 'machine-b', path: '/workspace/b', host: 'b-host' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        }]);
        await flushConcurrentCacheStartup(2);

        expect(storage.getState().concurrentSessionListCacheByServerId['server-b']).toBeUndefined();
        expect((storage.getState() as any).machineListByServerId?.['server-b']).toBeUndefined();
        expect((storage.getState() as any).sessionListRowStateByServerId?.['server-b']).toBeUndefined();

        stopConcurrentSessionCacheSync();
    });

});
