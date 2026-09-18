import * as React from 'react';

import { useLazyDirectoryTree } from '@/hooks/ui/filesystem/useLazyDirectoryTree';
import type { LazyDirectoryTreeEntry, LazyDirectoryTreeLoadResult } from '@/hooks/ui/filesystem/lazyDirectoryTreeTypes';
import {
    getCachedRepositoryDirectoryEntries,
    getCachedRepositoryGitIgnoreAvailable,
    listRepositoryDirectoryEntries,
    warmRepositoryDirectoryCache,
    type ListRepositoryDirectoryEntriesResult,
    type RepositoryDirectoryEntry,
} from '@/sync/domains/input/repositoryDirectory';
import { resolveWorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';
import { useWorkspaceRepositoryDirectoryRevision } from '@/hooks/workspaces/files/useWorkspaceRepositoryDirectoryRevision';

import { readRepositoryTreeClassification } from '@/hooks/workspaces/files/repositoryTreeClassification';
import { projectRepositoryTreeNodes } from '@/hooks/workspaces/files/repositoryTreeVisibility';

const NO_PRESERVED_PATHS: readonly string[] = [];

function joinPath(parent: string, name: string): string {
    const trimmedParent = parent.trim().replace(/\/+$/g, '');
    const trimmedName = name.trim().replace(/^\/+/g, '');
    if (!trimmedParent) return trimmedName;
    if (!trimmedName) return trimmedParent;
    return `${trimmedParent}/${trimmedName}`;
}

function toLazyEntries(directoryPath: string, entries: readonly RepositoryDirectoryEntry[]): LazyDirectoryTreeEntry[] {
    return entries.map((entry) => ({
        name: entry.name,
        path: joinPath(directoryPath, entry.name),
        type: entry.type,
        sizeBytes: entry.sizeBytes,
        modifiedMs: entry.modifiedMs,
    }));
}

function toLazyLoadResult(directoryPath: string, result: ListRepositoryDirectoryEntriesResult): LazyDirectoryTreeLoadResult {
    if (!result.ok) {
        return result;
    }
    return {
        ok: true,
        entries: toLazyEntries(directoryPath, result.entries),
    };
}

export function useRepositoryTreeBrowser(input: {
    sessionId: string;
    enabled: boolean;
    expandedPaths?: readonly string[];
    onExpandedPathsChange?: (paths: string[]) => void;
    reloadToken?: number;
    visibilityMode?: 'project' | 'all';
    preservedPaths?: readonly string[];
}) {
    const workspaceCacheKey = React.useMemo(() => {
        const target = resolveWorkspaceTargetForSession(input.sessionId);
        return target?.workspaceCacheKey ?? null;
    }, [input.sessionId]);
    const scopeKey = workspaceCacheKey ?? input.sessionId;
    const directoryRevision = useWorkspaceRepositoryDirectoryRevision(workspaceCacheKey);
    const effectiveReloadToken = React.useMemo(() => (
        `${input.reloadToken ?? ''}:${directoryRevision}`
    ), [directoryRevision, input.reloadToken]);

    const getCachedEntries = React.useCallback((directoryPath: string) => {
        const cached = getCachedRepositoryDirectoryEntries({ sessionId: input.sessionId, directoryPath });
        return cached ? toLazyEntries(directoryPath, cached) : null;
    }, [input.sessionId]);

    const loadDirectoryEntries = React.useCallback(async (directoryPath: string) => {
        const result = await listRepositoryDirectoryEntries({ sessionId: input.sessionId, directoryPath });
        return toLazyLoadResult(directoryPath, result);
    }, [input.sessionId]);

    const warmDirectoryEntries = React.useCallback(async (directoryPath: string) => {
        const result = await warmRepositoryDirectoryCache({ sessionId: input.sessionId, directoryPath });
        return toLazyLoadResult(directoryPath, result);
    }, [input.sessionId]);

    const tree = useLazyDirectoryTree({
        scopeKey,
        enabled: input.enabled,
        rootDirectoryPath: '',
        expandedPaths: input.expandedPaths,
        onExpandedPathsChange: input.onExpandedPathsChange,
        reloadToken: effectiveReloadToken,
        getCachedEntries,
        loadDirectoryEntries,
        warmDirectoryEntries,
        warmChildDirectoriesLimit: 2,
    });
    const classification = React.useMemo(() => readRepositoryTreeClassification(tree.nodes, (directoryPath) => ({
        available: getCachedRepositoryGitIgnoreAvailable({ sessionId: input.sessionId, directoryPath }),
        entries: getCachedRepositoryDirectoryEntries({ sessionId: input.sessionId, directoryPath }),
    })), [tree.nodes, input.sessionId]);
    const gitIgnoreAvailable = classification.available;
    const preservedPaths = input.preservedPaths ?? NO_PRESERVED_PATHS;
    const nodes = React.useMemo(() => input.visibilityMode === 'project' && gitIgnoreAvailable === true
        ? projectRepositoryTreeNodes(tree.nodes, classification.ignoredPaths, preservedPaths)
        : tree.nodes, [tree.nodes, input.visibilityMode, gitIgnoreAvailable, classification.ignoredPaths, preservedPaths]);
    return { ...tree, nodes, gitIgnoreAvailable };
}
