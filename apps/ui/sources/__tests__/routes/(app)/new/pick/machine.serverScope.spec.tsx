import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    flushHookEffects,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { installNewPickRouteCommonModuleMocks } from './newPickRouteTestHelpers';
import { createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const navigationDispatchSpy = vi.hoisted(() => vi.fn());
const routerBackSpy = vi.hoisted(() => vi.fn());
const routerReplaceSpy = vi.hoisted(() => vi.fn());
const setActiveServerAndSwitchSpy = vi.hoisted(() => vi.fn(async (_params: any) => false));
const refreshMachinesThrottledSpy = vi.hoisted(() => vi.fn(async () => {}));
const prefetchMachineCapabilitiesSpy = vi.hoisted(() => vi.fn(async () => {}));
const resolveMachinePoolSpy = vi.hoisted(() => vi.fn(async () => ({
    kind: 'resolved' as const,
    poolId: '3a948f0c-bc30-491c-b764-37f0e6744d1f',
    machineId: 'machine-1',
    priorityTier: 0,
})));
const refreshMachinePoolsSpy = vi.hoisted(() => vi.fn(async () => []));
const storeTempDataSpy = vi.hoisted(() => vi.fn(() => 'temporary-target-data'));
const temporaryComputerAvailabilityState = vi.hoisted(() => ({
    value: { status: 'unavailable', reason: 'artifact_unavailable', retry: vi.fn() } as any,
    inputs: [] as Array<Record<string, unknown>>,
}));
const machinePoolLists = vi.hoisted(() => ({
    byServerId: {} as Record<string, any[] | null>,
    statusByServerId: { 'server-b': 'error' } as Record<string, 'idle' | 'loading' | 'signedOut' | 'error'>,
}));
const activeServerListeners = vi.hoisted(() => new Set<(snapshot: {
    serverId: string;
    serverUrl: string;
    generation: number;
}) => void>());
const activeServerSnapshotState = vi.hoisted(() => ({
    serverId: 'server-a',
    serverUrl: 'https://stack-a.example.test',
    generation: 1,
}));

const state = vi.hoisted(() => ({
    localSearchParams: {
        selectedId: 'machine-1',
        spawnServerId: 'server-b',
    } as {
        selectedId?: string;
        spawnServerId?: string;
    },
    settings: {
        serverSelectionGroups: [] as Array<{ id: string; name: string; serverIds: string[]; presentation?: 'grouped' | 'flat-with-badge' }>,
        serverSelectionActiveTargetKind: 'server' as 'server' | 'group' | null,
        serverSelectionActiveTargetId: 'server-b' as string | null,
    },
}));

let activeServerId = 'server-a';
const scopedMachinesState = vi.hoisted(() => ({
    groups: [
        {
            serverId: 'server-b',
            serverName: 'Server B',
            loading: false,
            signedOut: false,
            machines: [
                {
                    id: 'machine-1',
                    serverId: 'server-b',
                    metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
                    active: true,
                    createdAt: 1,
                    updatedAt: 1,
                    activeAt: Date.now(),
                    seq: 1,
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                },
            ],
        },
    ] as any[],
}));
const serverScopedMachineOptionsCalls = vi.hoisted(() => [] as Array<Readonly<{
    allowedServerIds: readonly string[];
}>>);

let capturedMachineSelectionContentProps: any = null;

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

installNewPickRouteCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web' },
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    header: { tint: '#111' },
                    textSecondary: '#666',
                    groupped: { background: '#fff' },
                },
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const module = createExpoRouterMock({
            navigation: {
                getState: () => ({
                    index: 1,
                    routes: [
                        {
                            key: 'new-route',
                            name: '(app)/new/index',
                            path: '/new',
                            params: {
                                machineId: 'machine-1',
                                spawnServerId: 'server-b',
                            },
                        },
                        {
                            key: 'current-route',
                            name: '(app)/new/pick/machine',
                            path: '/new/pick/machine',
                        },
                    ],
                }),
                dispatch: navigationDispatchSpy,
            },
            router: {
                push: vi.fn(),
                back: routerBackSpy,
                replace: routerReplaceSpy,
                setParams: vi.fn(),
            },
        }).module;

        return {
            ...module,
            useLocalSearchParams: () => state.localSearchParams,
        };
    },
    storage: async () => {
        const { createStorageModuleStub, createStorageStoreMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: createStorageStoreMock({
                setMachinePoolListStatus: vi.fn(),
            }),
            useAllMachines: () => ([
                {
                    id: 'machine-1',
                    metadata: {
                        host: 'host-1',
                        displayName: 'Machine 1',
                        homeDir: '/home/me',
                        platform: 'darwin',
                        happyCliVersion: '0.0.0-test',
                        happyHomeDir: '/Users/tester/.happy-dev',
                    },
                    active: true,
                    createdAt: 1,
                    updatedAt: 1,
                    activeAt: Date.now(),
                    seq: 1,
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                },
            ]),
            useAllSessionListRenderables: () => [],
            useMachinePoolListByServerId: () => machinePoolLists.byServerId,
            useMachinePoolListStatusByServerId: () => machinePoolLists.statusByServerId,
            useMachinePoolAccountIdByServerId: () => Object.fromEntries(
                Object.keys(machinePoolLists.byServerId).map((serverId) => [serverId, 'account-a']),
            ),
            useSetting: (key: string) => {
                if (key === 'useMachinePickerSearch') return false;
                return (state.settings as any)[key];
            },
            useSettings: () => ({
                ...state.settings,
                useMachinePickerSearch: false,
            } as any),
            useSettingMutable: createUseSettingMutableMockFromReader((key) => (key === 'favoriteMachines' ? [[], vi.fn()] : [undefined, vi.fn()])),
        });
    },
});

