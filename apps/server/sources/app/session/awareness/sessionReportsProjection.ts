import type { Prisma } from '@prisma/client';
import {
    isProjectedSessionStalledV1,
    parseSessionRuntimeActivityProjectionFields,
    projectSessionAwarenessOperationalV1,
    projectSessionAwarenessRuntimeV1,
    type SessionReportsV1,
    type V2SessionRecord,
} from '@happier-dev/protocol';
import type { Tx } from '@/storage/inTx';
import type { SessionAccessAuthentication } from '@/app/session/access/sessionAccessAuthentication';
import {
    buildSessionAccessWhere,
    resolveEffectiveSessionAccessWhere,
    type SessionCollectiveAccessSnapshot,
} from '@/app/session/access/sessionAccessWhere';
import {
    hasSessionTranscriptPublicationLiveFacts,
    isSessionTranscriptShareable,
    SESSION_TRANSCRIPT_PUBLICATION_SELECT,
} from '@/app/session/sessionTranscriptPublicationPolicy';
import { parseStoredSessionLatestTurnStatus, readLatestTurnStatusObservedAt } from '@/app/session/listing/rows';
import { AUTOMATION_RUN_TERMINAL_STATES } from '@/app/automations/automationTypes';

/** Content-free turn-end review barrier; FIN owns the run lifecycle and terminal vocabulary. */
export async function readSessionPendingReviewRunCountsInTx(tx: Tx, sessionIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (sessionIds.length === 0) return new Map();
    const runs = await tx.automationRun.groupBy({
        by: ['causeSourceSessionId'],
        where: { causeSourceSessionId: { in: [...sessionIds] }, causeTriggerKind: 'sessionLifecycle',
            causeSessionLifecycleEvent: { in: ['parentTurnCompleted', 'parentTurnFailed', 'parentTurnCancelled'] },
            state: { notIn: [...AUTOMATION_RUN_TERMINAL_STATES] } },
        _count: { _all: true },
    });
    return new Map(runs.flatMap((run) => run.causeSourceSessionId ? [[run.causeSourceSessionId, run._count._all] as const] : []));
}

const REPORT_SESSION_SELECT = {
    id: true,
    ...SESSION_TRANSCRIPT_PUBLICATION_SELECT,
    archivedAt: true,
    latestTurnStatus: true,
    latestTurnStatusObservedAt: true,
    latestReadyEventSeq: true,
    latestReadyEventAt: true,
    meaningfulActivityAt: true,
    active: true,
    lastActiveAt: true,
    thinking: true,
    thinkingAt: true,
    runtimeActivityState: true,
    runtimeActivityActiveCount: true,
    runtimeActivityObservedAt: true,
    runtimeActivityRevision: true,
    pendingPermissionRequestCount: true,
    pendingUserActionRequestCount: true,
    pendingRequestObservedAt: true,
    pendingCount: true,
    pendingBlockedCount: true,
} as const satisfies Prisma.SessionSelect;

type ReportSessionRow = Prisma.SessionGetPayload<{ select: typeof REPORT_SESSION_SELECT }>;

function projectReportOperational(row: ReportSessionRow, nowMs: number) {
    const liveFacts = hasSessionTranscriptPublicationLiveFacts(row);
    const lifecycle = {
        archivedAtMs: row.archivedAt?.getTime() ?? null,
        latestTurnStatus: liveFacts ? parseStoredSessionLatestTurnStatus(row.latestTurnStatus) : null,
        latestTurnStatusObservedAtMs: liveFacts ? readLatestTurnStatusObservedAt(row.latestTurnStatusObservedAt) : null,
        latestReadyEventSeq: liveFacts ? row.latestReadyEventSeq : null,
        latestReadyEventAtMs: liveFacts ? row.latestReadyEventAt?.getTime() ?? null : null,
        meaningfulActivityAtMs: row.meaningfulActivityAt?.getTime() ?? null,
    };
    const parsedActivity = liveFacts ? parseSessionRuntimeActivityProjectionFields({
        runtimeActivityState: row.runtimeActivityState,
        runtimeActivityActiveCount: row.runtimeActivityActiveCount,
        runtimeActivityObservedAt: readLatestTurnStatusObservedAt(row.runtimeActivityObservedAt),
        runtimeActivityRevision: readLatestTurnStatusObservedAt(row.runtimeActivityRevision),
    }) : null;
    const activity = parsedActivity?.kind === 'valid' ? parsedActivity.projection : null;
    const runtime = projectSessionAwarenessRuntimeV1({
        nowMs,
        lifecycle,
        runtime: {
            presence: 'unknown',
            active: liveFacts && row.active,
            lastObservedAtMs: liveFacts ? row.lastActiveAt.getTime() : null,
            thinking: liveFacts && row.thinking,
            thinkingAtMs: liveFacts ? row.thinkingAt?.getTime() ?? null : null,
            activityState: activity?.state ?? null,
            activityActiveCount: activity?.activeCount ?? null,
        },
        pending: liveFacts ? {
            hasPendingPermissionRequests: row.pendingPermissionRequestCount > 0,
            hasPendingUserActionRequests: row.pendingUserActionRequestCount > 0,
            pendingRequestObservedAtMs: row.pendingRequestObservedAt?.getTime() ?? null,
            queuedInputCount: row.pendingCount,
            blockedInputCount: row.pendingBlockedCount,
        } : {},
    });
    return {
        operational: projectSessionAwarenessOperationalV1({ runtime, lifecycle }),
        // The existing presence publisher/timeout owns Session.active; only its own turn can stall it.
        stalled: liveFacts && isProjectedSessionStalledV1({ active: row.active, latestTurnStatus: lifecycle.latestTurnStatus }),
    };
}

