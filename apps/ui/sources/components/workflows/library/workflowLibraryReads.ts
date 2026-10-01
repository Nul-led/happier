import * as React from 'react';

import type { WorkflowDefinitionListResultV1 } from '@happier-dev/protocol/workflows/actionsV1';

import {
    resolveWorkflowProblemPresentation,
    type WorkflowProblemPresentation,
} from '@/components/workflows/presentation/workflowProblemPresentation';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { getStorage, useActiveServerAccountScope, useWorkflowRunRows } from '@/sync/domains/state/storage';
import { listWorkflowDefinitions } from '@/sync/domains/workflows/workflowDefinitionActions';
import {
    buildWorkflowRunListFilter,
    listWorkflowRuns,
    type WorkflowRunListFilterId,
} from '@/sync/domains/workflows/workflowRunListActions';
import { subscribeVisibleWorkflowRunListInvalidation } from '@/sync/domains/workflows/workflowRunListInvalidation';

/**
 * The Workflows destination's reads (FIN 04 §3.3). The column, the library home and History are
 * mounted together, so each read has one shared, Account-scoped owner here: concurrent mounts
 * collapse onto one request, a refresh keeps last-known rows, and an Account switch retires
 * everything the previous Account produced. Run rows land in the one Account-scoped Run store; this
 * module keeps only each window's read status, never a second copy of a Run.
 */

export type WorkflowLibraryReadStatus = 'loading' | 'loaded' | 'failed';

type ReadStatus = Readonly<{
    /** The Account that produced this status; a status from another Account is not shown. */
    scopeKey: string | null;
    status: WorkflowLibraryReadStatus;
    failure: WorkflowProblemPresentation | null;
    loadingMore: boolean;
    loadMoreFailed: boolean;
}>;

const INITIAL_STATUS: ReadStatus = Object.freeze({
    scopeKey: null,
    status: 'loading',
    failure: null,
    loadingMore: false,
    loadMoreFailed: false,
});

function useActiveScopeKey(): string | null {
    const scope = useActiveServerAccountScope();
    return scope === null ? null : serverAccountScopeKeySuffix(scope);
}

