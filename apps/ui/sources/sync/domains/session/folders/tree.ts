import type {
    SessionFolderV1,
    SessionFolderList,
    SessionFolderListItem,
    SessionFolderWorkspaceRefV1,
} from './types';
import { compareSessionFolderWorkspaceRefs } from './workspaceRefs';

export type SessionFolderTreeItem = Pick<SessionFolderV1, 'id' | 'name' | 'parentId' | 'sortKey'> & Readonly<{
    workspace: SessionFolderWorkspaceRefV1 | null;
    serverId?: string;
}>;

export type SessionFolderTreeNode<TItem extends SessionFolderTreeItem = SessionFolderListItem> = TItem & Readonly<{
    depth: number;
    children: readonly SessionFolderTreeNode<TItem>[];
}>;

export type SessionFolderTree<TItem extends SessionFolderTreeItem = SessionFolderListItem> = Readonly<{
    rootNodes: readonly SessionFolderTreeNode<TItem>[];
    nodesById: ReadonlyMap<string, SessionFolderTreeNode<TItem>>;
}>;

function compareFolders<TItem extends SessionFolderTreeItem>(a: TItem, b: TItem): number {
    const sortA = a.sortKey ?? a.name.toLocaleLowerCase();
    const sortB = b.sortKey ?? b.name.toLocaleLowerCase();
    if (sortA !== sortB) return sortA.localeCompare(sortB);
    return a.id.localeCompare(b.id);
}

export function buildSessionFolderTree<TItem extends SessionFolderTreeItem>(
    folders: Readonly<{ v: 1; folders: readonly TItem[] }>,
    workspace: SessionFolderWorkspaceRefV1,
    options: Readonly<{
        includeLockedFolderIds?: ReadonlySet<string>;
    }> = {},
): SessionFolderTree<TItem> {
    const workspaceFolders = folders.folders
        .filter((folder) => folder.workspace
            ? compareSessionFolderWorkspaceRefs(folder.workspace, workspace)
            : folder.serverId === workspace.serverId && options.includeLockedFolderIds?.has(folder.id) === true)
        .slice()
        .sort(compareFolders);
    const childFoldersByParentId = new Map<string | null, TItem[]>();
    for (const folder of workspaceFolders) {
        const siblings = childFoldersByParentId.get(folder.parentId) ?? [];
        siblings.push(folder);
        childFoldersByParentId.set(folder.parentId, siblings);
    }

    const nodesById = new Map<string, SessionFolderTreeNode<TItem>>();
    const buildNode = (folder: TItem, depth: number): SessionFolderTreeNode<TItem> => {
        const children = (childFoldersByParentId.get(folder.id) ?? []).map((child) => buildNode(child, depth + 1));
        const node: SessionFolderTreeNode<TItem> = { ...folder, depth, children };
        nodesById.set(folder.id, node);
        return node;
    };

    return {
        rootNodes: (childFoldersByParentId.get(null) ?? []).map((folder) => buildNode(folder, 0)),
        nodesById,
    };
}
