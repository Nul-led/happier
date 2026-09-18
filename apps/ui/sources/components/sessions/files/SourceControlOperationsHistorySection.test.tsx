import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installSessionFilesCommonModuleMocks } from './sessionFilesTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionFilesCommonModuleMocks();

function makeEntries(count: number) {
    return Array.from({ length: count }, (_, index) => ({
        sha: `sha-${index + 1}`,
        shortSha: `s${index + 1}`,
        subject: `Commit ${index + 1}`,
        timestamp: 0,
    })) as any[];
}

function getCommitRows(screen: { findAllHostsByTestId: (testID: string) => unknown[] }, count: number) {
    return Array.from({ length: count }, (_, index) => `scm-commit-entry-sha-${index + 1}`)
        .flatMap((testID) => screen.findAllHostsByTestId(testID));
}

describe('SourceControlOperationsHistorySection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const theme = {
        colors: {
            text: {
                primary: '#fff',
                secondary: '#aaa',
                link: '#09f',
            },
            divider: '#333',
            border: { default: '#333' },
            surface: {
                base: '#222',
                inset: '#111',
            },
            surfaceHigh: '#222',
            input: { background: '#111' },
        },
    } as any;

    it('shows more commits initially when more can be loaded, then expands when requested', async () => {
        const { SourceControlOperationsHistorySection } = await import('@/components/workspaces/scm/SourceControlOperationsHistorySection');

        const onLoadMoreHistory = vi.fn();
        const onOpenCommit = vi.fn();

        const screen = await renderScreen(<SourceControlOperationsHistorySection
                    theme={theme}
                    historyIdentity="repo-a"
                    historyLoading={false}
                    historyEntries={makeEntries(20)}
                    historyHasMore={true}
                    onLoadMoreHistory={onLoadMoreHistory}
                    onOpenCommit={onOpenCommit}
                />);

        const commitRowsBefore = getCommitRows(screen, 12);
        expect(commitRowsBefore).toHaveLength(12);

        const headBadges = screen.findAllHostsByTestId('scm-commit-entry-head-badge');
        expect(headBadges).toHaveLength(1);

        const loadMore = screen.findAllHostsByTestId('scm-commit-load-more');
        expect(loadMore).toHaveLength(1);

        await act(async () => {
            await pressTestInstanceAsync(loadMore[0]);
        });

        expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);

        const commitRowsAfter = getCommitRows(screen, 20);
        expect(commitRowsAfter.length).toBeGreaterThan(12);
        expect(commitRowsAfter).toHaveLength(20);
    });

    it('does not hide commits when no more pages are available', async () => {
        const { SourceControlOperationsHistorySection } = await import('@/components/workspaces/scm/SourceControlOperationsHistorySection');

        const screen = await renderScreen(<SourceControlOperationsHistorySection
                    theme={theme}
                    historyIdentity="repo-a"
                    historyLoading={false}
                    historyEntries={makeEntries(10)}
                    historyHasMore={false}
                    onLoadMoreHistory={vi.fn()}
                    onOpenCommit={vi.fn()}
                />);

        const commitRows = getCommitRows(screen, 10);
        expect(commitRows).toHaveLength(10);

        const loadMore = screen.findAllHostsByTestId('scm-commit-load-more');
        expect(loadMore).toHaveLength(0);
    });

    it('reveals more already-loaded commits without requesting another page', async () => {
        const { SourceControlOperationsHistorySection } = await import('@/components/workspaces/scm/SourceControlOperationsHistorySection');

        const onLoadMoreHistory = vi.fn();
        const screen = await renderScreen(<SourceControlOperationsHistorySection
                    theme={theme}
                    historyIdentity="repo-a"
                    historyLoading={false}
                    historyEntries={makeEntries(40)}
                    historyHasMore={true}
                    onLoadMoreHistory={onLoadMoreHistory}
                    onOpenCommit={vi.fn()}
                />);

        const loadMore = screen.findAllHostsByTestId('scm-commit-load-more');
        expect(loadMore).toHaveLength(1);

        await act(async () => {
            await pressTestInstanceAsync(loadMore[0]);
        });

        expect(getCommitRows(screen, 37)).toHaveLength(37);
        expect(onLoadMoreHistory).not.toHaveBeenCalled();
    });

    it('opens commit details from timeline rows', async () => {
        const { SourceControlOperationsHistorySection } = await import('@/components/workspaces/scm/SourceControlOperationsHistorySection');

        const onOpenCommit = vi.fn();
        const screen = await renderScreen(<SourceControlOperationsHistorySection
                    theme={theme}
                    historyIdentity="repo-a"
                    historyLoading={false}
                    historyEntries={makeEntries(3)}
                    historyHasMore={false}
                    onLoadMoreHistory={vi.fn()}
                    onOpenCommit={onOpenCommit}
                />);

        const firstCommit = screen.findAllHostsByTestId('scm-commit-entry-sha-1');
        expect(firstCommit).toHaveLength(1);

        await act(async () => {
            await pressTestInstanceAsync(firstCommit[0]);
        });

        expect(onOpenCommit).toHaveBeenCalledWith('sha-1');
    });    it('retains expanded commits across a prepended head and resets for another history identity', async () => {
        const { SourceControlOperationsHistorySection } = await import('@/components/workspaces/scm/SourceControlOperationsHistorySection');
        const entries = makeEntries(50);
        const props = { theme, historyIdentity: 'repo-a', historyLoading: false, historyEntries: entries,
            historyHasMore: false, onLoadMoreHistory: vi.fn(), onOpenCommit: vi.fn() };
        const screen = await renderScreen(<SourceControlOperationsHistorySection {...props} />);
        await screen.pressByTestIdAsync('scm-commit-load-more');
        expect(screen.findByTestId('scm-commit-entry-sha-37')).not.toBeNull();
        await screen.update(<SourceControlOperationsHistorySection {...props}
            historyEntries={[{ ...entries[0], sha: 'new-head' }, ...entries]} />);
        expect(screen.findByTestId('scm-commit-entry-sha-37')).not.toBeNull();
        expect(screen.findByTestId('scm-commit-entry-sha-38')).toBeNull();
        await screen.update(<SourceControlOperationsHistorySection {...props} historyIdentity="repo-b" />);
        expect(screen.findByTestId('scm-commit-entry-sha-12')).not.toBeNull();
        expect(screen.findByTestId('scm-commit-entry-sha-13')).toBeNull();
    });

    it('keeps the viewed commit at the same viewport offset after a head is prepended', async () => {
        const { WorkspaceScmHistoryTab } = await import('@/components/workspaces/scm/WorkspaceScmHistoryTab');
        const entries = makeEntries(50);
        const scrollTo = vi.fn();
        const props = { theme, historyIdentity: 'repo-a', historyLoading: false, historyEntries: entries,
            historyHasMore: false, onLoadMoreHistory: vi.fn(), onOpenCommit: vi.fn() };
        const screen = await renderScreen(<WorkspaceScmHistoryTab {...props} />, {
            createNodeMock: (element) => element.type === 'ScrollView' ? { scrollTo } : null,
        });
        await screen.pressByTestIdAsync('scm-commit-load-more');
        const layout = (sha: string, y: number) => screen.findByTestId(`scm-commit-entry-${sha}`)?.props.onLayout?.({
            nativeEvent: { layout: { x: 0, y, width: 300, height: 60 } },
        });
        await act(async () => {
            entries.slice(0, 25).forEach((entry, index) => layout(entry.sha, 30 + index * 60));
            screen.findByType('ScrollView').props.onScroll({ nativeEvent: {
                contentOffset: { x: 0, y: 615 }, layoutMeasurement: { width: 300, height: 400 },
                contentSize: { width: 300, height: 1600 },
            } });
        });
        await screen.update(<WorkspaceScmHistoryTab {...props}
            historyEntries={[{ ...entries[0], sha: 'new-head' }, ...entries]} />);
        await act(async () => { layout('sha-10', 630); });
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 675, animated: false });
        await screen.update(<WorkspaceScmHistoryTab {...props} historyIdentity="repo-b" />);
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    });

});
