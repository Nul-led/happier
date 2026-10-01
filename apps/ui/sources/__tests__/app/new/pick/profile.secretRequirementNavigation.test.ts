import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import {
    flushHookEffects,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import {
    BUNDLED_AGENT_ROUTE_PARAMS,
    createConfiguredAcpBackendCatalogSettings,
    createConfiguredBackendRouteParams,
    createDiscoveredPluginBackendDescribeResult,
    createNavigationMock,
    createProjectionDescribeMock,
    createRouterMock,
    enableReactActEnvironment,
    installPickerCommonModuleMocks,
    PICKER_THEME_COLORS,
    PICKER_NAV_STATE,
} from './testHarness';
import {
    captureProfilesListProps,
    createMissingRequiredSecretScenario,
    getCapturedProfilePressHandler,
    getProfileSecretRequirementSetting,
    profileSecretRequirementModalMock,
    resetProfileSecretRequirementHarness,
    useProfileSecretRequirementSettingMutable,
} from './profileSecretRequirementTestHarness';
import type { ProfilesListProps } from '@/components/profiles/ProfilesList';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import type { BackendTargetRefV2 } from '@happier-dev/protocol';

enableReactActEnvironment();

const missingRequiredSecretScenario = createMissingRequiredSecretScenario();
const routerMock = createRouterMock();
const navigationMock = createNavigationMock();
const routeParamsState = {
    value: {
        selectedId: '',
        dataId: 'draft-1',
        machineId: 'm1',
        agentType: 'customAcp',
        ...createConfiguredBackendRouteParams('review-bot'),
        spawnServerId: 'server-2',
    } as Record<string, string>,
};
const settingsState = {
    current: {
        lastUsedAgent: 'customAcp',
        lastUsedBackendTarget: null as BackendTargetRefV2 | null,
        backendEnabledByTargetKey: null as Record<string, boolean> | null,
        acpCatalogSettingsV1: null as unknown,
    },
};
const machineContributionRegistryProjectionDescribe = createProjectionDescribeMock();

installPickerCommonModuleMocks({
    reactNative: async () =>
        (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({
            Platform: { OS: 'ios' },
        }),
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock(),
    unistyles: async () =>
        (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock({
            theme: { colors: PICKER_THEME_COLORS },
        }),
    expoRouter: async () =>
        ({
            ...(await import('@/dev/testkit/mocks/router')).createExpoRouterMock({
                navigation: navigationMock,
                params: () => routeParamsState.value,
                router: {
                    push: routerMock.push,
                    back: routerMock.back,
                    replace: routerMock.replace,
                    setParams: routerMock.setParams,
                },
            }).module,
            useNavigation: () => navigationMock,
        }),
    modal: async () => profileSecretRequirementModalMock.module,
    storage: async () =>
        (await import('@/dev/testkit/mocks/storage')).createStorageModuleStub({
            useSetting: getProfileSecretRequirementSetting,
            useSettingMutable: useProfileSecretRequirementSettingMutable,
            useSettings: () => ({
                ...settingsDefaults,
                lastUsedAgent: settingsState.current.lastUsedAgent,
                lastUsedBackendTarget: settingsState.current.lastUsedBackendTarget,
                backendEnabledByTargetKey:
                    settingsState.current.backendEnabledByTargetKey as typeof settingsDefaults.backendEnabledByTargetKey,
                acpCatalogSettingsV1:
                    settingsState.current.acpCatalogSettingsV1 as typeof settingsDefaults.acpCatalogSettingsV1,
            }),
        }),
    projectionSeam: { describe: machineContributionRegistryProjectionDescribe },
    tempDataStore: {
        storeTempData: () => 'temp',
        getTempData: () => null,
    },
});

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: React.PropsWithChildren<Record<string, never>>) =>
        React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: () => null,
}));

vi.mock('@/components/profiles/ProfilesList', () => ({
    ProfilesList: (props: ProfilesListProps) => {
        captureProfilesListProps({
            onPressProfile: props.onPressProfile,
            onEditProfile: props.onEditProfile,
            onAddProfilePress: props.onAddProfilePress,
            onDuplicateProfile: props.onDuplicateProfile,
        });
        return null;
    },
}));

vi.mock('@/sync/domains/profiles/profileSecrets', () => ({
    getRequiredSecretEnvVarNames: () => [...missingRequiredSecretScenario.secretEnvVarNames],
}));

vi.mock('@/sync/ops', () => ({
    machinePreviewEnv: vi.fn(async () => ({ supported: false })),
}));

vi.mock('@/sync/domains/profiles/profileCompatibility', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/profiles/profileCompatibility')>();
    return {
        ...actual,
        getProfileEnvironmentVariables: () => ({}),
    };
});

vi.mock('@/utils/secrets/secretSatisfaction', () => ({
    getSecretSatisfaction: () => ({
        isSatisfied: false,
        items: [
            {
                envVarName: missingRequiredSecretScenario.secretEnvVarName,
                required: true,
                isSatisfied: false,
            },
        ],
    }),
}));

vi.mock('@/hooks/machine/useMachineEnvPresence', () => ({
    useMachineEnvPresence: () => ({ isLoading: false, isPreviewEnvSupported: false, meta: {} }),
}));

vi.mock('@/components/secrets/requirements', () => ({
    SecretRequirementModal: () => null,
}));

