import { SESSION_FOLDER_MAX_COUNT, SESSION_FOLDER_MAX_DEPTH } from './constants';
import { sessionFolderAddressKey } from './assignmentKeys';
import { makeSiblingUniqueSessionFolderName, normalizeSessionFolderName } from './names';
import { migrateLegacyPaddedSortKeysToFractional, rebalanceSortKeys } from './orderKey';
import type { SessionFolderV1, SessionFoldersV1 } from './types';
import { buildSessionFolderWorkspaceRefKey, normalizeSessionFolderWorkspaceRef } from './workspaceRefs';

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildFolderKey(folder: Pick<SessionFolderV1, 'id' | 'workspace'>): string {
    return sessionFolderAddressKey({ serverId: folder.workspace.serverId, folderId: folder.id });
}

function parentCreatesCycle(folder: SessionFolderV1, parentId: string | null, byKey: ReadonlyMap<string, SessionFolderV1>): boolean {
    let current = parentId;
    const seen = new Set<string>();
    while (current) {
        if (current === folder.id) return true;
        if (seen.has(current)) return true;
        seen.add(current);
        current = byKey.get(sessionFolderAddressKey({ serverId: folder.workspace.serverId, folderId: current }))?.parentId ?? null;
    }
    return false;
}

function resolveDepth(folder: SessionFolderV1, byKey: ReadonlyMap<string, SessionFolderV1>): number {
    let depth = 0;
    let current = folder.parentId;
    const seen = new Set<string>([folder.id]);
    while (current) {
        if (seen.has(current)) return SESSION_FOLDER_MAX_DEPTH + 1;
        seen.add(current);
        const parent = byKey.get(sessionFolderAddressKey({ serverId: folder.workspace.serverId, folderId: current }));
        if (!parent) return depth;
        depth += 1;
        current = parent.parentId;
    }
    return depth;
}

export function normalizeSessionFolders(
    value: unknown,
    options: Readonly<{
        currentRenderWorkspaceKeysByFolderKey?: Readonly<Record<string, string>>;
    }> = {},
): SessionFoldersV1 {
    if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.folders)) {
        return { v: 1, folders: [] };
    }

    const byKey = new Map<string, SessionFolderV1>();
    const ordered: SessionFolderV1[] = [];
    for (const rawFolder of value.folders.slice(0, SESSION_FOLDER_MAX_COUNT)) {
        if (!isRecord(rawFolder)) continue;
        const id = String(rawFolder.id ?? '').trim();
        const workspace = normalizeSessionFolderWorkspaceRef(rawFolder.workspace);
        const name = normalizeSessionFolderName(rawFolder.name);
        if (!id || !workspace || !name) continue;

        const folder: SessionFolderV1 = {
            id,
            workspace,
            ...(typeof rawFolder.renderWorkspaceKey === 'string' && rawFolder.renderWorkspaceKey.trim()
                ? { renderWorkspaceKey: rawFolder.renderWorkspaceKey.trim() }
                : {}),
            parentId: typeof rawFolder.parentId === 'string' && rawFolder.parentId.trim()
                ? rawFolder.parentId.trim()
                : null,
            name,
            createdAt: normalizeTimestamp(rawFolder.createdAt, 0),
            updatedAt: normalizeTimestamp(rawFolder.updatedAt, normalizeTimestamp(rawFolder.createdAt, 0)),
            ...(typeof rawFolder.sortKey === 'string' && rawFolder.sortKey.trim()
                ? { sortKey: rawFolder.sortKey.trim() }
                : {}),
        };
        const key = buildFolderKey(folder);
        if (byKey.has(key)) continue;
        byKey.set(key, folder);
        ordered.push(folder);
    }

    const parentNormalized = ordered.map((folder): SessionFolderV1 => {
        const parent = folder.parentId
            ? byKey.get(sessionFolderAddressKey({ serverId: folder.workspace.serverId, folderId: folder.parentId }))
            : null;
        const parentId = parent
            && buildSessionFolderWorkspaceRefKey(parent.workspace) === buildSessionFolderWorkspaceRefKey(folder.workspace)
            && !parentCreatesCycle(folder, parent.id, byKey)
            ? parent.id
            : null;
        return { ...folder, parentId };
    });

    const byKeyAfterParents = new Map(parentNormalized.map((folder) => [buildFolderKey(folder), folder] as const));
    const nameKeysBySibling = new Map<string, Set<string>>();
    const finalFolders: SessionFolderV1[] = [];
    for (const folder of parentNormalized) {
        const depth = resolveDepth(folder, byKeyAfterParents);
        const parentId = depth > SESSION_FOLDER_MAX_DEPTH ? null : folder.parentId;
        const siblingKey = JSON.stringify([buildSessionFolderWorkspaceRefKey(folder.workspace), parentId]);
        const siblingNames = nameKeysBySibling.get(siblingKey) ?? new Set<string>();
        nameKeysBySibling.set(siblingKey, siblingNames);
        const name = makeSiblingUniqueSessionFolderName(folder.name, siblingNames);
        siblingNames.add(name.toLocaleLowerCase());
        finalFolders.push({
            ...folder,
            parentId,
            name,
            ...(options.currentRenderWorkspaceKeysByFolderKey?.[buildFolderKey(folder)]
                ? { renderWorkspaceKey: options.currentRenderWorkspaceKeysByFolderKey[buildFolderKey(folder)] }
                : {}),
        });
    }

    const migrationSortKeysByFolderKey = new Map<string, string>();
    const siblingsByKey = new Map<string, SessionFolderV1[]>();
    for (const folder of finalFolders) {
        const siblingKey = JSON.stringify([
            buildSessionFolderWorkspaceRefKey(folder.workspace),
            folder.parentId,
        ]);
        const siblings = siblingsByKey.get(siblingKey) ?? [];
        siblings.push(folder);
        siblingsByKey.set(siblingKey, siblings);
    }
    for (const siblings of siblingsByKey.values()) {
        const migrated = siblings.every((folder) => !folder.sortKey)
            ? rebalanceSortKeys(new Map(
                siblings.map((folder, index) => [folder.id, String(index + 1).padStart(6, '0')] as const),
            ))
            : migrateLegacyPaddedSortKeysToFractional(siblings);
        for (const [folderId, sortKey] of migrated) {
            const folder = siblings.find((candidate) => candidate.id === folderId);
            if (folder) migrationSortKeysByFolderKey.set(buildFolderKey(folder), sortKey);
        }
    }

    return {
        v: 1,
        folders: migrationSortKeysByFolderKey.size === 0
            ? finalFolders
            : finalFolders.map((folder) => {
                const sortKey = migrationSortKeysByFolderKey.get(buildFolderKey(folder));
                return sortKey ? { ...folder, sortKey } : folder;
            }),
    };
}
