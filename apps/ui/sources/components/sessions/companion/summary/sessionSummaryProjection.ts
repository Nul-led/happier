import type { SessionAwarenessProjectionV1 } from '@happier-dev/protocol';

import type { ScmStatusSummary } from '@/components/sessions/sourceControl/status/statusSummary';
import type { SessionCompanionDensity } from '../state/sessionCompanionPreference';

/**
 * The pure card composer for the first-party Session Summary.
 *
 * It composes canonical facts and nothing else: Lane 09A awareness decides
 * operational state and freshness, the approval selector decides how many
 * approvals are open, the SCM snapshot owner decides branch and change totals,
 * and the Session usage owner decides tokens/context. This module may omit rows,
 * order them and name an EXISTING destination — it never decides runtime status,
 * work precedence, personal relevance/attention, freshness or usage meaning, and
 * it never generates prose.
 */

/** Where a row opens. Every value is an incumbent surface, never a Companion screen. */
export type SessionSummaryDestination =
    | 'sessionInfo'
    | 'approvals'
    | 'work'
    | 'workflow'
    | 'git'
    | 'usage';

export type SessionSummaryRow =
    | Readonly<{ kind: 'approvals'; count: number; destination: 'approvals' }>
    | Readonly<{
        kind: 'activity';
        liveCount: number;
        totalCount: number;
        title: string | null;
        statusLabel: string | null;
        destination: 'workflow';
    }>
    | Readonly<{
        kind: 'work';
        label: string;
        status: NonNullable<SessionAwarenessProjectionV1['currentWork']>['status'] | null;
        destination: 'work';
    }>
    | Readonly<{ kind: 'workflow'; runCount: number; destination: 'workflow' }>
    | Readonly<{
        kind: 'workspace';
        label: string;
        branch: string | null;
        changedFiles: number | null;
        destination: 'git';
    }>
    | Readonly<{
        kind: 'usage';
        tokens: number | null;
        contextPercent: number | null;
        stale: boolean;
        destination: 'usage';
    }>;

export type SessionSummaryUsageFacts = Readonly<{
    tokens: number | null;
    contextPercent: number | null;
    stale: boolean;
}>;

export type SessionSummaryActivityFacts = Readonly<{
    live: number;
    total: number;
    headline: Readonly<{ title: string; statusLabel: string }> | null;
}>;

export type SessionSummaryInput = Readonly<{
    awareness: SessionAwarenessProjectionV1;
    /** From the existing Agent catalog presentation; never inferred from metadata here. */
    agentLabel: string | null;
    /** The canonical Lane 05 count projection; this composer derives no roster. */
    activity: SessionSummaryActivityFacts | null;
    openApprovalCount: number;
    /** `buildScmStatusSummaryFromSnapshot` output; `null` when there is no repository. */
    scm: ScmStatusSummary | null;
    usage: SessionSummaryUsageFacts | null;
}>;

export type SessionSummaryCardModel = Readonly<{
    /** Exact Home + Session proof is required before any Session fact is exposed. */
    scope: 'exact' | 'realm_unavailable';
    title: string | null;
    agentLabel: string | null;
    operational: SessionAwarenessProjectionV1['operational']['primary'] | null;
    /** Lane 09A's freshness, softened once in presentation; values are never zeroed. */
    stale: boolean;
    /** Lane 09A's own admission that it could not see everything it describes. */
    availability: SessionAwarenessProjectionV1['availability'];
    /** Canonical content-readability reason; presentation owns only its label. */
    encryption: SessionAwarenessProjectionV1['encryption'];
    identityDestination: 'sessionInfo';
    rows: readonly SessionSummaryRow[];
}>;

/** §10.4: at most two compact detail rows before the full-surface affordance. */
const ROW_BUDGET: Readonly<Record<SessionCompanionDensity, number>> = {
    compact: 2,
    comfortable: 3,
};

