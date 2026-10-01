import { describe, expect, it } from 'vitest';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { selectScmFolderSelections, toggleScmFolderSelection } from './scmFolderSelection';

const changedEntry = (path: string): ScmWorkingSnapshot['entries'][number] => ({
    path, previousPath: null, kind: 'modified', includeStatus: '.', pendingStatus: 'M',
    hasIncludedDelta: false, hasPendingDelta: true,
    stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false },
});

describe('selectScmFolderSelections', () => {
    it('aggregates only canonical changed files and derives tri-state selection across nested folders', () => {
        const stagedAndEdited = changedEntry('src/a.ts');
        const snapshot: ScmWorkingSnapshot = {
            projectKey: 'machine:/repo', fetchedAt: 1,
            repo: { isRepo: true, rootPath: '/repo' },
            branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
            stashCount: 0, hasConflicts: false,
            entries: [{ ...stagedAndEdited, hasIncludedDelta: true, includeStatus: 'M',
                stats: { ...stagedAndEdited.stats, includedAdded: 1 } },
                changedEntry('src/nested/b.ts'), changedEntry('src/nested/c.ts'), changedEntry('scratch/')],
            totals: { includedFiles: 1, pendingFiles: 4, untrackedFiles: 0, includedAdded: 1, includedRemoved: 0, pendingAdded: 4, pendingRemoved: 0 },
        };

        expect(selectScmFolderSelections(snapshot, ['src/nested/b.ts'])).toEqual([
            { path: 'src', changedCount: 3, selectedCount: 1, state: 'some', filePaths: ['src/a.ts', 'src/nested/b.ts', 'src/nested/c.ts'] },
            { path: 'src/nested', changedCount: 2, selectedCount: 1, state: 'some', filePaths: ['src/nested/b.ts', 'src/nested/c.ts'] },
        ]);
        expect(selectScmFolderSelections(snapshot, [])?.[0]?.state).toBe('none');
        expect(selectScmFolderSelections(snapshot, ['src/a.ts', 'src/nested/b.ts', 'src/nested/c.ts'])?.[0]?.state).toBe('all');
        expect(toggleScmFolderSelection(snapshot, 'src/nested', ['src/a.ts', 'src/nested/b.ts'])).toEqual([
            'src/a.ts', 'src/nested/b.ts', 'src/nested/c.ts',
        ]);
        expect(toggleScmFolderSelection(snapshot, 'src/nested', ['src/a.ts', 'src/nested/b.ts', 'src/nested/c.ts'])).toEqual(['src/a.ts']);
    });
});
