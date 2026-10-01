import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

// Unrelated external Markdown package; fail if this Git path ever invokes it.
vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({
    splitStreamingRevealTextParts: () => { throw new Error('Unexpected streaming Markdown in Git'); },
}));


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SLOW_TEST_TIMEOUT_MS = 120_000;
let activeGitSubTab: 'commit' | 'history' = 'commit';
let paneLayout: 'unified' | 'tabs' = 'tabs';
const setActiveGitSubTabSpy = vi.hoisted(() => vi.fn());
const gitSubTabsBarSpy = vi.hoisted(() => vi.fn());
const gitCommitTabContentSpy = vi.hoisted(() => vi.fn());


// Hoist boundaries before any static dependency can cache its real module.
vi.mock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: any) => React.createElement('View', props, props.children),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
            Text: (props: any) => React.createElement('Text', props, props.children),
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (value: any) => value?.default ?? null,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(
            importOriginal,
            {
                useSetting: (key: string) => key === 'scmGitPaneLayout' ? paneLayout : null,
                useAllMachines: () => [{ id: 'm1', active: true, activeAt: 1, metadata: { host: 'mbp', homeDir: '/tmp' } }],
                useProjectForSession: () => null,
                useProjectSessions: () => [],
                useMachine: () => ({ online: true }),
                useSession: () => ({ active: true, metadata: { machineId: 'm1', path: '/repo' } }),
                useSessionListRenderableWithServerScope: () => createSessionListRenderableSessionFixture({ id: 's1', ...{ active: true, metadata: { host: 'test-machine', machineId: 'm1', path: '/repo' } } }),
                useSessionProjectScmCommitSelectionPaths: () => [],
                useSessionProjectScmCommitSelectionPatches: () => [],
                useSessionProjectScmInFlightOperation: () => null,
                useSessionProjectScmOperationLog: () => [],
                useSessionProjectScmSnapshot: () => ({
                    fetchedAt: 1,
                    projectKey: 'm1:/repo',
                    repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                    capabilities: {
                        readStatus: true,
                        readDiffFile: true,
                        readDiffCommit: true,
                        readLog: true,
                        writeCommit: true,
                        writeInclude: true,
                        writeExclude: true,
                        writeRemoteFetch: true,
                        writeRemotePull: true,
                        writeRemotePush: true,
                        supportedDiffAreas: ['included', 'pending'],
                    },
                    branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                    stashCount: 0,
                    hasConflicts: false,
                    entries: [],
                    totals: {
                        includedFiles: 0,
                        pendingFiles: 0,
                        untrackedFiles: 0,
                        includedAdded: 0,
                        includedRemoved: 0,
                        pendingAdded: 0,
                        pendingRemoved: 0,
                    },
                }),
                useSessionProjectScmSnapshotError: () => null,
                useWorkspaceScmTouchedPathsForSession: () => [],
            },
        );
});
vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        scopeState: {},
    }),
}));

vi.mock('@/components/workspaces/scm/useWorkspaceScmTabState', () => ({
    useWorkspaceScmTabState: () => ({
        activeGitSubTab,
        setActiveGitSubTab: setActiveGitSubTabSpy,
        commitDraftMessage: '',
        setCommitDraftMessage: vi.fn(),
    }),
}));

vi.mock('@/components/workspaces/scm/WorkspaceScmSubTabsBar', () => ({
    WorkspaceScmSubTabsBar: (props: any) => {
        gitSubTabsBarSpy(props);
        return React.createElement('WorkspaceScmSubTabsBar', props);
    },
}));

