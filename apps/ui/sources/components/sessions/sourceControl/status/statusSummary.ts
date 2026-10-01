import { selectScmChangedFiles, type ScmFileStatus } from '@/scm/scmStatusFiles';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

/**
 * What the session surfaces say about a working copy at a glance (the composer's Git instrument,
 * the status badges, the Companion summary): where it is, how many files changed and by how much.
 * Not the SCM backend's `ScmStatusSummary` (included/pending/untracked areas); the changed-file count
 * is the one change-count truth, `selectScmChangedFiles`.
 */
export type SessionScmSummary = {
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    changedFiles: number;
    linesAdded: number;
    linesRemoved: number;
    hasLineChanges: boolean;
    isComplete?: boolean;
    hasAnyChanges: boolean;
};

export type SessionScmChangesSummary = SessionScmSummary & Readonly<{
    files: readonly ScmFileStatus[];
    fetchedAt: number;
}>;

export function buildSessionScmSummary(snapshot: ScmWorkingSnapshot | null): SessionScmChangesSummary | null {
    if (!snapshot?.repo.isRepo) {
        return null;
    }

    const linesAdded = snapshot.totals.includedAdded + snapshot.totals.pendingAdded;
    const linesRemoved = snapshot.totals.includedRemoved + snapshot.totals.pendingRemoved;
    const files = selectScmChangedFiles(snapshot);
    const changedFiles = files.length;

    return {
        branch: snapshot.branch.head,
        upstream: snapshot.branch.upstream,
        ahead: snapshot.branch.ahead,
        behind: snapshot.branch.behind,
        changedFiles,
        ...(snapshot.totals.isComplete === undefined ? {} : { isComplete: snapshot.totals.isComplete }),
        linesAdded,
        linesRemoved,
        hasLineChanges: linesAdded > 0 || linesRemoved > 0,
        hasAnyChanges: changedFiles > 0,
        files,
        fetchedAt: snapshot.fetchedAt,
    };
}
