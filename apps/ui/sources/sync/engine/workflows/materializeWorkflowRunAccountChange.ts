import type { WorkflowRunSummaryV1 } from '@happier-dev/protocol';

import { WorkflowActionError } from '@/sync/domains/workflows/workflowActionError';

/**
 * Materialize one content-free `workflow-run:<id>` Account change.
 *
 * A successful exact read replaces the shared row projection. `run_not_found`
 * is equally authoritative after history deletion, so it removes the row. Any
 * other failure is left rejected for the Account-change applier to hold its
 * durable cursor and retry instead of losing the invalidation.
 */
export async function materializeWorkflowRunAccountChange(params: Readonly<{
    runId: string;
    getRun: () => Promise<Readonly<{
        run: WorkflowRunSummaryV1;
        acceptedContext?: Readonly<{ metadata?: Readonly<{ title: string; description?: string }> }>;
    }>>;
    upsertRun: (detail: Readonly<{
        run: WorkflowRunSummaryV1;
        acceptedContext?: Readonly<{ metadata?: Readonly<{ title: string; description?: string }> }>;
    }>) => void;
    removeRun: (runId: string) => void;
}>): Promise<void> {
    try {
        const detail = await params.getRun();
        params.upsertRun(detail);
    } catch (error) {
        if (error instanceof WorkflowActionError && error.code === 'run_not_found') {
            params.removeRun(params.runId);
            return;
        }
        throw error;
    }
}
