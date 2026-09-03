import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installConnectionStatusControlCommonModuleMocks } from './connectionStatusControlTestHelpers';


(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

type PopoverCaptureProps = {
    open?: boolean;
    portal?: {
        web?: boolean;
        native?: boolean;
        matchAnchorWidth?: boolean;
    };
    maxWidthCap?: number;
    children?: ((params: { maxHeight: number }) => React.ReactNode) | React.ReactNode;
};

type ActionLike = {
    id?: unknown;
    label?: unknown;
    subtitle?: unknown;
    accessibilityLabel?: unknown;
    icon?: unknown;
    onPress?: () => void;
};
type ActionListSectionProps = {
    actions?: ActionLike[];
};

type DropdownMenuCaptureProps = {
    items?: Array<{ id?: string; title?: string; subtitle?: string }>;
    selectedId?: string | null;
    matchTriggerWidth?: boolean;
    maxWidthCap?: number;
    overlayStyle?: unknown;
    itemTrigger?: { title?: string; subtitle?: string };
    onSelect?: (itemId: string) => void;
};

const capture = vi.hoisted(() => ({
    popoverProps: null as PopoverCaptureProps | null,
    actionSections: [] as ActionListSectionProps[],
    dropdownMenuProps: [] as DropdownMenuCaptureProps[],
    reset() {
        this.popoverProps = null;
        this.actionSections = [];
        this.dropdownMenuProps = [];
    },
}));

const authMocks = vi.hoisted(() => ({
    refreshFromActiveServer: vi.fn(async () => {}),
}));

const connectionMocks = vi.hoisted(() => ({
    switchConnectionToActiveServer: vi.fn(async (_params?: unknown): Promise<unknown> => null),
    retryActiveServerConnection: vi.fn(async () => undefined),
    appliedServerId: '',
    appliedListeners: new Set<() => void>(),
}));

const modalMocks = vi.hoisted(() => ({
    confirm: vi.fn(async () => true),
}));

const tokenStorageMock = vi.hoisted(() => ({
    getCredentialsForServerUrl: vi.fn<(serverUrl: string) => Promise<{ token: string; secret: string } | null>>(
        async () => ({ token: 'scoped-token', secret: 'scoped-secret' })
    ),
    readPendingExternalAuthState: vi.fn(async () => ({ value: null, serverMismatch: false })),
    readPendingExternalAuthStateForServerUrl: vi.fn(async () => ({ value: null, serverMismatch: false })),
}));

const routerMocks = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
}));

const syncMocks = vi.hoisted(() => ({
    retryNow: vi.fn(),
}));

const irohDiagnosticsState = vi.hoisted(() => ({
    values: [] as Array<Record<string, unknown>>,
    listeners: new Set<() => void>(),
}));

const clipboardMock = vi.hoisted(() => ({
    setClipboardStringSafe: vi.fn(async (_value: string) => true),
}));

const settingsState = vi.hoisted(() => ({
    serverSelectionGroups: [] as Array<{ id: string; name: string; serverIds: string[]; presentation: 'grouped' | 'flat-with-badge' }>,
    serverSelectionActiveTargetKind: null as 'server' | 'group' | null,
    serverSelectionActiveTargetId: null as string | null,
}));

const connectionState = vi.hoisted(() => ({
    socketStatus: 'connected' as 'connected' | 'connecting' | 'disconnected' | 'error',
    syncError: null as null | { message: string; retryable?: boolean; kind?: string; at?: number },
    lastSyncAt: null as number | null,
}));

const machineListStatusState = vi.hoisted(() => ({
    byServerId: {} as Record<string, 'idle' | 'loading' | 'signedOut' | 'error'>,
}));

const connectionHealthState = vi.hoisted(() => ({
    kind: 'no_machine' as
        | 'healthy'
        | 'connecting'
        | 'server_error'
        | 'server_unreachable'
        | 'auth_required'
        | 'no_machine'
        | 'machine_offline'
        | 'machine_not_ready',
    color: '#ff9900',
    isPulsing: false,
    statusLabelKey: 'status.actionRequired',
    machineLabelKey: 'newSession.noMachinesFound',
    endpointStatus: 'online' as 'idle' | 'offline' | 'connecting' | 'online' | 'auth_failed' | 'shutting_down',
    machineCount: 0,
    onlineCount: 0,
    hasUnknownMachines: false,
    primaryMachineLabel: null as string | null,
}));

installConnectionStatusControlCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (options: { web?: unknown; default?: unknown; ios?: unknown; android?: unknown }) =>
                    options.web ?? options.default ?? options.ios ?? options.android,
            },
            View: 'View',
            Text: 'Text',
            Pressable: 'Pressable',
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    status: {
                        connected: '#00ff00',
                        connecting: '#ffcc00',
                        actionRequired: '#ff9900',
                        disconnected: '#ff0000',
                        error: '#ff0000',
                        default: '#999999',
                    },
                    surface: '#000000',
                    surfaceHigh: '#111111',
                    divider: '#222222',
                    text: '#111111',
                    textSecondary: '#666666',
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key, params) => params
                ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
                : key,
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSocketStatus: () => ({ status: connectionState.socketStatus }),
            useSyncError: () => connectionState.syncError,
            useLastSyncAt: () => connectionState.lastSyncAt,
            useMachineListStatusByServerId: () => machineListStatusState.byServerId,
            useSettings: () => settingsState,
            useSetting: (key: keyof typeof settingsState) => settingsState[key],
            useSettingMutable: (key: keyof typeof settingsState) => [
                settingsState[key],
                (value: unknown) => {
                    (settingsState as Record<string, unknown>)[String(key)] = value;
                },
            ],
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                confirm: modalMocks.confirm,
            },
        }).module;
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { push: routerMocks.push, replace: routerMocks.replace },
        }).module;
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/constants/Typography', () => ({
    FontWeights: {
        regular: '400',
    },
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/components/ui/lists/ActionListSection', () => ({
    ActionListSection: (props: ActionListSectionProps) => {
        capture.actionSections.push(props);
        return null;
    },
}));

vi.mock('@/components/navigation/connection/ConnectionTargetList', () => ({
    ConnectionTargetList: (props: ActionListSectionProps) => {
        capture.actionSections.push(props);
        return React.createElement('ConnectionTargetList', props);
    },
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: DropdownMenuCaptureProps) => {
        capture.dropdownMenuProps.push(props);
        return null;
    },
}));

vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: (props: { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, props.children),
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: (props: PopoverCaptureProps) => {
        capture.popoverProps = props;
        if (!props.open) return null;
        return React.createElement(
            React.Fragment,
            null,
            typeof props.children === 'function' ? props.children({ maxHeight: 520 }) : props.children,
        );
    },
    PopoverScope: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, refreshFromActiveServer: authMocks.refreshFromActiveServer }),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: tokenStorageMock,
    subscribeHomeCredentialMutations: () => () => {},
}));

vi.mock('@/sync/sync', () => ({
    sync: { retryNow: syncMocks.retryNow },
}));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    switchConnectionToActiveServer: connectionMocks.switchConnectionToActiveServer,
    retryActiveServerConnection: connectionMocks.retryActiveServerConnection,
    getAppliedActiveServerId: () => connectionMocks.appliedServerId,
    subscribeAppliedActiveServer: (listener: () => void) => {
        connectionMocks.appliedListeners.add(listener);
        return () => connectionMocks.appliedListeners.delete(listener);
    },
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    readIrohHomeTransportDiagnostics: () => irohDiagnosticsState.values,
}));

vi.mock('@/sync/runtime/irohHomeTransportDiagnostics', () => ({
    readIrohHomeTransportDiagnostics: () => irohDiagnosticsState.values,
    subscribeIrohHomeTransportDiagnostics: (listener: () => void) => {
        irohDiagnosticsState.listeners.add(listener);
        return () => irohDiagnosticsState.listeners.delete(listener);
    },
}));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: clipboardMock.setClipboardStringSafe,
}));

vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => false,
}));

vi.mock('@/components/navigation/connectionStatus/useConnectionHealth', () => ({
    useConnectionHealth: () => connectionHealthState,
}));

function getActionLabels(): string[] {
    return capture.actionSections.flatMap((section) =>
        (section.actions ?? []).flatMap((action) => {
            if (!action || typeof action !== 'object') return [];
            const label = action.label;
            return typeof label === 'string' ? [label] : [];
        }),
    );
}

function getActions(): ActionLike[] {
    return capture.actionSections.flatMap((section) => section.actions ?? []);
}

function findAction(id: string): ActionLike | undefined {
    const actions = getActions();
    for (let index = actions.length - 1; index >= 0; index -= 1) {
        if (actions[index]?.id === id) return actions[index];
    }
    return undefined;
}

async function importConnectionStatusControl() {
    const module = await import('./ConnectionStatusControl');
    return module.ConnectionStatusControl;
}

afterEach(() => {
    capture.reset();
    authMocks.refreshFromActiveServer.mockClear();
    connectionMocks.switchConnectionToActiveServer.mockReset();
    connectionMocks.switchConnectionToActiveServer.mockResolvedValue(null);
    connectionMocks.retryActiveServerConnection.mockReset();
    connectionMocks.retryActiveServerConnection.mockResolvedValue(undefined);
    connectionMocks.appliedServerId = '';
    connectionMocks.appliedListeners.clear();
    modalMocks.confirm.mockReset();
    syncMocks.retryNow.mockReset();
    tokenStorageMock.getCredentialsForServerUrl.mockReset();
    tokenStorageMock.getCredentialsForServerUrl.mockResolvedValue({ token: 'scoped-token', secret: 'scoped-secret' });
    routerMocks.push.mockReset();
    routerMocks.replace.mockReset();
    settingsState.serverSelectionGroups = [];
    settingsState.serverSelectionActiveTargetKind = null;
    settingsState.serverSelectionActiveTargetId = null;
    connectionState.socketStatus = 'connected';
    connectionState.syncError = null;
    connectionState.lastSyncAt = null;
    irohDiagnosticsState.values = [];
    irohDiagnosticsState.listeners.clear();
    clipboardMock.setClipboardStringSafe.mockClear();
    machineListStatusState.byServerId = {};
    connectionHealthState.kind = 'no_machine';
    connectionHealthState.color = '#ff9900';
    connectionHealthState.isPulsing = false;
    connectionHealthState.statusLabelKey = 'status.actionRequired';
    connectionHealthState.machineLabelKey = 'newSession.noMachinesFound';
    connectionHealthState.endpointStatus = 'online';
    connectionHealthState.machineCount = 0;
    connectionHealthState.onlineCount = 0;
    connectionHealthState.hasUnknownMachines = false;
    connectionHealthState.primaryMachineLabel = null;
});

