import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { selectScmChangedFiles } from './scmStatusFiles';

export type ScmFolderSelection = Readonly<{
    path: string;
    changedCount: number;
    selectedCount: number;
    state: 'none' | 'some' | 'all';
    filePaths: readonly string[];
}>;

export function selectScmFolderSelections(
    snapshot: ScmWorkingSnapshot,
    selectedPaths: readonly string[],
): readonly ScmFolderSelection[] {
    const selected = new Set(selectedPaths);
    const folders = new Map<string, { filePaths: string[]; selectedCount: number }>();
    for (const file of selectScmChangedFiles(snapshot)) {
        const parts = file.fullPath.split('/');
        for (let depth = 1; depth < parts.length; depth += 1) {
            const path = parts.slice(0, depth).join('/');
            const folder = folders.get(path) ?? { filePaths: [], selectedCount: 0 };
            folder.filePaths.push(file.fullPath);
            if (selected.has(file.fullPath)) folder.selectedCount += 1;
            folders.set(path, folder);
        }
    }
    return Array.from(folders, ([path, folder]) => ({
        path,
        changedCount: folder.filePaths.length,
        selectedCount: folder.selectedCount,
        state: folder.selectedCount === 0 ? 'none' : folder.selectedCount === folder.filePaths.length ? 'all' : 'some',
        filePaths: folder.filePaths,
    }));
}

export function toggleScmFolderSelection(
    snapshot: ScmWorkingSnapshot,
    folderPath: string,
    selectedPaths: readonly string[],
): readonly string[] {
    const folder = selectScmFolderSelections(snapshot, selectedPaths).find((item) => item.path === folderPath);
    if (!folder) return selectedPaths;
    const next = new Set(selectedPaths);
    if (folder.state === 'all') {
        for (const path of folder.filePaths) next.delete(path);
    } else {
        for (const path of folder.filePaths) next.add(path);
    }
    return Array.from(next).sort();
}
