import type { FileSearchItem } from '@/sync/domains/fileSystem/fileSearchItem';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';

import {
    buildUniversalSearchScopeKey,
    UNIVERSAL_SEARCH_SOURCE_IDS,
    type UniversalSearchResult,
} from './universalSearchResult';

export function buildUniversalSearchWorkspaceFileResults(input: Readonly<{
    files: readonly FileSearchItem[];
    accountId: string;
    scope: WorkspaceScopeBase;
    workspaceRefId: string | null;
    sessionId: string | null;
}>): UniversalSearchResult[] {
    const scopeKey = buildUniversalSearchScopeKey([
        input.accountId,
        input.scope.serverId,
        input.scope.machineId,
        input.scope.rootPath,
    ]);
    return input.files.flatMap((file) => file.fileType === 'file' ? [{
        id: file.fullPath,
        scopeKey,
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.files,
        kind: 'workspaceFile',
        title: file.fileName,
        subtitle: file.filePath,
        target: {
            kind: 'workspaceFile' as const,
            scope: input.scope,
            path: file.fullPath,
            workspaceRefId: input.workspaceRefId,
            sessionId: input.sessionId,
            serverId: input.scope.serverId,
            accountId: input.accountId,
        },
    }] : []);
}
