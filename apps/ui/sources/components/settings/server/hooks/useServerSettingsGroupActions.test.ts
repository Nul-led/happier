import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';
import type { HomeViewSelectionSettings } from '@/hooks/server/useHomeViewSelectionSettings';
import { installWebLockManagerMock } from '@/auth/storage/tokenStorage.web.testHelpers';


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

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: { getCredentialsForServerUrl: vi.fn(async () => null) },
    });
});

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

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('useServerSettingsGroupActions', () => {
    const mountedHookCleanups: Array<() => Promise<void>> = [];
    let restoreWebLockManager: (() => void) | null = null;

    const previousStorageScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    beforeEach(() => {
        // A fresh storage scope isolates each test's saved Homes without
        // reloading the module graph.
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `group_actions_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        mountedHookCleanups.length = 0;
        vi.clearAllMocks();
        restoreWebLockManager = installWebLockManagerMock().restore;
    });

    afterEach(async () => {
        while (mountedHookCleanups.length > 0) {
            const cleanup = mountedHookCleanups.pop();
            if (!cleanup) {
                continue;
            }
            await cleanup();
        }
        restoreWebLockManager?.();
        restoreWebLockManager = null;
        vi.restoreAllMocks();
        (await import('@/sync/domains/server/serverProfiles')).resetServerProfilesRuntimeForTests();
        if (previousStorageScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousStorageScope;
    });

    /**
     * Seeds the device-global Home-view owner and hands the action the real
     * production setter (`useHomeViewSelectionSettingsMutable`). Assertions read
     * the persisted/effective owner state, never a local copy, so a setter that
     * ignored the requested target scope would be observable.
     */
    async function seedHomeView(initial: HomeViewSelectionSettings) {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const selection = await import('@/sync/domains/server/selection/homeViewSelectionState');
        const { normalizeServerSelectionGroupsForSettings } = await import('@/sync/domains/server/selection/serverSelectionSettingsAdapter');
        const { useHomeViewSelectionSettingsMutable } = await import('@/hooks/server/useHomeViewSelectionSettings');
        await profiles.saveHomeViewState({
            version: 1,
            groups: initial.serverSelectionGroups,
            activeTargetKind: initial.serverSelectionActiveTargetKind,
            activeTargetId: initial.serverSelectionActiveTargetId,
        });
        const probe = await renderHook(() => useHomeViewSelectionSettingsMutable());
        mountedHookCleanups.push(probe.__cleanup);
        const project = (state: ReturnType<typeof selection.loadEffectiveHomeViewState>): HomeViewSelectionSettings => ({
            serverSelectionGroups: normalizeServerSelectionGroupsForSettings(state?.groups ?? []),
            serverSelectionActiveTargetKind: state?.activeTargetKind ?? null,
            serverSelectionActiveTargetId: state?.activeTargetId ?? null,
        });
        return {
            setHomeViewSelectionSettings: probe.setHomeViewSelectionSettings,
            /** This runtime's effective Home view (device state plus any tab target). */
            getCurrent: () => project(selection.loadEffectiveHomeViewState()),
            /** The device-global persisted Home view. */
            getDevice: () => project(profiles.loadHomeViewState()),
            // Another writer (another surface/tab) landing a change through the
            // canonical persisted owner while an action awaits a modal, auth probe
            // or focus switch.
            applyConcurrentChange: async (
                update: (value: HomeViewSelectionSettings) => HomeViewSelectionSettings,
            ): Promise<void> => {
                await profiles.updateHomeViewState((current) => {
                    const next = update(project(current));
                    return {
                        version: 1,
                        groups: next.serverSelectionGroups,
                        activeTargetKind: next.serverSelectionActiveTargetKind,
                        activeTargetId: next.serverSelectionActiveTargetId,
                    };
                });
            },
        };
    }

    it('seeds default selection without issuing push unregister when deleting the active server group', async () => {
        const networkBoundary = vi.spyOn(globalThis, 'fetch');
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const serverA = await profiles.upsertServerProfile({
            serverUrl: 'http://localhost:3013',
            name: 'Server A',
        });
        const serverB = await profiles.upsertServerProfile({
            serverUrl: 'http://localhost:3012',
            name: 'Server B',
        });
        await profiles.setActiveServerId(serverA.id, { scope: 'device' });
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const activeServerId = serverA.id;
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        const setRevision = vi.fn();

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId,
            validServerIds: new Set([serverA.id, serverB.id]),
            authStatusByServerId: { [serverA.id]: 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById: vi.fn(async () => 'switched' as const),
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onRemoveGroup({ id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' });

        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: activeServerId,
        });
        expect(networkBoundary).not.toHaveBeenCalled();
        expect(networkBoundary).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ method: 'DELETE' }),
        );
        networkBoundary.mockRestore();
    });

    it('uses the currently applied Home after the remove confirmation resolves', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeServer = vi.spyOn(profiles, 'getActiveServerId').mockReturnValue('server-a');
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const { Modal } = await import('@/modal');
        const confirmation = createDeferred<boolean>();
        vi.mocked(Modal.confirm).mockImplementationOnce(async () => await confirmation.promise);
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');
        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-a': 'signedIn', 'server-b': 'signedIn' },
            normalizedGroupProfiles: [{ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' }],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById: vi.fn(async () => 'switched' as const),
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const removing = actions.onRemoveGroup({ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' });
        activeServer.mockReturnValue('server-b');
        confirmation.resolve(true);
        await removing;

        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-b',
        });
    });

    it('renames the group against the current state landed while the prompt was open', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const { Modal } = await import('@/modal');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        const prompt = createDeferred<string | null>();
        vi.mocked(Modal.prompt).mockImplementationOnce(async () => await prompt.promise);
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a']),
            authStatusByServerId: { 'server-a': 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById: vi.fn(async () => 'switched' as const),
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const pending = actions.onRenameGroup({ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' });
        await homeView.applyConcurrentChange((current) => ({
            ...current,
            serverSelectionGroups: [
                ...current.serverSelectionGroups,
                { id: 'other', name: 'Other', serverIds: ['server-a'], presentation: 'grouped' },
            ],
        }));
        prompt.resolve('Renamed');
        await pending;

        expect(homeView.getCurrent().serverSelectionGroups).toEqual([
            { id: 'grp', name: 'Renamed', serverIds: ['server-a'], presentation: 'grouped' },
            { id: 'other', name: 'Other', serverIds: ['server-a'], presentation: 'grouped' },
        ]);
    });

    it('removes the group from current state and leaves a concurrently changed target alone', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const { Modal } = await import('@/modal');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        const confirm = createDeferred<boolean>();
        vi.mocked(Modal.confirm).mockImplementationOnce(async () => await confirm.promise);
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a']),
            authStatusByServerId: { 'server-a': 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById: vi.fn(async () => 'switched' as const),
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const pending = actions.onRemoveGroup({ id: 'grp', name: 'Group', serverIds: ['server-a'], presentation: 'grouped' });
        await homeView.applyConcurrentChange((current) => ({
            serverSelectionGroups: [
                ...current.serverSelectionGroups,
                { id: 'other', name: 'Other', serverIds: ['server-a'], presentation: 'grouped' },
            ],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'other',
        }));
        confirm.resolve(true);
        await pending;

        expect(homeView.getCurrent()).toEqual({
            serverSelectionGroups: [{ id: 'other', name: 'Other', serverIds: ['server-a'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'other',
        });
    });

    it('allocates the created group id against the state present at commit time', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const switchDeferred = createDeferred<'switched'>();
        const onSwitchServerById = vi.fn(async () => await switchDeferred.promise);
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: { 'server-b': 'signedIn' },
            normalizedGroupProfiles: [],
            activeGroupId: null,
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const pending = actions.onCreateServerGroup({ name: 'My Group', serverIds: ['server-b'] });
        await homeView.applyConcurrentChange((current) => ({
            ...current,
            serverSelectionGroups: [
                { id: 'my-group', name: 'Someone Else', serverIds: ['server-a'], presentation: 'grouped' },
            ],
        }));
        switchDeferred.resolve('switched');

        expect(await pending).toBe(true);
        expect(homeView.getCurrent()).toEqual({
            serverSelectionGroups: [
                { id: 'my-group', name: 'Someone Else', serverIds: ['server-a'], presentation: 'grouped' },
                { id: 'my-group-2', name: 'My Group', serverIds: ['server-b'], presentation: 'grouped' },
            ],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'my-group-2',
        });
    });

    it('switching to a server selects an explicit server target and disables group mode', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const serverA = await profiles.upsertServerProfile({
            serverUrl: 'http://localhost:3013',
            name: 'Server A',
        });
        const serverB = await profiles.upsertServerProfile({
            serverUrl: 'http://localhost:3012',
            name: 'Server B',
        });
        await profiles.setActiveServerId(serverA.id, { scope: 'device' });
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: serverA.id,
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: serverA.id,
            validServerIds: new Set([serverA.id, serverB.id]),
            authStatusByServerId: { [serverB.id]: 'signedIn' },
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' } as const,
            ],
            activeGroupId: 'grp',
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp', name: 'Group', serverIds: [serverA.id, serverB.id], presentation: 'grouped' });

        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        expect(onSwitchServerById).not.toHaveBeenCalled();
        expect(setRevision).toHaveBeenCalled();
    });

    it('selects a signed-out identity-backed group target without another prompt', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const savedA = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3013', name: 'Server A' });
        const savedB = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3012', name: 'Server B' });
        await profiles.setServerProfileIdentityForUrl(savedA.serverUrl, 'srv_a');
        await profiles.setServerProfileIdentityForUrl(savedB.serverUrl, 'srv_b');
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp', name: 'Group', serverIds: ['srv_b'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'srv_a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const onAfterSignedOutSwitch = vi.fn();
        const serverA = { ...savedA, serverIdentityId: 'srv_a' };
        const serverB = { ...savedB, serverIdentityId: 'srv_b' };

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'srv_a',
            validServerIds: new Set(['srv_a', 'srv_b']),
            authStatusByServerId: {},
            normalizedGroupProfiles: [
                { id: 'grp', name: 'Group', serverIds: ['srv_b'], presentation: 'grouped' } as const,
            ],
            activeGroupId: null,
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch,
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp', name: 'Group', serverIds: ['srv_b'], presentation: 'grouped' });

        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp',
        });
        expect(onSwitchServerById).toHaveBeenCalledWith('srv_b');
        expect(onAfterSignedOutSwitch).toHaveBeenCalledTimes(1);
    });

    it('does not route a Home whose credential store cannot be read to sign-in', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const serverA = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3013', name: 'Server A' });
        const serverB = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3012', name: 'Server B' });
        await profiles.setActiveServerId(serverA.id, { scope: 'device' });
        const serverBId = profiles.resolveServerProfileScopeId(serverB);
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        // Mirrors the real storage owner: an unreadable store reads as absent
        // unless the caller asks for the failure to surface.
        vi.mocked(TokenStorage.getCredentialsForServerUrl).mockImplementationOnce(async (_serverUrl, options) => {
            if (options?.storageReadFailure === 'surface') throw new Error('secure_storage_unavailable');
            return null;
        });
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: serverA.id,
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const onAfterSignedOutSwitch = vi.fn();
        const group = { id: 'grp-b', name: 'Group B', serverIds: [serverBId], presentation: 'grouped' } as const;

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: serverA.id,
            validServerIds: new Set([serverA.id, serverBId]),
            authStatusByServerId: {},
            normalizedGroupProfiles: [group],
            activeGroupId: null,
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch,
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup(group);

        expect(onSwitchServerById).toHaveBeenCalledWith(serverBId);
        expect(onAfterSignedOutSwitch).not.toHaveBeenCalled();
    });

    it('re-reads the applied Home after group authentication resolves', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const activeServer = vi.spyOn(profiles, 'getActiveServerId').mockReturnValue('server-a');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const credentials = createDeferred<{ token: string } | null>();
        vi.mocked(TokenStorage.getCredentialsForServerUrl).mockImplementationOnce(async () => await credentials.promise);
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp-a', name: 'Group A', serverIds: ['server-a'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');
        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b']),
            authStatusByServerId: {},
            normalizedGroupProfiles: [
                { id: 'grp-a', name: 'Group A', serverIds: ['server-a'], presentation: 'grouped' } as const,
            ],
            activeGroupId: null,
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        const switching = actions.onSwitchGroup({
            id: 'grp-a',
            name: 'Group A',
            serverIds: ['server-a'],
            presentation: 'grouped',
        });
        activeServer.mockReturnValue('server-b');
        credentials.resolve({ token: 'home-a-token' });
        await switching;

        expect(onSwitchServerById).toHaveBeenCalledWith('server-a');
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp-a',
        });
    });

    it('chooses the first credentialed group member when the current Home is outside the group', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [{ id: 'grp-bc', name: 'Group B+C', serverIds: ['server-b', 'server-c'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const serverA = makeServerProfile('server-a', 'Server A', 'http://localhost:3013');
        const serverB = makeServerProfile('server-b', 'Server B', 'http://localhost:3012');
        const serverC = makeServerProfile('server-c', 'Server C', 'http://localhost:3011');

        const actions = await renderHook(() => useServerSettingsGroupActions({
            servers: [serverA, serverB, serverC],
            activeServerId: 'server-a',
            validServerIds: new Set(['server-a', 'server-b', 'server-c']),
            authStatusByServerId: {
                'server-b': 'signedOut',
                'server-c': 'signedIn',
            },
            normalizedGroupProfiles: [
                { id: 'grp-bc', name: 'Group B+C', serverIds: ['server-b', 'server-c'], presentation: 'grouped' } as const,
            ],
            activeGroupId: null,
            groupPresentation: 'grouped',
            selectionScope: 'device',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp-bc', name: 'Group B+C', serverIds: ['server-b', 'server-c'], presentation: 'grouped' });

        expect(onSwitchServerById).toHaveBeenCalledWith('server-c');
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp-bc',
        });
    });

    it('keeps the current HomeView target unchanged when custody blocks the group focus switch', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
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
            selectionScope: 'device',
            setRevision: setRevision as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onSwitchGroup({ id: 'grp-b', name: 'Group B', serverIds: ['server-b'], presentation: 'grouped' });

        expect(onSwitchServerById).toHaveBeenCalledWith('server-b');
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-a',
        });
        expect(setRevision).not.toHaveBeenCalled();
    });

    it('creates a server group from the add-server-group flow', async () => {
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
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
            selectionScope: 'device',
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
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'my-group',
        });
        expect(setRevision).toHaveBeenCalled();
    });

    it('persists a group created from a browser tab device-wide while targeting it only in that tab', async () => {
        // Browser boundary: a tab has its own session storage beside the
        // device-wide local storage that holds saved Homes and Home groups.
        const storageOf = (values: Map<string, string>) => ({
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => void values.set(key, String(value)),
            removeItem: (key: string) => void values.delete(key),
            clear: () => void values.clear(),
        });
        vi.stubGlobal('sessionStorage', storageOf(new Map()));
        vi.stubGlobal('window', {
            location: { origin: 'https://origin.example.test', hostname: 'origin.example.test' },
            localStorage: storageOf(new Map()),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', {});
        try {
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const serverA = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3013', name: 'Server A' });
            const serverB = await profiles.upsertServerProfile({ serverUrl: 'http://localhost:3012', name: 'Server B' });
            const serverAId = profiles.resolveServerProfileScopeId(serverA);
            const serverBId = profiles.resolveServerProfileScopeId(serverB);
            await profiles.setActiveServerId(serverAId, { scope: 'device' });
            const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
            const homeView = await seedHomeView({
                serverSelectionGroups: [],
                serverSelectionActiveTargetKind: 'server',
                serverSelectionActiveTargetId: serverAId,
            });

            const actions = await renderHook(() => useServerSettingsGroupActions({
                servers: [serverA, serverB],
                activeServerId: serverAId,
                validServerIds: new Set([serverAId, serverBId]),
                authStatusByServerId: { [serverAId]: 'signedIn', [serverBId]: 'signedIn' },
                normalizedGroupProfiles: [],
                activeGroupId: null,
                groupPresentation: 'grouped',
                selectionScope: 'tab',
                setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
                onSwitchServerById: vi.fn(async () => 'switched' as const),
                onAfterSignedOutSwitch: vi.fn(),
                setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
            }));
            mountedHookCleanups.push(actions.__cleanup);

            await expect(actions.onCreateServerGroup({ name: 'Both', serverIds: [serverAId, serverBId] })).resolves.toBe(true);

            const created = { id: 'both', name: 'Both', serverIds: [serverAId, serverBId], presentation: 'grouped' };
            // The group definition is device-global; the device default target is untouched.
            expect(homeView.getDevice()).toEqual({
                serverSelectionGroups: [created],
                serverSelectionActiveTargetKind: 'server',
                serverSelectionActiveTargetId: serverAId,
            });
            // Only this tab now targets the new group.
            expect(homeView.getCurrent()).toMatchObject({
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'both',
            });

            // A later rename from the same tab also persists device-wide.
            const { Modal } = await import('@/modal');
            vi.mocked(Modal.prompt).mockImplementationOnce(async () => 'Renamed');
            await actions.onRenameGroup(created as never);
            expect(homeView.getDevice().serverSelectionGroups).toEqual([{ ...created, name: 'Renamed' }]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('switches back to the chosen group member when focus changed during creation', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        vi.spyOn(profiles, 'getActiveServerId').mockReturnValue('server-b');
        const { useServerSettingsGroupActions } = await import('./useServerSettingsGroupActions');
        const homeView = await seedHomeView({
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: 'server',
            serverSelectionActiveTargetId: 'server-b',
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
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
            selectionScope: 'device',
            setRevision: vi.fn() as unknown as React.Dispatch<React.SetStateAction<number>>,
            onSwitchServerById,
            onAfterSignedOutSwitch: vi.fn(),
            setHomeViewSelectionSettings: homeView.setHomeViewSelectionSettings,
        }));
        mountedHookCleanups.push(actions.__cleanup);

        await actions.onCreateServerGroup({ name: 'A only', serverIds: ['server-a'] });

        expect(onSwitchServerById).toHaveBeenCalledWith('server-a');
        expect(homeView.getCurrent()).toMatchObject({
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'a-only',
        });
    });
});
