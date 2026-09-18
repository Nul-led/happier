import { storage } from '@/sync/domains/state/storage';
import { workflowRunDetailActions } from '@/sync/domains/workflows/workflowRunDetailActions';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

import { materializeWorkflowRunAccountChange } from './materializeWorkflowRunAccountChange';

/**
 * Refresh one exact Run into the Account-scoped `workflowRunsById` owner.
 *
 * This is the single composition of the exact `workflow.run.get` read, the
 * canonical change materialization and the shared row merge. The Account-change
 * applier invokes it for every `workflow-run:<id>` change; a transcript row that
 * has just observed a start acknowledgement invokes it once so the row is known
 * before the change stream mentions it. Neither keeps a copy: the shared row
 * is the only body, and its revision merge makes a delayed read harmless.
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
        getRun: () => workflowRunDetailActions.getRun(runId, options.signal),
        upsertRun: (detail) => {
            if (!isCurrent()) return;
            storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                detail.run,
                detail.acceptedContext?.metadata
                    ? { kind: 'available', value: detail.acceptedContext.metadata }
                    : { kind: 'unavailable' },
            )]);
        },
        removeRun: (missingRunId) => {
            if (!isCurrent()) return;
            storage.getState().removeWorkflowRun(missingRunId);
        },
    });
}
