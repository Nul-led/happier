import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { mergeTurnChangeSets } from '@happier-dev/protocol';
import { renderScreen } from '@/dev/testkit';
import { useChangedFilesData } from '@/hooks/session/files/useChangedFilesData';
import {
    installFilesContentCommonModuleMocks,
} from '@/components/workspaces/scm/review/filesContentTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installFilesContentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Platform: {
                select: (value: any) => value?.default ?? null,
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string, params?: Record<string, unknown>) => {
                if (key === 'files.repositoryChangedFiles') return `Repository changed files (${String(params?.count ?? '')})`;
                if (key === 'files.latestTurnChanges') return `Latest turn changes (${String(params?.count ?? '')})`;
                if (key === 'files.latestTurnDescription') return 'Provider-backed changes from the most recent completed turn.';
                if (key === 'files.sessionAttributedChanges') return `Session-attributed changes (${String(params?.count ?? '')})`;
                if (key === 'files.otherRepositoryChanges') return `Other repository changes (${String(params?.count ?? '')})`;
                if (key === 'files.noLatestTurnChanges') return 'No latest-turn changes currently detected.';
                if (key === 'files.checkpointTurnChanges') return `Checkpoint changes (${String(params?.count ?? '')})`;
                if (key === 'files.checkpointUnavailable') return 'Checkpoint evidence is unavailable.';
                if (key === 'files.noCheckpointTurnChanges') return 'No checkpoint changes currently detected.';
                if (key === 'files.noSessionAttributedChanges') return 'No session-attributed changes currently detected.';
                return key;
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Octicons: 'Octicons',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/components/ui/media/FileIcon', () => ({
    FileIcon: 'FileIcon',
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/workspaces/scm/changes/ScmChangeRow', () => ({
    ScmChangeRow: (props: any) => React.createElement('ScmChangeRow', props),
    resolveScmChangeStatsColumnWidth: (files: readonly any[]) => {
        const maxLabelLength = files.reduce((maxLength, file) => {
            const added = Number.isFinite(file?.linesAdded) ? String(Math.max(0, Math.trunc(file.linesAdded))) : '0';
            const removed = Number.isFinite(file?.linesRemoved) ? String(Math.max(0, Math.trunc(file.linesRemoved))) : '0';
            return Math.max(maxLength, `+${added}/-${removed}`.length);
        }, 0);
        return Math.max(38, maxLabelLength * 7 + 4);
    },
}));

