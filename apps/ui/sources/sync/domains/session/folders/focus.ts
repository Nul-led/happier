import type { SessionFolderV1, SessionFoldersV1, SessionFolderWorkspaceRefV1 } from './types';
import { sessionFolderAddressKey } from './assignmentKeys';
import { compareSessionFolderWorkspaceRefs } from './workspaceRefs';

export type SessionFolderFocusScope = Readonly<{
    folder: SessionFolderV1;
    folderIds: ReadonlySet<string>;
    breadcrumbs: readonly SessionFolderV1[];
}>;

function collectDescendants(serverId: string, folderId: string, folders: readonly SessionFolderV1[], output: Set<string>): void {
    output.add(folderId);
    for (const folder of folders) {
        if (folder.workspace.serverId === serverId && folder.parentId === folderId && !output.has(folder.id)) {
            collectDescendants(serverId, folder.id, folders, output);
        }
    }
}

export function resolveSessionFolderFocusScope(
    folders: SessionFoldersV1,
    focus: Readonly<{
        folderId: string;
        workspace: SessionFolderWorkspaceRefV1;
        serverId?: string | null;
    }> | null,
): SessionFolderFocusScope | null {
    if (!focus) return null;
    const serverId = focus.serverId?.trim() || focus.workspace.serverId;
    const folder = folders.folders.find((candidate) => (
        candidate.id === focus.folderId
        && candidate.workspace.serverId === serverId
        && compareSessionFolderWorkspaceRefs(candidate.workspace, focus.workspace)
    ));
    if (!folder) return null;

    const byKey = new Map(folders.folders.map((candidate) => [
        sessionFolderAddressKey({ serverId: candidate.workspace.serverId, folderId: candidate.id }),
        candidate,
    ] as const));
    const breadcrumbs: SessionFolderV1[] = [];
    let current: SessionFolderV1 | undefined = folder;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        breadcrumbs.unshift(current);
        current = current.parentId
            ? byKey.get(sessionFolderAddressKey({ serverId, folderId: current.parentId }))
            : undefined;
    }

    const folderIds = new Set<string>();
    collectDescendants(serverId, folder.id, folders.folders, folderIds);
    return { folder, folderIds, breadcrumbs };
}
