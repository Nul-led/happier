import * as React from 'react';
import { act } from 'react-test-renderer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createThemeFixture } from '@/dev/testkit/fixtures/themeFixtures';
import type { Machine } from '@/sync/domains/state/storageTypes';
import type { RemoveWorkspaceRefFromAccountResult } from '@/sync/ops/workspaceRefs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const openMachinePathBrowserModalSpy = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<string | null>>());
const workspaceListDirectorySpy = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
const modalAlertSpy = vi.hoisted(() => vi.fn());
const modalConfirmSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true));
const modalPromptSpy = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<string | null>>());
const terminateRelationshipSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}));
const addWorkspaceRefToAccountSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: true; workspaceRefId: string }>>(async () => ({ ok: true as const, workspaceRefId: 'added-ref' })));
const renameWorkspaceRefInAccountSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })));
const resetWorkspaceRefNameInAccountSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })));
const setWorkspaceRefPinnedInAccountSpy = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })));
const removeWorkspaceRefFromAccountSpy = vi.hoisted(
    () => vi.fn<(...args: unknown[]) => Promise<RemoveWorkspaceRefFromAccountResult>>(async () => ({ ok: true as const })),
);
const routerPushSpy = vi.hoisted(() => vi.fn());
let workspaceSyncRelationshipSummariesMock: any[] = [];
let translationPrefixMock = '';

let machinesMock: Machine[] = [];
let workspaceRefsV1Mock: any[] = [];
let pinnedWorkspaceRefIdsV1Mock: string[] = [];
let deviceTypeMock: 'phone' | 'tablet' = 'tablet';
let paneScopesMock: Record<string, { right?: { activeTabId?: string | null } }> = {};
let localSettingsMock: Record<string, unknown> = {};
let projectLastMobileSurfacesByWorkspaceRefIdMock: Record<string, string> = {};
let accountSettingsMock: Record<string, unknown> = {};
const setWorkspaceRefsV1Spy = vi.hoisted(() => vi.fn());
const setPinnedWorkspaceRefIdsV1Spy = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: React.forwardRef((props: any, ref: any) => React.createElement('View', { ...props, ref }, props.children)),
        Pressable: (props: any) => React.createElement('Pressable', props, props.children),
        Platform: { OS: 'web' },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key, params) => {
            const base = typeof params?.machine === 'string' ? `${key}:${params.machine}` : key;
            return `${translationPrefixMock}${base}`;
        },
    });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: {
            push: routerPushSpy,
        },
    }).module;
});

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => deviceTypeMock,
}));

vi.mock('@/components/appShell/panes/AppPaneProvider', async () => {
    const actual = await vi.importActual<typeof import('@/components/appShell/panes/AppPaneProvider')>(
        '@/components/appShell/panes/AppPaneProvider',
    );
    return {
        ...actual,
        useOptionalAppPaneContext: () => ({
            state: { scopes: paneScopesMock },
        }),
    };
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alert: modalAlertSpy,
            confirm: (...args: any[]) => modalConfirmSpy(...args),
            prompt: (...args: any[]) => modalPromptSpy(...args),
        },
    }).module;
});

vi.mock('@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries', () => ({
    useWorkspaceSyncRelationshipSummaries: () => workspaceSyncRelationshipSummariesMock,
    resolveWorkspaceSyncStatusScope: (summary: any) => ({
        serverId: 'server-1',
        machineId: summary.alpha.machineId,
        relationshipId: summary.relationshipId,
    }),
}));

vi.mock('@/sync/ops/workspaceSync', () => ({
    terminatePersistedWorkspaceSyncRelationship: (...args: any[]) => terminateRelationshipSpy(...args),
}));

