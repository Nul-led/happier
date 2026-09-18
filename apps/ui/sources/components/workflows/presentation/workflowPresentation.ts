import { t } from '@/text';
import type { WorkflowPhaseRollup } from '@/components/sessions/workState/sessionWorkflowActivityTypes';
import type { SessionWorkflowRunHeadlineV1, SessionWorkflowRunStatusV1 } from '@happier-dev/protocol';

/**
 * Neutral workflow presentation owner.
 *
 * Status tone, progress and rollup formatting shared by every workflow surface — the transcript
 * card, the Session work-state popover, and the managed library/run/Flow surfaces. It is
 * origin-neutral on purpose: nothing here reads a Claude observation snapshot or a managed run
 * record, only exact counts and statuses already normalized by the owning reader. Claude-observation
 * snapshot normalization stays in `@/components/sessions/workState/sessionWorkflowActivityPresentation`.
 */

/** Workflow status tone shared by the compact badge, popover, and transcript card (themed downstream). */
export type WorkflowStatusTone = 'active' | 'warning' | 'complete' | 'neutral';

/** Run-status tone: failed/blocked warns, active is active, terminal-success is complete. */
export function resolveWorkflowRunTone(status: SessionWorkflowRunStatusV1): WorkflowStatusTone {
    if (status === 'failed' || status === 'blocked' || status === 'stopped') return 'warning';
    if (status === 'active') return 'active';
    if (status === 'complete') return 'complete';
    if (status === 'cancelled') return 'neutral';
    return 'neutral';
}

/** Phase/run rollup tone: any failed/blocked agent warns, any active agent is active, all-complete is complete. */
export function resolveWorkflowRollupTone(rollup: WorkflowPhaseRollup): WorkflowStatusTone {
    if (rollup.failed > 0 || rollup.blocked > 0) return 'warning';
    if (rollup.active > 0) return 'active';
    if (rollup.total > 0 && rollup.complete === rollup.total) return 'complete';
    return 'neutral';
}

/** Progress meter tone for `MeterBar`: success/warning/danger/neutral from a run-level rollup. */
export function resolveWorkflowMeterTone(rollup: WorkflowPhaseRollup): 'success' | 'warning' | 'danger' | 'neutral' {
    if (rollup.failed > 0) return 'danger';
    if (rollup.blocked > 0) return 'warning';
    if (rollup.total > 0 && rollup.complete === rollup.total) return 'success';
    if (rollup.active > 0) return 'success';
    return 'neutral';
}

/** Completed-over-total fraction in 0..1 for the progress meter; 0 when there are no agents. */
export function resolveWorkflowProgressFraction(run: Pick<SessionWorkflowRunHeadlineV1, 'completedAgents' | 'totalAgents'>): number {
    if (run.totalAgents <= 0) return 0;
    return Math.min(1, Math.max(0, run.completedAgents / run.totalAgents));
}

/**
 * Compose a concise rollup string from exact counts, e.g. `3/3 complete`, `2/5 active · 1 failed`.
 * Returns the highest-signal summary so phase headers stay scannable.
 */
export function formatPhaseRollup(rollup: WorkflowPhaseRollup): string {
    const segments: string[] = [];
    if (rollup.total > 0) {
        segments.push(t('tools.workflowActivityView.phaseComplete', { complete: rollup.complete, total: rollup.total }));
    }
    if (rollup.active > 0) segments.push(t('tools.workflowActivityView.phaseActive', { count: rollup.active }));
    if (rollup.failed > 0) segments.push(t('tools.workflowActivityView.phaseFailed', { count: rollup.failed }));
    if (rollup.blocked > 0) segments.push(t('tools.workflowActivityView.phaseBlocked', { count: rollup.blocked }));
    if (rollup.pending > 0 && rollup.active === 0 && rollup.complete === 0) {
        segments.push(t('tools.workflowActivityView.phasePending', { count: rollup.pending }));
    }
    return segments.join(' · ');
}
