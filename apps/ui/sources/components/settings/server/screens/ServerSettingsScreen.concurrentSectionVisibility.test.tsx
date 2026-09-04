import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Genuine host-boundary mock: the shared desktop-host seam (Tauri/Electron command bridge) is
// outside the renderer's deterministic logic, so tests substitute it here instead of invoking a
// real shell. Every assertion still runs through the real Tauri task bridge, runner, and screen.
const desktopHostMock = vi.hoisted(() => ({
    invocations: [] as Array<Readonly<{ command: string; args: Record<string, unknown> | undefined }>>,
    kind: null as 'tauri' | 'electron' | null,
}));
const relocationInputs = vi.hoisted(() => ({
    remoteHosts: [] as unknown[],
}));
const rebuildHomeSearchIndex = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/sync/domains/memory/searchHomeMemory', () => ({ rebuildHomeSearchIndex }));

vi.mock('@/utils/platform/desktopHost', () => ({
    desktopHostKind: () => desktopHostMock.kind,
    isDesktopHost: () => desktopHostMock.kind !== null,
    invokeDesktopHost: async (command: string, args?: Record<string, unknown>) => {
        desktopHostMock.invocations.push({ command, args });
        if (command === 'start_system_task') {
            const spec = JSON.parse(String(args?.specJson ?? '{}')) as { kind?: string };
            return { taskId: `task_host:${spec.kind ?? 'unknown'}` };
        }
        if (command === 'get_system_task_snapshot') {
            const taskId = String(args?.taskId ?? '');
            if (taskId.includes('relay.runtime.uninstall.v1')) {
                return {
                    events: [],
                    result: { protocolVersion: 1, taskId, ok: true, data: { uninstalled: true } },
                };
            }
            return { events: [], result: null };
        }
        return undefined;
    },
    listenDesktopHostEvent: async () => async () => {},
}));

let controllerValue: any = null;

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            KeyboardAvoidingView: ({ children }: any) => React.createElement('KeyboardAvoidingView', null, children),
            Platform: {
                OS: 'ios',
                select: ({ ios, default: defaultValue }: any) => ios ?? defaultValue,
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock().module;
    },
    storage: async () => ({
        useSetting: () => relocationInputs.remoteHosts,
    }),
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {},
        });
    },
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children, ...props }: any) => React.createElement('ItemList', props, children),
}));

vi.mock('@/components/ui/keyboardAvoidance', () => ({
    KeyboardAwareScrollView: ({ children, ...props }: any) =>
        React.createElement('KeyboardAwareScrollView', props, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/settings/server/sections/SavedServersSection', () => ({
    SavedServersSection: (props: any) => React.createElement('SavedServersSection', props),
}));

vi.mock('@/components/settings/server/sections/ServerRetentionSection', () => ({
    ServerRetentionSection: (props: any) => React.createElement('ServerRetentionSection', props),
}));

vi.mock('@/components/settings/server/sections/AddTargetsSection', () => ({
    AddTargetsSection: (props: any) => React.createElement('AddTargetsSection', props),
}));

vi.mock('@/components/settings/server/sections/ServerGroupsSection', () => ({
    ServerGroupsSection: (props: any) => React.createElement('ServerGroupsSection', props),
}));
vi.mock('@/components/settings/server/sections/HomeDeviceApprovalSection', () => ({
    HomeDeviceApprovalSection: (props: any) => React.createElement('HomeDeviceApprovalSection', props),
}));

vi.mock('@/components/settings/server/RelayDriftActionCard', () => ({
    RelayDriftActionCard: (props: any) => React.createElement('RelayDriftActionCard', props),
}));

vi.mock('@/components/settings/server/localControl/LocalRelayRuntimeControlSection', () => ({
    LocalRelayRuntimeControlSection: (props: any) => React.createElement('LocalRelayRuntimeControlSection', props),
}));
vi.mock('@/components/settings/server/localControl/PersonalHomeRuntimeControlSection', () => ({
    PersonalHomeRuntimeControlSection: (props: any) => React.createElement('PersonalHomeRuntimeControlSection', props),
}));
vi.mock('@/components/settings/server/localControl/LocalRelayAccessControlSection', () => ({
    LocalRelayAccessControlSection: (props: any) => React.createElement('LocalRelayAccessControlSection', props),
}));

vi.mock('@/components/settings/server/hooks/useServerSettingsScreenController', () => ({
    useServerSettingsScreenController: () => controllerValue,
}));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/serverFeaturesClient')>(),
    probeServerFeaturesAtUrl: async () => ({ status: 'failed' }),
}));