vi.mock('./useSessionRightPanelGitOpenDetails', () => ({
    useSessionRightPanelGitOpenDetails: () => ({
        openFileInDetails: vi.fn(),
        openFileInDetailsPinned: vi.fn(),
        openCommitInDetails: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useScmCommitHistory', () => ({
    useScmCommitHistory: () => ({
        historyEntries: [],
        historyLoading: false,
        historyHasMore: false,
        loadCommitHistory: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useFilesScmOperations', () => ({
    useFilesScmOperations: () => ({
        scmOperationBusy: false,
        scmOperationStatus: null,
        commitPreflight: { allowed: true, message: null },
        pullPreflight: { allowed: true, message: null },
        pushPreflight: { allowed: true, message: null },
        runRemoteOperation: vi.fn(),
        createCommitFromMessage: vi.fn(),
        commitMessageGeneratorEnabled: false,
        generateCommitMessageSuggestion: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));

vi.mock('@/components/workspaces/scm/states', () => ({
    SourceControlStaleSnapshotNotice: () => null,
    NotSourceControlRepositoryState: () => React.createElement('NotSourceControlRepositoryState'),
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
    SourceControlSessionInactiveState: () => React.createElement('SourceControlSessionInactiveState'),
}));

vi.mock('@/scm/registry/scmUiBackendRegistry', () => {
    const scmUiBackendRegistry = {
        getPluginForSnapshot: () => ({
            displayName: 'Git',
            commitActionConfig: () => ({ label: 'Commit' }),
            remoteActionConfig: () => ({ fetch: true, pull: true, push: true }),
            inferRemoteTarget: () => ({ remote: 'origin', branch: 'main' }),
            mapCapabilitiesToUiPolicy: () => ({ supportedDiffAreas: ['pending'] }),
        }),
    };
    return {
        scmUiBackendRegistry,
        createScmUiBackendRegistry: () => scmUiBackendRegistry,
    };
});

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromUserAndAwait: vi.fn(),
        invalidateFromAutoRefreshAndAwait: vi.fn(),
        invalidateFromMutationAndAwait: vi.fn(async () => {}),
    },
}));

vi.mock('./SessionRightPanelGitCommitTabContent', () => ({
    SessionRightPanelGitCommitTabContent: (props: any) => {
        gitCommitTabContentSpy(props);
        return React.createElement('CommitTab', { testID: 'session-right-panel-git-commit-tab' });
    },
}));

// Owner loading belongs to setup, not an individual interaction's timeout.
const { SessionRightPanelGitView } = await import('./SessionRightPanelGitView');

describe('SessionRightPanelGitView (keep mounted sub-tabs)', () => {
    beforeEach(() => {
        paneLayout = 'tabs';
        activeGitSubTab = 'commit';
        setActiveGitSubTabSpy.mockClear();
        gitSubTabsBarSpy.mockClear();
        gitCommitTabContentSpy.mockClear();
    });

    it('mounts inactive sub-tabs only after first activation', async () => {

        activeGitSubTab = 'commit';
        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />)).tree;

        expect(tree.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(1);
        expect(tree.findAllByTestId('session-right-panel-git-update-tab')).toHaveLength(0);
        expect(tree.findAllHostsByTestId('session-rightpanel-git-surface:history')).toHaveLength(0);

        activeGitSubTab = 'history';
        await act(async () => {
            tree.update(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1:history" />);
        });

        expect(tree.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(1);
        expect(tree.findAllByTestId('session-right-panel-git-update-tab')).toHaveLength(0);
        expect(tree.findAllHostsByTestId('session-rightpanel-git-surface:history')).toHaveLength(1);
        const mountedHistory = tree.findHostByTestId('session-rightpanel-git-surface:history');
        activeGitSubTab = 'commit';
        await act(async () => {
            tree.update(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);
        });
        expect(tree.findHostByTestId('session-rightpanel-git-surface:history')).toBe(mountedHistory);
    }, SLOW_TEST_TIMEOUT_MS);


    it('offers only Changes and History in Tabs layout, and no sub-tabs in Unified', async () => {
        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);
        expect(gitSubTabsBarSpy.mock.calls.at(-1)?.[0].tabs).toEqual([
            { id: 'commit', label: 'sessionGitPane.subTabs.changes' },
            { id: 'history', label: 'sessionGitPane.subTabs.history' },
        ]);
        paneLayout = 'unified';
        await act(async () => { screen.tree.update(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1:unified" />); });
        expect(screen.findAllByType('WorkspaceScmSubTabsBar')).toHaveLength(0);
        expect(screen.findByTestId('session-right-panel-git-commit-tab')).toBeTruthy();
        expect(screen.tree.findAllHostsByTestId('session-rightpanel-git-surface:history')).toHaveLength(0);
    }, SLOW_TEST_TIMEOUT_MS);

    it('keeps commit tab action callbacks stable when switching to another sub-tab', async () => {

        activeGitSubTab = 'commit';
        const { tree } = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);
        const firstProps = gitCommitTabContentSpy.mock.calls.at(-1)?.[0];

        activeGitSubTab = 'history';
        await act(async () => {
            tree.update(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1:history" />);
        });

        const nextProps = gitCommitTabContentSpy.mock.calls.at(-1)?.[0];
        expect(nextProps.openFileInDetails).toBe(firstProps.openFileInDetails);
        expect(nextProps.openFileInDetailsPinned).toBe(firstProps.openFileInDetailsPinned);
        expect(nextProps.onOpenReviewAllChanges).toBe(firstProps.onOpenReviewAllChanges);
        expect(nextProps.onOpenStashDetails).toBe(firstProps.onOpenStashDetails);
    }, SLOW_TEST_TIMEOUT_MS);
});