vi.mock('@react-navigation/native', () => ({
    CommonActions: {
        setParams: (params: Record<string, unknown>) => ({
            type: 'SET_PARAMS',
            payload: { params },
        }),
    },
}));

vi.mock('@/components/sessions/new/components/NewSessionMachineSelectionContent', () => ({
    NewSessionMachineSelectionContent: (props: any) => {
        capturedMachineSelectionContentProps = props;
        return null;
    },
}));

vi.mock('@/utils/sessions/recentMachines', () => ({
    getRecentMachinesFromSessions: ({ machines }: { machines: unknown[] }) => machines,
}));

vi.mock('@/components/navigation/HeaderTitleWithAction', () => ({
    HeaderTitleWithAction: ({ title }: { title: string }) => React.createElement('Text', null, title),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: refreshMachinesThrottledSpy,
    },
}));

vi.mock('@/sync/ops/machinePools', () => ({
    refreshMachinePools: refreshMachinePoolsSpy,
    resolveMachinePool: resolveMachinePoolSpy,
}));

vi.mock('@/utils/sessions/tempDataStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/sessions/tempDataStore')>();
    return {
        ...actual,
        storeTempData: storeTempDataSpy,
    };
});

vi.mock('@/components/sessions/new/hooks/useTemporaryComputerAvailability', () => ({
    resolveTemporaryComputerDestinationProjectionState: (availability: { status: string }) => (
        availability.status === 'available' ? 'available' : availability.status === 'loading' ? 'pending' : 'empty'
    ),
    shouldOfferTemporaryComputerDestination: (availability: { status: string; reason?: string }) => (
        availability.status !== 'unavailable'
        || (availability.reason !== 'feature_disabled' && availability.reason !== 'automation_unsupported')
    ),
    // Destination eligibility no longer consumes Agent compatibility; that is
    // launch readiness, resolved separately by the picker model.
    useTemporaryComputerAvailability: (input: Record<string, unknown>) => {
        temporaryComputerAvailabilityState.inputs.push(input);
        return temporaryComputerAvailabilityState.value;
    },
}));

vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    prefetchMachineCapabilities: prefetchMachineCapabilitiesSpy,
}));

vi.mock('@/hooks/machine/useMachineEnvPresence', () => ({
    invalidateMachineEnvPresence: vi.fn(),
}));

// The picker model now reads Home view selection, which subscribes to this module's real
// device-state and profile change sources. Keep the profile fixtures overridden but preserve every
// sibling export instead of replacing the module with a fixed surface.
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createPartialServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createPartialServerProfilesModuleMock(importOriginal as <T>() => Promise<T>, {
        profiles: [
            { id: 'server-a', name: 'Server A', serverUrl: 'https://stack-a.example.test' },
            { id: 'server-b', name: 'Server B', serverUrl: 'https://stack-b.example.test' },
            { id: 'server-c', name: 'Server C', serverUrl: 'https://stack-c.example.test' },
        ],
        overrides: {
            getActiveServerId: () => activeServerId,
            loadHomeViewState: () => null,
        },
    });
});

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        ...activeServerSnapshotState,
    }),
    subscribeActiveServer: (listener: (snapshot: { serverId: string; serverUrl: string; generation: number }) => void) => {
        activeServerListeners.add(listener);
        return () => {
            activeServerListeners.delete(listener);
        };
    },
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/features/featureDecisionRuntime')>();
    const { buildServerFeaturesResponse } = await import('@/hooks/server/serverFeaturesTestUtils');
    const features = buildServerFeaturesResponse();
    features.features.machines.pools.enabled = true;
    const readySnapshot = Object.freeze({ status: 'ready' as const, features });
    const mainSnapshots = new Map<string, Readonly<{
        status: 'ready';
        serverIds: string[];
        snapshotsByServerId: Record<string, typeof readySnapshot>;
    }>>();
    return {
        ...actual,
        useServerFeaturesRuntimeSnapshot: () => readySnapshot,
        useServerFeaturesSnapshotForServerId: () => readySnapshot,
        useServerFeaturesMainSelectionSnapshot: (serverIds: readonly string[]) => {
            const key = serverIds.join('\u0000');
            const cached = mainSnapshots.get(key);
            if (cached) return cached;
            const snapshot = Object.freeze({
                status: 'ready' as const,
                serverIds: [...serverIds],
                snapshotsByServerId: Object.fromEntries(serverIds.map((serverId) => [serverId, {
                    status: 'ready' as const,
                    features,
                }])),
            });
            mainSnapshots.set(key, snapshot);
            return snapshot;
        },
    };
});

vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: (serverId: string | null | undefined) => (
        serverId
            ? { kind: 'bound' as const, scope: { serverId, accountId: 'account-a' } }
            : { kind: 'unknown_home' as const }
    ),
    useServerCredentialAccountScopeResolutions: (serverIds: readonly string[]) => new Map(
        serverIds.map((serverId) => [serverId, {
            kind: 'bound' as const,
            scope: { serverId, accountId: 'account-a' },
        }]),
    ),
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: async (params: any) => {
        setActiveServerAndSwitchSpy(params);
        activeServerId = String(params?.serverId ?? '').trim() || activeServerId;
        return true;
    },
}));

vi.mock('@/components/sessions/new/hooks/machines/useServerScopedMachineOptions', () => ({
    useServerScopedMachineOptions: (params: Readonly<{ allowedServerIds: readonly string[] }>) => {
        serverScopedMachineOptionsCalls.push(params);
        return scopedMachinesState.groups;
    },
}));

