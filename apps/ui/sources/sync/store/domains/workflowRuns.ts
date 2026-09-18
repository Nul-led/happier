import type {
    WorkflowRunInvocationIndexV1,
    WorkflowRunSummaryV1,
    WorkflowRunPrivateMetadataV1,
} from '@happier-dev/protocol';

import type { AutomationDefinitionRun } from '@/sync/domains/automations/automationTypes';

import type { StoreGet, StoreSet } from './_shared';

/**
 * One admitted workflow Run, as this Account can read it.
 *
 * A Run is identified by its own `runId`, never by the Automation that happened
 * to admit it, so an exact read, an invalidation or a deep link reaches the row
 * with no list loaded.
 *
 * Two transports produce Runs and neither is a downgrade of the other:
 *
 * - `workflow.run.*` Actions return `WorkflowRunSummaryV1` — origin, custody,
 *   frozen machine and the canonical availability of each control.
 * - the incumbent `/v3/automations/:automationId/runs` REST route returns the
 *   Automation projection — trigger cause, dispatch state and reply handoff.
 *
 * Their state vocabularies are genuinely different contracts, so this row keeps
 * both projections side by side instead of flattening them into one guessed
 * enum. Each projection carries its own `revision`, which is the Run's exact
 * persisted currentness counter, so each slot knows independently how fresh it
 * is and a read from one transport never blanks what the other observed.
 */
export type WorkflowRunRow = Readonly<{
    id: string;
    /** The newest Run revision observed through any transport. */
    revision: number;
    /** Epoch milliseconds, normalized across both transports for ordering. */
    updatedAt: number;
    summary: WorkflowRunSummaryV1 | null;
    /** Account-private accepted display metadata, never sourced from the public summary. */
    metadata: WorkflowRunPrivateMetadataV1 | null;
    automation: AutomationDefinitionRun | null;
}>;

export type WorkflowRunsById = Record<string, WorkflowRunRow>;

/**
 * The one Account-scoped map of workflow Run bodies. Every transport that reads
 * Runs normalizes into it and keeps only its own ordered `runId` window beside
 * it, so two surfaces showing the same Run cannot diverge.
 */
export type WorkflowRunsDomain = {
    workflowRunsById: WorkflowRunsById;
    workflowRunListWindows: Partial<Record<WorkflowRunListWindowId, WorkflowRunListWindow>>;
    workflowRunInvocationsByRunId: Record<string, WorkflowRunInvocationWindow>;
    /**
     * Merge exact Run bodies by `runId`. This is the entry point an exact read,
     * a list page or an invalidation uses; it joins no window, because a Run is
     * discoverable by identity whether or not a list containing it is loaded.
     */
    upsertWorkflowRuns: (runs: readonly WorkflowRunRow[]) => void;
    removeWorkflowRun: (runId: string) => void;
    applyWorkflowRunListPage: (input: Readonly<{
        windowId: WorkflowRunListWindowId;
        runs: readonly WorkflowRunSummaryV1[];
        metadataByRunId?: Readonly<Record<string, WorkflowRunPrivateMetadataV1>>;
        nextCursor: string | null;
        mode: 'replace' | 'append';
    }>) => void;
    applyWorkflowRunInvocationPage: (input: Readonly<{
        runId: string;
        invocations: readonly WorkflowRunInvocationIndexV1[];
        nextCursor: string | null;
        parentRevision: number;
        mode: 'replace' | 'append';
    }>) => void;
    /** Merge one exact historical row without disturbing the currently loaded page. */
    upsertWorkflowRunInvocation: (input: Readonly<{
        runId: string;
        invocation: WorkflowRunInvocationIndexV1;
        parentRevision: number;
    }>) => void;
};

export type WorkflowRunListWindowId = 'all' | 'active' | 'attention';
export type WorkflowRunListWindow = Readonly<{
    runIds: readonly string[];
    nextCursor: string | null;
    loaded: boolean;
}>;

export type WorkflowRunInvocationWindow = Readonly<{
    invocations: readonly WorkflowRunInvocationIndexV1[];
    nextCursor: string | null;
    /** The parent revision the page was read at, so a stale control can be refused. */
    parentRevision: number | null;
    loaded: boolean;
}>;

function appendInvocations(
    existing: readonly WorkflowRunInvocationIndexV1[],
    incoming: readonly WorkflowRunInvocationIndexV1[],
): WorkflowRunInvocationIndexV1[] {
    const indexById = new Map(existing.map((entry, index) => [entry.id, index]));
    const next = [...existing];
    for (const invocation of incoming) {
        const index = indexById.get(invocation.id);
        if (index === undefined) {
            indexById.set(invocation.id, next.length);
            next.push(invocation);
            continue;
        }
        // A refreshed row replaces its own entry in place, so an update never
        // moves a row the reader has open to the end of the page.
        next[index] = invocation;
    }
    return next;
}

function appendUniqueIds(existing: readonly string[], incoming: readonly string[]): string[] {
    const seen = new Set(existing);
    const next = [...existing];
    for (const id of incoming) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
    }
    return next;
}

