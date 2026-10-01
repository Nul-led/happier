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
const routeState = vi.hoisted(() => ({ pathname: '/projects' }));
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
        pathname: () => routeState.pathname,
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

function workspaceRef(id: string, machineId: string, rootPath: string) {
    return { v: 1, id, serverId: 'server-1', machineId, rootPath, createdAtMs: 1, updatedAtMs: 1 };
}

describe('ProjectsColumn', () => {
    beforeEach(() => {
        standardCleanup();
        routeState.pathname = '/projects';
        machinesMock = [
            createMachine({ id: 'm1', host: 'studio' }),
            createMachine({ id: 'm2', host: 'laptop' }),
        ];
        workspaceRefsV1Mock = [
            workspaceRef('ref-a', 'm1', '/Users/tester/alpha'),
            workspaceRef('ref-b', 'm1', '/Users/tester/beta'),
            workspaceRef('ref-c', 'm2', '/Users/tester/gamma'),
        ];
        pinnedWorkspaceRefIdsV1Mock = ['ref-c'];
        accountSettingsMock = {};
        localSettingsMock = {};
        workspaceSyncRelationshipSummariesMock = [];
        openMachinePathBrowserModalSpy.mockReset();
        routerPushSpy.mockReset();
    });

    const rowIds = (screen: Awaited<ReturnType<typeof renderScreen>>) => screen.root
        .findAll((node) => typeof node.type === 'string' || typeof node.type === 'function')
        .map((node) => node.props?.testID)
        .filter((testID): testID is string => typeof testID === 'string' && /^projects-column:(project|group):/.test(testID))
        .filter((testID, index, all) => all.indexOf(testID) === index);

    it("lists pinned projects, then each machine's projects, and marks the open one", async () => {
        routeState.pathname = '/projects/ref-b/files';
        const { ProjectsColumn } = await import('./ProjectsColumn');
        const screen = await renderScreen(<ProjectsColumn />);

        expect(rowIds(screen)).toEqual([
            'projects-column:group:pinned',
            'projects-column:project:ref-c',
            'projects-column:group:m1',
            'projects-column:project:ref-a',
            'projects-column:project:ref-b',
        ]);
        expect(screen.findAllByTestId('projects-column:project:ref-b')[0]?.props.selected).toBe(true);
        expect(screen.findAllByTestId('projects-column:project:ref-a')[0]?.props.selected).toBe(false);
    });

    it('opens a project from its row', async () => {
        const { ProjectsColumn } = await import('./ProjectsColumn');
        const screen = await renderScreen(<ProjectsColumn />);
        await act(async () => {
            screen.findAllByTestId('projects-column:project:ref-a')[0]?.props.onPress();
        });
        expect(routerPushSpy).toHaveBeenCalledWith(expect.stringContaining('/projects/ref-a'));
    });
});

describe('Projects index', () => {
    beforeEach(() => {
        standardCleanup();
        machinesMock = [createMachine({ id: 'm1', host: 'studio' })];
        workspaceRefsV1Mock = [workspaceRef('ref-a', 'm1', '/Users/tester/alpha')];
        pinnedWorkspaceRefIdsV1Mock = [];
        accountSettingsMock = {};
        localSettingsMock = {};
        workspaceSyncRelationshipSummariesMock = [];
    });

    it('does not repeat the list beside the Projects column: it says no project is open', async () => {
        const { AppShellColumnContext } = await import('@/components/navigation/shell/appRail/appShellColumnContext');
        const { ProjectsIndexView } = await import('./ProjectsIndexView');
        const beside = await renderScreen(
            <AppShellColumnContext.Provider value={{ present: true, columnVisible: true }}>
                <ProjectsIndexView />
            </AppShellColumnContext.Provider>,
        );
        expect(beside.findByTestId('projects-none-open')).toBeTruthy();
        expect(beside.findByTestId('projects-list')).toBeNull();

        // Collapsed column, or a phone: the page is the list.
        const alone = await renderScreen(
            <AppShellColumnContext.Provider value={{ present: true, columnVisible: false }}>
                <ProjectsIndexView />
            </AppShellColumnContext.Provider>,
        );
        expect(alone.findByTestId('projects-list')).toBeTruthy();
        expect(alone.findByTestId('projects-none-open')).toBeNull();
    });
});