describe('machine picker server scope', () => {
    afterEach(() => {
        standardCleanup();
    });

    beforeEach(() => {
        activeServerId = 'server-a';
        activeServerSnapshotState.serverId = 'server-a';
        activeServerSnapshotState.serverUrl = 'https://stack-a.example.test';
        activeServerSnapshotState.generation = 1;
        activeServerListeners.clear();
        state.localSearchParams = {
            selectedId: 'machine-1',
            spawnServerId: 'server-b',
        };
        state.settings = {
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-b',
        };
        scopedMachinesState.groups = [
            {
                serverId: 'server-b',
                serverName: 'Server B',
                loading: false,
                signedOut: false,
                machines: [
                    {
                        id: 'machine-1',
                        serverId: 'server-b',
                        metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
                        active: true,
                        createdAt: 1,
                        updatedAt: 1,
                        activeAt: Date.now(),
                        seq: 1,
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ],
            },
        ] as any;
        machinePoolLists.byServerId = { 'server-b': [] };
        machinePoolLists.statusByServerId = { 'server-b': 'idle' };
        serverScopedMachineOptionsCalls.length = 0;
        resolveMachinePoolSpy.mockClear();
        refreshMachinePoolsSpy.mockClear();
        storeTempDataSpy.mockClear();
        temporaryComputerAvailabilityState.value = {
            status: 'unavailable',
            reason: 'artifact_unavailable',
            retry: vi.fn(),
        };
        temporaryComputerAvailabilityState.inputs.length = 0;
    });

    function emitActiveServerSnapshot(serverId: string) {
        activeServerId = serverId;
        activeServerSnapshotState.serverId = serverId;
        activeServerSnapshotState.serverUrl = `https://${serverId}.example.test`;
        activeServerSnapshotState.generation += 1;
        const nextSnapshot = {
            ...activeServerSnapshotState,
        };
        for (const listener of activeServerListeners) {
            listener(nextSnapshot);
        }
    }

    it('propagates selected machine and server params back to new session route without switching global active server', async () => {
        setActiveServerAndSwitchSpy.mockReset();
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        refreshMachinesThrottledSpy.mockReset();
        prefetchMachineCapabilitiesSpy.mockReset();
        capturedMachineSelectionContentProps = null;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();

        await act(async () => {
            capturedMachineSelectionContentProps.onSelectMachine({
                id: 'machine-1',
                metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
            });
            await flushHookEffects();
        });

        expect(navigationDispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SET_PARAMS',
            payload: {
                params: expect.objectContaining({
                    machineId: 'machine-1',
                    spawnServerId: 'server-b',
                }),
            },
        }));
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    it('uses the selected machine serverId when provided (group target coherence)', async () => {
        setActiveServerAndSwitchSpy.mockReset();
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        refreshMachinesThrottledSpy.mockReset();
        prefetchMachineCapabilitiesSpy.mockReset();
        capturedMachineSelectionContentProps = null;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        await act(async () => {
            capturedMachineSelectionContentProps.onSelectMachine({
                id: 'machine-1',
                serverId: 'server-c',
                metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
            } as any);
            await flushHookEffects();
        });

        expect(setActiveServerAndSwitchSpy).not.toHaveBeenCalled();
        expect(navigationDispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SET_PARAMS',
            payload: {
                params: expect.objectContaining({
                    machineId: 'machine-1',
                    spawnServerId: 'server-c',
                }),
            },
        }));
    });

    it('auto-selects machine when selected server has exactly one machine', async () => {
        setActiveServerAndSwitchSpy.mockReset();
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        refreshMachinesThrottledSpy.mockReset();
        prefetchMachineCapabilitiesSpy.mockReset();
        capturedMachineSelectionContentProps = null;

        state.localSearchParams = {
            selectedId: '',
            spawnServerId: 'server-b',
        };

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        expect(navigationDispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SET_PARAMS',
            payload: {
                params: expect.objectContaining({
                    machineId: 'machine-1',
                    spawnServerId: 'server-b',
                }),
            },
        }));
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps the picker open when one machine and a machine pool are both available', async () => {
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        state.localSearchParams = { selectedId: '', spawnServerId: 'server-b' };
        machinePoolLists.byServerId = {
            'server-b': [{
                pool: {
                    id: '3a948f0c-bc30-491c-b764-37f0e6744d1f',
                    name: 'Development',
                    description: null,
                    revision: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    members: [],
                },
                availability: { state: 'known', connectedCount: 1, enabledCount: 1 },
            }],
        };

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        expect(navigationDispatchSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(capturedMachineSelectionContentProps.poolGroups[0].serverId).toBe('server-b');
    });

    it('keeps Temporary computer offered and explained when the picker has no exact authoring producer', async () => {
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        state.localSearchParams = { selectedId: '', spawnServerId: 'server-b' };
        temporaryComputerAvailabilityState.value = {
            status: 'available',
            artifacts: [{ identity: { target: 'linux-x64' } }],
            client: {},
            retry: vi.fn(),
        };
        scopedMachinesState.groups = [{
            serverId: 'server-b',
            serverName: 'Server B',
            loading: false,
            signedOut: false,
            machines: [],
        }] as any;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        // Destination eligibility is a Home fact; the missing authoring producer
        // is launch readiness. Deleting the row for the second used to leave the
        // user with no destination, no reason and no recovery.
        expect(temporaryComputerAvailabilityState.inputs.at(-1)).not.toHaveProperty('agentCompatible');
        const offered = capturedMachineSelectionContentProps.temporaryComputers;
        expect(offered).toHaveLength(1);
        expect(offered[0]).toMatchObject({
            serverId: 'server-b',
            artifactTarget: 'linux-x64',
        });
        expect(offered[0].disabled).not.toBe(true);
        expect(typeof offered[0].unavailableText).toBe('string');
        expect(offered[0].unavailableText.length).toBeGreaterThan(0);
        expect(storeTempDataSpy).not.toHaveBeenCalled();
        expect(navigationDispatchSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('resolves a pool against its captured Home and returns the exact machine', async () => {
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        state.localSearchParams = { selectedId: '', spawnServerId: 'server-b', draftId: 'request-7' } as any;
        const pool = {
            pool: { id: '3a948f0c-bc30-491c-b764-37f0e6744d1f', name: 'Development', description: null, revision: 1, createdAt: 1, updatedAt: 1, members: [] },
            availability: { state: 'known', connectedCount: 1, enabledCount: 1 },
        };
        machinePoolLists.byServerId = { 'server-b': [pool] };

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await act(async () => {
            await capturedMachineSelectionContentProps.onSelectPool({ serverId: 'server-b', accountId: 'account-a', pool });
            await flushHookEffects();
        });

        expect(resolveMachinePoolSpy).toHaveBeenCalledWith('server-b', {
            poolId: pool.pool.id,
            requestKey: 'request-7',
        });
        expect(navigationDispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            payload: {
                params: expect.objectContaining({
                    machineId: 'machine-1',
                    spawnServerId: 'server-b',
                    machinePoolId: pool.pool.id,
                }),
            },
        }));
    });

    it('keeps the picker open until the pool list is known empty', async () => {
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        state.localSearchParams = { selectedId: '', spawnServerId: 'server-b' };
        machinePoolLists.byServerId = {};
        machinePoolLists.statusByServerId = { 'server-b': 'error' };

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        expect(navigationDispatchSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('ignores a late pool result after a newer exact-machine choice', async () => {
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        state.localSearchParams = { selectedId: '', spawnServerId: 'server-b', draftId: 'request-8' } as any;
        const pool = {
            pool: { id: '3a948f0c-bc30-491c-b764-37f0e6744d1f', name: 'Development', description: null, revision: 1, createdAt: 1, updatedAt: 1, members: [] },
            availability: { state: 'known', connectedCount: 1, enabledCount: 1 },
        };
        machinePoolLists.byServerId = { 'server-b': [pool] };
        let finishResolve!: (value: any) => void;
        resolveMachinePoolSpy.mockImplementationOnce(() => new Promise((resolve) => {
            finishResolve = resolve;
        }));

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        let pending!: Promise<void>;
        await act(async () => {
            pending = capturedMachineSelectionContentProps.onSelectPool({ serverId: 'server-b', accountId: 'account-a', pool });
            await Promise.resolve();
            capturedMachineSelectionContentProps.onSelectMachine({ id: 'machine-new', serverId: 'server-b' });
            finishResolve({ kind: 'resolved', poolId: pool.pool.id, machineId: 'machine-late', priorityTier: 0 });
            await pending;
            await flushHookEffects();
        });

        const returnedMachineIds = navigationDispatchSpy.mock.calls.map((call) => call[0]?.payload?.params?.machineId);
        expect(returnedMachineIds).toContain('machine-new');
        expect(returnedMachineIds).not.toContain('machine-late');
        const exactMachineReturn = navigationDispatchSpy.mock.calls
            .map((call) => call[0]?.payload?.params)
            .find((params) => params?.machineId === 'machine-new');
        expect(exactMachineReturn?.machinePoolId).toBeUndefined();
    });

    it('does not auto-select when the only machine for the selected server is offline', async () => {
        setActiveServerAndSwitchSpy.mockReset();
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        refreshMachinesThrottledSpy.mockReset();
        prefetchMachineCapabilitiesSpy.mockReset();
        capturedMachineSelectionContentProps = null;

        state.localSearchParams = {
            selectedId: '',
            spawnServerId: 'server-b',
        };

        scopedMachinesState.groups = [
            {
                serverId: 'server-b',
                serverName: 'Server B',
                loading: false,
                signedOut: false,
                machines: [
                    {
                        id: 'machine-1',
                        serverId: 'server-b',
                        metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
                        active: false,
                        createdAt: 1,
                        updatedAt: 1,
                        activeAt: 0,
                        seq: 1,
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ],
            },
        ] as any;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        expect(navigationDispatchSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('refreshes machines on mount so newly registered daemons appear in the fallback picker route', async () => {
        refreshMachinesThrottledSpy.mockReset();

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects();

        expect(refreshMachinesThrottledSpy).toHaveBeenCalledWith({
            staleMs: 0,
            force: true,
        });
    });

    it('normalizes invalid requested serverId to the allowed active target server', async () => {
        setActiveServerAndSwitchSpy.mockReset();
        navigationDispatchSpy.mockReset();
        routerBackSpy.mockReset();
        capturedMachineSelectionContentProps = null;

        state.localSearchParams = {
            selectedId: 'machine-1',
            spawnServerId: 'server-z',
        };
        state.settings.serverSelectionActiveTargetKind = 'server';
        state.settings.serverSelectionActiveTargetId = 'server-b';
        scopedMachinesState.groups = [
            {
                serverId: 'server-b',
                serverName: 'Server B',
                loading: false,
                signedOut: false,
                machines: [
                    {
                        id: 'machine-1',
                        serverId: 'server-b',
                        metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
                        active: true,
                        createdAt: 1,
                        updatedAt: 1,
                        activeAt: Date.now(),
                        seq: 1,
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ],
            },
        ] as any;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        expect(capturedMachineSelectionContentProps).toBeTruthy();
        expect(capturedMachineSelectionContentProps.serverId).toBe('server-b');

        await act(async () => {
            capturedMachineSelectionContentProps.onSelectMachine({
                id: 'machine-1',
                metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
            } as any);
            await flushHookEffects();
        });

        expect(navigationDispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'SET_PARAMS',
            payload: {
                params: expect.objectContaining({
                    machineId: 'machine-1',
                    spawnServerId: 'server-b',
                }),
            },
        }));
    });

    it('keeps the fallback Home destinations visible when the saved exact Home no longer exists', async () => {
        capturedMachineSelectionContentProps = null;
        state.localSearchParams = { selectedId: '' };
        state.settings.serverSelectionActiveTargetKind = 'server';
        state.settings.serverSelectionActiveTargetId = 'removed-server';
        scopedMachinesState.groups = [{
            serverId: 'server-a',
            serverName: 'Server A',
            loading: false,
            signedOut: false,
            machines: [{
                id: 'machine-a',
                serverId: 'server-a',
                metadata: { host: 'host-a', displayName: 'Machine A', homeDir: '/home/me' },
                active: true,
                createdAt: 1,
                updatedAt: 1,
                activeAt: Date.now(),
                seq: 1,
                metadataVersion: 1,
                daemonState: null,
                daemonStateVersion: 0,
            }],
        }] as any;
        machinePoolLists.byServerId = { 'server-a': [] };
        machinePoolLists.statusByServerId = { 'server-a': 'idle' };

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        expect(serverScopedMachineOptionsCalls.at(-1)?.allowedServerIds).toEqual(['server-a']);
        expect(capturedMachineSelectionContentProps.groups).toEqual(expect.arrayContaining([
            expect.objectContaining({ serverId: 'server-a' }),
        ]));
        expect(capturedMachineSelectionContentProps.poolGroups).toEqual(expect.arrayContaining([
            expect.objectContaining({ serverId: 'server-a' }),
        ]));
    });

    it('renders grouped selector when target is a group with multiple servers', async () => {
        capturedMachineSelectionContentProps = null;
        state.settings.serverSelectionGroups = [
            {
                id: 'grp-dev',
                name: 'Dev Group',
                serverIds: ['server-b', 'server-c'],
                presentation: 'grouped',
            },
        ];
        state.settings.serverSelectionActiveTargetKind = 'group';
        state.settings.serverSelectionActiveTargetId = 'grp-dev';
        scopedMachinesState.groups = [
            {
                serverId: 'server-b',
                serverName: 'Server B',
                loading: false,
                signedOut: false,
                machines: [
                    {
                        id: 'machine-1',
                        serverId: 'server-b',
                        metadata: { host: 'host-1', displayName: 'Machine 1', homeDir: '/home/me' },
                        active: true,
                        createdAt: 1,
                        updatedAt: 1,
                        activeAt: Date.now(),
                        seq: 1,
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ],
            },
            {
                serverId: 'server-c',
                serverName: 'Server C',
                loading: false,
                signedOut: false,
                machines: [],
            },
        ] as any;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        expect(capturedMachineSelectionContentProps).toBeTruthy();
        expect(capturedMachineSelectionContentProps.groups).toHaveLength(2);
        expect(capturedMachineSelectionContentProps.onSelectScopedMachine).toEqual(expect.any(Function));
    });

    it('tracks active server snapshot changes so machine scope does not stay on a stale server', async () => {
        capturedMachineSelectionContentProps = null;
        state.localSearchParams = {
            selectedId: '',
        };
        state.settings.serverSelectionGroups = [];
        state.settings.serverSelectionActiveTargetKind = null;
        state.settings.serverSelectionActiveTargetId = null;
        scopedMachinesState.groups = [
            {
                serverId: 'server-a',
                serverName: 'Server A',
                loading: false,
                signedOut: false,
                machines: [],
            },
            {
                serverId: 'server-b',
                serverName: 'Server B',
                loading: false,
                signedOut: false,
                machines: [
                    {
                        id: 'machine-b',
                        serverId: 'server-b',
                        metadata: { host: 'host-b', displayName: 'Machine B', homeDir: '/home/me' },
                        active: true,
                        createdAt: 1,
                        updatedAt: 1,
                        activeAt: Date.now(),
                        seq: 1,
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                ],
            },
        ] as any;

        const Screen = (await import('@/app/(app)/new/pick/machine')).default;
        await renderScreen(React.createElement(Screen));

        expect(capturedMachineSelectionContentProps).toBeTruthy();
        expect(capturedMachineSelectionContentProps.selectedServerId).toBe('server-a');

        await act(async () => {
            emitActiveServerSnapshot('server-b');
            await flushHookEffects();
        });

        expect(capturedMachineSelectionContentProps.selectedServerId).toBe('server-b');
    });
});