/** One batch acquires authorized relation facts for every returned list/detail row. */
export async function projectSessionReportsForRowsInTx(tx: Tx, input: Readonly<{
    accountId: string;
    authentication: SessionAccessAuthentication;
    sessions: readonly V2SessionRecord[];
    accessMode: 'legacy_owner_or_direct' | 'effective_access_v1';
    collectiveAccessSnapshot?: SessionCollectiveAccessSnapshot;
    nowMs: number;
}>): Promise<V2SessionRecord[]> {
    if (input.sessions.length === 0) return [];
    const sessionIds = input.sessions.map((session) => session.id);
    const pendingReviewRuns = await readSessionPendingReviewRunCountsInTx(tx, sessionIds);
    const edges = await tx.sessionReportsTo.findMany({
        where: { OR: [{ sessionId: { in: sessionIds } }, { leadSessionId: { in: sessionIds } }] },
        select: { sessionId: true, leadSessionId: true },
    });
    const relatedIds = [...new Set(edges.flatMap((edge) => [edge.sessionId, edge.leadSessionId]))];
    const accessWhere = input.accessMode === 'legacy_owner_or_direct' && !input.authentication.sessionRuntimePrincipal
        ? buildSessionAccessWhere({ accountId: input.accountId, capability: 'readTranscript', mode: 'legacy_owner_or_direct' })
        : (await resolveEffectiveSessionAccessWhere({
            tx, accountId: input.accountId, capability: 'readTranscript', mode: 'effective_access_v1',
            authentication: input.authentication, collectiveAccessSnapshot: input.collectiveAccessSnapshot,
        })).where;
    const related = await tx.session.findMany({
        where: { AND: [accessWhere, { id: { in: relatedIds } }] },
        select: REPORT_SESSION_SELECT,
    });
    const readable = new Map(related.filter((row) => row.accountId === input.accountId || isSessionTranscriptShareable(row))
        .map((row) => [row.id, row]));
    const leads = new Map<string, string>();
    const reports = new Map<string, SessionReportsV1>();
    for (const edge of edges) {
        // Neither an unreadable parent nor an unreadable child leaks via counts or IDs.
        if (!readable.has(edge.sessionId) || !readable.has(edge.leadSessionId)) continue;
        leads.set(edge.sessionId, edge.leadSessionId);
        const counts = reports.get(edge.leadSessionId) ?? { total: 0, working: 0, needsYou: 0, stalled: 0 };
        counts.total += 1;
        const child = readable.get(edge.sessionId)!;
        const { operational, stalled } = projectReportOperational(child, input.nowMs);
        if (operational.primary === 'working' && !stalled) counts.working += 1;
        if (operational.primary === 'failed' || operational.primary === 'permission_required' || operational.primary === 'action_required') counts.needsYou += 1;
        if (stalled) counts.stalled += 1;
        reports.set(edge.leadSessionId, counts);
    }
    return input.sessions.map((session) => {
        const { reportsTo: _previousReportsTo, reports: _previousReports, ...base } = session;
        const leadSessionId = leads.get(session.id);
        return {
            ...base,
            pendingReviewRuns: pendingReviewRuns.get(session.id) ?? 0,
            ...(leadSessionId ? { reportsTo: { sessionId: leadSessionId } } : {}),
            reports: reports.get(session.id) ?? { total: 0, working: 0, needsYou: 0, stalled: 0 },
        };
    });
}
