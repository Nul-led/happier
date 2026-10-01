import {
    type WorkflowRunPrivateMetadataV1,
    WorkflowRunListRequestV1Schema,
    WorkflowRunListResultV1Schema,
    WorkflowRunSummariesRequestV1Schema,
    WorkflowRunSummariesResultV1Schema,
    type WorkflowRunSummariesResultV1,
} from '@happier-dev/protocol/workflows/actionsV1';
import type {
    WorkflowRunStateV1,
    WorkflowRunSummaryV1,
} from '@happier-dev/protocol/workflows/workflowProgressV1';

import { callWorkflowAction } from './callWorkflowAction';
import { WorkflowActionError } from './workflowActionError';

/**
 * The Workflows collection's Run **list** reader.
 *
 * Scope boundary: this module reads the paged Run list for the collection
 * screen only. Exact Run detail, invocation pages and run controls are owned by
 * the Run-detail lane and are deliberately absent here, so there is one reader
 * per concern rather than two overlapping run clients. Row bodies are stored by
 * the existing Account-scoped `workflowRunsById` owner; this module never keeps
 * a second cache.
 */

export type WorkflowRunListFilter = Readonly<{
    /**
     * Exact-Run selection. The page stays the lean list projection — one Run
     * summary plus its sparse private metadata — with no usage, checkpoint,
     * definition or invocation reads. Background refresh and transcript
     * initial materialization use this; explicit Run detail keeps the full
     * `workflow.run.get` read.
     */
    runId?: string;
    sourceArtifactId?: string;
    /** `attention: 'required'` asks the server's indexed predicate, not a cached page. */
    attention?: 'required';
    states?: readonly WorkflowRunStateV1[];
    origin?: 'automation' | 'direct';
    automationId?: string;
    originSessionId?: string;
    machineId?: string;
}>;

export type WorkflowRunListPage = Readonly<{
    runs: readonly WorkflowRunSummaryV1[];
    /**
     * Sparse per-page private metadata: a missing key is a readable Run
     * whose accepted snapshot opened but carries no authored title — the
     * canonical display projector names it Untitled — while an explicit
     * `unavailable` value is content this host could not open.
     */
    metadataByRunId: Readonly<Record<string, WorkflowRunPrivateMetadataV1 | null>>;
    nextCursor: string | undefined;
}>;

/**
 * One page of Account-scoped Runs. The opaque cursor binds every supplied
 * filter, so a caller must not mix cursors across filters.
 */
export async function listWorkflowRuns(params: Readonly<{
    filter?: WorkflowRunListFilter;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
}> = {}): Promise<WorkflowRunListPage> {
    const request = WorkflowRunListRequestV1Schema.parse({
        ...(params.filter ?? {}),
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
    });
    const result = await callWorkflowAction({
        actionId: 'workflow.run.list',
        input: request,
        parseResult: (value) => WorkflowRunListResultV1Schema.parse(value),
        fallbackMessage: 'Workflow run list request failed',
        ...(params.signal === undefined ? {} : { signal: params.signal }),
    });
    const sidecar = result.metadataByRunId;
    const metadataByRunId: Record<string, WorkflowRunPrivateMetadataV1 | null> = Object.fromEntries(
        result.runs.map((run) => [
            run.id,
            // An omitted key is the current host's readable untitled Run.
            sidecar[run.id] ?? null,
        ]),
    );
    return { runs: result.runs, metadataByRunId, nextCursor: result.nextCursor };
}

/** Lean batch for the rendered saved-workflow page; no Run-detail cache or reads. */
export async function summarizeWorkflowRuns(params: Readonly<{
    sourceArtifactIds: readonly string[]; recent: number; signal?: AbortSignal;
}>): Promise<WorkflowRunSummariesResultV1> {
    return await callWorkflowAction({
        actionId: 'workflow.run.summaries',
        input: WorkflowRunSummariesRequestV1Schema.parse({ sourceArtifactIds: params.sourceArtifactIds, recent: params.recent }),
        parseResult: (value) => WorkflowRunSummariesResultV1Schema.parse(value),
        fallbackMessage: 'Workflow run summaries request failed',
        ...(params.signal ? { signal: params.signal } : {}),
    });
}

/**
 * One exact Run summary plus its sparse private metadata, through the lean
 * list projection.
 *
 * This is what background Account invalidation and transcript initial
 * materialization read: the Run display fields and the accepted private title
 * the Account row needs, without paging invocations or opening progress
 * envelopes to recompute usage. An empty page is the authoritative deleted
 * signal, so it raises `run_not_found` for the change materializer to remove
 * the row; any other failure is left rejected so the caller holds its cursor
 * and retries instead of losing the invalidation.
 */
export async function getWorkflowRunSummary(runId: string, signal?: AbortSignal): Promise<Readonly<{
    run: WorkflowRunSummaryV1;
    /**
     * Sparse private metadata: `null` is a readable Run whose accepted
     * snapshot opened but carries no authored title (Untitled), while
     * `unavailable` is content this host could not open.
     */
    metadata: WorkflowRunPrivateMetadataV1 | null;
}>> {
    const page = await listWorkflowRuns({ filter: { runId }, limit: 1, ...(signal === undefined ? {} : { signal }) });
    const run = page.runs.find((candidate) => candidate.id === runId);
    if (!run) {
        throw new WorkflowActionError({ message: 'Workflow Run not found', rawCode: 'run_not_found' });
    }
    return { run, metadata: page.metadataByRunId[run.id] ?? null };
}

/** The canonical Runs filters History offers, in display order. */
export const WORKFLOW_RUN_LIST_FILTERS = ['all', 'active', 'attention', 'triggered'] as const;
export type WorkflowRunListFilterId = (typeof WORKFLOW_RUN_LIST_FILTERS)[number];

/**
 * Projects a filter chip onto the canonical request.
 *
 * **Needs you** asks the server for `attention: 'required'` so an off-page
 * approval is discoverable before this client has loaded any invocation.
 * Boundary-paused alone is deliberately not attention.
 */
export function buildWorkflowRunListFilter(id: WorkflowRunListFilterId): WorkflowRunListFilter {
    switch (id) {
        case 'all':
            return {};
        case 'active':
            return { states: ['queued', 'claimed', 'running', 'pause_requested', 'paused', 'interrupted'] };
        case 'attention':
            return { attention: 'required' };
        case 'triggered':
            // Retained history by frozen cause (F24): a run a trigger started stays here after the
            // trigger is deleted, and a direct run never appears.
            return { origin: 'automation' };
    }
}
