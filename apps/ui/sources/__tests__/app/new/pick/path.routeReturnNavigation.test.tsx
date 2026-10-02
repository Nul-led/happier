import { authoringMemoryDefaults } from '@/sync/store/domains/authoringMemory';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import {
    flushHookEffects,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import type { BackendTargetRefV2 } from '@happier-dev/protocol';

import {
    BUNDLED_AGENT_ROUTE_PARAMS,
    cloneNavigationState,
    createConfiguredAcpBackendCatalogSettings,
    createConfiguredBackendRouteParams,
    createDiscoveredPluginBackendDescribeResult,
    createNavigationMock,
    createProjectionDescribeMock,
    createRouterMock,
    enableReactActEnvironment,
    installPickerCommonModuleMocks,
    PICKER_THEME_COLORS,
    type PickerNavigationState,
} from './testHarness';
import { createUseSettingMock, createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';

enableReactActEnvironment();

const routerMock = createRouterMock();
const navigationMock = createNavigationMock();
const safeRouterBack = vi.fn();
const settingsState = {
    current: {
        lastUsedAgent: 'claude',
        lastUsedBackendTarget: null as BackendTargetRefV2 | null,
        backendEnabledByTargetKey: null as Record<string, boolean> | null,
        acpCatalogSettingsV1: null as unknown,
    },
};
const machineContributionRegistryProjectionDescribe = createProjectionDescribeMock();
const pickerMachineMetadata = {
    host: 'tester.local',
    platform: 'darwin',
    happyCliVersion: '0.0.0-test',
    happyHomeDir: '/Users/tester/.happy-dev',
    homeDir: '/home/test',
} as const;
const pickerMachine = createMachineFixture({
    id: 'machine-1',
    metadata: pickerMachineMetadata,
});
let capturedPathSelectionListProps: {
    onSubmitSelectedPath: (path: string) => void;
    selectedPath?: string;
} | null = null;
let localSearchParams: Record<string, string> = {
    machineId: 'machine-1',
    selectedPath: '/repo/current',
};
let navigationState: PickerNavigationState = cloneNavigationState({
    index: 0,
    routes: [{ key: 'path-picker', name: '(app)/new/pick/path', path: '/new/pick/path' }],
});
const paramListeners = new Set<() => void>();

function emitLocalSearchParamsChange() {
    for (const listener of paramListeners) {
        listener();
    }
}
installPickerCommonModuleMocks({
    reactNative: async () =>
        (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({
            Platform: { OS: 'web' },
        }),
    unistyles: async () =>
        (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock({
            theme: {
                colors: {
                    ...PICKER_THEME_COLORS,
                    input: { background: '#fff', placeholder: '#aaa', text: '#000' },
                },
            },
        }),
    expoRouter: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const module = createExpoRouterMock({
            navigation: navigationMock,
            router: {
                push: routerMock.push,
                back: routerMock.back,
                replace: routerMock.replace,
                setParams: routerMock.setParams,
            },
        }).module;

        return {
            ...module,
            useNavigation: () => navigationMock,
            useLocalSearchParams: () =>
                React.useSyncExternalStore(
                    (listener) => {
                        paramListeners.add(listener);
                        return () => {
                            paramListeners.delete(listener);
                        };
                    },
                    () => localSearchParams,
                    () => localSearchParams,
                ),
        };
    },
    storage: async (importOriginal) =>
        (await import('@/dev/testkit/mocks/storage')).createStorageModuleMock({
            importOriginal,
            overrides: {
                useAllMachines: () => [pickerMachine],
                useAllSessionListRenderables: () => [],
                useAuthoringMemoryField: (key) => ({ ...authoringMemoryDefaults, recentMachinePaths: [] })[key],
                useSetting: createUseSettingMock({ fallback: (key) => {
                    if (key === 'usePathPickerSearch') return false;
                    return null;
                } }),
                useSettingMutable: createUseSettingMutableMockFromReader(() => [[], vi.fn()]),
                useSettings: () => ({
                    ...settingsDefaults,
                    lastUsedAgent: settingsState.current.lastUsedAgent,
                    lastUsedBackendTarget: settingsState.current.lastUsedBackendTarget,
                    backendEnabledByTargetKey:
                        settingsState.current.backendEnabledByTargetKey as unknown as typeof settingsDefaults.backendEnabledByTargetKey,
                    acpCatalogSettingsV1:
                        settingsState.current.acpCatalogSettingsV1 as unknown as typeof settingsDefaults.acpCatalogSettingsV1,
                }),
            },
        }),
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock(),
    projectionSeam: { describe: machineContributionRegistryProjectionDescribe },
});

vi.mock('@/components/ui/forms/SearchHeader', () => ({
    SearchHeader: () => null,
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/components/sessions/new/components/PathSelectionList', () => ({
    PathSelectionList: (props: any) => {
        capturedPathSelectionListProps = {
            ...props,
            selectedPath: props.initialValue,
            onSubmitSelectedPath: props.onCommit,
            machineBrowse: {
                enabled: true,
                machineId: props.machineId,
                serverId: props.serverId,
            },
        };
        return React.createElement('PathSelectionList', props);
    },
}));

vi.mock('@/utils/sessions/recentPaths', () => ({
    getRecentPathsForMachine: () => [],
}));

vi.mock('@/utils/navigation/safeRouterBack', () => ({
    safeRouterBack: (...args: any[]) => safeRouterBack(...args),
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 920 },
    useLayoutMaxWidth: () => 920,
    useLayoutMaxWidthStyle: () => ({ maxWidth: 920 }),
}));

describe('PathPickerScreen', () => {
    afterEach(() => {
        standardCleanup();
    });

    beforeEach(() => {
        vi.resetModules();
        capturedPathSelectionListProps = null;
        localSearchParams = {
            machineId: 'machine-1',
            selectedPath: '/repo/current',
        };
        settingsState.current = {
            lastUsedAgent: 'claude',
            lastUsedBackendTarget: null,
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: null,
        };
        paramListeners.clear();
        routerMock.setParams.mockReset();
        routerMock.replace.mockReset();
        routerMock.back.mockReset();
        safeRouterBack.mockReset();
        navigationMock.dispatch.mockReset();
        machineContributionRegistryProjectionDescribe.mockReset();
        machineContributionRegistryProjectionDescribe.mockResolvedValue({ supported: false, reason: 'not-supported' });
        navigationState = {
            index: 0,
            routes: [{ key: 'path-picker', name: '(app)/new/pick/path', path: '/new/pick/path' }],
        };
        navigationMock.getState = () => navigationState;
    });

    async function renderPathPicker() {
        const PathPickerScreen = (await import('@/app/(app)/new/pick/path')).default;
        const screen = await renderScreen(React.createElement(PathPickerScreen));
        return { PathPickerScreen, screen };
    }

    it('replaces to new session with path params when confirming without a previous route', async () => {
        await renderPathPicker();
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...BUNDLED_AGENT_ROUTE_PARAMS.claude,
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
            },
        });
        expect(routerMock.setParams).not.toHaveBeenCalled();
        expect(safeRouterBack).not.toHaveBeenCalled();
    });

    it('replaces back to /new instead of mutating a non-new previous route under the modal stack', async () => {
        navigationState = {
            index: 1,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };

        await renderPathPicker();

        await act(async () => {
            await Promise.resolve();
        });

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(navigationMock.dispatch).not.toHaveBeenCalled();
        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...BUNDLED_AGENT_ROUTE_PARAMS.claude,
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
            },
        });
        expect(safeRouterBack).not.toHaveBeenCalled();
    });

    it('preserves configured backend route params on replace fallback without reserializing the legacy customAcp agentType', async () => {
        localSearchParams = {
            agentType: 'customAcp',
            ...createConfiguredBackendRouteParams('review-bot'),
            machineId: 'machine-1',
            selectedPath: '/repo/current',
            spawnServerId: 'server-2',
        };
        navigationState = {
            index: 1,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };

        await renderPathPicker();

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(routerMock.replace).toHaveBeenCalledTimes(1);
        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...createConfiguredBackendRouteParams('review-bot'),
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
                spawnServerId: 'server-2',
            },
        });
    });

    it('falls back to the preferred built-in target when route params only carry legacy customAcp and no explicit backend target is stored', async () => {
        localSearchParams = {
            agentType: 'customAcp',
            machineId: 'machine-1',
            selectedPath: '/repo/current',
            spawnServerId: 'server-2',
        };
        settingsState.current = {
            lastUsedAgent: 'customAcp',
            lastUsedBackendTarget: null,
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: null,
        };
        navigationState = {
            index: 1,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };
        machineContributionRegistryProjectionDescribe.mockResolvedValue(createDiscoveredPluginBackendDescribeResult());

        await renderPathPicker();

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(machineContributionRegistryProjectionDescribe).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            serverId: 'server-2',
            accountLifetime: expect.objectContaining({
                scope: { serverId: 'server-2', accountId: 'account:server-2' },
            }),
        }));
        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...BUNDLED_AGENT_ROUTE_PARAMS.claude,
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
                spawnServerId: 'server-2',
            },
        });
    });

    it('rehydrates canonical configured backend params from settings when route params only carry legacy customAcp', async () => {
        settingsState.current = {
            lastUsedAgent: 'customAcp',
            lastUsedBackendTarget: { kind: 'backend', backendId: 'review-bot', configuredBackendId: 'review-bot', sourceKind: 'configured' },
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: null,
        };
        localSearchParams = {
            agentType: 'customAcp',
            machineId: 'machine-1',
            selectedPath: '/repo/current',
            spawnServerId: 'server-legacy',
        };
        navigationState = {
            index: 1,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };

        await renderPathPicker();

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...createConfiguredBackendRouteParams('review-bot'),
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
                spawnServerId: 'server-legacy',
            },
        });
    });

    it('falls back to the preferred built-in target when the stored configured backend is stale', async () => {
        settingsState.current = {
            lastUsedAgent: 'codex',
            lastUsedBackendTarget: { kind: 'backend', backendId: 'stale-review-bot', configuredBackendId: 'stale-review-bot', sourceKind: 'configured' },
            backendEnabledByTargetKey: { 'agent:codex': true },
            acpCatalogSettingsV1: createConfiguredAcpBackendCatalogSettings('review-bot'),
        };
        localSearchParams = {
            agentType: 'customAcp',
            machineId: 'machine-1',
            selectedPath: '/repo/current',
            spawnServerId: 'server-2',
        };
        navigationState = {
            index: 1,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };

        await renderPathPicker();

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(routerMock.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                ...BUNDLED_AGENT_ROUTE_PARAMS.codex,
                machineId: 'machine-1',
                directoryKind: 'path',
                directory: '/repo/selected',
                path: undefined,
                spawnServerId: 'server-2',
            },
        });
    });

    it('returns path updates to the actual /new screen instead of an intermediate picker route', async () => {
        navigationState = {
            index: 3,
            routes: [
                {
                    key: 'session-route',
                    name: '(app)/session/[id]',
                    path: '/session/s1',
                    params: { id: 's1' },
                },
                {
                    key: 'new-route',
                    name: '(app)/new/index',
                    path: '/new',
                    params: { machineId: 'machine-1' },
                },
                {
                    key: 'profile-picker',
                    name: '(app)/new/pick/profile',
                    path: '/new/pick/profile',
                    params: { profileId: 'profile-1' },
                },
                {
                    key: 'path-picker',
                    name: '(app)/new/pick/path',
                    path: '/new/pick/path',
                },
            ],
        };

        await renderPathPicker();

        expect(capturedPathSelectionListProps).toBeTruthy();

        await act(async () => {
            await capturedPathSelectionListProps?.onSubmitSelectedPath('/repo/selected');
        });

        expect(navigationMock.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            source: 'new-route',
            payload: expect.objectContaining({
                params: expect.objectContaining({
                    directory: '/repo/selected',
                }),
            }),
        }));
        expect(routerMock.replace).not.toHaveBeenCalled();
        expect(safeRouterBack).toHaveBeenCalled();
    });

    it('uses the direct-entry path query as a fallback selected path', async () => {
        localSearchParams = {
            machineId: 'machine-1',
            path: '/repo/direct-entry',
        };

        await renderPathPicker();

        expect(capturedPathSelectionListProps?.selectedPath).toBe('/repo/direct-entry');
    });

    it('updates the selected path when route params change after mount', async () => {
        await renderPathPicker();

        expect(capturedPathSelectionListProps?.selectedPath).toBe('/repo/current');

        localSearchParams = {
            machineId: 'machine-1',
            selectedPath: '/repo/updated',
        };

        act(() => {
            emitLocalSearchParamsChange();
        });

        expect(capturedPathSelectionListProps?.selectedPath).toBe('/repo/updated');
    });
});
