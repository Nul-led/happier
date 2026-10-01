import { storage } from '@/sync/domains/state/storage';
import { getWorkflowRunSummary } from '@/sync/domains/workflows/workflowRunListActions';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

import { materializeWorkflowRunAccountChange } from './materializeWorkflowRunAccountChange';

/**
 * Refresh one exact Run into the Account-scoped `workflowRunsById` owner.
 *
 * This is the single composition of the lean exact-Run summary read, the
 * canonical change materialization and the shared row merge. The Account-change
 * applier invokes it for every `workflow-run:<id>` change; a transcript row that
 * has just observed a start acknowledgement invokes it once so the row is known
 * before the change stream mentions it. Neither keeps a copy: the shared row
 * is the only body, and its revision merge makes a delayed read harmless.
 *
 * The read is the list owner's exact-Run projection — one Run summary plus its
 * sparse private metadata — never the full `workflow.run.get` detail. Full
 * detail pages all invocations and opens every progress envelope to recompute
 * usage, a history-proportional cost no background invalidation or transcript
 * placeholder may pay. Explicit Run detail keeps that read.
 *
 * `fence` is the caller's Account lifetime. A read that completes after that
 * lifetime retired is discarded rather than merged into another Account's map.
 */
export async function refreshWorkflowRunById(
    runId: string,
    options: Readonly<{
        signal?: AbortSignal;
        fence?: Readonly<{ isCurrent(): boolean }>;
    }> = {},
): Promise<void> {
    const isCurrent = (): boolean => options.fence?.isCurrent() ?? true;
    await materializeWorkflowRunAccountChange({
        runId,
        getRun: () => getWorkflowRunSummary(runId, options.signal),
        upsertRun: (detail) => {
            if (!isCurrent()) return;
            // The sparse sidecar semantics survive verbatim: `null` is a
            // readable Run whose accepted snapshot opened but carries no
            // authored title (Untitled), while `unavailable` is content this
            // host could not open. Collapsing the two locked a perfectly
            // readable unnamed Run behind "Content unavailable" in the
            // collection and in every Session card that reads the same row.
            storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(detail.run, detail.metadata)]);
        },
        removeRun: (missingRunId) => {
            if (!isCurrent()) return;
            storage.getState().removeWorkflowRun(missingRunId);
        },
    });
}
