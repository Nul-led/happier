import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { EMPTY_SCM_CAPABILITIES } from '@/scm/core/snapshotMappers';
import { storage } from '@/sync/domains/state/storage';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { ScmLogEntry } from '@happier-dev/protocol';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { projectManager } from '@/sync/runtime/orchestration/projectManager';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
// This external package subpath is absent on some execution hosts. Git never renders streaming
// Markdown: throwing if invoked keeps this unrelated dependency from bypassing the tested path.
const splitStreamingRevealTextParts = vi.hoisted(() => vi.fn(() => { throw new Error('Unexpected streaming Markdown in Git'); }));
vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({ splitStreamingRevealTextParts }));
// The native list runtime needs a viewport; render its slots at the framework boundary.
vi.mock('@legendapp/list/react-native', () => ({
    LegendList: (props: Readonly<{ ListHeaderComponent?: React.ReactNode; ListFooterComponent?: React.ReactNode; ListEmptyComponent?: React.ReactNode }>) => (
        <React.Fragment>{props.ListHeaderComponent}{props.ListEmptyComponent}{props.ListFooterComponent}</React.Fragment>
    ),
}));
// Machine SCM is the RPC boundary; the controller, store, history and view remain real.
vi.mock('@/sync/ops/scm/machineScm', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/ops/scm/machineScm')>(),
    machineScmStatusSnapshot: vi.fn(async () => ({ success: false, error: 'offline' })),
    machineScmLogList: vi.fn(async () => ({
        success: true,
        entries: [{ sha: 'abc123', shortSha: 'abc123', subject: 'Saved project change', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }],
    })),
}));
// The session placement's public SCM RPC facade is its transport boundary.
vi.mock('@/sync/ops', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/ops')>(),
    sessionScmLogList: vi.fn(),
}));

const scope = { serverId: 's1', machineId: 'm1', rootPath: '/repo' };
const snapshot: ScmWorkingSnapshot = {
    projectKey: 'project-layout', fetchedAt: 1,
    repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
    capabilities: { ...EMPTY_SCM_CAPABILITIES, readLog: true, writeCommit: true },
    branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
    hasConflicts: false, entries: [],
    totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
};

