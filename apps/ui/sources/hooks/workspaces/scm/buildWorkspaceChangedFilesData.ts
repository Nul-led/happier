import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { selectScmChangedFiles, snapshotToScmStatusFiles, type ScmFileStatus, type ScmStatusFiles } from '@/scm/scmStatusFiles';

export type WorkspaceChangedFilesData = Readonly<{
    scmStatusFiles: ScmStatusFiles | null;
    changedFilesCount: number;
    allRepositoryChangedFiles: ScmFileStatus[];
}>;

export function buildWorkspaceChangedFilesData(input: Readonly<{
    scmSnapshot: ScmWorkingSnapshot | null;
}>): WorkspaceChangedFilesData {
    if (!input.scmSnapshot?.repo.isRepo) {
        return { scmStatusFiles: null, changedFilesCount: 0, allRepositoryChangedFiles: [] };
    }
    const allRepositoryChangedFiles = [...selectScmChangedFiles(input.scmSnapshot)];
    return {
        scmStatusFiles: snapshotToScmStatusFiles(input.scmSnapshot),
        changedFilesCount: allRepositoryChangedFiles.length,
        allRepositoryChangedFiles,
    };
}