describe('ChangedFilesList', () => {
    const testTheme = {
        colors: {
            text: { primary: '#fff', secondary: '#999' },
            border: { default: '#222' },
            surface: { inset: '#111' },
        },
    } as const;

    const file = {
        fileName: 'a.ts',
        filePath: 'src',
        fullPath: 'src/a.ts',
        status: 'modified',
        isIncluded: false,
        linesAdded: 1,
        linesRemoved: 1,
    } as const;
    const directoryLike = {
        fileName: 'src/some-dir/',
        filePath: 'src/some-dir/',
        fullPath: 'src/some-dir/',
        status: 'added',
        isIncluded: false,
        linesAdded: 0,
        linesRemoved: 0,
    } as const;

    it('renders repository view heading and rows', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="repository"

                    allRepositoryChangedFiles={[file as any, directoryLike as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                    rowDensity="compact"
                />);

        // Directory-like SCM entries should be ignored (they cannot be opened / diffed).
        expect(screen.getTextContent()).toContain('Repository changed files (1)');
        const rows = screen.findAllByType('ScmChangeRow' as any);
        expect(rows).toHaveLength(1);
        expect(rows[0].props.density).toBe('compact');
    });

    it('uses the largest visible change stats as a shared stats column width', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const largeStatsFile = {
            ...file,
            fileName: 'requestId.test.ts',
            fullPath: 'src/middleware/requestId.test.ts',
            linesAdded: 146,
            linesRemoved: 10,
        } as const;

        const smallScreen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="repository"

                    allRepositoryChangedFiles={[file as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                />);
        const mixedScreen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="repository"

                    allRepositoryChangedFiles={[file as any, largeStatsFile as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                />);

        const smallWidth = smallScreen.findByType('ScmChangeRow' as any).props.statsColumnWidth;
        const mixedWidths = mixedScreen.findAllByType('ScmChangeRow' as any).map((row) => row.props.statsColumnWidth);

        expect(new Set(mixedWidths).size).toBe(1);
        expect(mixedWidths[0]).toBeGreaterThan(smallWidth);
    });

    it('supports injecting per-file actions for commit/stage flows', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');

        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="repository"

                    allRepositoryChangedFiles={[file as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                    renderFileActions={(f) => React.createElement('Action', { path: f.fullPath })}
                />);

        const rows = screen.findAllByType('ScmChangeRow' as any);
        expect(rows).toHaveLength(1);

        const right = rows[0]!.props.leadingElement;
        const rightScreen = await renderScreen(right);
        expect(rightScreen.findAllByType('Action' as any)).toHaveLength(1);
    });

    it('supports opening a pinned details tab via onFilePressPinned', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const onFilePressPinned = vi.fn();

        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="repository"

                    allRepositoryChangedFiles={[file as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                    onFilePressPinned={onFilePressPinned}
                />);

        const row = screen.findByType('ScmChangeRow' as any);
        expect(typeof row.props.onPressPinned).toBe('function');

        act(() => {
            row.props.onPressPinned();
        });

        expect(onFilePressPinned).toHaveBeenCalledTimes(1);
        expect(onFilePressPinned).toHaveBeenCalledWith(file);
    });

    it('keeps uncertain Session attribution visible without inferring active peers', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="session"

                    allRepositoryChangedFiles={[file as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[file as any]}

                    onFilePress={vi.fn()}
                />);

        expect(screen.getTextContent()).not.toContain('Reliability limited: multiple sessions are active for this repository');
        expect(screen.getTextContent()).toContain('No session-attributed changes currently detected.');
    });

    it('renders latest-turn copy and rows when turn view is selected', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const repositoryOnlyFile = {
            ...file,
            fileName: 'b.ts',
            fullPath: 'src/b.ts',
        } as const;
        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="turn"

                    allRepositoryChangedFiles={[file as any, repositoryOnlyFile as any]}
                    turnAttributedFiles={[{ file: file as any, turns: ['turn-1'], content: { source: 'provider_native', confidence: 'exact' }, attribution: { confidence: 'session_exact', reason: 'provider_correlated' }, checkpointOverlap: 'unknown', evidence: [] }]}
                    turnRepositoryOnlyFiles={[repositoryOnlyFile as any]}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                />);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('Latest turn changes (1)');
        expect(textContent).toContain('Provider-backed changes from the most recent completed turn.');
        expect(textContent).not.toContain('Other repository changes (1)');
        expect(textContent).not.toContain('Reliability limited: multiple sessions are active for this repository');

        const rows = screen.findAllByType('ScmChangeRow' as any);
        expect(rows).toHaveLength(1);
    });

    it('does not render checkpoint empty copy when checkpoint evidence is unavailable', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="turn_checkpoint"

                    allRepositoryChangedFiles={[]}
                    turnCheckpointFiles={[]}
                    turnCheckpointMetadata={{
                        version: 1,
                        scopeId: 's1:/repo',
                        baseRefSource: 'unavailable',
                        contentConfidence: 'unavailable',
                        attributionScope: 'unknown',
                        receipts: [],
                    }}
                    sessionAttributedFiles={[]}
                    repositoryOnlyFiles={[]}

                    onFilePress={vi.fn()}
                />);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('Checkpoint evidence is unavailable.');
        expect(textContent).not.toContain('No checkpoint changes currently detected.');
    });

    it('keeps session view scoped to session-attributed files', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const sessionFile = {
            ...file,
            fullPath: 'src/session.ts',
            fileName: 'session.ts',
        } as const;
        const repositoryOnlyFile = {
            ...file,
            fullPath: 'src/repo-only.ts',
            fileName: 'repo-only.ts',
        } as const;
        const screen = await renderScreen(<ChangedFilesList
                    theme={testTheme as any}
                    changedFilesViewMode="session"

                    allRepositoryChangedFiles={[sessionFile as any, repositoryOnlyFile as any]}
                    sessionAttributedFiles={[{ file: sessionFile as any, turns: ['turn-1'], content: { source: 'provider_native', confidence: 'exact' }, attribution: { confidence: 'session_exact', reason: 'provider_correlated' }, checkpointOverlap: 'unknown', evidence: [] }]}
                    repositoryOnlyFiles={[repositoryOnlyFile as any]}

                    onFilePress={vi.fn()}
                />);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('Session-attributed changes (1)');
        expect(textContent).not.toContain('Other repository changes (1)');

        const rows = screen.findAllByType('ScmChangeRow' as any);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.props.file?.fullPath).toBe('src/session.ts');
        expect(rows[0]?.props.accessibilityQualification).toContain('changedFileEvidence.content.exact');
        expect(rows[0]?.props.accessibilityQualification).toContain('changedFileEvidence.attribution.session_exact');
        expect(screen.findByTestId('changed-file-evidence-trigger')).not.toBeNull();
    });

    it('retains edit-to-rename turn lineage through the hook into a mounted evidence disclosure without exposing ids', async () => {
        const { ChangedFilesList } = await import('./ChangedFilesList');
        const { ChangedFileEvidenceDisclosure } = await import('@/components/workspaces/scm/changes/ChangedFileEvidenceDisclosure');
        const sessionChangeSet = mergeTurnChangeSets({
            sessionId: 's1',
            turns: [
                {
                    sessionId: 's1',
                    turnId: 'private-turn-edit',
                    seqRange: { startSeqInclusive: 1, endSeqInclusive: 2 },
                    status: 'completed',
                    provider: 'codex',
                    derivedAt: 1,
                    files: [{
                        filePath: 'src/old.ts',
                        changeKind: 'modified',
                        source: 'provider_native',
                        confidence: 'exact',
                        provider: 'codex',
                    }],
                },
                {
                    sessionId: 's1',
                    turnId: 'private-turn-rename',
                    seqRange: { startSeqInclusive: 3, endSeqInclusive: 4 },
                    status: 'completed',
                    provider: 'codex',
                    derivedAt: 2,
                    files: [{
                        filePath: 'src/new.ts',
                        previousFilePath: 'src/old.ts',
                        changeKind: 'renamed',
                        source: 'provider_native',
                        confidence: 'exact',
                        provider: 'codex',
                    }],
                },
            ],
        });

        function MountedChangedFiles() {
            const changed = useChangedFilesData({
                sessionId: 's1',
                scmSnapshot: {
                    projectKey: 'm:/repo',
                    fetchedAt: 1,
                    repo: { isRepo: true, rootPath: '/repo' },
                    branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                    stashCount: 0,
                    hasConflicts: false,
                    entries: [{
                        path: 'src/new.ts',
                        previousPath: 'src/old.ts',
                        kind: 'renamed',
                        includeStatus: '.',
                        pendingStatus: 'R',
                        hasIncludedDelta: false,
                        hasPendingDelta: true,
                        stats: {
                            includedAdded: 0,
                            includedRemoved: 0,
                            pendingAdded: 1,
                            pendingRemoved: 1,
                            isBinary: false,
                        },
                    }],
                    totals: {
                        includedFiles: 0,
                        pendingFiles: 1,
                        untrackedFiles: 0,
                        includedAdded: 0,
                        includedRemoved: 0,
                        pendingAdded: 1,
                        pendingRemoved: 1,
                    },
                },
                workspaceTouchedPaths: [],
                searchQuery: '',
                showAllRepositoryFiles: false,
                sessionChangeSet,
            });
            return <ChangedFilesList
                theme={testTheme as any}
                changedFilesViewMode="session"
                allRepositoryChangedFiles={changed.allRepositoryChangedFiles}
                sessionAttributedFiles={changed.sessionAttributedFiles}
                repositoryOnlyFiles={changed.repositoryOnlyFiles}
                onFilePress={vi.fn()}
            />;
        }

        const screen = await renderScreen(<MountedChangedFiles />);
        const disclosure = screen.tree.findByType(ChangedFileEvidenceDisclosure);
        expect(disclosure.props.entry.turns).toEqual(['private-turn-edit', 'private-turn-rename']);
        expect(screen.getTextContent()).not.toContain('private-turn-edit');
        expect(screen.getTextContent()).not.toContain('private-turn-rename');
    });
});
