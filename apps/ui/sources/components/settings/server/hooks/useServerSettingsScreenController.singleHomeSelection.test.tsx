import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const storageState: Record<string, unknown> = {};
const homeViewState = {
    version: 1 as const,
    get groups() { return storageState.serverSelectionGroups as any[]; },
    get activeTargetKind() { return storageState.serverSelectionActiveTargetKind as 'server' | 'group' | null; },
    get activeTargetId() { return storageState.serverSelectionActiveTargetId as string | null; },
};
const useSettingMutableMock = ((key: string) => [
    storageState[key],
    (value: unknown) => {
        storageState[key] = value;
    },
]) as typeof import('@/sync/domains/state/storage')['useSettingMutable'];

const routerReplaceMock = vi.fn();
const activeServerSnapshot = { serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 } as const;

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: vi.fn(async () => {}) }),
}));

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
});

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    switchConnectionToActiveServer: vi.fn(async () => {}),
    getAppliedActiveServerSnapshot: () => activeServerSnapshot,
    isAppliedActiveServerRuntimeAvailable: () => true,
    subscribeAppliedActiveServer: () => () => {},
    subscribeAppliedActiveServerRuntimeAvailability: () => () => {},
    subscribeApplyingActiveServer: () => () => {},
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => activeServerSnapshot,
    listServerProfiles: () => ([
        { id: 'server-a', name: 'A', serverUrl: 'https://a.example.test', lastUsedAt: 0, createdAt: 0, updatedAt: 0 },
        { id: 'server-b', name: 'B', serverUrl: 'https://b.example.test', lastUsedAt: 0, createdAt: 0, updatedAt: 0 },
    ]),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    getActiveServerId: () => 'server-a',
    getDeviceDefaultServerId: () => 'server-a',
    getServerProfileById: (serverId: string) => ([
        { id: 'server-a', name: 'A', serverUrl: 'https://a.example.test', lastUsedAt: 0, createdAt: 0, updatedAt: 0 },
        { id: 'server-b', name: 'B', serverUrl: 'https://b.example.test', lastUsedAt: 0, createdAt: 0, updatedAt: 0 },
    ].find((profile) => profile.id === serverId) ?? null),
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    getTabActiveServerId: () => null,
    clearTabActiveServerId: vi.fn(),
    getResetToDefaultServerId: () => 'server-a',
    subscribeActiveServer: vi.fn(() => () => {}),
    getServerProfilesGeneration: () => 1,
    subscribeServerProfiles: vi.fn(() => () => {}),
    loadHomeViewState: () => homeViewState,
    subscribeHomeViewState: () => () => {},
    updateHomeViewState: vi.fn((update: (current: typeof homeViewState) => typeof homeViewState) => {
        const next = update(homeViewState);
        storageState.serverSelectionGroups = next.groups;
        storageState.serverSelectionActiveTargetKind = next.activeTargetKind;
        storageState.serverSelectionActiveTargetId = next.activeTargetId;
        return next;
    }),
    setActiveServerId: vi.fn(),
    upsertServerProfile: vi.fn(() => ({ id: 'server-a' })),
}));

vi.mock('@/sync/domains/server/serverConfig', () => ({
    validateServerUrl: () => ({ valid: true, error: null }),
}));

vi.mock('@/components/settings/server/hooks/useServerAuthStatusByServerId', () => ({
    useServerAuthStatusByServerId: () => ({}),
}));

vi.mock('@/components/settings/server/hooks/useServerAutoAddFromRoute', () => ({
    useServerAutoAddFromRoute: () => {},
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsServerProfileActions', () => ({
    useServerSettingsServerProfileActions: (params: {
        onSwitchServerById: (serverId: string) => Promise<unknown>;
    }) => ({
        onSwitchServer: async (profile: { id: string }) => {
            await params.onSwitchServerById(profile.id);
        },
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

describe('useServerSettingsScreenController single-Home selection', () => {
    beforeEach(() => {
        routerReplaceMock.mockReset();
        Object.keys(storageState).forEach((key) => delete storageState[key]);
        storageState.serverSelectionGroups = [
            { id: 'grp-b', name: 'Server B only', serverIds: ['server-b'], presentation: 'grouped' },
            { id: 'grp-ab', name: 'Servers A+B', serverIds: ['server-a', 'server-b'], presentation: 'grouped' },
        ];
        storageState.serverSelectionActiveTargetKind = 'server';
        storageState.serverSelectionActiveTargetId = 'server-a';
        vi.clearAllMocks();
    });

    afterEach(async () => {
        vi.resetModules();
    });

    it('selecting a Home leaves group mode through the canonical HomeView owner', async () => {
        storageState.serverSelectionActiveTargetKind = 'group';
        storageState.serverSelectionActiveTargetId = 'grp-ab';
        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let controller: any = null;
        function Probe() {
            controller = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            await controller.onSwitchServer({ id: 'server-a' });
        });

        expect(storageState.serverSelectionActiveTargetKind).toBe('server');
        expect(storageState.serverSelectionActiveTargetId).toBe('server-a');
        // Switching settles on the Homes page inside the settings layout, not the full-screen entry.
        expect(routerReplaceMock).toHaveBeenCalledWith('/settings/server');
        expect(routerReplaceMock).not.toHaveBeenCalledWith('/server');
    });
});
