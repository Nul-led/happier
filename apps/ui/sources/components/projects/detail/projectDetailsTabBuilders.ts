import type { DetailsTab } from '@/components/appShell/panes/details/workspace/detailsWorkspaceTypes';

export function createProjectFileDetailsTab(fullPath: string): DetailsTab {
    const fileName = fullPath.split(/[\\/]/).pop() ?? fullPath;
    return {
        key: `file:${fullPath}`,
        kind: 'file',
        title: fileName,
        resource: { kind: 'file', path: fullPath },
    };
}

export function createProjectCommitDetailsTab(sha: string): DetailsTab | null {
    const safeSha = sha.trim().split(/\s+/)[0] ?? '';
    if (!safeSha) return null;
    return {
        key: `commit:${safeSha}`,
        kind: 'commit',
        title: safeSha.slice(0, 7),
        resource: { kind: 'commit', sha: safeSha },
    };
}
