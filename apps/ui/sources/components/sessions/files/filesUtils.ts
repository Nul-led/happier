import type { ScmFileStatus } from '@/scm/scmStatusFiles';

export function normalizeFilePath(path: string): string {
    if (!path) return path;
    return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function formatLineChanges(file: Pick<ScmFileStatus, 'linesAdded' | 'linesRemoved' | 'isComplete'>): string {
    if (file.isComplete === false) return '';
    const parts = [];
    if (file.linesAdded > 0) {
        parts.push(`+${file.linesAdded}`);
    }
    if (file.linesRemoved > 0) {
        parts.push(`-${file.linesRemoved}`);
    }
    return parts.length > 0 ? parts.join(' ') : '';
}

export function formatFileSubtitle(file: Pick<ScmFileStatus, 'filePath' | 'linesAdded' | 'linesRemoved' | 'isComplete'>, projectRootLabel: string): string {
    const lineChanges = formatLineChanges(file);
    const pathPart = file.filePath || projectRootLabel;
    return lineChanges ? `${pathPart} • ${lineChanges}` : pathPart;
}
