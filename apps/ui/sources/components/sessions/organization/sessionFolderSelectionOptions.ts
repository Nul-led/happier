import { t } from '@/text';

export type SessionFolderSelectionTarget = Readonly<{ folderId: string; title: string; depth: number }>;
export type SessionFolderSelectionOption = Readonly<{ id: string; folderId: string | null; label: string; depth: number }>;

/** The no-folder choice's option id; a folder id never takes this value. */
export const SESSION_FOLDER_SELECTION_ROOT_ID = 'root';

/**
 * The folder step shared by the new-session placement chip and Settings → Embeds: the no-folder
 * choice first, then the eligible folders in tree order.
 */
export function buildSessionFolderSelectionOptions(
    folderTargets: readonly SessionFolderSelectionTarget[],
): readonly SessionFolderSelectionOption[] {
    return [
        { id: SESSION_FOLDER_SELECTION_ROOT_ID, folderId: null, label: t('sessionsList.moveToWorkspaceRoot'), depth: 0 },
        ...folderTargets.map((folder) => ({ id: folder.folderId, folderId: folder.folderId, label: folder.title, depth: folder.depth })),
    ];
}

/** The selected folder's label, or the no-folder label; a folder that is no longer eligible says so. */
export function resolveSessionFolderSelectionLabel(
    folderId: string | null,
    folderTargets: readonly SessionFolderSelectionTarget[],
): string {
    if (!folderId) return t('sessionsList.moveToWorkspaceRoot');
    return folderTargets.find((folder) => folder.folderId === folderId)?.title ?? t('common.unavailable');
}