function workspaceLabel(
    awareness: SessionAwarenessProjectionV1,
    scm: ScmStatusSummary | null,
): string | null {
    const workspace = awareness.workspace;
    const label = workspace?.projectName ?? workspace?.worktreeName ?? workspace?.path ?? null;
    return label ?? scm?.branch ?? null;
}

export function projectSessionSummaryCard(input: SessionSummaryInput): SessionSummaryCardModel {
    const rows: SessionSummaryRow[] = [];

    // An open approval leads because it is the only row a person can act on right
    // now. This is visual ordering, not another attention or relevance predicate.
    if (input.openApprovalCount > 0) {
        rows.push(Object.freeze({
            kind: 'approvals',
            count: input.openApprovalCount,
            destination: 'approvals',
        }));
    }

    if (input.activity && input.activity.total > 0) {
        rows.push(Object.freeze({
            kind: 'activity',
            liveCount: input.activity.live,
            totalCount: input.activity.total,
            title: input.activity.headline?.title ?? null,
            statusLabel: input.activity.headline?.statusLabel ?? null,
            destination: 'workflow',
        }));
    }

    const work = input.awareness.currentWork;
    if (work?.title) {
        rows.push(Object.freeze({
            kind: 'work',
            label: work.title,
            status: work.status ?? null,
            destination: 'work',
        }));
    }
    if (work?.activeWorkflowRunCount) {
        rows.push(Object.freeze({
            kind: 'workflow',
            runCount: work.activeWorkflowRunCount,
            destination: 'workflow',
        }));
    }

    const workspace = workspaceLabel(input.awareness, input.scm);
    // A repository with nothing to report adds noise, not information.
    if (workspace && (input.awareness.workspace || input.scm?.hasAnyChanges || input.scm?.branch)) {
        rows.push(Object.freeze({
            kind: 'workspace',
            label: workspace,
            branch: input.scm?.branch ?? null,
            changedFiles: input.scm ? input.scm.changedFiles : null,
            destination: 'git',
        }));
    }

    // Usage appears only when the canonical latest usage supports a truthful
    // metric; an absent window or token count is omitted, never shown as zero.
    if (input.usage && (input.usage.tokens !== null || input.usage.contextPercent !== null)) {
        rows.push(Object.freeze({
            kind: 'usage',
            tokens: input.usage.tokens,
            contextPercent: input.usage.contextPercent,
            stale: input.usage.stale,
            destination: 'usage',
        }));
    }

    return Object.freeze({
        scope: 'exact',
        title: input.awareness.title ?? null,
        agentLabel: input.agentLabel,
        operational: input.awareness.operational.primary,
        stale: input.awareness.freshness !== 'live',
        availability: input.awareness.availability,
        encryption: input.awareness.encryption,
        identityDestination: 'sessionInfo',
        rows: Object.freeze(rows),
    });
}

/**
 * Bounded presentation, not dropped data: rows beyond the density budget stay
 * reachable through one labelled full-surface affordance, and the caller uses
 * `hiddenCount` to announce exactly what is omitted.
 */
export function resolveSessionSummaryVisibleRows(
    model: SessionSummaryCardModel,
    density: SessionCompanionDensity,
): Readonly<{ rows: readonly SessionSummaryRow[]; hiddenCount: number }> {
    const budget = ROW_BUDGET[density];
    return Object.freeze({
        rows: Object.freeze(model.rows.slice(0, budget)),
        hiddenCount: Math.max(0, model.rows.length - budget),
    });
}

export type SessionSummaryRowPresentation =
    | Readonly<{ kind: 'full' }>
    | Readonly<{ kind: 'card'; density: SessionCompanionDensity }>;

/** Full Companion is the destination for omitted card rows, so it is uncapped. */
export function resolveSessionSummaryRows(
    model: SessionSummaryCardModel,
    presentation: SessionSummaryRowPresentation,
): Readonly<{ rows: readonly SessionSummaryRow[]; hiddenCount: number }> {
    if (presentation.kind === 'full') {
        return Object.freeze({ rows: model.rows, hiddenCount: 0 });
    }
    return resolveSessionSummaryVisibleRows(model, presentation.density);
}