describe('project Git presentation', () => {
    beforeEach(() => {
        storage.setState({ settings: {
            ...storage.getState().settings,
            scmGitPaneLayout: 'unified', experiments: true,
            featureToggles: { ...storage.getState().settings.featureToggles, 'scm.writeOperations': true },
        } });
        storage.getState().updateWorkspaceScmSnapshot(scope, snapshot);
        storage.getState().updateWorkspaceScmSnapshotError(scope, null);
    });

    it('shows history with changes in Unified and preserves the changes surface when switching layouts', async () => {
        const { WorkspaceRightPanelGitView } = await import('./WorkspaceRightPanelGitView');
        const screen = await renderScreen(<WorkspaceRightPanelGitView {...scope} onOpenFile={() => {}} />);
        expect(screen.findByTestId('project-rightpanel-git-subtab:commit')).toBeNull();
        expect(screen.getTextContent()).toContain('Saved project change');
        const { machineScmLogList } = await import('@/sync/ops/scm/machineScm');
        expect(machineScmLogList).toHaveBeenCalledWith('m1', expect.objectContaining({ cwd: '/repo', skip: 0 }), { serverId: 's1' });
        const changesSurface = screen.findHostByTestId('project-rightpanel-git-surface:commit');
        expect(changesSurface).not.toBeNull();
        await act(async () => { screen.changeTextByTestId('scm-commit-message', 'Keep this draft'); });

        await act(async () => {
            storage.setState({ settings: { ...storage.getState().settings, scmGitPaneLayout: 'tabs' } });
        });
        expect(screen.findByTestId('project-rightpanel-git-subtab:history')).not.toBeNull();
        expect(screen.findByTestId('project-rightpanel-git-subtab:update')).toBeNull();
        await screen.pressByTestIdAsync('project-rightpanel-git-subtab:history');
        expect(screen.findHostByTestId('project-rightpanel-git-surface:commit')).toBe(changesSurface);
        await screen.pressByTestIdAsync('project-rightpanel-git-subtab:commit');
        expect(screen.findHostByTestId('project-rightpanel-git-surface:commit')).toBe(changesSurface);
        expect(screen.findHostByTestId('scm-commit-message')?.props.value).toBe('Keep this draft');
        expect(splitStreamingRevealTextParts).not.toHaveBeenCalled();
    });

    it('keeps repository tools reachable after removing the Sync tab', async () => {
        storage.getState().updateWorkspaceScmSnapshot(scope, {
            ...snapshot,
            repo: { ...snapshot.repo, defaultBranch: 'main' },
            branch: { ...snapshot.branch, head: 'feature' },
            capabilities: { ...EMPTY_SCM_CAPABILITIES, ...snapshot.capabilities, readPullRequestStatus: true, readHostingRepositoryPublishTargets: true, writePullRequestCreate: true, writeRemoteAdd: true, writeBranchMerge: true },
        });
        const { WorkspaceRightPanelGitView } = await import('./WorkspaceRightPanelGitView');
        const screen = await renderScreen(<WorkspaceRightPanelGitView {...scope} onOpenFile={() => {}} />);
        await screen.pressByTestIdAsync('project-git-tools');
        expect(screen.findHostByTestId('scm-pull-request-section')).not.toBeNull();
        expect(screen.findHostByTestId('scm-update-remotes-section')).not.toBeNull();
        expect(screen.findHostByTestId('scm-update-branch-integration-section')).not.toBeNull();
        expect(screen.findHostByTestId('scm-remote-editor-name')?.props.editable).not.toBe(false);
        await act(async () => { screen.changeTextByTestId('scm-remote-editor-name', 'backup'); });
        await act(async () => {
            storage.setState({ settings: { ...storage.getState().settings, scmGitPaneLayout: 'tabs' } });
        });
        await screen.pressByTestIdAsync('project-rightpanel-git-subtab:history');
        await screen.pressByTestIdAsync('project-rightpanel-git-subtab:commit');
        expect(screen.findHostByTestId('scm-remote-editor-name')?.props.value).toBe('backup');
        expect(splitStreamingRevealTextParts).not.toHaveBeenCalled();
    });

    it('keeps the observed force-with-lease action available when the branch is behind', async () => {
        storage.getState().updateWorkspaceScmSnapshot(scope, {
            ...snapshot,
            capabilities: { ...snapshot.capabilities, changeSetModel: 'index', writeRemotePush: true, writeRemotePolicies: true, writeRemoteForceWithLease: true },
            branch: { ...snapshot.branch, upstream: 'origin/main', upstreamOid: 'a'.repeat(40), behind: 1 },
        });
        const { WorkspaceRightPanelGitView } = await import('./WorkspaceRightPanelGitView');
        const screen = await renderScreen(<WorkspaceRightPanelGitView {...scope} onOpenFile={() => {}} />);
        await screen.pressByTestIdAsync('project-git-tools');
        expect(screen.findHostByTestId('workspace-scm-force-with-lease')?.props.disabled).toBe(false);
    });

    it('reloads the timeline after undo moves HEAD without changing the branch name', async () => {
        storage.getState().updateWorkspaceScmSnapshot(scope, {
            ...snapshot, branch: { ...snapshot.branch, headOid: 'a'.repeat(40) },
        });
        const { WorkspaceRightPanelGitView } = await import('./WorkspaceRightPanelGitView');
        const screen = await renderScreen(<WorkspaceRightPanelGitView {...scope} onOpenFile={() => {}} />);
        expect(screen.getTextContent()).toContain('Saved project change');
        const { machineScmLogList } = await import('@/sync/ops/scm/machineScm');
        vi.mocked(machineScmLogList).mockResolvedValueOnce({
            success: true,
            entries: [{ sha: 'parent', shortSha: 'parent', subject: 'Previous project commit', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }],
        });
        await act(async () => {
            storage.getState().updateWorkspaceScmSnapshot(scope, {
                ...snapshot, branch: { ...snapshot.branch, headOid: 'b'.repeat(40) },
            });
        });
        expect(screen.getTextContent()).toContain('Previous project commit');
        expect(screen.getTextContent()).not.toContain('Saved project change');
    });

    it('refreshes the moved HEAD after an earlier timeline read finishes', async () => {
        const { machineScmLogList } = await import('@/sync/ops/scm/machineScm');
        let completeInitialLog!: (value: Awaited<ReturnType<typeof machineScmLogList>>) => void;
        vi.mocked(machineScmLogList).mockImplementationOnce(() => new Promise((resolve) => { completeInitialLog = resolve; }));
        storage.getState().updateWorkspaceScmSnapshot(scope, {
            ...snapshot, branch: { ...snapshot.branch, headOid: 'a'.repeat(40) },
        });
        const { WorkspaceRightPanelGitView } = await import('./WorkspaceRightPanelGitView');
        const screen = await renderScreen(<WorkspaceRightPanelGitView {...scope} onOpenFile={() => {}} />);
        vi.mocked(machineScmLogList).mockResolvedValueOnce({
            success: true,
            entries: [{ sha: 'parent', shortSha: 'parent', subject: 'Previous project commit', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }],
        });
        await act(async () => {
            storage.getState().updateWorkspaceScmSnapshot(scope, {
                ...snapshot, branch: { ...snapshot.branch, headOid: 'b'.repeat(40) },
            });
        });
        await act(async () => {
            completeInitialLog({ success: true, entries: [{ sha: 'old', shortSha: 'old', subject: 'Saved project change', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }] });
        });
        expect(screen.getTextContent()).toContain('Previous project commit');
        expect(screen.getTextContent()).not.toContain('Saved project change');
    });

    it('refreshes the session timeline after HEAD moves during an earlier read', async () => {
        storage.setState(storage.getInitialState(), true);
        projectManager.clear();
        storage.setState({ settings: { ...storage.getState().settings, scmGitPaneLayout: 'unified', scmFilesAutoRefreshIntervalMs: 0 } });
        storage.getState().applySessions([createSessionFixture({ id: 'history-session', active: true,
            metadata: { path: '/repo', host: 'localhost', machineId: 'm1' } })]);
        storage.getState().applyMachines([createMachineFixture({ id: 'm1', activeAt: Date.now() })]);
        storage.getState().updateSessionProjectScmSnapshot('history-session', {
            ...snapshot, branch: { ...snapshot.branch, headOid: 'a'.repeat(40) },
        });
        const { sessionScmLogList } = await import('@/sync/ops');
        let completeInitialLog!: (value: Awaited<ReturnType<typeof sessionScmLogList>>) => void;
        vi.mocked(sessionScmLogList).mockImplementationOnce(() => new Promise((resolve) => { completeInitialLog = resolve; }));
        vi.mocked(sessionScmLogList).mockResolvedValue({ success: true,
            entries: [{ sha: 'parent', shortSha: 'parent', subject: 'Previous session commit', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }] });
        const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
        const { SessionRightPanelGitView } = await import('@/components/sessions/panes/git/SessionRightPanelGitView');
        const screen = await renderScreen(<AppPaneProvider><SessionRightPanelGitView sessionId="history-session" scopeId="session:history-session" /></AppPaneProvider>);
        await act(async () => {
            storage.getState().updateSessionProjectScmSnapshot('history-session', {
                ...snapshot, branch: { ...snapshot.branch, headOid: 'b'.repeat(40) },
            });
        });
        await act(async () => {
            completeInitialLog({ success: true, entries: [{ sha: 'old', shortSha: 'old', subject: 'Saved session change', body: '', authorName: 'Ada', authorEmail: '', timestamp: 1 }] });
        });
        expect(screen.getTextContent()).toContain('Previous session commit');
        expect(screen.getTextContent()).not.toContain('Saved session change');
    });

    it('offers the shared pane preference without unsupported project tree choices', async () => {
        const { GitDisplayOptions } = await import('@/components/sessions/panes/git/display/GitDisplayMenu');
        const screen = await renderScreen(<GitDisplayOptions testIDPrefix="project-display" paneOnly />);
        expect(screen.findHostByTestId('project-display-layout:tabs')).not.toBeNull();
        expect(screen.findByTestId('project-display-show-as:tree')).toBeNull();
    });

    it('keeps the viewed current or incoming commit anchored on refresh and resets for another history', async () => {
        const { GitPaneLayout } = await import('@/components/workspaces/scm/GitPaneLayout');
        const { GitTimelineSection } = await import('@/components/sessions/panes/git/GitTimelineSection');
        const entries: ScmLogEntry[] = Array.from({ length: 25 }, (_, index) => ({
            sha: `sha-${index + 1}`, shortSha: `s${index + 1}`, subject: `Commit ${index + 1}`,
            body: '', authorName: 'Ada', authorEmail: '', timestamp: 0,
        }));
        const scrollTo = vi.fn();
        const renderHistory = (current: ScmLogEntry[], identity = 'repo-a', incoming: ScmLogEntry[] | null = null) => (
            <GitPaneLayout layout="tabs" activeSubTabId="history" onSelectSubTab={() => {}} changedCount={0}
                historyIdentity={identity} testIDPrefix="history-pane" renderChanges={() => null}
                timeline={<GitTimelineSection changedCount={0} selectedCount={0} ahead={0} behind={incoming?.length ?? 0}
                    upstream={incoming ? 'origin/main' : null} entries={current} incoming={incoming}
                    loading={false} hasMore={false} onLoadMore={() => {}} onOpenCommit={() => {}} landedSha={null} />}
            />
        );
        const screen = await renderScreen(renderHistory(entries), {
            createNodeMock: (element) => element.type === 'ScrollView' ? { scrollTo } : null,
        });
        const layout = (sha: string, y: number) => screen.findHostByTestId(`scm-commit-entry-${sha}`)?.props.onLayout?.({
            nativeEvent: { layout: { x: 0, y, width: 300, height: 60 } },
        });
        const scroll = (y: number) => screen.findHostByTestId('scm-history-scroll')?.props.onScroll({ nativeEvent: {
            contentOffset: { x: 0, y }, layoutMeasurement: { width: 300, height: 400 },
            contentSize: { width: 300, height: 1600 },
        } });
        await act(async () => {
            entries.slice(1).forEach((entry, index) => layout(entry.sha, 90 + index * 60));
            scroll(615);
        });
        await screen.update(renderHistory([{ ...entries[0], sha: 'new-head' }, ...entries]));
        await act(async () => { layout('sha-10', 630); });
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 675, animated: false });
        await screen.update(renderHistory(entries, 'repo-b'));
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });

        const incoming = entries.slice(0, 2).map((entry, index) => ({ ...entry, sha: `incoming-${index + 1}` }));
        await screen.update(renderHistory(entries, 'repo-incoming', incoming));
        await act(async () => {
            layout('incoming-1', 30);
            layout('incoming-2', 90);
            scroll(95);
        });
        await screen.update(renderHistory([{ ...entries[0], sha: 'new-head' }, ...entries], 'repo-incoming', incoming));
        await act(async () => { layout('incoming-2', 150); });
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 155, animated: false });
    });
});
