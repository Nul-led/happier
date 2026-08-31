import * as React from 'react';

import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState = {
    serverSelectionGroups: [
        { id: 'grp-one', name: 'Group One', serverIds: ['server-a'], presentation: 'grouped' },
    ] as any[],
    serverSelectionActiveTargetKind: 'group' as 'server' | 'group' | null,
    serverSelectionActiveTargetId: 'grp-one' as string | null,
};
const storageState = settingsState as Record<string, unknown>;
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
const modalAlertMock = vi.fn();
const modalConfirmMock = vi.fn(async () => false);
let activeServerId = 'server-a';
let activeServerSnapshot = { serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 };

function setActiveServerForTest(serverId: string) {
    activeServerId = serverId;
    activeServerSnapshot = { serverId, serverUrl: `https://${serverId}.example.test`, generation: 1 };
}

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
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: modalAlertMock,
                confirm: modalConfirmMock,
            },
        }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
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
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => activeServerSnapshot,
    listServerProfiles: () => [
        { id: 'server-a', name: 'A', serverUrl: 'https://a.example.test', lastUsedAt: 0 },
        { id: 'server-b', name: 'B', serverUrl: 'https://b.example.test', lastUsedAt: 0 },
    ],
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    getActiveServerId: () => activeServerId,
    getDeviceDefaultServerId: () => 'server-a',
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

vi.mock('@/sync/domains/server/selection/serverSelectionMutations', () => ({
    normalizeStoredServerSelectionGroups: (raw: unknown) => (Array.isArray(raw) ? raw : []),
    filterServerSelectionGroupsToAvailableServers: (profiles: any) => profiles,
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

describe('useServerSettingsScreenController', () => {
    it('uses explicit active server target kind/id when present', async () => {
        setActiveServerForTest('server-a');
        storageState.serverSelectionActiveTargetKind = 'group';
        storageState.serverSelectionActiveTargetId = 'grp-one';

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(value.activeTargetKey).toBe('group:grp-one');
    });

    it('keeps a valid explicit Home target when another Home is focused', async () => {
        setActiveServerForTest('server-b');
        storageState.serverSelectionActiveTargetKind = 'server';
        storageState.serverSelectionActiveTargetId = 'server-a';

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(value.activeTargetKey).toBe('server:server-a');
    });
});
