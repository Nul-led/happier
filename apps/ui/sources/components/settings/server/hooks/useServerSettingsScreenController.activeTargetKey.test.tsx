import * as React from 'react';

import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState = vi.hoisted(() => ({
    serverSelectionGroups: [
        { id: 'grp-one', name: 'Group One', serverIds: ['server-a'], presentation: 'grouped' },
    ] as any[],
    serverSelectionActiveTargetKind: 'group' as 'server' | 'group' | null,
    serverSelectionActiveTargetId: 'grp-one' as string | null,
}));
const storageState = settingsState as Record<string, unknown>;
const homeViewState = vi.hoisted(() => ({
    version: 1 as const,
    get groups() { return settingsState.serverSelectionGroups as any[]; },
    get activeTargetKind() { return settingsState.serverSelectionActiveTargetKind as 'server' | 'group' | null; },
    get activeTargetId() { return settingsState.serverSelectionActiveTargetId as string | null; },
}));
const useSettingMutableMock = ((key: string) => [
    storageState[key],
    (value: unknown) => {
        storageState[key] = value;
    },
]) as typeof import('@/sync/domains/state/storage')['useSettingMutable'];

const routerReplaceMock = vi.fn();
const modalAlertMock = vi.fn();
const modalConfirmMock = vi.fn(async () => false);
const activeServerState = vi.hoisted(() => ({
    id: 'server-a',
    snapshot: { serverId: 'server-a', serverUrl: 'https://a.example.test', generation: 1 },
}));

function setActiveServerForTest(serverId: string) {
    activeServerState.id = serverId;
    activeServerState.snapshot = { serverId, serverUrl: `https://${serverId}.example.test`, generation: 1 };
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

vi.mock('@/sync/runtime/orchestration/connectionManager', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/connectionManager')>(),
    switchConnectionToActiveServer: vi.fn(async () => {}),
    getAppliedActiveServerSnapshot: () => activeServerState.snapshot,
    isAppliedActiveServerRuntimeAvailable: () => true,
    subscribeAppliedActiveServer: () => () => {},
    subscribeApplyingActiveServer: () => () => {},
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getActiveServerSnapshot: () => activeServerState.snapshot,
    listServerProfiles: () => [
        { id: 'server-a', name: 'A', serverUrl: 'https://a.example.test', lastUsedAt: 0 },
        { id: 'server-b', name: 'B', serverUrl: 'https://b.example.test', lastUsedAt: 0 },
    ],
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    getActiveServerId: () => activeServerState.id,
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

    it('keeps an explicit All Homes selection rather than treating it as a stale group', async () => {
        setActiveServerForTest('server-a');
        storageState.serverSelectionGroups = [];
        storageState.serverSelectionActiveTargetKind = 'group';
        storageState.serverSelectionActiveTargetId = '@all-homes';

        const { useServerSettingsScreenController } = await import('./useServerSettingsScreenController');

        let value: any = null;
        function Probe() {
            value = useServerSettingsScreenController();
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect(value.activeTargetKey).toBe('group:@all-homes');
        expect(storageState.serverSelectionActiveTargetKind).toBe('group');
        expect(storageState.serverSelectionActiveTargetId).toBe('@all-homes');
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
