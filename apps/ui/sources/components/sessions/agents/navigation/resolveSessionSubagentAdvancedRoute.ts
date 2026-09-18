import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import { buildSessionExecutionRunRouteHref } from './buildSessionExecutionRunRouteHref';

export function resolveSessionSubagentAdvancedRoute(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    subagent: SessionSubagent;
}>): string | null {
    const runId = params.subagent.runRef?.runId;
    if (!runId) return null;

    return buildSessionExecutionRunRouteHref({
        sessionId: params.sessionId,
        serverId: params.serverId,
        runId,
    });
}
