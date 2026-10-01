import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { clearTempData, peekTempData, type NewSessionData } from '@/utils/sessions/tempDataStore';
import { createUseLocalSettingMock, createUseSettingMock } from '@/dev/testkit/mocks/storage';
import type { ProjectMobileSurface } from '@/components/workspaceCockpit/project/projectCockpitState';
import type { WorkspaceRefV1 } from '@happier-dev/protocol';

const routerPushSpy = vi.hoisted(() => vi.fn());
const openUniversalSearchSpy = vi.hoisted(() => vi.fn());
const rememberLastProjectSessionSelections = vi.hoisted(() => ({ value: true }));
const sessionById = vi.hoisted(() => ({ value: {} as Record<string, any> }));
const projectOpenState = vi.hoisted((): {
    workspaceRefs: WorkspaceRefV1[];
    mobileSurfaces: Record<string, ProjectMobileSurface>;
    activeRootPaths: Record<string, string>;
    worktreeIds: Record<string, string>;
} => ({
    workspaceRefs: [],
    mobileSurfaces: {},
    activeRootPaths: {},
    worktreeIds: {},
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: {
            push: routerPushSpy,
        },
    }).module;
});

vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'phone' }));

vi.mock('@/components/workspaceCockpit/useMobileWorkspaceExperienceState', () => ({
    useMobileWorkspaceExperienceState: () => ({ cockpitEnabled: true }),
}));

vi.mock('@/components/appShell/panes/AppPaneProvider', () => ({
    useOptionalAppPaneContext: () => ({ state: { scopes: {} } }),
}));

