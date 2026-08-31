import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';
import type { HomeViewSelectionSettings } from '@/hooks/server/useHomeViewSelectionSettings';


installServerSettingsHooksCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: vi.fn(async () => true),
                prompt: vi.fn(async () => null),
                show: vi.fn(),
            },
        }).module;
    },
});

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => null),
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));

const promptSignedOutServerSwitchConfirmationMock = vi.fn(async () => true);
vi.mock('@/components/settings/server/modals/ServerSwitchAuthPrompt', () => ({
    promptSignedOutServerSwitchConfirmation: promptSignedOutServerSwitchConfirmationMock,
}));

async function renderHook<T extends object>(
    useValue: () => T,
): Promise<T & { __cleanup: () => Promise<void> }> {
    let current: T | null = null;
    let tree: renderer.ReactTestRenderer | null = null;

    function Test() {
        current = useValue();
        return null;
    }

    tree = (await renderScreen(React.createElement(Test))).tree;

    if (!current) {
        throw new Error('Hook did not render');
    }

    return Object.assign(current, {
        __cleanup: async () => {
            if (!tree) {
                return;
            }
            await act(async () => {
                tree?.unmount();
            });
            tree = null;
        },
    });
}

function makeServerProfile(id: string, name: string, serverUrl: string): ServerProfile {
    return {
        id,
        name,
        serverUrl,
        createdAt: 0,
        updatedAt: 0,
        lastUsedAt: 0,
    };
}

function createHomeViewSetter(initial: HomeViewSelectionSettings) {
    let current = initial;
    const setHomeViewSelectionSettings = vi.fn((
        update: (value: HomeViewSelectionSettings) => HomeViewSelectionSettings,
    ) => {
        current = update(current);
    });
    return { setHomeViewSelectionSettings, getCurrent: () => current };
}

describe('useServerSettingsGroupActions', () => {
    const mountedHookCleanups: Array<() => Promise<void>> = [];

    beforeEach(() => {
        mountedHookCleanups.length = 0;
        promptSignedOutServerSwitchConfirmationMock.mockReset();
        promptSignedOutServerSwitchConfirmationMock.mockResolvedValue(true);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        while (mountedHookCleanups.length > 0) {
            const cleanup = mountedHookCleanups.pop();
            if (!cleanup) {
                continue;
            }
            await cleanup();
        }
        vi.resetModules();
    });

    it('seeds default selection when deleting the active server group', async () => {
        const networkBoundary = vi.spyOn(globalThis, 'fetch');
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const activeServerId = 'server-a';
        const homeView = createHomeViewSetter({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: ['server-a', 'server-b'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        const setRevision = vi.fn();
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId,
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-a': 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['server-a', 'server-b'], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById: vi.fn(async () => 'switched' as const),
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onRemoveGroup({ id: 'grp', name: 'Group', serverIds: ['server-a', 'server-b'], presentation: 'grouped' });

        expect(homeView.setHomeViewSelectionSettings).toHaveBeenCalledTimes(1);
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: activeServerId,
        });
        expect(networkBoundary).not.toHaveBeenCalled();
        networkBoundary.mockRestore();
    });

    it('switching to a server selects an explicit server target and disables group mode', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = createHomeViewSetter({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-b': 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['server-a', 'server-b'], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp', name: 'Group', serverIds: ['server-a', 'server-b'], presentation: 'grouped' });

        expect(homeView.setHomeViewSelectionSettings).toHaveBeenCalledTimes(1);
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(setRevision).toHaveBeenCalled();
    });

    it('checks signed-out confirmation against identity-backed group server ids', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = createHomeViewSetter({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'srv-a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const onAfterSignedOutSwitch = vi.fn();
        const serverA = {
            ...makeServerProfile('server-a', 'Server A', 'http://localhost:3013'),
            serverIdentityId: 'srv-a',
        };
        const serverB = {
            ...makeServerProfile('server-b', 'Server B', 'http://localhost:3012'),
            serverIdentityId: 'srv-b',
        };

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'srv-a',
            validServerIds: new Set(['srv-a', 'srv-b']),
            authStatusByServerId: {},
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['srv-b'], presentation: 'grouped' } as const,
            ],
            activeGroupId: null,
            groupPresentation: 'grouped',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch,
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp', name: 'Group', serverIds: ['srv-b'], presentation: 'grouped' });

        expect(promptSignedOutServerSwitchConfirmationMock).toHaveBeenCalledTimes(1);
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        expect(onSwitchServerById).toHaveBeenCalledWith('srv-b');
        expect(onAfterSignedOutSwitch).toHaveBeenCalledTimes(1);
    });

    it('keeps the current HomeView target unchanged when custody blocks the group focus switch', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = createHomeViewSetter({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const onSwitchServerById = vi.fn(async () => 'blocked' as const);
        const setRevision = vi.fn();
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-b': 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp-b', name: 'Group B', serverIds: ['server-b'], presentation: 'grouped' } as const,
            ],
            activeGroupId: null,
            groupPresentation: 'grouped',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp-b', name: 'Group B', serverIds: ['server-b'], presentation: 'grouped' });

        expect(onSwitchServerById).toHaveBeenCalledWith('server-b');
        expect(homeView.setHomeViewSelectionSettings).not.toHaveBeenCalled();
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        expect(setRevision).not.toHaveBeenCalled();
    });

    it('creates a server group from the add-server-group flow', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = createHomeViewSetter({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-a': 'signedIn' },
            normalizedGroupProfiles: [],
            activeGroupId: null,
            groupPresentation: 'grouped',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const created = await actions.onCreateServerGroup({
            name: 'My Group',
            serverIds: ['server-a', 'server-b'],
        });

        expect(created).toBe(true);
        expect(homeView.setHomeViewSelectionSettings).toHaveBeenCalledTimes(1);
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'my-group',
        });
        expect(setRevision).toHaveBeenCalled();
    });
});
