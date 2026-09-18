import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';

/**
 * The one Session-scoped Run route spelling.
 *
 * Every caller that knows a Run id — a subagent row, a conversation's Agent
 * reference, the Conversations Agent section — reaches Run Details through this
 * helper so the Home scope and encoding cannot drift between them.
 */
export function buildSessionExecutionRunRouteHref(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    runId: string;
}>): string | null {
    const normalizedSessionId = normalizeSessionId(params.sessionId);
    if (!normalizedSessionId) return null;

    const runId = params.runId.trim();
    if (!runId) return null;

    return buildScopedSessionRouteHref({
        sessionId: normalizedSessionId,
        serverId: params.serverId,
        suffix: `/runs/${encodeURIComponent(runId)}`,
    });
}
