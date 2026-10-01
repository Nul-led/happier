import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    machineListStatus: 'loading' as 'idle' | 'loading' | 'signedOut' | 'error',
    activeServerSnapshot: {
        serverId: 'server-a',
        serverUrl: 'https://a.example.test',
        generation: 1,
    },
    appliedServerSnapshot: {
        serverId: 'server-a',
        serverUrl: 'https://a.example.test',
        generation: 1,
    },
    activeMachines: [] as Array<Record<string, unknown>>,
    machineListByServerId: {} as Record<string, Array<Record<string, unknown>>>,
    machineListStatusByServerId: {} as Record<string, 'idle' | 'loading' | 'signedOut' | 'error'>,
    socketStatus: 'connected' as 'disconnected' | 'connecting' | 'connected' | 'error',
    endpointStatus: 'online' as 'idle' | 'offline' | 'connecting' | 'online' | 'auth_failed' | 'shutting_down',
    runtimeAvailable: true,
    appliedListeners: new Set<() => void>(),
    availabilityListeners: new Set<() => void>(),
    syncError: null as null | Readonly<{
        serverId: string;
        kind: 'auth' | 'network';
        message: string;
        retryable: boolean;
        at: number;
    }>,
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                status: {
                    connected: '#00ff00',
                    connecting: '#ffcc00',
                    actionRequired: '#ff9900',
                    disconnected: '#999999',
                    error: '#ff0000',
                    default: '#999999',
                },
            },
        },
    });
});

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => state.activeServerSnapshot,
}));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => state.appliedServerSnapshot,
    isAppliedActiveServerRuntimeAvailable: () => state.runtimeAvailable,
    subscribeAppliedActiveServer: (listener: (serverId: string, generation: number) => void) => {
        const callback = () => listener('server-a', 1);
        state.appliedListeners.add(callback);
        return () => state.appliedListeners.delete(callback);
    },
    subscribeAppliedActiveServerRuntimeAvailability: (listener: (available: boolean) => void) => {
        const callback = () => listener(state.runtimeAvailable);
        state.availabilityListeners.add(callback);
        return () => state.availabilityListeners.delete(callback);
    },
}));

vi.mock('@/components/settings/machines/hooks/useActiveSelectionMachineGroups', () => ({
    useActiveSelectionMachineGroups: () => ({ visibleMachineGroups: [] }),
}));

vi.mock('@/hooks/server/useHomeViewSelectionSettings', () => ({
    useHomeViewSelectionSettings: () => ({
        serverSelectionGroups: null,
        serverSelectionActiveTargetKind: null,
        serverSelectionActiveTargetId: null,
    }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    listServerProfiles: () => [],
}));

vi.mock('@/sync/runtime/connectivity/syncErrorScope', () => ({
    selectSyncErrorForServer: (error: typeof state.syncError, serverId: string) => (
        error?.serverId === serverId ? error : null
    ),
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSocketStatus: () => ({ status: state.socketStatus }),
        useEndpointConnectivity: () => ({
            status: state.endpointStatus,
            reason: null,
            attempt: 0,
            nextRetryAt: null,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            lastErrorMessage: null,
        }),
        useSyncError: () => state.syncError,
        useAllMachines: () => state.activeMachines,
        useMachineListByServerId: () => {
            throw new Error('active Home chrome must not subscribe to the whole machine-list map');
        },
        useMachineListForServer: (serverId: string) => state.machineListByServerId[serverId] ?? null,
        useMachineListStatusByServerId: () => {
            throw new Error('active Home chrome must not subscribe to the whole machine-status map');
        },
        useMachineListStatusForServer: (serverId: string) => (
            serverId === 'server-a'
                ? state.machineListStatus
                : state.machineListStatusByServerId[serverId] ?? 'idle'
        ),
        useSetting: () => null,
    });
});

