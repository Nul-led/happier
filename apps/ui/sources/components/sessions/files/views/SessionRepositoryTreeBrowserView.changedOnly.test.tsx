import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { installSessionFilesViewCommonModuleMocks } from './sessionFilesViewsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setExpandedPathsSpy = vi.fn();
const treeListProps: any[] = [];
const CHANGED_ENTRIES = ['src/a.ts', 'src/b.ts', 'README.md', 'scratch/'].map((path) => ({
    path,
    previousPath: null,
    kind: path.endsWith('/') ? 'untracked' : 'modified',
    includeStatus: '',
    pendingStatus: '',
    hasIncludedDelta: false,
    hasPendingDelta: true,
    stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false },
}));

installSessionFilesViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web', select: (value: any) => value?.default ?? null },
        });
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            storage: { getState: () => ({ setSessionRepositoryTreeExpandedPaths: setExpandedPathsSpy }) } as any,
            useSession: () => ({ active: true, metadata: { machineId: 'm1' } }) as any,
            useProjectForSession: () => ({ key: { serverId: 'server', machineId: 'm1', rootPath: '/repo' } }) as any,
            useAllMachines: () => [{ id: 'm1', active: true, activeAt: 1, metadata: { host: 'mbp', platform: 'darwin', happyCliVersion: '0', happyHomeDir: '/tmp/.h', homeDir: '/tmp' } }] as any,
            useMachine: () => ({ id: 'm1' }) as any,
            useSessionRepositoryTreeExpandedPaths: () => ['src'],
            // Keyed by Home: two Homes can host one Session id, and an unqualified read lands on
            // whichever the shared cache holds (modelled here as `home-a`).
            useSessionProjectScmSnapshot: (_sessionId: string, serverId?: string | null) => ({
                projectKey: `p:${String(serverId ?? 'home-a')}`,
                fetchedAt: 1,
                repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                capabilities: {} as any,
                branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                hasConflicts: false,
                entries: CHANGED_ENTRIES,
                totals: {
                    includedFiles: 0,
                    pendingFiles: 0,
                    untrackedFiles: 0,
                    includedAdded: 0,
                    includedRemoved: 0,
                    pendingAdded: 0,
                    pendingRemoved: 0,
                },
            }) as any,
        });
    },
});

vi.mock('@/hooks/session/files/useWorkspaceFileTransfers', () => ({
    useWorkspaceFileTransfers: () => ({
        uploadState: { status: 'idle' },
        downloadState: { status: 'idle' },
        startUploads: vi.fn(async () => ({ ok: true })),
        cancelUploads: vi.fn(),
        startDownload: vi.fn(async () => ({ ok: true })),
        cancelDownload: vi.fn(),
    }),
}));

vi.mock('@/components/workspaces/scm/states', () => ({
    SourceControlSessionInactiveState: () => React.createElement('SourceControlSessionInactiveState'),
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
}));

vi.mock('@/components/sessions/model/resolveSessionMachineReachability', () => ({
    resolveSessionMachineReachability: () => true,
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
    isMachineOnline: () => true,
}));

vi.mock('@/components/sessions/model/useSessionMachineReachability', () => ({
    useSessionMachineReachability: () => ({
        machineReachable: true,
        machineOnline: true,
        machineRpcTargetAvailable: true,
    }),
}));

vi.mock('@/components/sessions/agents/presentation/useSessionMachineName', () => ({
    useSessionMachineName: () => 'MacBook Pro',
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => {
        const trigger = typeof props.trigger === 'function'
            ? props.trigger({ toggle: vi.fn(), openMenu: vi.fn(), closeMenu: vi.fn(), open: Boolean(props.open), selectedItem: null })
            : props.trigger;
        return React.createElement('DropdownMenu', props, trigger);
    },
}));

vi.mock('@/hooks/session/useSessionWorkspaceTarget', () => ({
    useSessionWorkspaceTarget: (_sessionId: string, serverId?: string | null) => ({
        workspaceCacheKey: `${String(serverId ?? 'server')}:m1:/repo`,
        machineId: 'm1',
        rootPath: '/repo',
        serverId: String(serverId ?? 'server'),
    }),
}));

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: { invalidateFromUser: () => {} },
}));

vi.mock('@/sync/domains/input/suggestionFile', () => ({
    fileSearchCache: { clearCache: () => {} },
    searchFiles: vi.fn(async () => []),
}));

vi.mock('@/components/projects/files/WorkspaceRepositoryTreeList', () => ({
    WorkspaceRepositoryTreeList: (props: any) => {
        treeListProps.push(props);
        return React.createElement('View', { testID: 'workspace-repository-tree-list' });
    },
}));

vi.mock('@/components/workspaces/files/repositoryTree/SearchResultsList', () => ({
    SearchResultsList: () => React.createElement('SearchResultsList'),
}));

