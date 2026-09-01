import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';


import { createCapturingComponent, createPassThroughComponent, createPassThroughModule } from '@/dev/testkit/mocks/components';
import { installNewSessionComponentsCommonModuleMocks } from './newSessionComponentsTestHelpers';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createReactNativeNativeMock } from '@/dev/testkit/mocks/reactNative';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';
import { renderScreen } from '@/dev/testkit';
import type { ActiveServerSwitchResult } from '@/sync/domains/server/activeServerSwitch';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const capturedItems: Array<Record<string, unknown>> = [];
const capturedItemGroups: Array<Record<string, unknown>> = [];
const capturedItemLists: Array<{ kind: 'scroll' | 'static'; props: Record<string, unknown> }> = [];
const getCredentialsForServerUrlMock = vi.hoisted(() =>
    vi.fn(async () => ({ token: 'token', secret: 'secret' } as { token: string; secret: string } | null)),
);
const refreshFromActiveServerMock = vi.hoisted(() => vi.fn(async () => {}));
const setActiveServerAndSwitchMock = vi.hoisted(() => vi.fn(
    async (): Promise<ActiveServerSwitchResult> => 'switched',
));
const setNewSessionPickerReturnParamsMock = vi.hoisted(() => vi.fn(() => 'dispatch'));
const serverAuthStatusState = vi.hoisted(() => ({
    value: {
        'server-a': 'signedIn',
        'server-b': 'signedOut',
    } as Record<string, 'signedIn' | 'signedOut' | 'unknown'>,
}));
const fireAndForgetPromises = vi.hoisted(() => [] as Promise<unknown>[]);
const serverProfilesState = vi.hoisted(() => ({
    value: [
        { id: 'server-a', name: 'Server A', serverUrl: 'http://server-a.local' },
        { id: 'server-b', name: 'Server B', serverUrl: 'http://server-b.local' },
    ] as Array<{ id: string; name: string; serverUrl: string; serverIdentityId?: string }>,
}));
const expoRouterMock = createExpoRouterMock({
    params: { selectedId: 'server-a', draftId: 'draft-1', agentType: 'codex' },
    navigation: { dispatch: vi.fn(), getState: () => undefined },
    router: { replace: vi.fn() },
});

type StyleLikeProps = Readonly<{
    style?: unknown;
}>;

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign(
            {} as Record<string, unknown>,
            ...style.filter(Boolean).map((entry) => flattenStyle(entry)),
        );
    }
    return (style as Record<string, unknown> | undefined) ?? {};
}

function readProps<P>(node: ReactTestInstance): P {
    return node.props as P;
}

installNewSessionComponentsCommonModuleMocks({
    icons: () => ({
        Ionicons: createPassThroughComponent('Ionicons'),
    }),
    reactNative: () => createReactNativeNativeMock({ platformOS: 'ios' }, {
        View: createPassThroughComponent('View'),
        Pressable: createPassThroughComponent('Pressable'),
    }),
    router: () => expoRouterMock.module,
    storage: () => createStorageModuleStub({
        useSetting: (key: string) => {
            if (key === 'serverSelectionGroups') return [];
            if (key === 'serverSelectionActiveTargetKind') return 'all';
            if (key === 'serverSelectionActiveTargetId') return null;
            return null;
        },
    }),
    text: () => createTextModuleMock(),
    unistyles: () => createUnistylesMock({
        theme: {
            colors: {
                groupped: { background: '#fff' },
                text: '#111',
                textSecondary: '#666',
            },
        },
    }),
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: createCapturingComponent('ItemList', (props) => {
        capturedItemLists.push({ kind: 'scroll', props });
    }),
    ItemListStatic: createCapturingComponent('ItemListStatic', (props) => {
        capturedItemLists.push({ kind: 'static', props });
    }),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: createCapturingComponent('ItemGroup', (props) => {
        capturedItemGroups.push(props);
    }),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: createCapturingComponent('Item', (props) => {
        capturedItems.push(props);
    }),
}));
vi.mock('@/components/ui/text/Text', () => createPassThroughModule(['Text']));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({
        generation: 1,
        serverId: 'server-a',
    }),
    listServerProfiles: () => serverProfilesState.value,
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => profile.serverIdentityId ?? profile.id,
    loadHomeViewState: () => null,
    loadEffectiveHomeViewState: () => null,
    subscribeHomeViewState: () => () => {},
}));

vi.mock('@/sync/domains/server/selection/serverSelectionResolution', () => ({
    resolveActiveServerSelectionFromRawSettings: (params: { availableServerIds: string[] }) => ({
        allowedServerIds: params.availableServerIds,
    }),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: getCredentialsForServerUrlMock,
    },
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: refreshFromActiveServerMock }),
}));