/** A tiny external store: one value, its listeners, and identity-preserving writes. */
function createCell<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set(next: T) {
            if (Object.is(next, value)) return;
            value = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

// ---- saved definitions -------------------------------------------------------------------------

export type WorkflowLibraryDefinition = WorkflowDefinitionListResultV1['definitions'][number];

type DefinitionsState = ReadStatus & Readonly<{
    definitions: readonly WorkflowLibraryDefinition[];
    nextCursor: string | null;
}>;

const INITIAL_DEFINITIONS: DefinitionsState = Object.freeze({
    ...INITIAL_STATUS,
    definitions: Object.freeze([]) as readonly WorkflowLibraryDefinition[],
    nextCursor: null,
});

const definitionsCell = createCell<DefinitionsState>(INITIAL_DEFINITIONS);
let definitionsInFlight: Readonly<{ scopeKey: string | null; promise: Promise<void> }> | null = null;

/** Read the first page again; mounts in the same Account share one request. */
function refreshDefinitions(): Promise<void> {
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (lifetime === null) return Promise.resolve();
    const scopeKey = serverAccountScopeKeySuffix(lifetime.scope);
    if (definitionsInFlight?.scopeKey === scopeKey) return definitionsInFlight.promise;
    const previous = definitionsCell.get();
    // Another Account's rows are never shown while this one loads.
    if (previous.scopeKey !== scopeKey) definitionsCell.set({ ...INITIAL_DEFINITIONS, scopeKey });
    else if (previous.status === 'failed') definitionsCell.set({ ...previous, status: 'loading' });
    const readDefinitions = async (): Promise<void> => {
        try {
            const page = await listWorkflowDefinitions({});
            if (!lifetime.isCurrent()) return;
            definitionsCell.set({
                scopeKey,
                status: 'loaded',
                failure: null,
                loadingMore: false,
                loadMoreFailed: false,
                definitions: page.definitions,
                nextCursor: page.nextCursor ?? null,
            });
        } catch (error) {
            if (!lifetime.isCurrent()) return;
            // A failed refresh keeps what is already loaded and says why.
            definitionsCell.set({
                ...definitionsCell.get(),
                scopeKey,
                status: 'failed',
                failure: resolveWorkflowProblemPresentation(error),
            });
        } finally {
            if (definitionsInFlight?.promise === promise) definitionsInFlight = null;
        }
    };
    const promise = readDefinitions();
    definitionsInFlight = { scopeKey, promise };
    return promise;
}

async function loadMoreDefinitions(): Promise<void> {
    const current = definitionsCell.get();
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (lifetime === null || current.nextCursor === null || current.loadingMore) return;
    const scopeKey = serverAccountScopeKeySuffix(lifetime.scope);
    if (current.scopeKey !== scopeKey) return;
    definitionsCell.set({ ...current, loadingMore: true, loadMoreFailed: false });
    try {
        const page = await listWorkflowDefinitions({ cursor: current.nextCursor });
        if (!lifetime.isCurrent()) return;
        const latest = definitionsCell.get();
        const seen = new Set(latest.definitions.map((entry) => entry.definitionId));
        definitionsCell.set({
            ...latest,
            loadingMore: false,
            definitions: [...latest.definitions, ...page.definitions.filter((entry) => !seen.has(entry.definitionId))],
            nextCursor: page.nextCursor ?? null,
        });
    } catch {
        // The loaded rows and the cursor stay; Retry asks for exactly this page again.
        if (lifetime.isCurrent()) definitionsCell.set({ ...definitionsCell.get(), loadingMore: false, loadMoreFailed: true });
    }
}

/** Drop a deleted definition from the loaded rows without re-reading the list. */
export function forgetWorkflowLibraryDefinition(definitionId: string): void {
    const current = definitionsCell.get();
    if (!current.definitions.some((entry) => entry.definitionId === definitionId)) return;
    definitionsCell.set({ ...current, definitions: current.definitions.filter((entry) => entry.definitionId !== definitionId) });
}

export type WorkflowDefinitionLibrary = Readonly<{
    status: WorkflowLibraryReadStatus;
    failure: WorkflowProblemPresentation | null;
    definitions: readonly WorkflowLibraryDefinition[];
    hasMore: boolean;
    loadingMore: boolean;
    loadMoreFailed: boolean;
    retry: () => void;
    loadMore: () => void;
}>;

const retryDefinitions = () => { void refreshDefinitions(); };
const requestMoreDefinitions = () => { void loadMoreDefinitions(); };

/** The saved definitions, refreshed when a surface that shows them mounts or the Account changes. */
export function useWorkflowDefinitionLibrary(): WorkflowDefinitionLibrary {
    const scopeKey = useActiveScopeKey();
    const state = React.useSyncExternalStore(definitionsCell.subscribe, definitionsCell.get, definitionsCell.get);
    React.useEffect(() => { void refreshDefinitions(); }, [scopeKey]);
    const owned = state.scopeKey === scopeKey;
    return {
        status: owned ? state.status : 'loading',
        failure: owned ? state.failure : null,
        definitions: owned ? state.definitions : INITIAL_DEFINITIONS.definitions,
        hasMore: owned && state.nextCursor !== null,
        loadingMore: owned && state.loadingMore,
        loadMoreFailed: owned && state.loadMoreFailed,
        retry: retryDefinitions,
        loadMore: requestMoreDefinitions,
    };
}

// ---- Run windows ------------------------------------------------------------------------------

type RunWindowStatuses = Readonly<Partial<Record<WorkflowRunListFilterId, ReadStatus>>>;

const runWindowStatusCell = createCell<RunWindowStatuses>({});
const runWindowInFlight = new Map<WorkflowRunListFilterId, Readonly<{ scopeKey: string; promise: Promise<void> }>>();

function setRunWindowStatus(windowId: WorkflowRunListFilterId, next: ReadStatus): void {
    runWindowStatusCell.set({ ...runWindowStatusCell.get(), [windowId]: next });
}

function readRunWindowStatus(windowId: WorkflowRunListFilterId): ReadStatus {
    return runWindowStatusCell.get()[windowId] ?? INITIAL_STATUS;
}

/** Read a window's first page; a window this Account already traversed is restated, not replaced. */
function refreshRunWindow(windowId: WorkflowRunListFilterId): Promise<void> {
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (lifetime === null) return Promise.resolve();
    const scopeKey = serverAccountScopeKeySuffix(lifetime.scope);
    const inFlight = runWindowInFlight.get(windowId);
    if (inFlight?.scopeKey === scopeKey) return inFlight.promise;
    const previous = readRunWindowStatus(windowId);
    const ownedBefore = previous.scopeKey === scopeKey && previous.status !== 'loading';
    if (!ownedBefore) setRunWindowStatus(windowId, { ...INITIAL_STATUS, scopeKey });
    const readRunWindow = async (): Promise<void> => {
        try {
            const page = await listWorkflowRuns({ filter: buildWorkflowRunListFilter(windowId) });
            if (!lifetime.isCurrent()) return;
            const store = getStorage().getState();
            store.applyWorkflowRunListPage({
                windowId,
                runs: page.runs,
                metadataByRunId: page.metadataByRunId,
                nextCursor: page.nextCursor ?? null,
                mode: ownedBefore && store.workflowRunListWindows[windowId]?.loaded === true ? 'refresh' : 'replace',
            });
            setRunWindowStatus(windowId, { scopeKey, status: 'loaded', failure: null, loadingMore: false, loadMoreFailed: false });
        } catch (error) {
            if (!lifetime.isCurrent()) return;
            setRunWindowStatus(windowId, {
                ...readRunWindowStatus(windowId),
                scopeKey,
                status: 'failed',
                failure: resolveWorkflowProblemPresentation(error),
            });
        } finally {
            if (runWindowInFlight.get(windowId)?.promise === promise) runWindowInFlight.delete(windowId);
        }
    };
    const promise = readRunWindow();
    runWindowInFlight.set(windowId, { scopeKey, promise });
    return promise;
}

async function loadMoreRunWindow(windowId: WorkflowRunListFilterId): Promise<void> {
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (lifetime === null) return;
    const scopeKey = serverAccountScopeKeySuffix(lifetime.scope);
    const status = readRunWindowStatus(windowId);
    const cursor = getStorage().getState().workflowRunListWindows[windowId]?.nextCursor ?? null;
    if (status.scopeKey !== scopeKey || status.status !== 'loaded' || cursor === null || status.loadingMore) return;
    setRunWindowStatus(windowId, { ...status, loadingMore: true, loadMoreFailed: false });
    try {
        const page = await listWorkflowRuns({ filter: buildWorkflowRunListFilter(windowId), cursor });
        if (!lifetime.isCurrent()) return;
        getStorage().getState().applyWorkflowRunListPage({
            windowId,
            runs: page.runs,
            metadataByRunId: page.metadataByRunId,
            nextCursor: page.nextCursor ?? null,
            mode: 'append',
        });
        setRunWindowStatus(windowId, { ...readRunWindowStatus(windowId), loadingMore: false });
    } catch {
        if (lifetime.isCurrent()) setRunWindowStatus(windowId, { ...readRunWindowStatus(windowId), loadingMore: false, loadMoreFailed: true });
    }
}

const EMPTY_RUN_IDS: readonly string[] = Object.freeze([]);

export type WorkflowRunWindow = Readonly<{
    status: WorkflowLibraryReadStatus;
    failure: WorkflowProblemPresentation | null;
    /** The window's rows, in its order, from the one Account-scoped Run store. */
    rows: ReturnType<typeof useWorkflowRunRows>;
    hasMore: boolean;
    loadingMore: boolean;
    loadMoreFailed: boolean;
    retry: () => void;
    loadMore: () => void;
}>;

/**
 * One Run window (`all`, `active`, `attention`, `triggered`) while a surface shows it: its first
 * page on mount and on the Account's Run-change wake, and its rows from the shared Run store.
 * `enabled: false` holds no subscription and issues no read.
 */
export function useWorkflowRunWindow(windowId: WorkflowRunListFilterId, options: Readonly<{ enabled?: boolean }> = {}): WorkflowRunWindow {
    const enabled = options.enabled !== false;
    const scopeKey = useActiveScopeKey();
    const statuses = React.useSyncExternalStore(runWindowStatusCell.subscribe, runWindowStatusCell.get, runWindowStatusCell.get);
    const status = statuses[windowId] ?? INITIAL_STATUS;
    const owned = status.scopeKey === scopeKey && scopeKey !== null;
    const storedIds = getStorage()((state) => state.workflowRunListWindows[windowId]?.runIds);
    const hasNextCursor = getStorage()((state) => (state.workflowRunListWindows[windowId]?.nextCursor ?? null) !== null);
    const rows = useWorkflowRunRows(enabled && owned && status.status !== 'loading' ? storedIds ?? EMPTY_RUN_IDS : EMPTY_RUN_IDS);

    React.useEffect(() => {
        if (!enabled) return;
        void refreshRunWindow(windowId);
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        return subscribeVisibleWorkflowRunListInvalidation({
            lifetime,
            isVisibleWindowLoaded: () => getStorage().getState().workflowRunListWindows[windowId]?.loaded === true,
            invalidate: () => { void refreshRunWindow(windowId); },
        });
    }, [enabled, scopeKey, windowId]);

    const retry = React.useCallback(() => { void refreshRunWindow(windowId); }, [windowId]);
    const loadMore = React.useCallback(() => { void loadMoreRunWindow(windowId); }, [windowId]);
    return {
        status: owned ? status.status : 'loading',
        failure: owned ? status.failure : null,
        rows,
        hasMore: owned && hasNextCursor,
        loadingMore: owned && status.loadingMore,
        loadMoreFailed: owned && status.loadMoreFailed,
        retry,
        loadMore,
    };
}

/** Test seam: forget module read state between cases (the Run store is reset by its own owner). */
export function resetWorkflowLibraryReadsForTests(): void {
    definitionsCell.set(INITIAL_DEFINITIONS);
    definitionsInFlight = null;
    runWindowStatusCell.set({});
    runWindowInFlight.clear();
}
