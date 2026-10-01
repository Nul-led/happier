import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerProfilesModuleMock } from '@/dev/testkit/mocks/serverProfiles';
import { createTokenStorageModuleMock } from '@/dev/testkit/mocks/tokenStorage';

const reportServerUnreachableSpy = vi.fn<(...args: any[]) => void>();
const releaseServerReachabilitySupervisorSpy = vi.fn(async () => {});
const acquireServerReachabilitySupervisorSpy = vi.fn(async () => ({
    release: releaseServerReachabilitySupervisorSpy,
}));

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

describe('concurrentSessionCache teardown ordering', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        reportServerUnreachableSpy.mockReset();
        acquireServerReachabilitySupervisorSpy.mockClear();
        releaseServerReachabilitySupervisorSpy.mockClear();
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.resetModules();
        vi.clearAllMocks();
        try {
            const { resetServerReachabilitySupervisors } = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
            await resetServerReachabilitySupervisors();
        } catch {
            // ignore
        }
        delete process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT;
        delete process.env.EXPO_PUBLIC_HAPPIER_CONCURRENT_CACHE_REFRESH_INTERVAL_MS;
    });

    it('transfers the former focused Home after singleton withdrawal and tears it down intentionally', async () => {
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
        process.env.EXPO_PUBLIC_HAPPIER_CONCURRENT_CACHE_REFRESH_INTERVAL_MS = '600000';
        let appliedActiveServerId = 'server-a';
        let appliedActiveServerRuntimeAvailable = true;
        let selectedActiveServerId = 'server-a';
        let appliedActiveServerListener: ((serverId: string) => void) | null = null;
        let applyingActiveServerListener: ((serverId: string) => void) | null = null;
        let serverProfilesListener: ((generation: number) => void) | null = null;

        vi.doMock('@/sync/runtime/orchestration/connectionManager', () => ({
            getAppliedActiveServerId: () => appliedActiveServerId,
            isAppliedActiveServerRuntimeAvailable: () => appliedActiveServerRuntimeAvailable,
            subscribeAppliedActiveServer: (listener: (serverId: string) => void) => {
                appliedActiveServerListener = listener;
                return () => {
                    appliedActiveServerListener = null;
                };
            },
            subscribeApplyingActiveServer: (listener: (serverId: string) => void) => {
                applyingActiveServerListener = listener;
                return () => {
                    applyingActiveServerListener = null;
                };
            },
        }));

        vi.doMock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', () => ({
            setServerReachabilityNetworkAllowed: (_next: boolean) => {},
            subscribeServerReachabilityNetworkAllowed: (listener: (allowed: boolean) => void) => {
                listener(true);
                return () => {};
            },
            subscribeServerReachabilityState: (_serverUrl: string, listener: (state: any) => void) => {
                setTimeout(() => {
                    listener(onlineState());
                }, 0);
                return () => {};
            },
            acquireServerReachabilitySupervisor: acquireServerReachabilitySupervisorSpy,
            invalidateServerReachabilitySupervisor: vi.fn(async () => {}),
            reportServerUnreachable: reportServerUnreachableSpy,
            resetServerReachabilitySupervisors: async () => {},
        }));

        const getCredentialsForServerUrlSpy = vi.fn(async (serverUrl: string) => ({
            token: serverUrl.includes('stack-a') ? 'token-a' : 'token-b',
            secret: serverUrl.includes('stack-a') ? 'secret-a' : 'secret-b',
        }));
        vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => createTokenStorageModuleMock({
            importOriginal,
            tokenStorage: {
                getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
            },
            subscribeHomeCredentialMutations: () => () => {},
        }));

        vi.doMock('@/sync/domains/server/serverProfiles', () => createServerProfilesModuleMock({
            profiles: [
                { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
                { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
            ],
            overrides: {
                loadHomeViewState: () => null,
                subscribeHomeViewState: () => () => {},
                subscribeServerProfiles: (listener: (generation: number) => void) => {
                    serverProfilesListener = listener;
                    return () => {
                        serverProfilesListener = null;
                    };
                },
            },
        }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: selectedActiveServerId,
                serverUrl: selectedActiveServerId === 'server-a'
                    ? 'https://stack-a.example.test'
                    : 'https://stack-b.example.test',
                kind: 'stack',
                generation: 1,
            }),
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

        vi.doMock('./concurrentServerConnections/createConcurrentServerSocketTransport', () => {
            const connectedListeners = new Set<() => void>();
            const disconnectedListeners = new Set<(event: any) => void>();
            const errorListeners = new Set<(error: unknown) => void>();
            let connected = false;

            const transport = {
                async connect() {
                    connected = true;
                    connectedListeners.forEach((listener) => listener());
                },
                async disconnect(params?: { intentional?: boolean }) {
                    connected = false;
                    disconnectedListeners.forEach((listener) => listener({
                        intentional: params?.intentional === true,
                        reason: params?.intentional === true ? 'manual' : 'disconnect',
                    }));
                },
                async destroy() {
                    // Simulate a buggy transport that emits a non-intentional disconnect during teardown.
                    disconnectedListeners.forEach((listener) => listener({ intentional: false, reason: 'destroy' }));
                    connected = false;
                    connectedListeners.clear();
                    disconnectedListeners.clear();
                    errorListeners.clear();
                },
                isConnected() {
                    return connected;
                },
                onConnected(listener: () => void) {
                    connectedListeners.add(listener);
                    return () => connectedListeners.delete(listener);
                },
                onDisconnected(listener: (event: any) => void) {
                    disconnectedListeners.add(listener);
                    return () => disconnectedListeners.delete(listener);
                },
                onError(listener: (error: unknown) => void) {
                    errorListeners.add(listener);
                    return () => errorListeners.delete(listener);
                },
            };

            return {
                createConcurrentServerSocketTransport: () => ({
                    socket: { on: vi.fn(), off: vi.fn(), onAny: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn() },
                    transport,
                }),
            };
        });

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
        await vi.advanceTimersByTimeAsync(1);

        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith(
            'https://stack-b.example.test',
            { serverId: 'server-b' },
        );

        storage.setState((state) => ({
            ...state,
            concurrentSessionListCacheByServerId: {
                ...state.concurrentSessionListCacheByServerId,
                'server-b': {
                    serverName: 'Server B',
                },
            },
            sessionListRowsByServerId: {
                ...state.sessionListRowsByServerId,
                'server-b': {
                    'session-b': { id: 'session-b' } as never,
                },
            },
            ordinarySessionListMembershipByServerId: {
                ...state.ordinarySessionListMembershipByServerId,
                'server-b': ['session-b'],
            },
            machineListByServerId: {
                ...state.machineListByServerId,
                'server-b': [{ id: 'machine-b' } as never],
            },
            machineListStatusByServerId: {
                ...state.machineListStatusByServerId,
                'server-b': 'idle',
            },
        }));
        const serverBCredentialReadsBeforeSwitch = getCredentialsForServerUrlSpy.mock.calls.filter(([serverUrl]) => (
            serverUrl === 'https://stack-b.example.test'
        )).length;
        const reachabilityReleaseCountBeforeSwitch = releaseServerReachabilitySupervisorSpy.mock.calls.length;

        // A profile event queues reconciliation while A is still the applied
        // Home. Applying B must invalidate that queued view before releasing
        // B's secondary transport, otherwise the queued pass recreates B.
        (serverProfilesListener as ((generation: number) => void) | null)?.(1);
        selectedActiveServerId = 'server-b';
        appliedActiveServerRuntimeAvailable = false;
        (applyingActiveServerListener as ((serverId: string) => void) | null)?.('server-b');
        expect(
            storage.getState().concurrentSessionListCacheByServerId['server-a']?.listObservation?.phase,
        ).toBe('loading');
        await vi.advanceTimersByTimeAsync(1);
        expect(getCredentialsForServerUrlSpy.mock.calls.filter(([serverUrl]) => (
            serverUrl === 'https://stack-b.example.test'
        ))).toHaveLength(serverBCredentialReadsBeforeSwitch);
        expect(storage.getState().sessionListRowsByServerId['server-b']?.['session-b']).toBeDefined();
        expect(storage.getState().machineListByServerId['server-b']?.map((machine) => machine.id)).toEqual(['machine-b']);
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith(
            'https://stack-a.example.test',
            { serverId: 'server-a' },
        );
        expect(releaseServerReachabilitySupervisorSpy).toHaveBeenCalledTimes(
            reachabilityReleaseCountBeforeSwitch + 1,
        );
        (appliedActiveServerListener as ((serverId: string) => void) | null)?.('server-a');
        await vi.advanceTimersByTimeAsync(1);
        expect(getCredentialsForServerUrlSpy.mock.calls.filter(([serverUrl]) => (
            serverUrl === 'https://stack-b.example.test'
        ))).toHaveLength(serverBCredentialReadsBeforeSwitch);

        const releaseCountBeforeDuplicateApplyingEvent = releaseServerReachabilitySupervisorSpy.mock.calls.length;
        (applyingActiveServerListener as ((serverId: string) => void) | null)?.('server-b');
        expect(releaseServerReachabilitySupervisorSpy).toHaveBeenCalledTimes(
            releaseCountBeforeDuplicateApplyingEvent,
        );
        appliedActiveServerId = 'server-b';
        appliedActiveServerRuntimeAvailable = true;
        (appliedActiveServerListener as ((serverId: string) => void) | null)?.('server-b');
        await vi.advanceTimersByTimeAsync(1);
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith(
            'https://stack-a.example.test',
            { serverId: 'server-a' },
        );

        // This assertion is specifically about intentional teardown. Ignore
        // any earlier reachability report from the secondary's connection
        // attempt so the transport-destroy callback is the measured boundary.
        reportServerUnreachableSpy.mockClear();
        stopConcurrentSessionCacheSync();

        expect(acquireServerReachabilitySupervisorSpy).toHaveBeenCalled();
        expect(releaseServerReachabilitySupervisorSpy).toHaveBeenCalled();
        expect(reportServerUnreachableSpy).not.toHaveBeenCalled();
    });
});