describe('ConnectionStatusControl (native popover config)', () => {
    it('does not mount the closed popover shell until the trigger opens it', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));

        expect(capture.popoverProps).toBeNull();

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        expect(capture.popoverProps?.open).toBe(true);
    });

    it('toggles the popover when pressing the trigger twice', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        expect(capture.popoverProps).toBeNull();

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        expect(capture.popoverProps?.open).toBe(true);

        capture.popoverProps = null;
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        expect(capture.popoverProps).toBeNull();

        await act(async () => {
            tree?.unmount();
        });
    });

    it('enables a native portal so the menu is not width-constrained to the trigger', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        expect(capture.popoverProps).toBeTruthy();
        expect(capture.popoverProps?.portal?.web).toBe(true);
        expect(capture.popoverProps?.portal?.native).toBe(true);
        expect(capture.popoverProps?.portal?.matchAnchorWidth).toBe(false);

        await act(async () => {
            tree?.unmount();
        });
    });

    it('uses a wider screen-capped popover width for the sidebar connection details', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        expect(capture.popoverProps?.maxWidthCap).toBeGreaterThan(400);

        await act(async () => {
            tree?.unmount();
        });
    });

    it('puts the Home list first and keeps technical connection facts behind one disclosure', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeProfile = profiles.listServerProfiles().find((profile) => profile.name === 'Happier Cloud');
        if (!activeProfile) throw new Error('expected default Happier Cloud profile');
        irohDiagnosticsState.values = [{
            homeServerIdentityId: profiles.resolveServerProfileScopeId(activeProfile),
            remoteEndpointId: 'iroh-endpoint-123',
            state: 'connected',
            current: { carrier: 'iroh', observedPath: 'relay' },
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.example.test'],
                directAddressCount: 1,
            },
            lastTransitionAtMs: 1_700_000_000_000,
        }];
        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        const targetList = tree!.root.findByType('ConnectionTargetList');
        const detailsDisclosure = screen.findByTestId('connection-details-disclosure');
        const popoverContent = screen.findByTestId('connection-popover-content');
        expect(targetList).toBeTruthy();
        expect(detailsDisclosure?.props.accessibilityState).toEqual({ expanded: false });
        const orderedSections = (popoverContent?.children ?? []).flatMap((child) => (
            typeof child === 'object' && child !== null && 'props' in child
                ? [String((child as { props: { testID?: unknown } }).props.testID ?? '')]
                : []
        ));
        expect(orderedSections.indexOf('connection-target-list-section')).toBeLessThan(
            orderedSections.indexOf('connection-details-disclosure'),
        );
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-relay' })).toHaveLength(0);
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-realtime' })).toHaveLength(0);
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-machines' })).toHaveLength(0);
        expect(screen.getTextContent()).not.toContain('iroh-endpoint-123');

        await act(async () => {
            await pressTestInstanceAsync(detailsDisclosure);
        });

        expect(screen.findByTestId('connection-details-disclosure')?.props.accessibilityState).toEqual({ expanded: true });
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-relay' }).length).toBeGreaterThan(0);
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-realtime' }).length).toBeGreaterThan(0);
        expect(tree!.root.findAllByProps({ testID: 'connection-popover-machines' }).length).toBeGreaterThan(0);
        expect(screen.getTextContent()).toContain('iroh-endpoint-123');
        expect(screen.getTextContent()).toContain('relay.example.test');
        expect(screen.getTextContent()).not.toContain('connectionStatus.labels.transport');
        expect(screen.getTextContent()).not.toContain('connectionStatus.labels.connectionMode');
    });

    it('places an icon-only retry action next to the relay status badge when the server is unreachable', async () => {
        connectionHealthState.kind = 'server_unreachable';
        connectionHealthState.color = '#ff0000';
        connectionHealthState.statusLabelKey = 'status.disconnected';
        connectionHealthState.machineLabelKey = 'status.unknown';
        connectionHealthState.endpointStatus = 'offline';

        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        await act(async () => {
            await pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure'));
        });

        const retryButton = screen.findByTestId('connection-popover-relay-retry');
        expect(retryButton).toBeTruthy();
        expect(retryButton?.props.style).toMatchObject({ minWidth: 44, minHeight: 44 });

        await act(async () => {
            await pressTestInstanceAsync(retryButton);
        });

        expect(connectionMocks.retryActiveServerConnection).toHaveBeenCalledTimes(1);
        expect(syncMocks.retryNow).not.toHaveBeenCalled();

        await act(async () => {
            tree?.unmount();
        });
    });

    it('renders every Home in the primary list without a nested dropdown', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const local = profiles.upsertServerProfile({ serverUrl: 'https://local.example.test', name: 'Local' });
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            profiles.setActiveServerId(local.id, { scope: 'device' });
            connectionMocks.appliedServerId = local.id;
            settingsState.serverSelectionGroups = [
                {
                    id: 'grp-dev',
                    name: 'Dev Group',
                    serverIds: [local.id, company.id],
                    presentation: 'grouped',
                },
            ];
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            await vi.waitFor(() => {
                expect(tokenStorageMock.getCredentialsForServerUrl).toHaveBeenCalledWith('https://local.example.test', { serverId: local.id });
                expect(tokenStorageMock.getCredentialsForServerUrl).toHaveBeenCalledWith('https://company.example.test', { serverId: company.id });
            });

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const actionLabels = getActionLabels();

            expect(capture.dropdownMenuProps).toHaveLength(0);
            expect(actionLabels.some((label) => label.toLowerCase().includes('company'))).toBe(true);
            expect(actionLabels.some((label) => label.toLowerCase().includes('dev group'))).toBe(true);

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('keeps the trigger and details on the applied Home while another Home is staged', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const local = profiles.upsertServerProfile({ serverUrl: 'https://local.example.test', name: 'Local' });
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            profiles.setActiveServerId(local.id, { scope: 'device' });
            connectionMocks.appliedServerId = local.id;
            settingsState.serverSelectionGroups = [{
                id: 'grp-dev',
                name: 'Dev Group',
                serverIds: [local.id, company.id],
                presentation: 'grouped',
            }];

            const ConnectionStatusControl = await importConnectionStatusControl();
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            await act(async () => {
                for (const listener of connectionMocks.appliedListeners) listener();
            });
            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });
            await act(async () => {
                await pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure'));
            });

            await act(async () => {
                // Model the reachable production boundary directly: selection is
                // staged to Company while full Sync remains applied to Local.
                profiles.setActiveServerId(company.id, { scope: 'device' });
                await vi.waitFor(() => {
                    expect(profiles.areServerProfileIdentifiersEquivalent(
                        profiles.getActiveServerSnapshot().serverId,
                        company.id,
                    )).toBe(true);
                });
            });

            expect(trigger.props.accessibilityLabel).toContain('Local');
            expect(trigger.props.accessibilityLabel).not.toContain('Company');
            expect(screen.getTextContent()).toContain('local.example.test');
            expect(screen.getTextContent()).not.toContain('company.example.test');
            await act(async () => {
                screen.tree.unmount();
            });
        } finally {
            if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        }
    });

    it('opens relay settings from the relay section gear action', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();

        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        const settingsButton = screen.findByProps({ testID: 'connection-popover-relay-settings' });
        expect(settingsButton).toBeTruthy();
        expect(settingsButton?.props.style).toMatchObject({ minWidth: 44, minHeight: 44 });

        await act(async () => {
            await pressTestInstanceAsync(settingsButton);
        });

        expect(routerMocks.push).toHaveBeenCalledWith('/settings/server');

        await act(async () => {
            tree?.unmount();
        });
    });

    it('shows the active server target row even when there is only one saved server', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const local = profiles.upsertServerProfile({ serverUrl: 'https://local.example.test', name: 'Local' });
            profiles.setActiveServerId(local.id, { scope: 'device' });

            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const actionLabels = getActionLabels();
            expect(capture.dropdownMenuProps).toHaveLength(0);
            expect(actionLabels.some((label) => label.toLowerCase().includes('local'))).toBe(true);

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('switches server without reload by using runtime switch handlers', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;
        const webGlobals = globalThis as unknown as Record<string, unknown>;
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
        const sessionValues = new Map<string, string>();
        Object.defineProperties(globalThis, {
            window: { configurable: true, value: {} },
            document: { configurable: true, value: {} },
            sessionStorage: {
                configurable: true,
                value: {
                    getItem: (key: string) => sessionValues.get(key) ?? null,
                    setItem: (key: string, value: string) => sessionValues.set(key, value),
                    removeItem: (key: string) => sessionValues.delete(key),
                },
            },
        });

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const local = profiles.upsertServerProfile({ serverUrl: 'https://local.example.test', name: 'Local' });
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            profiles.setActiveServerId(local.id, { scope: 'device' });
            const previousDeviceDefault = profiles.getDeviceDefaultServerId();
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const companyItem = findAction(`target-use-server-${company.id}`);
            expect(companyItem).toBeTruthy();

            await act(async () => {
                companyItem?.onPress?.();
            });

            await vi.waitFor(() => {
                expect(connectionMocks.switchConnectionToActiveServer).toHaveBeenCalledTimes(1);
                expect(authMocks.refreshFromActiveServer).toHaveBeenCalledTimes(1);
                expect(profiles.getTabActiveServerId()).toBe(company.id);
            });
            expect(profiles.getDeviceDefaultServerId()).toBe(previousDeviceDefault);

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            for (const [key, descriptor] of [
                ['window', previousWindow],
                ['document', previousDocument],
                ['sessionStorage', previousSessionStorage],
            ] as const) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else delete webGlobals[key];
            }
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('gives same-named Homes distinct accessible labels without adding visible row metadata', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const first = profiles.upsertServerProfile({ serverUrl: 'https://first.example.test', name: 'Personal Home' });
            const second = profiles.upsertServerProfile({ serverUrl: 'https://second.example.test', name: 'Personal Home' });
            machineListStatusState.byServerId = { [first.id]: 'idle', [second.id]: 'idle' };

            const ConnectionStatusControl = await importConnectionStatusControl();
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const firstAction = findAction(`target-use-server-${first.id}`);
            const secondAction = findAction(`target-use-server-${second.id}`);
            expect(firstAction?.subtitle).toBe('status.connected');
            expect(secondAction?.subtitle).toBe('status.connected');
            expect(firstAction?.accessibilityLabel).not.toBe(secondAction?.accessibilityLabel);
            expect(firstAction?.accessibilityLabel).toContain('first.example.test');
            expect(secondAction?.accessibilityLabel).toContain('second.example.test');

            await act(async () => {
                screen.tree.unmount();
            });
        } finally {
            if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        }
    });

    it('labels each Home target with only its own provable auth and connection facts', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            const local = profiles.listServerProfiles().find((profile) => profile.id !== company.id)!;
            profiles.setActiveServerId(local.id, { scope: 'device' });
            machineListStatusState.byServerId = { [company.id]: 'error' };
            tokenStorageMock.getCredentialsForServerUrl.mockImplementation(async (...args: unknown[]) => {
                const url = String(args[0] ?? '');
                return url.includes('company.example.test') ? null : { token: 'scoped-token', secret: 'scoped-secret' };
            });

            const ConnectionStatusControl = await importConnectionStatusControl();
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));

            await vi.waitFor(() => {
                expect(tokenStorageMock.getCredentialsForServerUrl).toHaveBeenCalledWith(company.serverUrl, { serverId: company.id });
            });
            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const localAction = findAction(`target-use-server-${local.id}`);
            const companyAction = findAction(`target-use-server-${company.id}`);
            expect(localAction?.subtitle).toBe('status.actionRequired');
            expect(localAction?.accessibilityLabel).toBe(`${local.name}, status.actionRequired`);
            expect(localAction?.icon).toBeUndefined();
            expect(companyAction?.subtitle).toBe('server.signedOut');
            expect(companyAction?.accessibilityLabel).toBe('Company, server.signedOut');
            expect(companyAction?.icon).toBeUndefined();

            await act(async () => {
                screen.tree.unmount();
            });
        } finally {
            if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        }
    });

    it('uses stable server identity ids for relay switch actions', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            profiles.setServerProfileIdentityForUrl(company.serverUrl, 'srv_identity_company');
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const companyItem = findAction('target-use-server-srv_identity_company');
            expect(companyItem).toBeTruthy();

            await act(async () => {
                companyItem?.onPress?.();
            });

            expect(connectionMocks.switchConnectionToActiveServer).toHaveBeenCalledTimes(1);
            expect(authMocks.refreshFromActiveServer).toHaveBeenCalledTimes(1);

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('selects the active server row when saved target settings point at a previous server', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            const defaultServer = profiles.listServerProfiles().find((profile) => profile.id !== company.id);
            expect(defaultServer).toBeTruthy();
            profiles.setActiveServerId(company.id, { scope: 'device' });
            settingsState.serverSelectionActiveTargetKind = 'server';
            settingsState.serverSelectionActiveTargetId = defaultServer!.id;

            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            expect(findAction(`target-use-server-${defaultServer!.id}`)).toBeTruthy();
            expect(findAction(`target-use-server-${company.id}`)).toBeTruthy();

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('starts target-specific sign-in directly for a signed-out Home', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const company = profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            tokenStorageMock.getCredentialsForServerUrl.mockImplementation(async (...args: unknown[]) => {
                const url = String(args[0] ?? '');
                if (url.includes('company.example.test')) return null;
                return { token: 'scoped-token', secret: 'scoped-secret' };
            });
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const companyItem = findAction(`target-use-server-${company.id}`);
            expect(companyItem).toBeTruthy();

            await act(async () => {
                companyItem?.onPress?.();
            });

            expect(modalMocks.confirm).not.toHaveBeenCalled();
            expect(connectionMocks.switchConnectionToActiveServer).toHaveBeenCalledTimes(1);
            expect(authMocks.refreshFromActiveServer).toHaveBeenCalledTimes(1);
            expect(routerMocks.replace).toHaveBeenCalledWith('/');

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('activates the first credentialed group member through the primary switcher', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;
        const webGlobals = globalThis as unknown as Record<string, unknown>;
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
        const sessionValues = new Map<string, string>();
        Object.defineProperties(globalThis, {
            window: { configurable: true, value: {} },
            document: { configurable: true, value: {} },
            sessionStorage: {
                configurable: true,
                value: {
                    getItem: (key: string) => sessionValues.get(key) ?? null,
                    setItem: (key: string, value: string) => sessionValues.set(key, value),
                    removeItem: (key: string) => sessionValues.delete(key),
                },
            },
        });

        try {
            vi.resetModules();
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const selection = await import('@/sync/domains/server/selection/homeViewSelectionState');
            const local = profiles.upsertServerProfile({ serverUrl: 'https://local.example.test', name: 'Local' });
            const signedOut = profiles.upsertServerProfile({ serverUrl: 'https://signed-out.example.test', name: 'Signed out' });
            const credentialed = profiles.upsertServerProfile({ serverUrl: 'https://credentialed.example.test', name: 'Credentialed' });
            profiles.setActiveServerId(local.id, { scope: 'device' });

            settingsState.serverSelectionActiveTargetKind = 'server';
            settingsState.serverSelectionActiveTargetId = local.id;
            settingsState.serverSelectionGroups = [
                {
                    id: 'grp-one',
                    name: 'One',
                    serverIds: [signedOut.id, credentialed.id],
                    presentation: 'grouped',
                },
            ];
            profiles.updateHomeViewState(() => ({
                version: 1,
                groups: settingsState.serverSelectionGroups,
                activeTargetKind: 'server',
                activeTargetId: local.id,
            }));

            tokenStorageMock.getCredentialsForServerUrl.mockImplementation(async (...args: unknown[]) => {
                const url = String(args[0] ?? '');
                if (url.includes('signed-out.example.test')) return null;
                return { token: 'scoped-token', secret: 'scoped-secret' };
            });
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const groupItem = findAction('target-use-group-grp-one');
            expect(groupItem).toBeTruthy();

            await act(async () => {
                groupItem?.onPress?.();
            });

            expect(modalMocks.confirm).not.toHaveBeenCalled();
            await vi.waitFor(() => {
                expect(selection.loadEffectiveHomeViewState()?.activeTargetKind).toBe('group');
                expect(selection.loadEffectiveHomeViewState()?.activeTargetId).toBe('grp-one');
                expect(profiles.loadHomeViewState()?.activeTargetKind).toBe('server');
                expect(profiles.loadHomeViewState()?.activeTargetId).toBe(local.id);
                expect(profiles.getTabActiveServerId()).toBe(credentialed.id);
                expect(connectionMocks.switchConnectionToActiveServer).toHaveBeenCalledTimes(1);
                expect(authMocks.refreshFromActiveServer).toHaveBeenCalledTimes(1);
                expect(routerMocks.replace).not.toHaveBeenCalled();
            });

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            for (const [key, descriptor] of [
                ['window', previousWindow],
                ['document', previousDocument],
                ['sessionStorage', previousSessionStorage],
            ] as const) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else delete webGlobals[key];
            }
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('uses target action ids and does not expose legacy scope toggles', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const scope = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;

        try {
            vi.resetModules();
            const { Platform } = await import('react-native');
            const previousPlatform = Platform.OS;
            (Platform as any).OS = 'web';
            const profiles = await import('@/sync/domains/server/serverProfiles');
            profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
            const ConnectionStatusControl = await importConnectionStatusControl();

            let tree: renderer.ReactTestRenderer | undefined;
            const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
            tree = screen.tree;

            const trigger = screen.findByProps({ accessibilityRole: 'button' });
            await act(async () => {
                await pressTestInstanceAsync(trigger);
            });

            const actionIds = new Set(
                getActions().flatMap((action) => typeof action.id === 'string' ? [action.id] : []),
            );
            expect(Array.from(actionIds).some((id) => id.startsWith('server-use-') && id.endsWith('-tab'))).toBe(false);
            expect(Array.from(actionIds).some((id) => id.startsWith('server-use-') && id.endsWith('-device'))).toBe(false);
            expect(Array.from(actionIds).some((id) => id.startsWith('target-use-server-'))).toBe(true);
            expect(Array.from(actionIds).some((id) => id === 'server-switch-tab')).toBe(false);
            expect(Array.from(actionIds).some((id) => id === 'server-switch-device')).toBe(false);
            expect(actionIds.has('connection-popover-manage-relay')).toBe(false);

            (Platform as any).OS = previousPlatform;

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            if (previousScope === undefined) {
                delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            } else {
                process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
            }
        }
    });

    it('shows a retry CTA and sanitized error text inside the popover for retryable connection failures', async () => {
        connectionState.syncError = { message: 'xhr poll error', retryable: true, kind: 'unknown', at: Date.now() };

        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        await act(async () => {
            await pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure'));
        });

        const joined = screen.getTextContent();
        expect(joined).toContain('Connection error');
        expect(joined).not.toContain('xhr poll error');
        expect(joined).toContain('common.retry');

        await act(async () => {
            tree?.unmount();
        });
    });

    it('shows a restore-account CTA inside the popover for auth failures', async () => {
        connectionState.syncError = { message: 'Forbidden', retryable: false, kind: 'auth', at: Date.now() };

        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        await act(async () => {
            await pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure'));
        });

        expect(screen.getTextContent()).toContain('connect.restoreAccount');

        await act(async () => {
            tree?.unmount();
        });
    });

    it('shows restore-account from endpoint authentication state even without a separate sync error', async () => {
        connectionState.syncError = null;
        connectionHealthState.kind = 'auth_required';
        connectionHealthState.endpointStatus = 'auth_failed';

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));
        await act(async () => pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure')));

        expect(screen.getTextContent()).toContain('connect.restoreAccount');
        await act(async () => screen.tree?.unmount());
    });

    it('answers Home identity, truthful status, and the applicable action in the first popover layer', async () => {
        connectionHealthState.kind = 'auth_required';
        connectionHealthState.endpointStatus = 'auth_failed';

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));

        // No Details expansion: identity, state, and recovery are answered first.
        const homeRow = screen.findByTestId('connection-popover-home');
        expect(homeRow).toBeTruthy();
        const joined = screen.getTextContent();
        expect(joined).toContain('Happier Cloud');
        expect(joined).toContain('connectionStatus.summary.signInAgain');
        expect(screen.findByTestId('connection-popover-primary-action')).toBeTruthy();
        expect(joined).toContain('connect.restoreAccount');
        expect(joined).toContain('server.changeServer');

        await act(async () => screen.tree?.unmount());
    });

    it('reports the Home as connected in the first layer while only machines need attention', async () => {
        connectionHealthState.kind = 'machine_offline';
        connectionHealthState.statusLabelKey = 'status.actionRequired';

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));

        const joined = screen.getTextContent();
        expect(joined).toContain('connectionStatus.summary.connected');
        expect(joined).not.toContain('connectionStatus.summary.unavailable');
        expect(screen.tree?.root.findAllByProps({ testID: 'connection-popover-primary-action' })).toHaveLength(0);

        await act(async () => screen.tree?.unmount());
    });

    it('reports an unavailable Home with a retry in the first layer', async () => {
        connectionHealthState.kind = 'server_unreachable';

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));

        expect(screen.getTextContent()).toContain('connectionStatus.summary.unavailable');
        await act(async () => pressTestInstanceAsync(screen.findByTestId('connection-popover-primary-action')));
        expect(connectionMocks.retryActiveServerConnection).toHaveBeenCalled();

        await act(async () => screen.tree?.unmount());
    });

    it('keeps the collapsed trigger free of transport vocabulary', async () => {
        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'header' }));

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        const triggerLabel = String(trigger.props.accessibilityLabel);
        for (const transportTerm of ['iroh', 'relay', 'socket', 'https', 'direct', 'tunnel']) {
            expect(triggerLabel.toLowerCase()).not.toContain(transportTerm);
        }
        expect(triggerLabel).toContain('Happier Cloud');
        expect(triggerLabel).toContain('connectionStatus.summary.connected');
        expect(triggerLabel).not.toContain('status.actionRequired');

        await act(async () => screen.tree?.unmount());
    });

    it('presents browser Iroh as secure relay and refreshes open Details from the diagnostics owner', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeProfile = profiles.listServerProfiles().find((profile) => profile.name === 'Happier Cloud');
        if (!activeProfile) throw new Error('expected default Happier Cloud profile');
        const homeServerIdentityId = profiles.resolveServerProfileScopeId(activeProfile);
        irohDiagnosticsState.values = [{
            homeServerIdentityId,
            remoteEndpointId: 'browser-endpoint-123',
            state: 'connecting',
            current: { carrier: 'iroh' },
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.example.test'],
                directAddressCount: 0,
            },
            lastTransitionAtMs: 1_700_000_000_000,
        }];

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));
        await act(async () => pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure')));

        expect(screen.getTextContent()).toContain('browser-endpoint-123');
        expect(screen.getTextContent()).toContain('Iroh · status.unknown');
        expect(screen.getTextContent()).toContain('connectionStatus.labels.lastTransition');

        irohDiagnosticsState.values = [{
            ...irohDiagnosticsState.values[0],
            state: 'connected',
            current: { carrier: 'iroh', observedPath: 'relay' },
            lastKnown: { carrier: 'iroh', observedPath: 'relay' },
            lastTransitionAtMs: 1_700_000_001_000,
        }];
        await act(async () => {
            for (const listener of irohDiagnosticsState.listeners) listener();
        });

        const joined = screen.getTextContent();
        expect(joined).toContain('Iroh · connectionStatus.values.pathRelay');
        expect(joined).not.toContain('connectionStatus.values.pathDirect');

        await act(async () => screen.tree?.unmount());
    });

    it('keeps canonical and runtime origins with endpoint and relay diagnostics behind Details, with a copy affordance', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeProfile = profiles.listServerProfiles().find((profile) => profile.name === 'Happier Cloud');
        if (!activeProfile) throw new Error('expected default Happier Cloud profile');
        irohDiagnosticsState.values = [{
            homeServerIdentityId: profiles.resolveServerProfileScopeId(activeProfile),
            remoteEndpointId: 'iroh-endpoint-123',
            state: 'connected',
            current: { carrier: 'iroh', observedPath: 'direct' },
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.example.test'],
                directAddressCount: 2,
            },
            diagnosticError: { code: 'transport_stalled', message: 'no usable path', atMs: 1_700_000_000_000 },
        }];

        const ConnectionStatusControl = await importConnectionStatusControl();
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));

        expect(screen.getTextContent()).not.toContain('connectionStatus.labels.endpointId');

        await act(async () => pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure')));

        const joined = screen.getTextContent();
        expect(joined).toContain('connectionStatus.labels.canonicalAddress');
        expect(joined).toContain('connectionStatus.labels.endpointId');
        expect(joined).toContain('iroh-endpoint-123');
        expect(joined).toContain('connectionStatus.labels.connectionPath');
        expect(joined).toContain('connectionStatus.values.pathDirect');
        expect(joined).toContain('connectionStatus.labels.relayConfiguration');
        expect(joined).toContain('relay.example.test');
        expect(joined).toContain('connectionStatus.labels.transportError');
        expect(joined).toContain('transport_stalled: no usable path');
        expect(joined).toContain('connectionStatus.labels.lastSync');

        const copyButton = screen.findByTestId('connection-copy-diagnostics');
        if (!copyButton) throw new Error('expected diagnostics copy action');
        expect(copyButton.props.accessibilityRole).toBe('button');
        expect(copyButton.props.accessibilityLabel).toBe('connectionStatus.copyDiagnostics');
        await act(async () => pressTestInstanceAsync(copyButton));
        expect(clipboardMock.setClipboardStringSafe).toHaveBeenCalled();
        const copied = String(clipboardMock.setClipboardStringSafe.mock.calls.at(-1)?.[0] ?? '');
        expect(copied).toContain('iroh-endpoint-123');
        expect(copied).toContain('relay.example.test');
        expect(screen.getTextContent()).toContain('connectionStatus.diagnosticsCopied');
        const copiedButton = screen.findByTestId('connection-copy-diagnostics');
        if (!copiedButton) throw new Error('expected diagnostics copied action');
        expect(copiedButton.props.accessibilityLabel)
            .toBe('connectionStatus.diagnosticsCopied');

        await act(async () => screen.tree?.unmount());
    });

    it('reads current same-Home diagnostics on rerender instead of retaining the opening snapshot', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeProfile = profiles.listServerProfiles().find((profile) => profile.name === 'Happier Cloud');
        if (!activeProfile) throw new Error('expected default Happier Cloud profile');
        const homeServerIdentityId = profiles.resolveServerProfileScopeId(activeProfile);
        irohDiagnosticsState.values = [{
            homeServerIdentityId,
            remoteEndpointId: 'endpoint-before',
            state: 'connected',
        }];

        const ConnectionStatusControl = await importConnectionStatusControl();
        const element = React.createElement(ConnectionStatusControl, { variant: 'sidebar' });
        const screen = await renderScreen(element);
        await act(async () => pressTestInstanceAsync(screen.findByProps({ accessibilityRole: 'button' })));
        await act(async () => pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure')));
        expect(screen.getTextContent()).toContain('endpoint-before');

        irohDiagnosticsState.values = [{
            homeServerIdentityId,
            remoteEndpointId: 'endpoint-after',
            state: 'connected',
        }];
        await act(async () => screen.tree?.update(
            React.createElement(ConnectionStatusControl, { variant: 'sidebar', textSize: 13 }),
        ));

        expect(screen.getTextContent()).toContain('endpoint-after');
        expect(screen.getTextContent()).not.toContain('endpoint-before');
        await act(async () => screen.tree?.unmount());
    });

    it('does not show relay unknown when endpoint connectivity is idle but the connection is otherwise healthy', async () => {
        connectionHealthState.kind = 'healthy';
        connectionHealthState.color = '#00ff00';
        connectionHealthState.statusLabelKey = 'status.connected';
        connectionHealthState.machineLabelKey = 'status.online';
        connectionHealthState.endpointStatus = 'idle';
        connectionHealthState.machineCount = 1;
        connectionHealthState.onlineCount = 1;
        connectionHealthState.primaryMachineLabel = 'mbp';
        connectionState.socketStatus = 'connected';

        const ConnectionStatusControl = await importConnectionStatusControl();
        let tree: renderer.ReactTestRenderer | undefined;
        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));
        tree = screen.tree;

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        await act(async () => {
            await pressTestInstanceAsync(trigger);
        });

        await act(async () => {
            await pressTestInstanceAsync(screen.findByTestId('connection-details-disclosure'));
        });

        const joined = screen.getTextContent();
        expect(joined).not.toContain('status.unknown');
        expect(joined.match(/status\.connected/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

        await act(async () => {
            tree?.unmount();
        });
    });
});
