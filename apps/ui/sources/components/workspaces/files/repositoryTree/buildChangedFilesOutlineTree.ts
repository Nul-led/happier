import type { LazyDirectoryTreeNode } from '@/hooks/ui/filesystem/lazyDirectoryTreeTypes';
import type { ScmFileStatus } from '@/scm/scmStatusFiles';

export type ChangedFilesOutlineNode =
    | {
          kind: 'dir';
          name: string;
          fullPath: string;
          children: ChangedFilesOutlineNode[];
      }
    | {
          kind: 'file';
          name: string;
          fullPath: string;
          file: ScmFileStatus;
      };

function compareNamesCaseInsensitive(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function sortNodes(nodes: ChangedFilesOutlineNode[]): ChangedFilesOutlineNode[] {
    return [...nodes].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return compareNamesCaseInsensitive(a.name, b.name);
    });
}

type DirBuilder = {
    kind: 'dir';
    name: string;
    fullPath: string;
    dirs: Map<string, DirBuilder>;
    files: Map<string, ChangedFilesOutlineNode & { kind: 'file' }>;
};

function createDir(name: string, fullPath: string): DirBuilder {
    return {
        kind: 'dir',
        name,
        fullPath,
        dirs: new Map(),
        files: new Map(),
    };
}

function toNode(dir: DirBuilder): ChangedFilesOutlineNode & { kind: 'dir' } {
    const children: ChangedFilesOutlineNode[] = [];
    for (const childDir of dir.dirs.values()) children.push(toNode(childDir));
    for (const childFile of dir.files.values()) children.push(childFile);
    return {
        kind: 'dir',
        name: dir.name,
        fullPath: dir.fullPath,
        children: sortNodes(children),
    };
}

export function buildChangedFilesOutlineTree(files: readonly Pick<ScmFileStatus, 'fullPath'>[]): ChangedFilesOutlineNode[] {
    const root = createDir('', '');

    for (const file of files) {
        const fullPath = file.fullPath?.trim();
        if (!fullPath) continue;

        // SCM paths are expected to be forward-slash normalized, but be resilient to
        // backslash-delimited inputs (e.g. Windows/interop edge cases).
        const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length === 0) continue;

        let current = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]!;
            const nextPath = current.fullPath ? `${current.fullPath}/${part}` : part;
            const existing = current.dirs.get(part);
            if (existing) {
                current = existing;
            } else {
                const next = createDir(part, nextPath);
                current.dirs.set(part, next);
                current = next;
            }
        }

        const fileName = parts[parts.length - 1]!;
        current.files.set(fullPath, {
            kind: 'file',
            name: fileName,
            fullPath,
            file: file as ScmFileStatus,
        });
    }

    return toNode(root).children;
}

/**
 * Changed only (session tabs lab FC): the Files tree pruned to the changed files, as tree rows. Every
 * folder is open unless the person closed it, and a folder whose only child is one folder merges
 * into it ("components/settings/modal"), so a deep change never costs seven rows in a narrow pane.
 * A merged row stands for its deepest folder: its path opens, reveals and counts that folder.
 */
export function buildChangedOnlyTreeNodes(
    files: readonly Pick<ScmFileStatus, 'fullPath'>[],
    closedPaths: ReadonlySet<string>,
): LazyDirectoryTreeNode[] {
    const rows: LazyDirectoryTreeNode[] = [];
    const emit = (nodes: readonly ChangedFilesOutlineNode[], depth: number, parentDirectoryPath: string) => {
        for (const node of nodes) {
            if (node.kind === 'file') {
                rows.push({ path: node.fullPath, name: node.name, type: 'file', depth, isExpanded: false, isLoadingChildren: false, parentDirectoryPath });
                continue;
            }
            let folder = node;
            let name = node.name;
            while (folder.children.length === 1 && folder.children[0]!.kind === 'dir') {
                folder = folder.children[0] as typeof folder;
                name = `${name}/${folder.name}`;
            }
            const isExpanded = !closedPaths.has(folder.fullPath);
            rows.push({ path: folder.fullPath, name, type: 'directory', depth, isExpanded, isLoadingChildren: false, parentDirectoryPath });
            if (isExpanded) emit(folder.children, depth + 1, folder.fullPath);
        }
    };
    emit(buildChangedFilesOutlineTree(files), 0, '');
    return rows;
}