vi.mock('@/sync/ops/workspaceRefs', () => ({
    addWorkspaceRefToAccount: (...args: any[]) => addWorkspaceRefToAccountSpy(...args),
    renameWorkspaceRefInAccount: (...args: any[]) => renameWorkspaceRefInAccountSpy(...args),
    resetWorkspaceRefNameInAccount: (...args: any[]) => resetWorkspaceRefNameInAccountSpy(...args),
    setWorkspaceRefPinnedInAccount: (...args: any[]) => setWorkspaceRefPinnedInAccountSpy(...args),
    removeWorkspaceRefFromAccount: (...args: any[]) => removeWorkspaceRefFromAccountSpy(...args),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));

vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: (...args: any[]) => openMachinePathBrowserModalSpy(...args),
}));

vi.mock('@/sync/ops/workspaceFileSystem', () => ({
    workspaceListDirectory: (...args: any[]) => workspaceListDirectorySpy(...args),
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createPartialStorageModuleMock(importOriginal, {
        useAllMachines: () => machinesMock,
        useSetting: (key: string) => {
            if (key === 'workspaceRefsV1') return workspaceRefsV1Mock;
            if (key === 'pinnedWorkspaceRefIdsV1') return pinnedWorkspaceRefIdsV1Mock;
            return accountSettingsMock[key];
        },
        useLocalSetting: (key: string) => localSettingsMock[key],
        useProjectLastMobileSurfacesByWorkspaceRefId: () => projectLastMobileSurfacesByWorkspaceRefIdMock,
        useSettingMutable: (key: string) => {
            if (key === 'workspaceRefsV1') return [workspaceRefsV1Mock, setWorkspaceRefsV1Spy];
            if (key === 'pinnedWorkspaceRefIdsV1') return [pinnedWorkspaceRefIdsV1Mock, setPinnedWorkspaceRefIdsV1Spy];
            return [undefined, vi.fn()];
        },
    });
});

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => {
        const triggerParams = {
            open: Boolean(props.open),
            toggle: vi.fn(),
            openMenu: vi.fn(),
            closeMenu: vi.fn(),
            selectedItem: null,
        };
        const triggerResult = typeof props.trigger === 'function'
            ? props.trigger(triggerParams)
            : props.trigger ?? null;
        return React.createElement('DropdownMenu', props, triggerResult);
    },
}));

