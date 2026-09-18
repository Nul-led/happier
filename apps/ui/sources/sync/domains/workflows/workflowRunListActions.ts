import {
    type WorkflowRunPrivateMetadataV1,
    WorkflowRunListRequestV1Schema,
    WorkflowRunListResultV1Schema,
} from '@happier-dev/protocol/workflows/actionsV1';
import type {
    WorkflowRunStateV1,
    WorkflowRunSummaryV1,
} from '@happier-dev/protocol/workflows/workflowProgressV1';

import { callWorkflowAction } from './callWorkflowAction';

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
    metadataByRunId: Readonly<Record<string, WorkflowRunPrivateMetadataV1>>;
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
    const metadataByRunId: Record<string, WorkflowRunPrivateMetadataV1> = Object.fromEntries(
        result.runs.map((run) => [
            run.id,
            result.metadataByRunId?.[run.id] ?? { kind: 'unavailable' },
        ]),
    );
    return { runs: result.runs, metadataByRunId, nextCursor: result.nextCursor };
}

/** The canonical Runs filters the collection offers, in display order. */
export const WORKFLOW_RUN_LIST_FILTERS = ['all', 'active', 'attention'] as const;
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
    }
}