function setController(overrides: Partial<any>) {
    controllerValue = {
        screenOptions: { headerShown: true, headerTitle: 'Relay settings', headerBackTitle: 'Back' },
        servers: [],
        serverGroups: [],
        activeServerId: 'server-a',
        activeServerUrl: '',
        activeLocalRelayUrl: null,
        deviceDefaultServerId: 'server-a',
        activeTargetKey: null,
        authStatusByServerId: {},
        relayDriftBanner: null,

        autoMode: false,
        inputUrl: '',
        inputName: '',
        error: null,
        isValidating: false,
        onChangeUrl: vi.fn(),
        onChangeName: vi.fn(),
        onResetServer: vi.fn(),
        onAddServer: vi.fn(),

        onSwitchServer: vi.fn(),
        onSwitchGroup: vi.fn(),
        onRenameServer: vi.fn(),
        onRemoveServer: vi.fn(),
        onRenameGroup: vi.fn(),
        onRemoveGroup: vi.fn(),
        onCreateServerGroup: vi.fn(async () => false),

        groupSelectionPresentation: 'grouped',
        activeServerGroupId: null,
        selectedGroupServerIds: new Set<string>(),
        onToggleGroupPresentation: vi.fn(),
        onToggleGroupServer: vi.fn(),

        ...overrides,
    };
}