function toEpochMilliseconds(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Normalize the workflow Action projection into a shared row. */
export function workflowRunRowFromSummary(
    summary: WorkflowRunSummaryV1,
    metadata: WorkflowRunPrivateMetadataV1 | null = null,
): WorkflowRunRow {
    return {
        id: summary.id,
        revision: summary.revision,
        updatedAt: toEpochMilliseconds(summary.updatedAt),
        summary,
        metadata,
        automation: null,
    };
}

/** Normalize the incumbent Automation REST projection into a shared row. */
export function workflowRunRowFromAutomationRun(run: AutomationDefinitionRun): WorkflowRunRow {
    return {
        id: run.id,
        revision: run.revision,
        updatedAt: run.updatedAt,
        summary: null,
        metadata: null,
        automation: run,
    };
}

/**
 * Which of two reads of one projection slot is authoritative.
 *
 * The server increments `revision` on every Run mutation, so a strictly older
 * revision is a delayed page and must not regress the row it lands on. Within
 * one revision the newer `updatedAt` still wins, which is the incumbent
 * last-write rule and keeps a transport that reports progress without a
 * revision bump from being ignored. Only a fully identical read keeps the
 * stored reference, so an idle refresh does not invalidate every subscriber of
 * an unchanged row.
 */
function selectCurrentProjection<T extends Readonly<{ revision: number }>>(
    stored: T | null,
    incoming: T | null,
    updatedAtOf: (value: T) => number,
): T | null {
    if (!incoming) return stored;
    if (!stored) return incoming;
    if (incoming.revision !== stored.revision) {
        return incoming.revision > stored.revision ? incoming : stored;
    }
    return updatedAtOf(incoming) > updatedAtOf(stored) ? incoming : stored;
}

function selectCurrentSummaryProjection(
    stored: Pick<WorkflowRunRow, 'summary' | 'metadata'>,
    incoming: Pick<WorkflowRunRow, 'summary' | 'metadata'>,
): Pick<WorkflowRunRow, 'summary' | 'metadata'> {
    if (!incoming.summary) return stored;
    if (!stored.summary) return incoming;
    if (incoming.summary.revision !== stored.summary.revision) {
        return incoming.summary.revision > stored.summary.revision
            ? { summary: incoming.summary, metadata: incoming.metadata ?? stored.metadata }
            : stored;
    }

    const summary = toEpochMilliseconds(incoming.summary.updatedAt) > toEpochMilliseconds(stored.summary.updatedAt)
        ? incoming.summary
        : stored.summary;
    // Opening private content can recover without advancing the server-owned
    // Run revision. At the same accepted revision an available projection is
    // strictly more informative than unavailable, regardless of read order.
    const metadata = stored.metadata?.kind === 'available'
        ? stored.metadata
        : incoming.metadata?.kind === 'available'
            ? incoming.metadata
            : summary === incoming.summary
                ? incoming.metadata ?? stored.metadata
                : stored.metadata ?? incoming.metadata;
    return { summary, metadata };
}

function mergeRow(stored: WorkflowRunRow, incoming: WorkflowRunRow): WorkflowRunRow {
    const summaryProjection = selectCurrentSummaryProjection(stored, incoming);
    const { summary, metadata } = summaryProjection;
    const automation = selectCurrentProjection(
        stored.automation,
        incoming.automation,
        (value) => value.updatedAt,
    );
    if (summary === stored.summary && automation === stored.automation && metadata === stored.metadata) return stored;
    const revision = Math.max(summary?.revision ?? 0, automation?.revision ?? 0);
    // `updatedAt` follows whichever projection carries the newest revision, so
    // list ordering never regresses when only the other transport refreshes.
    const updatedAt = summary && summary.revision === revision
        ? toEpochMilliseconds(summary.updatedAt)
        : automation && automation.revision === revision
            ? automation.updatedAt
            : stored.updatedAt;
    return { id: stored.id, revision, updatedAt, summary, metadata, automation };
}

/**
 * Merge rows into the shared map, returning the previous map unchanged when
 * nothing advanced so an unrelated store update does not rerender every Run row
 * on the screen.
 */
export function mergeWorkflowRunBodies(
    previous: WorkflowRunsById,
    incoming: readonly WorkflowRunRow[],
): WorkflowRunsById {
    let next: WorkflowRunsById | null = null;
    for (const row of incoming) {
        const stored = (next ?? previous)[row.id];
        const current = stored ? mergeRow(stored, row) : row;
        if (current === stored) continue;
        next = next ?? { ...previous };
        next[row.id] = current;
    }
    return next ?? previous;
}

/**
 * Drop the bodies a window just stopped referencing.
 *
 * Retention is per-adapter on purpose: a caller releases only the ids its own
 * windows referenced, and only when no window it knows about still holds them.
 * A row reached by identity instead — a deep link, a notification, a Run whose
 * list was never opened — is in neither set and is therefore untouched.
 */
export function releaseWorkflowRunBodies(params: Readonly<{
    runsById: WorkflowRunsById;
    releasedRunIds: Iterable<string>;
    retainedRunIds: ReadonlySet<string>;
}>): WorkflowRunsById {
    const { runsById, releasedRunIds, retainedRunIds } = params;
    let next: WorkflowRunsById | null = null;
    for (const runId of releasedRunIds) {
        if (retainedRunIds.has(runId)) continue;
        const row = (next ?? runsById)[runId];
        if (!row?.automation) continue;
        next = next ?? { ...runsById };
        if (row.summary) {
            next[runId] = workflowRunRowFromSummary(row.summary, row.metadata);
        } else {
            delete next[runId];
        }
    }
    return next ?? runsById;
}

/**
 * Project an ordered window of ids onto the shared bodies. An id with no loaded
 * body is skipped rather than rendered as a placeholder row: the window records
 * membership, the map records what is actually known.
 */
export function resolveWorkflowRunRows(
    runsById: WorkflowRunsById,
    runIds: readonly string[],
): WorkflowRunRow[] {
    const rows: WorkflowRunRow[] = [];
    for (const runId of runIds) {
        const row = runsById[runId];
        if (row) rows.push(row);
    }
    return rows;
}

/**
 * The Automation projections of an ordered window. Automation surfaces read
 * this rather than the shared row, so their existing contract is unchanged and
 * a Run this client has only ever seen through a workflow Action does not
 * appear in an Automation history with half its fields missing.
 */
export function resolveAutomationRunProjections(
    runsById: WorkflowRunsById,
    runIds: readonly string[],
): AutomationDefinitionRun[] {
    const rows: AutomationDefinitionRun[] = [];
    for (const runId of runIds) {
        const row = runsById[runId];
        if (row?.automation) rows.push(row.automation);
    }
    return rows;
}

export function createWorkflowRunsDomain<S extends WorkflowRunsDomain>({
    set,
}: {
    set: StoreSet<S>;
    get: StoreGet<S>;
}): WorkflowRunsDomain {
    return {
        workflowRunsById: {},
        workflowRunListWindows: {},
        workflowRunInvocationsByRunId: {},
        upsertWorkflowRuns: (runs) =>
            set((state) => {
                const workflowRunsById = mergeWorkflowRunBodies(state.workflowRunsById, runs);
                if (workflowRunsById === state.workflowRunsById) return state;
                return { ...state, workflowRunsById };
            }),
        removeWorkflowRun: (runId) => set((state) => {
            if (!(runId in state.workflowRunsById)) return state;
            const workflowRunsById = { ...state.workflowRunsById };
            delete workflowRunsById[runId];
            const workflowRunListWindows = Object.fromEntries(
                Object.entries(state.workflowRunListWindows).map(([id, window]) => [
                    id,
                    window ? { ...window, runIds: window.runIds.filter((candidate) => candidate !== runId) } : window,
                ]),
            ) as WorkflowRunsDomain['workflowRunListWindows'];
            const workflowRunInvocationsByRunId = { ...state.workflowRunInvocationsByRunId };
            delete workflowRunInvocationsByRunId[runId];
            return { ...state, workflowRunsById, workflowRunListWindows, workflowRunInvocationsByRunId };
        }),
        applyWorkflowRunListPage: ({ windowId, runs, metadataByRunId, nextCursor, mode }) =>
            set((state) => {
                const previous = state.workflowRunListWindows[windowId];
                const runIds = mode === 'append' && previous
                    ? appendUniqueIds(previous.runIds, runs.map((run) => run.id))
                    : runs.map((run) => run.id);
                return {
                    ...state,
                    workflowRunsById: mergeWorkflowRunBodies(
                        state.workflowRunsById,
                        runs.map((run) => workflowRunRowFromSummary(run, metadataByRunId?.[run.id] ?? null)),
                    ),
                    workflowRunListWindows: {
                        ...state.workflowRunListWindows,
                        [windowId]: { runIds, nextCursor, loaded: true },
                    },
                };
            }),
        applyWorkflowRunInvocationPage: ({ runId, invocations, nextCursor, parentRevision, mode }) =>
            set((state) => {
                const previous = state.workflowRunInvocationsByRunId[runId];
                const merged = mode === 'replace' || !previous
                    ? [...invocations]
                    : appendInvocations(previous.invocations, invocations);
                return {
                    ...state,
                    workflowRunInvocationsByRunId: {
                        ...state.workflowRunInvocationsByRunId,
                        [runId]: { invocations: merged, nextCursor, parentRevision, loaded: true },
                    },
                };
            }),
        upsertWorkflowRunInvocation: ({ runId, invocation, parentRevision }) =>
            set((state) => {
                const previous = state.workflowRunInvocationsByRunId[runId];
                return {
                    ...state,
                    workflowRunInvocationsByRunId: {
                        ...state.workflowRunInvocationsByRunId,
                        [runId]: {
                            invocations: appendInvocations(previous?.invocations ?? [], [invocation]),
                            nextCursor: previous?.nextCursor ?? null,
                            parentRevision: Math.max(previous?.parentRevision ?? 0, parentRevision),
                            loaded: previous?.loaded ?? false,
                        },
                    },
                };
            }),
    };
}
