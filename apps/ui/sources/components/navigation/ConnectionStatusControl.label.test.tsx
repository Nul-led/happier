import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installConnectionStatusControlCommonModuleMocks } from './connectionStatusControlTestHelpers';


(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

const connectionHealthMock = vi.hoisted(() => ({
    current: {
        kind: 'no_machine',
        tone: 'attention',
        color: '#ff9900',
        isPulsing: false,
        statusLabelKey: 'status.actionRequired',
        machineLabelKey: 'newSession.noMachinesFound',
    } as Record<string, unknown>,
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
                        disconnected: '#999999',
                        error: '#ff0000',
                        default: '#999999',
                    },
                    state: {
                        success: { foreground: '#00ff00', background: '#002200', border: '#005500' },
                        warning: { foreground: '#ff9900', background: '#332000', border: '#664000' },
                        danger: { foreground: '#ff0000', background: '#330000', border: '#660000' },
                        info: { foreground: '#007aff', background: '#001f33', border: '#004f80' },
                        neutral: { foreground: '#666666', background: '#111111', border: '#222222' },
                    },
                    surface: {
                        base: '#000000',
                        inset: '#111111',
                        pressedOverlay: '#222222',
                    },
                    border: {
                        default: '#222222',
                        strong: '#444444',
                    },
                    text: {
                        primary: '#111111',
                        secondary: '#666666',
                    },
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSocketStatus: () => ({ status: 'connected' }),
            useSyncError: () => null,
            useLastSyncAt: () => null,
            useSettings: () => ({}),
            useSettingMutable: () => [null, vi.fn()],
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { replace: vi.fn(), push: vi.fn() },
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
        eyebrow: () => ({
            fontSize: 12,
            lineHeight: 16,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
        }),
        pillLabel: () => ({ fontSize: 10, lineHeight: 12 }),
        keyHint: () => ({ fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'] }),
        tabular: () => ({ fontVariant: ['tabular-nums'] }),
    },
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: () => null,
    PopoverScope: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/sync/domains/server/serverConfig', () => ({
    getServerUrl: () => 'https://cloud.example.test',
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left ?? '').trim() === String(right ?? '').trim(),
    getActiveServerHomeCarrier: () => null,
    getActiveServerId: () => 'srv-1',
    getDeviceDefaultServerId: () => 'srv-1',
    loadHomeViewState: () => null,
    listServerProfiles: () => [{ id: 'srv-1', name: 'Happier Cloud', serverUrl: 'https://cloud.example.test' }],
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    setActiveServerId: vi.fn(),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 1,
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({
        serverId: 'srv-1',
        serverUrl: 'https://cloud.example.test',
        runtimeOrigin: 'http://127.0.0.1:4312',
        carrier: 'iroh',
        generation: 1,
    }),
}));

vi.mock('@/hooks/server/useHomeViewSelectionSettings', () => ({
    useHomeViewSelectionSettingsMutable: () => ({
        serverSelectionGroups: [],
        serverSelectionActiveTargetKind: 'server',
        serverSelectionActiveTargetId: 'srv-1',
        setHomeViewSelectionSettings: vi.fn(),
    }),
}));

vi.mock('@/components/settings/server/hooks/useServerAuthStatusByServerId', () => ({
    useServerAuthStatusByServerId: () => ({ 'srv-1': 'signedIn' }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return await createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: vi.fn(async () => ({ token: 't', secret: 's' })),
        },
    });
});

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    switchConnectionToActiveServer: vi.fn(async () => {}),
    getAppliedActiveServerId: () => 'srv-1',
    subscribeAppliedActiveServer: () => () => undefined,
}));

vi.mock('@/sync/sync', () => ({
    sync: { retryNow: vi.fn() },
}));

vi.mock('@/sync/domains/server/selection/serverSelectionResolver', () => ({
    listServerSelectionTargets: () => [],
}));

vi.mock('@/sync/domains/server/selection/serverSelectionResolution', () => ({
    resolveActiveServerSelectionFromRawSettings: () => ({ activeTarget: { kind: 'server', id: 'srv-1' } }),
}));

vi.mock('@/sync/domains/server/url/serverUrlDisplay', () => ({
    toServerUrlDisplay: (value: string) => value,
}));

vi.mock('@/components/navigation/connection/useConnectionTargetActions', () => ({
    useConnectionTargetActions: () => [],
}));

vi.mock('@/components/navigation/connection/ConnectionTargetList', () => ({
    ConnectionTargetList: () => null,
}));

vi.mock('@/components/navigation/connectionStatus/useConnectionHealth', () => ({
    useActiveHomeConnectionHealth: () => connectionHealthMock.current,
    useConnectionHealth: () => connectionHealthMock.current,
}));

describe('ConnectionStatusControl (label)', () => {
    it('shows the active server name instead of a generic connection status label', async () => {
        const { ConnectionStatusControl } = await import('./ConnectionStatusControl');

        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'header' }));
        const joined = screen.getTextContent();
        expect(joined).toContain('Happier Cloud');
        expect(joined).not.toContain('status.connected');

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        expect(trigger.props.accessibilityLabel).toBe('Happier Cloud, connectionStatus.summary.connected');
        // Header activation navigates to the existing full-screen Homes surface;
        // only the desktop/sidebar trigger owns an expandable popover state.
        expect(trigger.props.accessibilityState).toBeUndefined();
        expect(trigger.props.style.minHeight).toBeGreaterThanOrEqual(44);
    });

    it('uses a single-line tail ellipsis contract for long sidebar server labels', async () => {
        const { ConnectionStatusControl } = await import('./ConnectionStatusControl');

        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'sidebar' }));

        const trigger = screen.findByProps({ accessibilityRole: 'button' });
        expect(trigger.props.style).toMatchObject({
            flexShrink: 1,
            maxWidth: '100%',
            minWidth: 0,
        });
        expect(trigger.props.style.width).toBeUndefined();

        const label = screen.findByType('Text' as any);
        expect(label).toBeTruthy();
        expect(label!.props.numberOfLines).toBe(1);
        expect(label!.props.ellipsizeMode).toBe('tail');
        expect(label!.props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    flexGrow: 0,
                    flexShrink: 1,
                    minWidth: 0,
                }),
            ]),
        );
    });

    it('shows one visible non-color warning cue carrying the action-required color', async () => {
        const { ConnectionStatusControl } = await import('./ConnectionStatusControl');
        const { Icon } = await import('@/components/ui/icons/Icon');

        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'header' }));

        const warningCue = screen.findAllByType(Icon).find((node) => node.props.name === 'warning');
        expect(warningCue).toBeTruthy();
        expect(warningCue!.props.color).toBe('#ff9900');
    });

    it('keeps the healthy connected trigger quiet with no warning cue', async () => {
        connectionHealthMock.current = {
            kind: 'healthy',
            tone: 'positive',
            color: '#00ff00',
            isPulsing: false,
            statusLabelKey: 'status.connected',
            machineLabelKey: 'status.online',
        };
        const { ConnectionStatusControl } = await import('./ConnectionStatusControl');
        const { Icon } = await import('@/components/ui/icons/Icon');

        const screen = await renderScreen(React.createElement(ConnectionStatusControl, { variant: 'header' }));

        const warningCue = screen.findAllByType(Icon).find((node) => node.props.name === 'warning');
        expect(warningCue).toBeUndefined();
        const dot = screen.findByType('StatusDot' as any);
        expect(dot.props.color).toBe('#00ff00');
    });
});
