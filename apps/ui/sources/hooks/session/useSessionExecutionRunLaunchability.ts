import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import * as React from 'react';

import { useResumeCapabilityOptions } from '@/agents/hooks/useResumeCapabilityOptions';
import { canResumeSessionWithOptions } from '@/agents/runtime/resumeCapabilities';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useExecutionRunsBackendsForSession } from '@/hooks/server/useExecutionRunsBackendsForSession';
import { useSessionExecutionRunsSupported } from '@/hooks/server/useSessionExecutionRunsSupported';
import { useSessionExternalSessionRuntime } from '@/components/sessions/model/useSessionExternalSessionRuntime';
import { canLaunchExecutionRunsForSession } from '@/sync/domains/executionRuns/canLaunchExecutionRunsForSession';
import type { ExecutionRunBackendCapabilityMap } from '@/sync/domains/executionRuns/resolveExecutionRunAvailableBackends';
import { resolveSessionMachineId } from '@/sync/domains/session/external/resolveSessionMachineId';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSettings } from '@/sync/domains/state/storage';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

export type UseSessionExecutionRunLaunchabilityResult = Readonly<{
    canLaunchExecutionRuns: boolean;
    canShowExecutionRunLauncher: boolean;
    executionRunsBackends: ExecutionRunBackendCapabilityMap;
    executionRunsSupported: boolean;
    sessionServerId: string | null;
}>;

export function useSessionExecutionRunLaunchability(
    sessionId: string,
    session: Session | null | undefined,
    explicitServerId?: string | null,
): UseSessionExecutionRunLaunchabilityResult {
    const settings = useSettings();
    const normalizedExplicitServerId = typeof explicitServerId === 'string' && explicitServerId.trim().length > 0
        ? explicitServerId.trim()
        : null;
    const preferredServerId = usePreferredServerIdForSession({
        serverId: normalizedExplicitServerId ?? session?.serverId,
        sessionId,
    });
    const sessionTargetServerId = preferredServerId;
    const scopedSession = normalizedExplicitServerId && session?.serverId
        && !areServerProfileIdentifiersEquivalent(session.serverId, sessionTargetServerId)
        ? null
        : session;
    const executionRunsEnabled = useFeatureEnabled(
        'execution.runs',
        sessionTargetServerId ? { scopeKind: 'spawn', serverId: sessionTargetServerId } : undefined,
    );
    const executionRunsSupported = useSessionExecutionRunsSupported(sessionId, sessionTargetServerId);
    const executionRunsBackends = useExecutionRunsBackendsForSession(sessionId, sessionTargetServerId);
    const { machineReachable } = useSessionMachineReachability(sessionId, sessionTargetServerId);
    const machineTarget = useSessionMachineTarget(sessionId, sessionTargetServerId);
    const ownerMetadata = scopedSession ? readSessionOwnerMetadataView(scopedSession) : null;
    const externalSessionRuntime = useSessionExternalSessionRuntime({
        sessionId,
        metadata: ownerMetadata,
        serverId: sessionTargetServerId,
    });
    // A Session whose Agent identity cannot be read must not borrow the default
    // Agent's resume capabilities; the hook already treats a null id as "no
    // current declaration" and fails the launcher closed.
    const agentId = React.useMemo(
        () => resolveAgentIdFromSessionMetadata(ownerMetadata),
        [ownerMetadata],
    );
    const { resumeCapabilityOptions } = useResumeCapabilityOptions({
        agentId,
        machineId: machineTarget?.machineId ?? resolveSessionMachineId(ownerMetadata),
        serverId: sessionTargetServerId,
        settings,
        enabled: scopedSession?.active === false,
    });
    const allowWhileInactive = React.useMemo(() => {
        if (scopedSession?.active !== false) return false;
        if (!machineReachable) return false;
        return canResumeSessionWithOptions(ownerMetadata, resumeCapabilityOptions);
    }, [machineReachable, ownerMetadata, resumeCapabilityOptions, scopedSession?.active]);

    const canShowExecutionRunLauncher = React.useMemo(() => {
        if (executionRunsEnabled !== true) {
            return false;
        }
        if (scopedSession?.active === false && allowWhileInactive !== true) {
            return false;
        }
        if (externalSessionRuntime.externalSessionLink !== null && externalSessionRuntime.status?.runnerActive !== true) {
            return false;
        }
        return true;
    }, [
        allowWhileInactive,
        externalSessionRuntime.externalSessionLink,
        externalSessionRuntime.status?.runnerActive,
        executionRunsEnabled,
        scopedSession?.active,
    ]);

    const canLaunchExecutionRuns = React.useMemo(() => canLaunchExecutionRunsForSession({
        session: scopedSession,
        executionRunsSupported,
        executionRunsBackends,
        allowWhileInactive,
        hasExternalSessionLink: externalSessionRuntime.externalSessionLink !== null,
        externalSessionRunnerActive: externalSessionRuntime.status?.runnerActive,
    }), [
        allowWhileInactive,
        externalSessionRuntime.externalSessionLink,
        externalSessionRuntime.status?.runnerActive,
        executionRunsBackends,
        executionRunsSupported,
        scopedSession,
    ]);

    return {
        canLaunchExecutionRuns,
        canShowExecutionRunLauncher,
        executionRunsBackends,
        executionRunsSupported,
        sessionServerId: sessionTargetServerId,
    };
}
