import * as React from 'react';

import type { ActionId, ApprovalRequest } from '@happier-dev/protocol';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import {
    createDefaultActionExecutor,
    requiresExactDaemonApprovalReplay,
    resolveApprovalReplayRoute,
    type ApprovalReplayRoute,
} from '@/sync/ops/actions/defaultActionExecutor';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';

export { resolveApprovalReplayRoute };

type ApprovalDecisionArtifact = Pick<DecryptedArtifact, 'id' | 'header'>;

function requiresResolvedReplayRoute(approval: ApprovalRequest): boolean {
    return approval.v === 2 && (
        requiresExactDaemonApprovalReplay(approval)
        || Boolean(approval.executionOriginV1.serverIdentityId?.trim())
    );
}

export function isApprovalReplayRouteUnavailable(approval: ApprovalRequest | null): boolean {
    return Boolean(approval && requiresResolvedReplayRoute(approval) && !resolveApprovalReplayRoute(approval));
}

function readServerId(
    artifact: ApprovalDecisionArtifact,
    approval: ApprovalRequest | null,
    replayRoute: ApprovalReplayRoute | null,
    sessionId: string,
    serverIdHint?: string | null,
): string | null {
    if (approval?.v === 2 && replayRoute) return replayRoute.serverId;
    if (approval && requiresExactDaemonApprovalReplay(approval)) return null;
    const normalizedServerIdHint = serverIdHint?.trim() ?? '';
    if (normalizedServerIdHint.length > 0) return normalizedServerIdHint;
    const headerServerId = typeof artifact.header?.serverId === 'string' ? artifact.header.serverId.trim() : '';
    if (headerServerId.length > 0) return headerServerId;
    if (approval?.v === 2) return approval.executionOriginV1.serverId.trim() || null;
    return resolvePreferredServerIdForSessionId(sessionId) ?? null;
}

export function useApprovalDecisionHandler(
    artifact: ApprovalDecisionArtifact,
    approval: ApprovalRequest | null,
    sessionId: string,
    serverIdHint?: string | null,
): (decision: 'approve' | 'reject') => Promise<boolean> {
    const serverProfilesGeneration = useServerProfilesGeneration();
    const executor = React.useMemo(
        () => createDefaultActionExecutor({
            resolveServerIdForSessionId: (targetSessionId) => resolvePreferredServerIdForSessionId(targetSessionId) ?? null,
        }),
        [],
    );
    const replayRoute = React.useMemo(
        () => resolveApprovalReplayRoute(approval),
        [approval, serverProfilesGeneration],
    );
    const serverId = React.useMemo(
        () => readServerId(artifact, approval, replayRoute, sessionId, serverIdHint),
        [approval, artifact, replayRoute, serverIdHint, sessionId],
    );

    return React.useCallback(async (decision: 'approve' | 'reject') => {
        if (!approval) return false;
        // Portable or daemon-owned origins must resolve their immutable Home identity. A
        // present-user UI approval intentionally has no cryptographic Home identity and stays
        // on its exact mounted route instead of being misclassified as cross-device replay.
        if (requiresResolvedReplayRoute(approval) && !replayRoute) return false;
        if (
            decision === 'approve'
            && requiresExactDaemonApprovalReplay(approval)
            && (approval.v !== 2 || !approval.executionOriginV1.machineId?.trim())
        ) return false;
        const result = await executor.execute(
            'approval.request.decide' as ActionId,
            { artifactId: artifact.id, decision },
            { surface: 'ui', ...(serverId ? { serverId } : {}) },
        );
        return result.ok === true;
    }, [approval, artifact.id, executor, replayRoute, serverId]);
}