function createMachine(params: Readonly<{
    id: string;
    host: string;
    active?: boolean;
    activeAt?: number;
}>): Machine {
    return {
        id: params.id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: params.active ?? true,
        activeAt: params.activeAt ?? 1,
        metadata: {
            host: params.host,
            platform: 'darwin',
            happyCliVersion: '0',
            happyHomeDir: '/tmp/.happy',
            homeDir: '/Users/tester',
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

describe('ProjectsListView', () => {
    beforeEach(() => {
        standardCleanup();
        machinesMock = [];
        workspaceRefsV1Mock = [];
        pinnedWorkspaceRefIdsV1Mock = [];
        deviceTypeMock = 'tablet';
        paneScopesMock = {};
        localSettingsMock = {};
        projectLastMobileSurfacesByWorkspaceRefIdMock = {};
        accountSettingsMock = {};
        translationPrefixMock = '';
        openMachinePathBrowserModalSpy.mockReset();
        workspaceListDirectorySpy.mockReset();
        modalAlertSpy.mockReset();
        modalConfirmSpy.mockReset();
        modalConfirmSpy.mockResolvedValue(true);
        modalPromptSpy.mockReset();
        terminateRelationshipSpy.mockReset();
        terminateRelationshipSpy.mockResolvedValue(undefined);
        addWorkspaceRefToAccountSpy.mockReset();
        addWorkspaceRefToAccountSpy.mockResolvedValue({ ok: true, workspaceRefId: 'added-ref' });
        renameWorkspaceRefInAccountSpy.mockReset();
        renameWorkspaceRefInAccountSpy.mockResolvedValue({ ok: true });
        resetWorkspaceRefNameInAccountSpy.mockReset();
        resetWorkspaceRefNameInAccountSpy.mockResolvedValue({ ok: true });
        setWorkspaceRefPinnedInAccountSpy.mockReset();
        setWorkspaceRefPinnedInAccountSpy.mockResolvedValue({ ok: true });
        removeWorkspaceRefFromAccountSpy.mockReset();
        removeWorkspaceRefFromAccountSpy.mockResolvedValue({ ok: true });
        workspaceSyncRelationshipSummariesMock = [];
        routerPushSpy.mockReset();
        setWorkspaceRefsV1Spy.mockReset();
        setPinnedWorkspaceRefIdsV1Spy.mockReset();
    });

    it('dedupes the empty-state add-first machine rows by display host and keeps the action subtitle', async () => {
        const nowMs = Date.now();
        machinesMock = [
            createMachine({ id: 'm1', host: 'leeroy-mbp', active: true, activeAt: nowMs }),
            createMachine({ id: 'm2', host: 'leeroy-mbp', active: false, activeAt: 1 }),
        ];

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        const firstRow = screen.findByTestId('projects-add-first-machine:m1');
        expect(firstRow).toBeTruthy();
        if (!firstRow) {
            throw new Error('Expected projects-add-first-machine:m1 row to render');
        }
        expect(
            screen.findAllByType('Text' as never)
                .some((node) => String(node.props.children) === 'projects.actions.chooseProjectFolderOnMachine:leeroy-mbp'),
        ).toBe(true);
        expect(
            screen.findAllByType('Text' as never)
                .some((node) => String(node.props.children) === 'projects.actions.chooseProjectFolderSubtitle'),
        ).toBe(true);
        expect(screen.findByTestId('projects-add-first-machine:m2')).toBeNull();
    });

    it('does not persist a project when the selected path cannot be listed via workspace filesystem', async () => {
        const nowMs = Date.now();
        machinesMock = [
            createMachine({ id: 'm1', host: 'leeroy-mbp', active: true, activeAt: nowMs }),
        ];
        openMachinePathBrowserModalSpy.mockResolvedValueOnce('/');
        workspaceListDirectorySpy.mockResolvedValueOnce({ success: false, error: "Access denied: Path '/' is outside the allowed directories" });

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-add-first-machine:m1');

        expect(workspaceListDirectorySpy).toHaveBeenCalledTimes(1);
        expect(setWorkspaceRefsV1Spy).toHaveBeenCalledTimes(0);
        expect(routerPushSpy).toHaveBeenCalledTimes(0);
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);
    });

    it('adds through the semantic Account Settings mutation and opens its committed ref', async () => {
        machinesMock = [createMachine({ id: 'm1', host: 'leeroy-mbp', activeAt: Date.now() })];
        openMachinePathBrowserModalSpy.mockResolvedValueOnce('/repo');
        workspaceListDirectorySpy.mockResolvedValueOnce({ success: true, entries: [] });

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);
        await screen.pressByTestIdAsync('projects-add-first-machine:m1');

        expect(addWorkspaceRefToAccountSpy).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'server-1', machineId: 'm1', rootPath: '/repo' },
        }));
        expect(routerPushSpy).toHaveBeenCalledWith('/projects/added-ref');
        expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
    });

    it('routes rename, reset, pin, and unpin through semantic Account Settings mutations', async () => {
        const workspaceRef = {
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Before',
            createdAtMs: 1,
        };
        machinesMock = [createMachine({ id: 'm1', host: 'leeroy-mbp' })];
        workspaceRefsV1Mock = [workspaceRef];
        modalPromptSpy.mockResolvedValueOnce('  After  ');

        const { ProjectsListView } = await import('./ProjectsListView');
        let screen = await renderScreen(<ProjectsListView />);
        let menuNode = screen.findAll((node: any) => typeof node.props?.onRename === 'function')[0];
        await act(async () => {
            await menuNode?.props.onRename(workspaceRef);
            await menuNode?.props.onReset(workspaceRef);
            await menuNode?.props.onTogglePinned('wr_1');
        });

        expect(renameWorkspaceRefInAccountSpy).toHaveBeenCalledWith({
            serverId: 'server-1', workspaceRefId: 'wr_1', label: 'After',
        });
        expect(resetWorkspaceRefNameInAccountSpy).toHaveBeenCalledWith({
            serverId: 'server-1', workspaceRefId: 'wr_1',
        });
        expect(setWorkspaceRefPinnedInAccountSpy).toHaveBeenCalledWith({
            serverId: 'server-1', workspaceRefId: 'wr_1', pinned: true,
        });

        pinnedWorkspaceRefIdsV1Mock = ['wr_1'];
        standardCleanup();
        screen = await renderScreen(<ProjectsListView />);
        menuNode = screen.findAll((node: any) => typeof node.props?.onTogglePinned === 'function')[0];
        await act(async () => { await menuNode?.props.onTogglePinned('wr_1'); });

        expect(setWorkspaceRefPinnedInAccountSpy).toHaveBeenLastCalledWith({
            serverId: 'server-1', workspaceRefId: 'wr_1', pinned: false,
        });
        expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
        expect(setPinnedWorkspaceRefIdsV1Spy).not.toHaveBeenCalled();
    });

    it('opens the last active mobile project subroute from the projects list', async () => {
        deviceTypeMock = 'phone';
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];
        paneScopesMock = {
            'project:wr_1': {
                right: { activeTabId: 'git' },
            },
        };

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-list-item-wr_1');

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1/git?worktreeId=%40root');
    });

    it('defaults mobile project opens to the files route when no last tab is remembered', async () => {
        deviceTypeMock = 'phone';
        accountSettingsMock = { mobileWorkspaceExperienceV1: 'classic' };
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-list-item-wr_1');

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1/files?worktreeId=%40root');
    });

    it('keeps project row menu props stable across unrelated cockpit-state rerenders', async () => {
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        const firstDropdown = screen.findAllByType('DropdownMenu' as any)[0];
        expect(firstDropdown).toBeTruthy();
        const firstItems = firstDropdown?.props?.items;
        const firstOnSelect = firstDropdown?.props?.onSelect;

        projectLastMobileSurfacesByWorkspaceRefIdMock = { wr_1: 'git' };

        await act(async () => {
            screen.tree.update(<ProjectsListView />);
        });

        const secondDropdown = screen.findAllByType('DropdownMenu' as any)[0];
        expect(secondDropdown?.props?.items).toBe(firstItems);
        expect(secondDropdown?.props?.onSelect).toBe(firstOnSelect);
    });

    it('reopens the remembered mobile worktree path without reviving the retired route setting', async () => {
        deviceTypeMock = 'phone';
        accountSettingsMock = { mobileWorkspaceExperienceV1: 'classic' };
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];
        localSettingsMock = {
            projectLastMobileRouteByWorkspaceRefId: { wr_1: 'git' },
            projectLastActiveRootPathByWorkspaceRefId: { wr_1: '/repo/.worktrees/feature-auth' },
            projectLastActiveWorktreeIdByWorkspaceRefId: { wr_1: 'gitwt_feature' },
        };

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-list-item-wr_1');

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1/files?worktreeId=gitwt_feature');
    });

    it('reopens the remembered cockpit-era mobile surface from local project state', async () => {
        deviceTypeMock = 'phone';
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];
        accountSettingsMock = { mobileWorkspaceExperienceV1: 'cockpit' };
        localSettingsMock = {
            projectLastActiveRootPathByWorkspaceRefId: { wr_1: '/repo/.worktrees/feature-auth' },
            projectLastActiveWorktreeIdByWorkspaceRefId: { wr_1: 'gitwt_feature' },
        };
        projectLastMobileSurfacesByWorkspaceRefIdMock = { wr_1: 'overview' };

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-list-item-wr_1');

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1?worktreeId=gitwt_feature&mobileSurface=overview');
    });

    it('reopens the remembered cockpit terminal surface from local project state', async () => {
        deviceTypeMock = 'phone';
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];
        accountSettingsMock = { mobileWorkspaceExperienceV1: 'cockpit' };
        localSettingsMock = {
            projectLastActiveRootPathByWorkspaceRefId: { wr_1: '/repo/.worktrees/feature-auth' },
            projectLastActiveWorktreeIdByWorkspaceRefId: { wr_1: 'gitwt_feature' },
        };
        projectLastMobileSurfacesByWorkspaceRefIdMock = { wr_1: 'terminal' };

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        await screen.pressByTestIdAsync('projects-list-item-wr_1');

        expect(routerPushSpy).toHaveBeenCalledWith('/projects/wr_1/terminal?worktreeId=gitwt_feature');
    });

    it('anchors project row menus below the trigger', async () => {
        workspaceRefsV1Mock = [{
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        }];

        const { ProjectsListView } = await import('./ProjectsListView');
        const screen = await renderScreen(<ProjectsListView />);

        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        expect(dropdowns.length).toBeGreaterThan(0);
        expect(dropdowns[0]?.props.placement).toBe('bottom');
        expect(dropdowns[0]?.props.popoverAnchorAlign).toBe('end');
    });

    describe('removing a project referenced by a workspace-sync relationship', () => {
        const workspaceRef = {
            id: 'wr_target',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
            lastOpenedAtMs: null,
        };
        const summary = {
            relationshipId: 'relationship-1',
            relationship: { v: 1, relationshipId: 'relationship-1', controllerMachineId: 'm2',
                alphaWorkspaceRefId: 'wr_source', betaWorkspaceRefId: 'wr_target', mode: 'keep_synced',
                contentPolicy: { v: 1, selection: 'all_files', extraIgnorePatterns: [], extraIncludePatterns: [], policyDigest: 'sha256:test' },
                enabled: true, createdAtMs: 1, updatedAtMs: 1 },
            alpha: { workspaceRefId: 'wr_source', machineId: 'm2', workspaceRef: { id: 'wr_source',
                serverId: 'server-1', machineId: 'm2', rootPath: '/source', createdAtMs: 1 } },
            beta: { workspaceRefId: 'wr_target', machineId: 'm1', workspaceRef },
            status: null,
        };

        it('reports unavailable sync status without inventing a conflict in a closed project row', async () => {
            machinesMock = [createMachine({ id: 'm1', host: 'leeroy-mbp' })];
            workspaceRefsV1Mock = [workspaceRef];
            workspaceSyncRelationshipSummariesMock = [summary];
            const { ProjectsListView } = await import('./ProjectsListView');
            const screen = await renderScreen(<ProjectsListView />);
            const subtitle = screen.findAllByTestId('projects-list-item-wr_target')
                .map((node) => node.props.subtitle)
                .find((value) => typeof value === 'string');
            expect(typeof subtitle).toBe('string');
            expect(subtitle).toContain('workspaceSync.attention.unavailableLinks');
            expect(subtitle).not.toContain('workspaceSync.attention.conflictedLinks');
        });

        async function invokeRemove() {
            machinesMock = [createMachine({ id: 'm1', host: 'leeroy-mbp' })];
            workspaceRefsV1Mock = [workspaceRef];
            const { ProjectsListView } = await import('./ProjectsListView');
            const screen = await renderScreen(<ProjectsListView />);
            const menuNode = screen.findAll((node: any) => typeof node.props?.onRemove === 'function')[0];
            const onRemove = (menuNode?.props as any)?.onRemove;
            if (typeof onRemove !== 'function') {
                throw new Error('Expected the project row menu to expose onRemove');
            }
            await act(async () => { await onRemove(workspaceRef); });
        }

        it('stops syncing through the daemon owner before the reference is released', async () => {
            workspaceSyncRelationshipSummariesMock = [summary];
            removeWorkspaceRefFromAccountSpy
                .mockResolvedValueOnce({
                    ok: false,
                    code: 'workspace_ref_in_use',
                    relationshipIds: ['relationship-1'],
                })
                .mockResolvedValueOnce({ ok: true });
            await invokeRemove();

            expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
            expect(terminateRelationshipSpy).toHaveBeenCalledTimes(1);
            expect(terminateRelationshipSpy).toHaveBeenCalledWith(
                expect.objectContaining({ relationshipId: 'relationship-1' }),
            );
            expect(removeWorkspaceRefFromAccountSpy).toHaveBeenCalledTimes(2);
            expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
        });

        it('keeps the reference when the user declines to stop syncing', async () => {
            workspaceSyncRelationshipSummariesMock = [summary];
            removeWorkspaceRefFromAccountSpy.mockResolvedValueOnce({
                ok: false,
                code: 'workspace_ref_in_use',
                relationshipIds: ['relationship-1'],
            });
            modalConfirmSpy.mockResolvedValueOnce(false);
            await invokeRemove();

            expect(terminateRelationshipSpy).not.toHaveBeenCalled();
            expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
        });

        it('keeps the reference when the daemon cannot stop syncing', async () => {
            workspaceSyncRelationshipSummariesMock = [summary];
            removeWorkspaceRefFromAccountSpy.mockResolvedValueOnce({
                ok: false,
                code: 'workspace_ref_in_use',
                relationshipIds: ['relationship-1'],
            });
            terminateRelationshipSpy.mockRejectedValueOnce(new Error('workspace_sync_unavailable'));
            await invokeRemove();

            expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
            expect(modalAlertSpy).toHaveBeenCalledTimes(1);
        });

        it('removes an unreferenced project without any daemon relationship command', async () => {
            workspaceSyncRelationshipSummariesMock = [];
            await invokeRemove();

            expect(modalConfirmSpy).not.toHaveBeenCalled();
            expect(terminateRelationshipSpy).not.toHaveBeenCalled();
            expect(removeWorkspaceRefFromAccountSpy).toHaveBeenCalledWith({
                serverId: 'server-1',
                workspaceRefId: 'wr_target',
            });
            expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
        });

        it('keeps the reference when another relationship wins after the requested relationship stops', async () => {
            workspaceSyncRelationshipSummariesMock = [summary];
            removeWorkspaceRefFromAccountSpy
                .mockResolvedValueOnce({
                    ok: false,
                    code: 'workspace_ref_in_use',
                    relationshipIds: ['relationship-1'],
                })
                .mockResolvedValueOnce({
                    ok: false,
                    code: 'workspace_ref_in_use',
                    relationshipIds: ['relationship-new'],
                });

            await invokeRemove();

            expect(terminateRelationshipSpy).toHaveBeenCalledTimes(1);
            expect(removeWorkspaceRefFromAccountSpy).toHaveBeenCalledTimes(2);
            expect(setWorkspaceRefsV1Spy).not.toHaveBeenCalled();
            expect(modalAlertSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('refreshes project row menu labels after the translation output changes', async () => {
        const workspaceRef = {
            id: 'wr_1',
            serverId: 'server-1',
            machineId: 'm1',
            rootPath: '/repo',
            label: 'Repo',
            createdAtMs: 1,
        };
        const { ProjectsListItemMenu } = await import('./ProjectsListItemMenu');
        const theme = createThemeFixture();
        const firstOnRemove = vi.fn();
        const screen = await renderScreen(
            <ProjectsListItemMenu
                theme={theme}
                workspaceRef={workspaceRef as any}
                pinAction="pin"
                onTogglePinned={vi.fn()}
                onRename={vi.fn()}
                onReset={vi.fn()}
                onRemove={firstOnRemove}
            />,
        );

        const englishDropdown = screen.findAllByType('DropdownMenu' as any)[0];
        expect(englishDropdown).toBeTruthy();
        expect(englishDropdown?.props.items.find((item: { id: string; title: string }) => item.id === 'rename')?.title)
            .toBe('sessionsList.renameWorkspace');

        translationPrefixMock = 'es:';
        const secondOnRemove = vi.fn();
        await act(async () => {
            screen.tree.update(
                <ProjectsListItemMenu
                    theme={theme}
                    workspaceRef={workspaceRef as any}
                    pinAction="pin"
                    onTogglePinned={vi.fn()}
                    onRename={vi.fn()}
                    onReset={vi.fn()}
                    onRemove={secondOnRemove}
                />,
            );
        });

        const spanishDropdown = screen.findAllByType('DropdownMenu' as any)[0];
        expect(spanishDropdown?.props.items.find((item: { id: string; title: string }) => item.id === 'rename')?.title)
            .toBe('es:sessionsList.renameWorkspace');
    });
});