describe('ServerSettingsScreen (concurrent section visibility)', () => {
    beforeEach(() => {
        desktopHostMock.kind = null;
        desktopHostMock.invocations.length = 0;
        relocationInputs.remoteHosts = [];
        rebuildHomeSearchIndex.mockClear();
    });
    it('hides concurrent multi-relay settings when there are no relay groups', async () => {
        setController({ serverGroups: [] });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('KeyboardAwareScrollView' as any)).toHaveLength(1);
        expect(screen.findAllByType('KeyboardAvoidingView' as any)).toHaveLength(0);
        expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(0);
    });

    it('hides group membership settings while a single Home is selected', async () => {
        setController({
            serverGroups: [{ id: 'grp-one', name: 'Group One', serverIds: ['server-a'], presentation: 'grouped' }],
            activeServerGroupId: null,
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(0);
    });

    it('shows group membership settings only while a group is selected', async () => {
        setController({
            serverGroups: [{ id: 'grp-one', name: 'Group One', serverIds: ['server-a'], presentation: 'grouped' }],
            activeServerGroupId: 'grp-one',
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('ServerGroupsSection' as any)).toHaveLength(1);
    });

    it('shows the relay drift banner when the controller reports drift', async () => {
        setController({
            relayDriftBanner: {
                kind: 'warning',
                title: 'relay.banner.title',
                description: 'relay.banner.description',
                actionLabel: 'relay.banner.action',
            },
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        const banners = screen.findAllByType('RelayDriftActionCard' as any);
        expect(banners).toHaveLength(0);

        const notice = screen.findByTestId('settings.server.relayDrift.readOnlyNotice');
        expect(notice?.props.subtitle).toBe('relay.banner.description');
    });

    it('shows the local relay control surfaces on the Relay settings screen', async () => {
        setController({ relayDriftBanner: null });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(0);
        expect(screen.findAllByType('LocalRelayAccessControlSection' as any)).toHaveLength(0);
        expect(screen.findByTestId('settings.server.localControl.desktopOnlyNotice')).toBeTruthy();
    });

    it('does not render the standalone Tailscale secure-access section on the Relay settings screen', async () => {
        desktopHostMock.kind = 'tauri';
        const previousTauriInternals = (globalThis as any).__TAURI_INTERNALS__;
        (globalThis as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
        setController({
            relayDriftBanner: null,
            activeServerUrl: 'https://relay.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:4555',
        });

        try {
            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

            const screen = await renderScreen(React.createElement(ServerSettingsScreen));

            expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(1);
            expect(screen.findAllByType('LocalRelayAccessControlSection' as any)).toHaveLength(1);
        } finally {
            if (previousTauriInternals === undefined) delete (globalThis as any).__TAURI_INTERNALS__;
            else (globalThis as any).__TAURI_INTERNALS__ = previousTauriInternals;
        }
    });

    it('does not expose local host controls from the Electron renderer', async () => {
        desktopHostMock.kind = 'electron';
        setController({
            servers: [{
                id: 'home-electron', name: 'Personal Home', url: 'http://127.0.0.1:43123',
                source: 'desktop-personal-home', serverIdentityId: 'srv_home_electron', personalHomeBootstrapCompleted: true,
            }],
        });
        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
        const screen = await renderScreen(React.createElement(ServerSettingsScreen));
        expect(screen.findAllByType('PersonalHomeRuntimeControlSection' as any)).toHaveLength(0);
        expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(0);
    });

    it('supplies the full production Personal Home operations contract through existing canonical bridges', async () => {
        desktopHostMock.kind = 'tauri';
        const onRemoveServer = vi.fn(async (..._removedProfiles: unknown[]) => {});
        const personalHomeProfile = {
            id: 'home-1',
            name: 'Personal Home',
            url: 'http://127.0.0.1:43123',
            source: 'desktop-personal-home',
            serverIdentityId: 'srv_personal_home_1',
            personalHomeBootstrapCompleted: true as const,
        };
        setController({
            relayDriftBanner: null,
            servers: [personalHomeProfile],
            activeServerId: 'home-1',
            onRemoveServer,
        });
        desktopHostMock.invocations.length = 0;

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));
        const sections = screen.findAllByType('PersonalHomeRuntimeControlSection' as any);
        expect(sections).toHaveLength(1);
        const operations = sections[0].props.operations;

        // Every Settings capability is a real production callback, not an optional prop
        // that only exists inside a component test.
        expect(typeof operations.removeProfile).toBe('function');
        expect(typeof operations.uninstallRuntime).toBe('function');
        expect(typeof operations.openDataLocation).toBe('function');
        expect(typeof operations.openLogs).toBe('function');
        expect(typeof operations.revealBackupOutput).toBe('function');
        expect(typeof operations.selectBackupArchive).toBe('function');
        expect(typeof operations.selectBackupExportDestination).toBe('function');

        expect(sections[0].props).not.toHaveProperty('searchReadiness');

        // Safe uninstall goes through the canonical system-task bridge.
        await operations.uninstallRuntime();
        const startCalls = desktopHostMock.invocations.filter((entry) => entry.command === 'start_system_task');
        expect(startCalls).toHaveLength(1);
        expect(String(startCalls[0]?.args?.specJson)).toContain('relay.runtime.uninstall.v1');

        // Path opening goes through the existing contained desktop-host bridge.
        await operations.openDataLocation('/home/.happier/self-host/data');
        await operations.openLogs('/home/.happier/self-host/logs');
        await operations.revealBackupOutput('/mnt/external-backups/personal-home-x.tar');
        await operations.selectBackupArchive();
        await operations.selectBackupExportDestination();
        const openCalls = desktopHostMock.invocations.filter((entry) => entry.command === 'system_tasks_open_log_path');
        expect(openCalls.map((entry) => entry.args?.path)).toEqual([
            '/home/.happier/self-host/data',
            '/home/.happier/self-host/logs',
        ]);
        const revealCalls = desktopHostMock.invocations.filter((entry) => entry.command === 'system_tasks_reveal_output_path');
        expect(revealCalls.map((entry) => entry.args?.path)).toEqual([
            '/mnt/external-backups/personal-home-x.tar',
        ]);
        expect(desktopHostMock.invocations.filter((entry) => entry.command === 'desktop_pick_personal_home_backup_archive')).toHaveLength(1);
        expect(desktopHostMock.invocations.filter((entry) => entry.command === 'desktop_save_personal_home_backup_archive')).toHaveLength(1);
    });

    it('keeps an eligible managed SSH relocation destination available without Account Directory publication', async () => {
        desktopHostMock.kind = 'tauri';
        relocationInputs.remoteHosts = [{
            id: 'managed-host-1',
            name: 'Home server',
            ssh: { target: 'ops@destination.example.test', authMode: 'agent' },
            createdAt: 1,
            updatedAt: 1,
            lastUsedAt: null,
        }];
        setController({
            relayDriftBanner: null,
            servers: [{
                id: 'home-1',
                name: 'Personal Home',
                url: 'http://127.0.0.1:43123',
                source: 'desktop-personal-home',
                serverIdentityId: 'srv_personal_home_1',
                personalHomeBootstrapCompleted: true,
            }],
            activeServerId: 'home-1',
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
        const screen = await renderScreen(React.createElement(ServerSettingsScreen));
        const section = screen.findAllByType('PersonalHomeRuntimeControlSection' as any)[0];

        expect(section?.props.operations.relocation.destinations).toEqual([{
            id: 'managed-host-1',
            title: 'Home server',
            subtitle: 'ops@destination.example.test',
        }]);
    });

    it('does not expose managed Personal Home controls from mutable adoption provenance alone', async () => {
        desktopHostMock.kind = 'tauri';
        setController({
            relayDriftBanner: null,
            servers: [{
                id: 'ordinary-home',
                name: 'Ordinary Home',
                url: 'https://ordinary.example.test',
                source: 'desktop-personal-home',
                serverIdentityId: 'ordinary-home-identity',
            }],
            activeServerId: 'ordinary-home',
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findAllByType('PersonalHomeRuntimeControlSection' as any)).toHaveLength(0);
    });

    it('finds the managed Personal Home independent of focus and never changes focus', async () => {
        desktopHostMock.kind = 'tauri';
        const previousTauriInternals = (globalThis as any).__TAURI_INTERNALS__;
        (globalThis as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
        const onRemoveServer = vi.fn(async (..._removedProfiles: unknown[]) => {});
        const onSwitchServer = vi.fn(async (..._switchedServers: unknown[]) => {});
        const personalHomeProfile = {
            id: 'home-1',
            name: 'Personal Home',
            url: 'http://127.0.0.1:43123',
            source: 'desktop-personal-home',
            serverIdentityId: 'srv_personal_home_1',
            personalHomeBootstrapCompleted: true as const,
        };
        setController({
            relayDriftBanner: null,
            servers: [
                { id: 'server-a', name: 'Cloud', url: 'https://relay.example.test', source: 'manual' },
                personalHomeProfile,
            ],
            activeServerId: 'server-a',
            deviceDefaultServerId: 'server-a',
            onRemoveServer,
            onSwitchServer,
        });

        try {
            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

            const screen = await renderScreen(React.createElement(ServerSettingsScreen));

            // The focused profile is the generic server, yet the managed Home section is found.
            const sections = screen.findAllByType('PersonalHomeRuntimeControlSection' as any);
            expect(sections).toHaveLength(1);
            expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(0);
            expect(sections[0].props.operations.repairSearch).toEqual(expect.any(Function));
            await sections[0].props.operations.repairSearch();
            expect(rebuildHomeSearchIndex).toHaveBeenCalledWith({ serverId: 'srv_personal_home_1' });

            // Rendering the Personal Home section never switches the focused Home.
            expect(onSwitchServer).not.toHaveBeenCalled();

            // Profile removal targets the discovered Home profile through the existing owner.
            await sections[0].props.operations.removeProfile();
            expect(onRemoveServer).toHaveBeenCalledTimes(1);
            expect(onRemoveServer.mock.calls[0][0]).toMatchObject({ id: 'home-1' });
        } finally {
            if (previousTauriInternals === undefined) delete (globalThis as any).__TAURI_INTERNALS__;
            else (globalThis as any).__TAURI_INTERNALS__ = previousTauriInternals;
        }
    });

    it('keeps secure-access local control desktop-only even when a known local relay alias exists', async () => {
        setController({
            activeServerUrl: 'https://relay.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:4555',
            relayDriftBanner: null,
        });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));

        expect(screen.findByTestId('settings.server.localControl.desktopOnlyNotice')).toBeTruthy();
    });

    it('hides local relay control surfaces when setup surface policy denies local relay host (desktop)', async () => {
        desktopHostMock.kind = 'tauri';
        const previousDeny = process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
        process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = 'setup.relay.allowLocalRelayHost';
        (globalThis as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
        try {
            setController({ relayDriftBanner: null });

            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
            const screen = await renderScreen(React.createElement(ServerSettingsScreen));

            expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(0);
            expect(screen.findAllByType('LocalRelayAccessControlSection' as any)).toHaveLength(0);
        } finally {
            delete (globalThis as any).__TAURI_INTERNALS__;
            if (previousDeny === undefined) delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
            else process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = previousDeny;
        }
    });

    it('hides the local Tailscale surface when setup surface policy denies it (desktop)', async () => {
        desktopHostMock.kind = 'tauri';
        const previousDeny = process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
        process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = 'setup.relayAccess.allowTailscale';
        (globalThis as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
        try {
            setController({ relayDriftBanner: null });

            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
            const screen = await renderScreen(React.createElement(ServerSettingsScreen));

            expect(screen.findAllByType('LocalRelayRuntimeControlSection' as any)).toHaveLength(1);
            expect(screen.findAllByType('LocalRelayAccessControlSection' as any)).toHaveLength(1);
        } finally {
            delete (globalThis as any).__TAURI_INTERNALS__;
            if (previousDeny === undefined) delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
            else process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = previousDeny;
        }
    });

    it('hides relay selection/setup surfaces when setup surface policy denies relay selection', async () => {
        const previousDeny = process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
        process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = 'setup.relay.allowRelaySelection';
        try {
            setController({ relayDriftBanner: null });

            const { ServerSettingsScreen } = await import('./ServerSettingsScreen');
            const screen = await renderScreen(React.createElement(ServerSettingsScreen));

            expect(screen.findByTestId('settings.server.openSetupWizard')).toBeNull();
            expect(screen.findAllByType('AddTargetsSection' as any)).toHaveLength(0);
        } finally {
            if (previousDeny === undefined) delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
            else process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = previousDeny;
        }
    });

    it('keeps relay form actions tappable while the keyboard is open', async () => {
        setController({ relayDriftBanner: null });

        const { ServerSettingsScreen } = await import('./ServerSettingsScreen');

        const screen = await renderScreen(React.createElement(ServerSettingsScreen));
        const itemList = screen.findByType('KeyboardAwareScrollView' as any);

        expect(itemList.props.keyboardShouldPersistTaps).toBe('handled');
        expect(itemList.props.keyboardDismissMode).toBe('interactive');
        expect(itemList.props.automaticallyAdjustKeyboardInsets).toBe(true);
    });
});