vi.mock('@/sync/domains/session/resolveWorkspaceTargetForSession', () => ({
    resolveWorkspaceTargetForSession: () => ({
        workspaceCacheKey: 'server:m1:/repo',
        machineId: 'm1',
        rootPath: '/repo',
        serverId: 'server',
    }),
}));

vi.mock('@/sync/ops/workspaceFileSystem', () => ({
    workspaceWriteFile: vi.fn(async () => ({ success: true })),
    workspaceCreateDirectory: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/utils/path/isSafeWorkspaceRelativePath', () => ({
    isSafeWorkspaceRelativePath: () => true,
}));

vi.mock('@/components/workspaces/files/repositoryTree/computeExpandedPathsForReveal', () => ({
    computeExpandedPathsForReveal: ({ expandedPaths }: any) => expandedPaths,
}));

describe('SessionRepositoryTreeBrowserView (Changed only, header, View menu)', () => {
    afterEach(() => {
        treeListProps.length = 0;
        standardCleanup();
    });

    async function renderRepositoryTreeBrowserView(serverId?: string) {
        const { SessionRepositoryTreeBrowserView } = await import('./SessionRepositoryTreeBrowserView');
        return renderScreen(<SessionRepositoryTreeBrowserView sessionId="s1" serverId={serverId} onOpenFile={vi.fn()} />);
    }

    it('prunes the same tree in place and names the one changed-file count on its chip', async () => {
        const { selectScmChangedFiles } = await import('@/scm/scmStatusFiles');
        const screen = await renderRepositoryTreeBrowserView();
        expect(treeListProps.at(-1)?.changedOnly).toBe(false);

        await act(async () => {
            screen.pressByTestId('repository-tree-filter-changed');
        });

        // Same tree owner, still mounted: Changed only is a presentation of it, not another list.
        expect(screen.findAllByTestId('workspace-repository-tree-list')).toHaveLength(1);
        const listProps = treeListProps.at(-1);
        expect(listProps?.changedOnly).toBe(true);
        const chip = screen.findByTestId('repository-tree-changed-only-chip');
        expect(chip).toBeTruthy();
        expect(screen.getTextContent()).toContain(String(selectScmChangedFiles(listProps.scmSnapshot).length));
        expect(selectScmChangedFiles(listProps.scmSnapshot)).toHaveLength(3);

        await act(async () => {
            screen.pressByTestId('repository-tree-changed-only-chip');
        });
        expect(treeListProps.at(-1)?.changedOnly).toBe(false);
        expect(screen.findAllByTestId('repository-tree-changed-only-chip')).toHaveLength(0);
    });

    it('reads the working tree of the Home named by the route', async () => {
        const screen = await renderRepositoryTreeBrowserView('home-b');
        await act(async () => {
            screen.pressByTestId('repository-tree-filter-changed');
        });
        expect(treeListProps.at(-1)?.scmSnapshot?.projectKey).toBe('p:home-b');
    });

    it('publishes only the + action to the pane header: the header is just "Files" (user ruling over lab H1)', async () => {
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePublishedPaneHeaderContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        const { SessionRepositoryTreeBrowserView } = await import('./SessionRepositoryTreeBrowserView');
        const published: any[] = [];
        function HeaderReader() {
            published.push(usePublishedPaneHeaderContent('files'));
            return null;
        }
        await renderScreen(
            <PaneHeaderSlotProvider>
                <HeaderReader />
                <PaneHeaderSlotScope slotKey="files">
                    <SessionRepositoryTreeBrowserView sessionId="s1" onOpenFile={vi.fn()} />
                </PaneHeaderSlotScope>
            </PaneHeaderSlotProvider>,
        );
        const content = published.at(-1);
        expect(content?.line ?? null).toBeNull();
        expect(content?.action).toBeTruthy();
    });

    it('keeps Collapse all, Size and date and Refresh in the one View menu', async () => {
        setExpandedPathsSpy.mockClear();
        const screen = await renderRepositoryTreeBrowserView();

        const menu = screen.findByTestId('repository-tree-view-menu');
        expect(menu?.props.items.map((item: any) => item.id)).toEqual([
            'repository-tree-toggle-details',
            'repository-tree-collapse-all',
            'repository-tree-refresh',
        ]);
        // The nine toolbar icons are gone: creating and uploading live in the header's +.
        expect(screen.findAllByTestId('repository-tree-create-file')).toHaveLength(0);
        expect(screen.findAllByTestId('repository-tree-upload')).toHaveLength(0);

        await act(async () => {
            menu?.props.onSelect('repository-tree-collapse-all');
        });
        expect(setExpandedPathsSpy).toHaveBeenCalledWith('s1', []);
    });
});