vi.mock('@/components/settings/server/hooks/useServerAuthStatusByServerId', () => ({
    useServerAuthStatusByServerId: () => serverAuthStatusState.value,
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: setActiveServerAndSwitchMock,
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => {
        fireAndForgetPromises.push(promise);
    },
}));

vi.mock('@/utils/navigation/safeRouterBack', () => ({
    safeRouterBack: vi.fn(),
}));

vi.mock('@/components/sessions/new/navigation/setNewSessionPickerReturnParams', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/sessions/new/navigation/setNewSessionPickerReturnParams')>();
    return {
        ...actual,
        setNewSessionPickerReturnParams: setNewSessionPickerReturnParamsMock,
    };
});

describe('NewSessionServerSelectionContent', () => {
    beforeEach(() => {
        capturedItems.length = 0;
        capturedItemGroups.length = 0;
        capturedItemLists.length = 0;
        serverProfilesState.value = [
            { id: 'server-a', name: 'Server A', serverUrl: 'http://server-a.local' },
            { id: 'server-b', name: 'Server B', serverUrl: 'http://server-b.local' },
        ];
        serverAuthStatusState.value = {
            'server-a': 'signedIn',
            'server-b': 'signedOut',
        };
        getCredentialsForServerUrlMock.mockReset();
        getCredentialsForServerUrlMock.mockResolvedValue({ token: 'token', secret: 'secret' });
        refreshFromActiveServerMock.mockClear();
        setActiveServerAndSwitchMock.mockReset();
        setActiveServerAndSwitchMock.mockResolvedValue('switched');
        setNewSessionPickerReturnParamsMock.mockClear();
        expoRouterMock.spies.replace.mockClear();
        fireAndForgetPromises.length = 0;
    });

    it('prefers the explicit selected server over stale route params in popover mode', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockClear();
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
                    maxHeight={520}
                    onClose={() => {}}
                    selectedServerId="server-b"
                />);

        expect(capturedItems.map((item) => ({
            title: item.title,
            selected: item.selected,
        }))).toEqual([
            { title: 'Server A', selected: false },
            { title: 'Server B', selected: true },
        ]);
    });

    it('looks up credentials using the explicit selected Home identity', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockClear();
        getCredentialsForServerUrlMock.mockResolvedValueOnce(null);
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
                    maxHeight={520}
                    onClose={() => {}}
                    selectedServerId="server-b"
                />);

        const serverBItem = capturedItems.find((item) => item.title === 'Server B');
        if (!serverBItem || typeof serverBItem.onPress !== 'function') {
            throw new Error('Expected Server B item with onPress handler');
        }

        serverBItem.onPress();
        await Promise.all(fireAndForgetPromises);

        expect(getCredentialsForServerUrlMock).toHaveBeenCalledWith('http://server-b.local', { serverId: 'server-b' });
    });

    it('uses device-scoped focus for signed-out Home authentication on native', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockResolvedValueOnce(null);
        const { Platform } = await import('react-native');
        const previousPlatform = Platform.OS;
        (Platform as { OS: string }).OS = 'ios';
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-b"
        />);

        const serverBItem = capturedItems.find((item) => item.title === 'Server B');
        if (!serverBItem || typeof serverBItem.onPress !== 'function') {
            throw new Error('Expected Server B item with onPress handler');
        }
        serverBItem.onPress();
        await Promise.all(fireAndForgetPromises);

        expect(setActiveServerAndSwitchMock).toHaveBeenCalledWith({
            serverId: 'server-b',
            scope: 'device',
            refreshAuth: refreshFromActiveServerMock,
        });
        expect(expoRouterMock.spies.replace).toHaveBeenCalledWith({
            pathname: '/',
            params: expect.objectContaining({
                newSessionAuthContinuation: '1',
                spawnServerId: 'server-b',
                draftId: 'draft-1',
                agentType: 'codex',
            }),
        });
        (Platform as { OS: string }).OS = previousPlatform;
    });

    it('exposes the mutually exclusive Home selection as one named radio group', async () => {
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-b"
        />);

        expect(capturedItemGroups.at(-1)).toMatchObject({
            accessibilityRole: 'radiogroup',
            accessibilityLabel: 'server.switchToServer',
        });
        expect(capturedItems.map((item) => ({
            title: item.title,
            accessibilityRole: item.accessibilityRole,
            selected: item.selected,
        }))).toEqual([
            { title: 'Server A', accessibilityRole: 'radio', selected: false },
            { title: 'Server B', accessibilityRole: 'radio', selected: true },
        ]);
    });

    it('owns scrolling only when rendered as the standalone picker', async () => {
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        const standalone = await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-a"
            ownsScrollViewport={true}
        />);
        expect(capturedItemLists.map((entry) => entry.kind)).toEqual(['scroll']);
        await act(async () => {
            standalone.tree.unmount();
        });

        capturedItemLists.length = 0;
        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-a"
            ownsScrollViewport={false}
        />);
        expect(capturedItemLists.map((entry) => entry.kind)).toEqual(['static']);
    });

    it('preserves the current Home and draft when target credential lookup fails', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockRejectedValueOnce(new Error('secure storage unavailable'));
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-a"
        />);

        const serverBItem = capturedItems.find((item) => item.title === 'Server B');
        if (!serverBItem || typeof serverBItem.onPress !== 'function') {
            throw new Error('Expected Server B item with onPress handler');
        }
        serverBItem.onPress();
        await Promise.all(fireAndForgetPromises);

        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
        expect(setNewSessionPickerReturnParamsMock).not.toHaveBeenCalled();
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalled();
    });

    it('shows one Home auth status instead of raw endpoint diagnostics', async () => {
        capturedItems.length = 0;
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-a"
        />);

        expect(capturedItems.map((item) => ({
            title: item.title,
            subtitle: item.subtitle,
        }))).toEqual([
            { title: 'Server A', subtitle: 'server.signedIn' },
            { title: 'Server B', subtitle: 'server.signedOut' },
        ]);
    });

    it('does not mutate navigation when custody blocks a signed-out Home switch', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockResolvedValueOnce(null);
        setActiveServerAndSwitchMock.mockResolvedValueOnce('blocked');
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-b"
        />);

        const serverBItem = capturedItems.find((item) => item.title === 'Server B');
        if (!serverBItem || typeof serverBItem.onPress !== 'function') {
            throw new Error('Expected Server B item with onPress handler');
        }
        serverBItem.onPress();
        await Promise.all(fireAndForgetPromises);

        expect(setActiveServerAndSwitchMock).toHaveBeenCalledTimes(1);
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalled();
    });

    it('preserves the current selection when a signed-out Home switch fails', async () => {
        capturedItems.length = 0;
        getCredentialsForServerUrlMock.mockResolvedValueOnce(null);
        setActiveServerAndSwitchMock.mockRejectedValueOnce(new Error('target unavailable'));
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
            maxHeight={520}
            onClose={() => {}}
            selectedServerId="server-a"
        />);

        const serverBItem = capturedItems.find((item) => item.title === 'Server B');
        if (!serverBItem || typeof serverBItem.onPress !== 'function') {
            throw new Error('Expected Server B item with onPress handler');
        }
        serverBItem.onPress();
        await expect(Promise.all(fireAndForgetPromises)).rejects.toThrow('target unavailable');

        expect(setNewSessionPickerReturnParamsMock).not.toHaveBeenCalled();
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalled();
    });

    it('lists and selects a Home by stable identity when its local profile id differs', async () => {
        serverProfilesState.value = [
            { id: 'server-a', name: 'Server A', serverUrl: 'http://server-a.local' },
            {
                id: 'legacy-server-b',
                serverIdentityId: 'srv_identity_b',
                name: 'Server B',
                serverUrl: 'http://server-b.local',
            },
        ];
        capturedItems.length = 0;
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        await renderScreen(<NewSessionServerSelectionContent
                    maxHeight={520}
                    onClose={() => {}}
                    selectedServerId="srv_identity_b"
                />);

        expect(capturedItems.map((item) => ({ title: item.title, selected: item.selected }))).toEqual([
            { title: 'Server A', selected: false },
            { title: 'Server B', selected: true },
        ]);
    });

    it('caps the popover content without forcing every server picker to max height', async () => {
        const { NewSessionServerSelectionContent } = await import('./NewSessionServerSelectionContent');

        const screen = await renderScreen(<NewSessionServerSelectionContent
                    maxHeight={333}
                    onClose={() => {}}
                    selectedServerId="server-a"
                />);

        const cappedContainer = screen.findAllByType('View').find((node) => {
            const style = flattenStyle(readProps<StyleLikeProps>(node).style);
            return style.maxHeight === 333;
        });

        expect(cappedContainer).toBeDefined();
        const style = flattenStyle(readProps<StyleLikeProps>(cappedContainer!).style);
        expect(style.maxHeight).toBe(333);
        expect(style.height).toBeUndefined();
        expect(style.flex).toBeUndefined();
    });
});
