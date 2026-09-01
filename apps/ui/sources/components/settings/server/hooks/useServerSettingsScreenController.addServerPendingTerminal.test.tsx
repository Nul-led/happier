import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ActiveServerSwitchResult } from '@/sync/domains/server/activeServerSwitch';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerReplaceMock = vi.fn();
const setActiveServerAndSwitchMock = vi.fn(
    async (): Promise<ActiveServerSwitchResult> => 'switched',
);
const refreshFromActiveServerMock = vi.fn(async () => {});
const createEndpointReadinessProbeMock = vi.hoisted(() => vi.fn(() => async () => ({ status: 'ready' as const })));
const pendingTerminalConnectMock = vi.hoisted(() => ({
    current: null as { publicKeyB64Url: string; serverUrl: string } | null,
    set: vi.fn((value: { publicKeyB64Url: string; serverUrl: string }) => {
        pendingTerminalConnectMock.current = value;
    }),
}));
const addedServerProfile = {
    id: 'server-correct',
    serverUrl: 'https://correct.example.test',
    name: 'Correct',
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: 0,
};

const settingsState = {
    serverSelectionGroups: [] as unknown[],
    serverSelectionActiveTargetKind: null as 'server' | 'group' | null,
    serverSelectionActiveTargetId: null as string | null,
};
const storageState = settingsState as Record<string, unknown>;
const useSettingMutableMock = ((key: string) => [
    storageState[key],
    (value: unknown) => {
        storageState[key] = value;
    },
]) as typeof import('@/sync/domains/state/storage')['useSettingMutable'];

installServerSettingsHooksCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { replace: routerReplaceMock },
            params: {},
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSettingMutable: useSettingMutableMock,
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: refreshFromActiveServerMock }),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => null),
    },
}));

vi.mock('@/sync/domains/pending/pendingTerminalConnect', () => ({
    getPendingTerminalConnect: () => pendingTerminalConnectMock.current,
    setPendingTerminalConnect: pendingTerminalConnectMock.set,
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: setActiveServerAndSwitchMock,
}));

vi.mock('@/sync/runtime/connectivity/createEndpointReadinessProbe', () => ({
    createEndpointReadinessProbe: (..._args: unknown[]) => createEndpointReadinessProbeMock(),
}));

vi.mock('@/components/settings/server/hooks/useEndpointReachabilityRemediationController', () => ({
    useEndpointReachabilityRemediationController: () => ({
        error: null,
        taskSnapshot: null,
        onAction: vi.fn(async () => {}),
    }),
}));

vi.mock('@/components/settings/server/useRelayDriftBanner', () => ({
    useRelayDriftBanner: () => null,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 }),
    listServerProfiles: () => [],
    getServerProfilesGeneration: () => 0,
    subscribeServerProfiles: () => () => {},
    subscribeActiveServer: () => () => {},
    loadHomeViewState: () => null,
    subscribeHomeViewState: () => () => {},
    getActiveServerId: () => 'server-a',
    getDeviceDefaultServerId: () => 'server-a',
    getTabActiveServerId: () => null,
    getResetToDefaultServerId: () => 'server-a',
    clearTabActiveServerId: vi.fn(),
    getServerProfileById: (serverId: string) =>
        serverId === addedServerProfile.id ? addedServerProfile : null,
    resolveServerProfileScopeId: (profile: { serverIdentityId?: string; id: string }) =>
        profile.serverIdentityId ?? profile.id,
    upsertServerProfile: vi.fn(() => addedServerProfile),
    adoptHomeProfile: vi.fn(async () => addedServerProfile),
    removeServerProfile: vi.fn(),
}));

vi.mock('@/sync/domains/server/serverConfig', () => ({
    validateServerUrl: () => ({ valid: true, error: null }),
}));

vi.mock('@/sync/domains/server/url/serverUrlClassification', () => ({
    isInsecureRemoteHttpServerUrl: () => false,
}));

vi.mock('@/sync/domains/server/selection/serverSelectionMutations', () => ({
    normalizeStoredServerSelectionGroups: (raw: unknown) => (Array.isArray(raw) ? raw : []),
    filterServerSelectionGroupsToAvailableServers: (profiles: unknown) => profiles,
}));

vi.mock('@/components/settings/server/hooks/useServerAuthStatusByServerId', () => ({
    useServerAuthStatusByServerId: () => ({}),
}));

vi.mock('@/components/settings/server/hooks/useServerAutoAddFromRoute', () => ({
    useServerAutoAddFromRoute: () => {},
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsServerProfileActions', () => ({
    useServerSettingsServerProfileActions: () => ({
        onSwitchServer: vi.fn(async () => {}),
        onRenameServer: vi.fn(async () => {}),
        onRemoveServer: vi.fn(async () => {}),
    }),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsGroupActions', () => ({
    useServerSettingsGroupActions: () => ({
        onSwitchGroup: vi.fn(async () => {}),
        onRenameGroup: vi.fn(async () => {}),
        onRemoveGroup: vi.fn(async () => {}),
        onCreateServerGroup: vi.fn(async () => false),
    }),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsConcurrentActions', () => ({
    useServerSettingsConcurrentActions: () => ({
        onTogglePresentation: vi.fn(),
        onToggleConcurrentServer: vi.fn(),
    }),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: vi.fn(async () => ({ status: 'error', reason: 'network' })),
}));

describe('useServerSettingsScreenController (add server pending terminal)', () => {
    afterEach(() => {
        routerReplaceMock.mockClear();
        setActiveServerAndSwitchMock.mockReset();
        setActiveServerAndSwitchMock.mockResolvedValue('switched');
        refreshFromActiveServerMock.mockClear();
        createEndpointReadinessProbeMock.mockClear();
        pendingTerminalConnectMock.current = null;
        pendingTerminalConnectMock.set.mockClear();
        storageState.serverSelectionGroups = [];
        storageState.serverSelectionActiveTargetKind = null;
        storageState.serverSelectionActiveTargetId = null;
        vi.resetModules();
    });

    it('adopts a signed-out Home without retargeting pending terminal state or changing focus', async () => {
        pendingTerminalConnectMock.current = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://wrong.example.test',
        };

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: ReturnType<typeof useServerSettingsScreenController> | null = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            value?.onChangeUrl('https://correct.example.test');
            value?.onChangeName('Correct');
        });

        await act(async () => {
            await value?.onAddServer();
        });

        expect(pendingTerminalConnectMock.set).not.toHaveBeenCalled();
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
        expect(storageState.serverSelectionActiveTargetKind).toBeNull();
        expect(storageState.serverSelectionActiveTargetId).toBeNull();
        expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it('does not enter the focus-custody path while adopting a Home', async () => {
        setActiveServerAndSwitchMock.mockResolvedValue('blocked');
        pendingTerminalConnectMock.current = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://active.example.test',
        };

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: ReturnType<typeof useServerSettingsScreenController> | null = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            value?.onChangeUrl('https://correct.example.test');
            value?.onChangeName('Correct');
        });
        await act(async () => {
            await value?.onAddServer();
        });

        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
        expect(pendingTerminalConnectMock.set).not.toHaveBeenCalled();
        expect(storageState.serverSelectionActiveTargetKind).toBeNull();
        expect(storageState.serverSelectionActiveTargetId).toBeNull();
        expect(routerReplaceMock).not.toHaveBeenCalled();
    });
});