describe('useActiveHomeConnectionHealth', () => {
    it('keeps an empty active Home machine list unknown while it is loading', async () => {
        const { useActiveHomeConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useActiveHomeConnectionHealth());

        expect(hook.getCurrent()).toMatchObject({
            kind: 'connecting',
            machineCount: 0,
            onlineCount: 0,
            hasUnknownMachines: true,
            machineLabelKey: 'status.unknown',
        });
    });

    it('keeps chrome health on the applied Home while another Home is staged', async () => {
        state.activeServerSnapshot = {
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            generation: 2,
        };
        state.appliedServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.activeMachines = [{
            id: 'machine-b',
            active: true,
            activeAt: Date.now(),
            revokedAt: null,
            metadata: { host: 'staged-b' },
        }];
        state.machineListByServerId = {
            'server-a': [{
                id: 'machine-a',
                active: true,
                activeAt: Date.now(),
                revokedAt: null,
                metadata: { host: 'applied-a' },
            }],
            'server-b': state.activeMachines,
        };
        state.machineListStatusByServerId = { 'server-b': 'loading' };
        state.machineListStatus = 'idle';
        state.runtimeAvailable = true;
        state.syncError = {
            serverId: 'server-b',
            kind: 'auth',
            message: 'staged Home auth error',
            retryable: false,
            at: Date.now(),
        };

        const { useActiveHomeConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useActiveHomeConnectionHealth());

        expect(hook.getCurrent()).toMatchObject({
            kind: 'healthy',
            machineCount: 1,
            onlineCount: 1,
            primaryMachineLabel: 'applied-a',
            machineLabelKey: 'status.online',
        });
    });

    it('does not present staged Home transport health under the applied Home label', async () => {
        state.activeServerSnapshot = {
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            generation: 2,
        };
        state.appliedServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.activeMachines = [];
        state.machineListByServerId = {
            'server-a': [{
                id: 'machine-a',
                active: true,
                activeAt: Date.now(),
                revokedAt: null,
                metadata: { host: 'applied-a' },
            }],
        };
        state.machineListStatusByServerId = { 'server-a': 'idle' };
        state.machineListStatus = 'idle';
        state.runtimeAvailable = false;
        state.socketStatus = 'connected';
        state.endpointStatus = 'online';
        state.syncError = null;

        const { useActiveHomeConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useActiveHomeConnectionHealth());

        expect(hook.getCurrent()).toMatchObject({
            kind: 'connecting',
            endpointStatus: 'connecting',
            primaryMachineLabel: 'applied-a',
        });
    });

    it('keeps the applied Home connecting when its canonical runtime is unavailable', async () => {
        state.activeServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.appliedServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.activeMachines = [];
        state.machineListByServerId = {
            'server-a': [{
                id: 'machine-a',
                active: true,
                activeAt: Date.now(),
                revokedAt: null,
                metadata: { host: 'applied-a' },
            }],
        };
        state.machineListStatusByServerId = { 'server-a': 'idle' };
        state.machineListStatus = 'idle';
        state.runtimeAvailable = false;
        state.socketStatus = 'connected';
        state.endpointStatus = 'online';
        state.syncError = null;

        const { useActiveHomeConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useActiveHomeConnectionHealth());

        expect(hook.getCurrent()).toMatchObject({
            kind: 'connecting',
            endpointStatus: 'connecting',
            primaryMachineLabel: 'applied-a',
        });
    });

    it('recovers same-target health when the applied runtime becomes available', async () => {
        state.activeServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.appliedServerSnapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        };
        state.machineListByServerId = {
            'server-a': [{
                id: 'machine-a',
                active: true,
                activeAt: Date.now(),
                revokedAt: null,
                metadata: { host: 'applied-a' },
            }],
        };
        state.machineListStatusByServerId = { 'server-a': 'idle' };
        state.machineListStatus = 'idle';
        state.runtimeAvailable = false;
        state.socketStatus = 'connected';
        state.endpointStatus = 'online';
        state.syncError = null;

        const { useActiveHomeConnectionHealth } = await import('./useConnectionHealth');
        const hook = await renderHook(() => useActiveHomeConnectionHealth());
        expect(hook.getCurrent()).toMatchObject({
            kind: 'connecting',
            endpointStatus: 'connecting',
        });

        state.runtimeAvailable = true;
        await act(async () => {
            for (const listener of state.availabilityListeners) listener();
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toMatchObject({
            kind: 'healthy',
            endpointStatus: 'online',
            primaryMachineLabel: 'applied-a',
        });
    });
});
