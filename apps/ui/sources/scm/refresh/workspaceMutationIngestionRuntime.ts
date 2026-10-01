import type { NormalizedMessage } from "@happier-dev/session-core/raw";

import { scmStatusSync } from '@/scm/scmStatusSync';
import { resolveWorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';
import { scmDiffCache } from '@/scm/diffCache/scmDiffCacheSingleton';

import { createWorkspaceMutationIngestion } from './workspaceMutationIngestion';

const ingestion = createWorkspaceMutationIngestion({
    debounceMs: 200,
    minUnknownOnlyIntervalMs: 1500,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as any),
    invalidateKnownMutation: (sessionId, changedPaths, serverId) => {
        const target = resolveWorkspaceTargetForSession(serverId ? { serverId, sessionId } : sessionId);
        if (target) scmDiffCache.invalidatePaths({ sessionId: target.workspaceCacheKey, paths: new Set(changedPaths) });
        scmStatusSync.invalidateFromMutation(sessionId, serverId);
    },
    invalidateUnknownMutation: (sessionId, serverId) => {
        scmStatusSync.invalidateFromAutoRefresh(sessionId, serverId);
    },
});

export function ingestWorkspaceMutationMessages(
    sessionId: string,
    messages: readonly NormalizedMessage[],
    serverId?: string | null,
): void {
    ingestion.ingest(sessionId, messages, serverId);
}