vi.mock('@/components/appShell/search/UniversalSearchRuntimeContext', () => ({
    useUniversalSearchRuntime: () => ({
        open: openUniversalSearchSpy,
        buildCommands: vi.fn(),
    }),
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    const readStorageState = () => ({
        sessions: sessionById.value,
        machines: {
            machine_target: {
                id: 'machine_target',
                active: true,
                activeAt: 1,
                metadata: { host: 'target-host' },
            },
        },
    });
    return createStorageModuleMock({
        importOriginal,
        overrides: {
            storage: Object.assign(
                ((selector?: (state: any) => unknown) => {
                    const state = readStorageState();
                    return typeof selector === 'function' ? selector(state) : state;
                }) as any,
                {
                    getState: readStorageState,
                    getInitialState: readStorageState,
                    setState: () => undefined,
                    subscribe: () => () => undefined,
                    destroy: () => undefined,
                },
            ),
            useSetting: createUseSettingMock({ fallback: (name) => {
                if (name === 'rememberLastProjectSessionSelections') {
                    return rememberLastProjectSessionSelections.value;
                }
                if (name === 'workspaceRefsV1') {
                    return projectOpenState.workspaceRefs;
                }
                return undefined;
            } }),
            useLocalSetting: createUseLocalSettingMock({ fallback: (name) => (
                name === 'projectLastActiveRootPathByWorkspaceRefId'
                    ? projectOpenState.activeRootPaths
                    : name === 'projectLastActiveWorktreeIdByWorkspaceRefId'
                        ? projectOpenState.worktreeIds
                        : undefined
            ) }),
            useProjectLastMobileSurfacesByWorkspaceRefId: () => projectOpenState.mobileSurfaces,
        },
    });
});

describe('useSessionListNavigationActions', () => {
    beforeEach(() => {
        routerPushSpy.mockClear();
        openUniversalSearchSpy.mockClear();
        rememberLastProjectSessionSelections.value = true;
        sessionById.value = {};
        projectOpenState.workspaceRefs = [];
        projectOpenState.mobileSurfaces = {};
        projectOpenState.activeRootPaths = {};
        projectOpenState.worktreeIds = {};
        clearTempData();
    });

    afterEach(() => {
        clearTempData();
    });

    it('routes project create-session actions into a prefilled new-session flow', async () => {
        const { useSessionListNavigationActions } = await import('./useSessionListNavigationActions');
        const hook = await renderHook(() => useSessionListNavigationActions());

        await act(async () => {
            hook.getCurrent().handleCreateSessionFromWorkspaceScope({
                serverId: 'server_a',
                machineId: 'machine_a',
                rootPath: '/repo',
            });
        });

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                draftId: expect.any(String),
                machineId: 'machine_a',
                directory: '/repo',
                spawnServerId: 'server_a',
            },
        });

        await hook.unmount();
    });

    it('opens an existing project through its persisted mobile surface and worktree', async () => {
        projectOpenState.workspaceRefs = [{
            id: 'wr_1',
            serverId: 'server_a',
            machineId: 'machine_a',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];
        projectOpenState.mobileSurfaces = { wr_1: 'git' };
        projectOpenState.activeRootPaths = { wr_1: '/repo/.worktrees/feature' };
        projectOpenState.worktreeIds = { wr_1: 'gitwt_feature' };

        const { useSessionListNavigationActions } = await import('./useSessionListNavigationActions');
        const hook = await renderHook(() => useSessionListNavigationActions());

        act(() => {
            hook.getCurrent().handleOpenProject('wr_1');
        });

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1/git?worktreeId=gitwt_feature');
        await hook.unmount();
    });

    it('uses the latest project session configuration when the remember setting is enabled', async () => {
        sessionById.value = {
            seed_sess: {
                id: 'seed_sess',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: false,
                activeAt: 1,
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 0,
                presence: 'online',
                encryptionMode: 'plain',
                metadata: {
                    machineId: 'machine-source',
                    path: '/old/repo',
                    flavor: 'codex',
                    backendTarget: { kind: 'backend', backendId: 'codex' },
                    profileId: 'profile-1',
                    transcriptStorage: 'direct',
                    codexBackendMode: 'appServer',
                    sessionModeOverrideV1: {
                        v: 1,
                        updatedAt: 100,
                        modeId: 'plan',
                    },
                },
                permissionMode: 'acceptEdits',
                permissionModeUpdatedAt: 101,
                modelMode: 'gpt-5',
                modelModeUpdatedAt: 102,
            },
        };

        const { useSessionListNavigationActions } = await import('./useSessionListNavigationActions');
        const hook = await renderHook(() => useSessionListNavigationActions());

        await act(async () => {
            (hook.getCurrent().handleCreateSessionFromWorkspaceScope as any)({
                serverId: 'server_a',
                machineId: 'machine_target',
                rootPath: '/repo',
            }, { seedSessionId: 'seed_sess' });
        });

        const pushArg = routerPushSpy.mock.calls[0]?.[0] as any;
        expect(pushArg).toEqual({
            pathname: '/new',
            params: {
                dataId: expect.any(String),
                draftId: expect.any(String),
                machineId: 'machine_target',
                directory: '/repo',
                spawnServerId: 'server_a',
            },
        });
        const tempData = peekTempData<NewSessionData>(pushArg.params.dataId);
        expect(tempData).toEqual(expect.objectContaining({
            prompt: '',
            replacePersistedDraftSelections: true,
            machineId: 'machine_target',
            directory: '/repo',
            agentType: 'codex',
            agentTarget: {
                kind: 'agent',
                identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
            },
            backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
            selectedProfileId: 'profile-1',
            transcriptStorage: 'direct',
            permissionMode: 'safe-yolo',
            modelSelection: {
                v: 1,
                ref: {
                    agentTargetKey: 'agent:happier.agent.codex/codex',
                    modelId: 'gpt-5',
                    providerConnectionId: null,
                },
                updatedAt: 102,
            },
            acpSessionModeId: 'plan',
        }));

        await hook.unmount();
    });

    it('starts a project session from the canonical Session control path', async () => {
        rememberLastProjectSessionSelections.value = false;
        sessionById.value = {
            seed_sess: {
                id: 'seed_sess',
                active: false,
                metadataLayoutVersion: 1,
                metadata: {},
                ownerMetadataView: {
                    machineId: 'machine_target',
                    path: '/home/coder/repo',
                    sessionWorkspaceLocationV1: {
                        v: 1,
                        machineId: 'machine_target',
                        agentPath: '/home/coder/repo',
                        machinePath: '/Users/alice/repo',
                    },
                },
            },
        };

        const { useSessionListNavigationActions } = await import('./useSessionListNavigationActions');
        const hook = await renderHook(() => useSessionListNavigationActions());

        await act(async () => {
            hook.getCurrent().handleCreateSessionFromWorkspaceScope({
                serverId: 'server_a',
                machineId: 'machine_target',
                rootPath: '/home/coder/repo',
            }, { seedSessionId: 'seed_sess' });
        });

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                draftId: expect.any(String),
                machineId: 'machine_target',
                directory: '/home/coder/repo',
                spawnServerId: 'server_a',
            },
        });

        await hook.unmount();
    });

    it('escalates through the canonical universal Search opener with a normalized query', async () => {
        const { useSessionListNavigationActions } = await import('./useSessionListNavigationActions');
        const hook = await renderHook(() => useSessionListNavigationActions({
            accountId: 'account-b',
            serverId: 'home-b',
            sessionId: null,
            machineId: null,
            rootPath: null,
        }));

        await act(async () => {
            hook.getCurrent().handleOpenUniversalSearch('  vector  ');
        });

        expect(openUniversalSearchSpy).toHaveBeenCalledWith('vector', {
            accountId: 'account-b',
            serverId: 'home-b',
            sessionId: null,
            machineId: null,
            rootPath: null,
        });
        expect(routerPushSpy).not.toHaveBeenCalled();

        await hook.unmount();
    });
});