describe('ProfilePickerScreen (native secret requirement)', () => {
    afterEach(() => {
        standardCleanup();
        vi.resetModules();
    });

    it('navigates to the secret requirement screen when required secrets are missing', async () => {
        routeParamsState.value = {
            selectedId: '',
            dataId: 'draft-1',
            machineId: 'm1',
            agentType: 'customAcp',
            ...createConfiguredBackendRouteParams('review-bot'),
            spawnServerId: 'server-2',
        };
        settingsState.current = {
            lastUsedAgent: 'customAcp',
            lastUsedBackendTarget: null,
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: null,
        };

        resetProfileSecretRequirementHarness();
        routerMock.push.mockClear();
        machineContributionRegistryProjectionDescribe.mockReset();
        machineContributionRegistryProjectionDescribe.mockResolvedValue({ supported: false, reason: 'not-supported' });
        navigationMock.getState = () => ({
            index: PICKER_NAV_STATE.index,
            routes: PICKER_NAV_STATE.routes.map((route) => ({ key: route.key })),
        });

        const ProfilePickerScreen = (await import('@/app/(app)/new/pick/profile')).default;
        await renderScreen(React.createElement(ProfilePickerScreen));
        await flushHookEffects({ cycles: 1, turns: 2 });

        const onPressProfile = getCapturedProfilePressHandler();

        await act(async () => {
            await onPressProfile(missingRequiredSecretScenario.profile);
        });

        expect(profileSecretRequirementModalMock.spies.show).not.toHaveBeenCalled();
        expect(routerMock.push).toHaveBeenCalledTimes(1);
        expect(routerMock.push).toHaveBeenCalledWith({
            pathname: '/new/pick/secret-requirement',
            params: expect.objectContaining({
                backendTarget: expect.stringContaining('"review-bot"'),
                backendTargetKey: expect.stringContaining('review-bot'),
                dataId: 'draft-1',
                profileId: 'deepseek',
                machineId: 'm1',
                secretEnvVarName: missingRequiredSecretScenario.secretEnvVarName,
                secretEnvVarNames: missingRequiredSecretScenario.secretEnvVarNames.join(','),
                revertOnCancel: '0',
                spawnServerId: 'server-2',
            }),
        });
    });

    it('rehydrates configured backend params for secret requirement navigation when the route only carries legacy customAcp', async () => {
        routeParamsState.value = {
            selectedId: '',
            dataId: 'draft-1',
            machineId: 'm1',
            agentType: 'customAcp',
            spawnServerId: 'server-2',
        };
        settingsState.current = {
            lastUsedAgent: 'customAcp',
            lastUsedBackendTarget: { kind: 'backend', backendId: 'review-bot', configuredBackendId: 'review-bot', sourceKind: 'configured' },
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: createConfiguredAcpBackendCatalogSettings('review-bot'),
        };

        resetProfileSecretRequirementHarness();
        routerMock.push.mockClear();
        navigationMock.getState = () => ({
            index: PICKER_NAV_STATE.index,
            routes: PICKER_NAV_STATE.routes.map((route) => ({ key: route.key })),
        });

        const ProfilePickerScreen = (await import('@/app/(app)/new/pick/profile')).default;
        await renderScreen(React.createElement(ProfilePickerScreen));

        const onPressProfile = getCapturedProfilePressHandler();

        await act(async () => {
            await onPressProfile(missingRequiredSecretScenario.profile);
        });

        expect(routerMock.push).toHaveBeenCalledWith({
            pathname: '/new/pick/secret-requirement',
            params: expect.objectContaining({
                ...createConfiguredBackendRouteParams('review-bot'),
                dataId: 'draft-1',
                machineId: 'm1',
                spawnServerId: 'server-2',
            }),
        });
    });

    it('falls back to the preferred built-in target when route params only carry legacy customAcp and no explicit backend target is stored', async () => {
        routeParamsState.value = {
            selectedId: '',
            dataId: 'draft-1',
            machineId: 'm1',
            agentType: 'customAcp',
            spawnServerId: 'server-2',
        };
        settingsState.current = {
            lastUsedAgent: 'customAcp',
            lastUsedBackendTarget: null,
            backendEnabledByTargetKey: null,
            acpCatalogSettingsV1: null,
        };
        machineContributionRegistryProjectionDescribe.mockReset();
        machineContributionRegistryProjectionDescribe.mockResolvedValue(createDiscoveredPluginBackendDescribeResult());

        resetProfileSecretRequirementHarness();
        routerMock.push.mockClear();
        navigationMock.getState = () => ({
            index: PICKER_NAV_STATE.index,
            routes: PICKER_NAV_STATE.routes.map((route) => ({ key: route.key })),
        });

        const ProfilePickerScreen = (await import('@/app/(app)/new/pick/profile')).default;
        await renderScreen(React.createElement(ProfilePickerScreen));

        const onPressProfile = getCapturedProfilePressHandler();

        await act(async () => {
            await onPressProfile(missingRequiredSecretScenario.profile);
        });

        expect(machineContributionRegistryProjectionDescribe).toHaveBeenCalledWith('m1', expect.objectContaining({
            serverId: 'server-2',
            timeoutMs: 10_000,
        }));
        expect(routerMock.push).toHaveBeenCalledWith({
            pathname: '/new/pick/secret-requirement',
            params: expect.objectContaining({
                ...BUNDLED_AGENT_ROUTE_PARAMS.claude,
                dataId: 'draft-1',
                machineId: 'm1',
                spawnServerId: 'server-2',
            }),
        });
        const pushedRoute = routerMock.push.mock.calls[0]?.[0];
        if (typeof pushedRoute !== 'object' || pushedRoute === null || !('params' in pushedRoute)) {
            throw new Error('Expected secret requirement navigation to include route params');
        }
        const pushedParams = pushedRoute.params;
        if (typeof pushedParams !== 'object' || pushedParams === null) {
            throw new Error('Expected secret requirement navigation params to be an object');
        }
        expect('agentType' in pushedParams ? pushedParams.agentType : undefined).toBeUndefined();
    });
});
