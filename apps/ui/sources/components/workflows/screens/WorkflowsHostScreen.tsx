import * as React from 'react';
import { useRouter } from 'expo-router';

import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import {
    getStorage,
    useActiveServerAccountScope,
    useAllMachines,
    useWorkflowRunRows,
} from '@/sync/domains/state/storage';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { Modal } from '@/modal';
import { t } from '@/text';

import type { WorkflowDefinitionArtifactHeaderV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';

import {
    deleteWorkflowDefinition,
    getWorkflowDefinition,
    listWorkflowDefinitions,
} from '@/sync/domains/workflows/workflowDefinitionActions';
import { exportWorkflowDefinition } from '@/sync/domains/workflows/workflowInterchange';
import { confirmWorkflowDocumentExport } from '../actions/confirmWorkflowDocumentExport';
import {
    buildWorkflowRunListFilter,
    listWorkflowRuns,
    type WorkflowRunListFilterId,
} from '@/sync/domains/workflows/workflowRunListActions';
import { subscribeVisibleWorkflowRunListInvalidation } from '@/sync/domains/workflows/workflowRunListInvalidation';
import {
    resolveWorkflowProblemPresentation,
    type WorkflowProblemPresentation,
} from '@/components/workflows/presentation/workflowProblemPresentation';

import type { WorkflowSavedEntryIntent } from './WorkflowEditorHostScreen';
import {
    resolveWorkflowRunDisplayName,
    type WorkflowRunDisplayName,
} from '@/components/workflows/presentation/workflowRunDisplayName';
import {
    WorkflowsScreen,
    type WorkflowsCollectionLoadState,
    type WorkflowsCollectionView,
} from './WorkflowsScreen';

/**
 * Route host for the Workflows collection.
 *
 * It owns fetching and Account currentness only. The selected view and filter
 * are user state that data updates never move, and both halves read their own
 * canonical owner: saved definitions through the definition Actions, Runs
 * through the Account-scoped Run list. Neither keeps a private cache.
 */

/**
 * A page that could not be appended, for exactly one Account and one window.
 *
 * It is presentation state, not a second load state: the window keeps its
 * rows and cursor, so Retry asks for the same next page again. Keying it by
 * Account and window is what lets a failure on **All** stay out of the way of
 * **Active**, and lets an Account switch retire it with everything else.
 */
type WorkflowsPagingFailure = Readonly<{
    accountScopeKey: string | null;
    window: 'saved' | WorkflowRunListFilterId;
}>;

const EMPTY_RUN_IDS: readonly string[] = Object.freeze([]);

export function WorkflowsHostScreen(props: Readonly<{
    /** Route intent selects the initial view only when the route explicitly names one. */
    initialView?: WorkflowsCollectionView;
}> = {}): React.ReactElement {
    const router = useRouter();
    const machines = useAllMachines();
    const activeAccountScope = useActiveServerAccountScope();
    const accountScopeKey = activeAccountScope === null
        ? null
        : serverAccountScopeKeySuffix(activeAccountScope);

    const [view, setView] = React.useState<WorkflowsCollectionView>(props.initialView ?? 'saved');
    const [runsFilter, setRunsFilter] = React.useState<WorkflowRunListFilterId>('all');

    const [savedState, setSavedState] = React.useState<WorkflowsCollectionLoadState>('loading');
    const [savedFailure, setSavedFailure] = React.useState<WorkflowProblemPresentation | null>(null);
    const [runsFailure, setRunsFailure] = React.useState<WorkflowProblemPresentation | null>(null);
    const [savedDefinitions, setSavedDefinitions] = React.useState<readonly WorkflowDefinitionArtifactHeaderV1[]>([]);
    const [savedNextCursor, setSavedNextCursor] = React.useState<string | null>(null);
    const [savedOwnerScopeKey, setSavedOwnerScopeKey] = React.useState<string | null>(accountScopeKey);
    const [loadingMoreSaved, setLoadingMoreSaved] = React.useState(false);
    const [runsState, setRunsState] = React.useState<WorkflowsCollectionLoadState>('loading');
    const [runWindowOwnerScopeKeys, setRunWindowOwnerScopeKeys] = React.useState<
        Partial<Record<WorkflowRunListFilterId, string | null>>
    >(() => ({ all: accountScopeKey, active: accountScopeKey, attention: accountScopeKey }));
    const [loadingMoreRuns, setLoadingMoreRuns] = React.useState(false);
    const [pagingFailure, setPagingFailure] = React.useState<WorkflowsPagingFailure | null>(null);
    const [reloadToken, setReloadToken] = React.useState(0);
    const [runsInvalidationToken, setRunsInvalidationToken] = React.useState(0);
    const deletingDefinitionIdsRef = React.useRef(new Set<string>());
    const previousAccountScopeKeyRef = React.useRef(accountScopeKey);
    const storedRunWindow = getStorage()((state) => state.workflowRunListWindows[runsFilter]);
    const runsOwnerScopeKey = runWindowOwnerScopeKeys[runsFilter] ?? null;
    const runWindow = runsOwnerScopeKey === accountScopeKey ? storedRunWindow : undefined;
    // Only the visible window's rows, never the Account's whole Run map: an
    // exact refresh of a Run this list does not show must not rerender it.
    const runRows = useWorkflowRunRows(runWindow?.runIds ?? EMPTY_RUN_IDS);
    const runs = React.useMemo(
        () => runRows.flatMap((row) => row.summary ? [row.summary] : []),
        [runRows],
    );

    React.useEffect(() => {
        if (previousAccountScopeKeyRef.current === accountScopeKey) return;
        previousAccountScopeKeyRef.current = accountScopeKey;
        // In-flight flags belong to the Account that started them. A retired
        // request never clears them because its lifetime correctly fails
        // currentness, so reset those local-only flags at the new scope.
        setLoadingMoreSaved(false);
        setLoadingMoreRuns(false);
        setPagingFailure(null);
        // A failure belongs to the Account that produced it.
        setSavedFailure(null);
        setRunsFailure(null);
        deletingDefinitionIdsRef.current.clear();
    }, [accountScopeKey]);

    React.useEffect(() => {
        if (view !== 'runs') return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        return subscribeVisibleWorkflowRunListInvalidation({
            lifetime,
            isVisibleWindowLoaded: () => (
                getStorage().getState().workflowRunListWindows[runsFilter]?.loaded === true
            ),
            invalidate: () => setRunsInvalidationToken((token) => token + 1),
        });
    }, [accountScopeKey, runsFilter, view]);

    React.useEffect(() => {
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        let cancelled = false;
        setSavedState((current) => (current === 'loaded' ? current : 'loading'));
        void (async () => {
            try {
                const page = await listWorkflowDefinitions({});
                if (cancelled || !lifetime.isCurrent() || requestScopeKey !== accountScopeKey) return;
                setSavedDefinitions(page.definitions);
                setSavedNextCursor(page.nextCursor ?? null);
                setSavedOwnerScopeKey(requestScopeKey);
                setPagingFailure((current) => (current?.window === 'saved' ? null : current));
                setSavedFailure(null);
                setSavedState('loaded');
            } catch (error) {
                if (cancelled || !lifetime.isCurrent()) return;
                // A refresh failure keeps whatever is already hydrated, and says
                // which failure it was through the one canonical mapping.
                setSavedFailure(resolveWorkflowProblemPresentation(error));
                setSavedState('failed');
            }
        })();
        return () => { cancelled = true; };
    }, [accountScopeKey, reloadToken]);

    React.useEffect(() => {
        if (view !== 'runs') return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        let cancelled = false;
        setRunsState((current) => (current === 'loaded' ? current : 'loading'));
        void (async () => {
            try {
                const page = await listWorkflowRuns({ filter: buildWorkflowRunListFilter(runsFilter) });
                if (cancelled || !lifetime.isCurrent()) return;
                // Bodies land in the one Account-scoped row owner, so opening a
                // row renders the same Run the detail route resolves by id
                // instead of refetching or diverging from it.
                getStorage().getState().applyWorkflowRunListPage({
                    windowId: runsFilter,
                    runs: page.runs,
                    metadataByRunId: page.metadataByRunId,
                    nextCursor: page.nextCursor ?? null,
                    mode: 'replace',
                });
                setRunWindowOwnerScopeKeys((current) => ({
                    ...current,
                    [runsFilter]: requestScopeKey,
                }));
                // A fresh first page supersedes a failed continuation of the old one.
                setPagingFailure((current) => (current?.window === runsFilter ? null : current));
                setRunsFailure(null);
                setRunsState('loaded');
            } catch (error) {
                if (cancelled || !lifetime.isCurrent()) return;
                setRunsFailure(resolveWorkflowProblemPresentation(error));
                setRunsState('failed');
            }
        })();
        return () => { cancelled = true; };
    }, [accountScopeKey, reloadToken, runsFilter, runsInvalidationToken, view]);

    const clearPagingFailure = React.useCallback((windowId: WorkflowsPagingFailure['window']) => {
        setPagingFailure((current) => (current?.window === windowId ? null : current));
    }, []);

    const loadMoreSaved = React.useCallback(async () => {
        if (savedOwnerScopeKey !== accountScopeKey || savedNextCursor === null || loadingMoreSaved) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        setLoadingMoreSaved(true);
        clearPagingFailure('saved');
        try {
            const page = await listWorkflowDefinitions({ cursor: savedNextCursor });
            if (!lifetime.isCurrent()) return;
            setSavedDefinitions((current) => {
                const seen = new Set(current.map((entry) => entry.definitionId));
                return [...current, ...page.definitions.filter((entry) => !seen.has(entry.definitionId))];
            });
            setSavedNextCursor(page.nextCursor ?? null);
        } catch {
            // The loaded rows and the cursor are untouched: only this page is
            // missing, and Retry asks for exactly it again.
            if (lifetime.isCurrent()) setPagingFailure({ accountScopeKey: requestScopeKey, window: 'saved' });
        } finally {
            if (lifetime.isCurrent()) setLoadingMoreSaved(false);
        }
    }, [accountScopeKey, clearPagingFailure, loadingMoreSaved, savedNextCursor, savedOwnerScopeKey]);

    const loadMoreRuns = React.useCallback(async () => {
        const cursor = runWindow?.nextCursor ?? null;
        if (runsOwnerScopeKey !== accountScopeKey || cursor === null || loadingMoreRuns) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        const windowId = runsFilter;
        setLoadingMoreRuns(true);
        clearPagingFailure(windowId);
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
        } catch {
            if (lifetime.isCurrent()) setPagingFailure({ accountScopeKey: requestScopeKey, window: windowId });
        } finally {
            if (lifetime.isCurrent()) setLoadingMoreRuns(false);
        }
    }, [accountScopeKey, clearPagingFailure, loadingMoreRuns, runWindow?.nextCursor, runsFilter, runsOwnerScopeKey]);

    const visibleWindow: WorkflowsPagingFailure['window'] = view === 'saved' ? 'saved' : runsFilter;
    const loadMoreFailed = pagingFailure !== null
        && pagingFailure.accountScopeKey === accountScopeKey
        && pagingFailure.window === visibleWindow;

    /**
     * The safe name a Run row may show.
     *
     * The server is ciphertext-blind, so `WorkflowRunSummaryV1` carries no
     * title. The one Account-side name that already exists for a Run is its
     * Automation's, which this Account already reads and displays throughout
     * Automations — so a scheduled Run is named by the thing that scheduled it,
     * and an Automation whose private detail genuinely cannot be opened reports
     * that rather than borrowing a title.
     *
     * A direct/inline Run has no Account-side name until its exact detail is
     * opened. It stays `unknown`, which keeps its real identity and lifecycle
     * on the row instead of claiming an encryption failure.
     */
    const metadataByRunId = React.useMemo(
        () => new Map(runRows.map((row) => [row.id, row.metadata] as const)),
        [runRows],
    );
    const resolveRunDisplayName = React.useCallback(
        (runId: string): WorkflowRunDisplayName => resolveWorkflowRunDisplayName(metadataByRunId.get(runId)),
        [metadataByRunId],
    );

    const resolveMachineName = React.useCallback((machineId: string): string => {
        const machine = machines.find((candidate) => candidate.id === machineId);
        // An unknown or unnamed machine shows its exact id rather than a blank.
        return (machine === undefined ? null : getMachineDisplayName(machine)) ?? machineId;
    }, [machines]);

    const openDefinition = React.useCallback((definitionId: string) => {
        router.push({
            pathname: '/workflows/[id]',
            params: { id: definitionId },
        } as never);
    }, [router]);

    /**
     * Run now and Schedule are not Edit.
     *
     * A saved row holds an Artifact identity, not a reviewed Machine, a
     * page-level **Run as** choice or collected input values, so this collection
     * cannot admit a Run or freeze a schedule itself. It opens the exact
     * revision in the one editor owner and names the intent; that owner then
     * presses its own Run now (reusing the run-admission and input-sheet owner)
     * or Schedule (reusing the Automation schedule-seed wrapper). Only the
     * intent travels in the URL — never definition content.
     */
    const openDefinitionWithIntent = React.useCallback((
        definitionId: string,
        intent: WorkflowSavedEntryIntent,
    ) => {
        router.push({
            pathname: '/workflows/[id]',
            params: { id: definitionId, intent },
        } as never);
    }, [router]);
    const runDefinition = React.useCallback(
        (definitionId: string) => openDefinitionWithIntent(definitionId, 'run'),
        [openDefinitionWithIntent],
    );
    const scheduleDefinition = React.useCallback(
        (definitionId: string) => openDefinitionWithIntent(definitionId, 'schedule'),
        [openDefinitionWithIntent],
    );

    const exportDefinition = React.useCallback(async (definitionId: string) => {
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        try {
            const opened = await getWorkflowDefinition({ definitionId });
            if (!lifetime.isCurrent()) return;
            const exported = exportWorkflowDefinition({ definition: opened.definition });
            if (!exported.ok) {
                await Modal.alert(t('workflows.save.failedTitle'), t('workflows.save.failedBody'));
                return;
            }
            await confirmWorkflowDocumentExport({
                name: opened.metadata.title,
                json: exported.json,
                isCurrent: lifetime.isCurrent,
            });
        } catch {
            if (lifetime.isCurrent()) {
                await Modal.alert(t('workflows.save.failedTitle'), t('workflows.save.failedBody'));
            }
        }
    }, []);

    const deleteDefinition = React.useCallback(async (definitionId: string) => {
        if (deletingDefinitionIdsRef.current.has(definitionId)) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const confirmed = await Modal.confirm(
            t('workflows.save.deleteTitle'),
            t('workflows.save.deleteBody'),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed || !lifetime.isCurrent()) return;
        deletingDefinitionIdsRef.current.add(definitionId);
        try {
            await deleteWorkflowDefinition({ definitionId });
            if (!lifetime.isCurrent()) return;
            setSavedDefinitions((current) => current.filter((entry) => entry.definitionId !== definitionId));
        } catch {
            if (lifetime.isCurrent()) {
                await Modal.alert(t('workflows.save.failedTitle'), t('workflows.loadFailedBody'));
            }
        } finally {
            deletingDefinitionIdsRef.current.delete(definitionId);
        }
    }, []);

    return (
        <WorkflowsScreen
            view={view}
            onChangeView={setView}
            savedState={savedOwnerScopeKey === accountScopeKey ? savedState : 'loading'}
            savedDefinitions={savedOwnerScopeKey === accountScopeKey ? savedDefinitions : []}
            onOpenDefinition={openDefinition}
            onEditDefinition={openDefinition}
            onRunDefinition={runDefinition}
            onScheduleDefinition={scheduleDefinition}
            onExportDefinition={exportDefinition}
            onDeleteDefinition={deleteDefinition}
            runsState={runsOwnerScopeKey === accountScopeKey ? runsState : 'loading'}
            runs={runs}
            runsFilter={runsFilter}
            onChangeRunsFilter={setRunsFilter}
            // Run detail is owned by the Run-detail lane; this collection only
            // navigates to the exact run id it was given.
            onOpenRun={(runId) => router.push({
                pathname: '/workflows/runs/[runId]',
                params: { runId },
            } as never)}
            resolveMachineName={resolveMachineName}
            resolveRunDisplayName={resolveRunDisplayName}
            hasMoreSaved={savedOwnerScopeKey === accountScopeKey && savedNextCursor !== null}
            loadingMoreSaved={savedOwnerScopeKey === accountScopeKey && loadingMoreSaved}
            onLoadMoreSaved={() => { void loadMoreSaved(); }}
            hasMoreRuns={(runWindow?.nextCursor ?? null) !== null}
            loadingMoreRuns={runsOwnerScopeKey === accountScopeKey && loadingMoreRuns}
            onLoadMoreRuns={() => { void loadMoreRuns(); }}
            loadMoreFailed={loadMoreFailed}
            // The visible view's own failure. Both reads go through the one
            // Workflow problem mapping, so the library says why it could not
            // load instead of one sentence for every cause.
            loadFailure={view === 'saved' ? savedFailure : runsFailure}
            onRetryLoadMore={() => { void (view === 'saved' ? loadMoreSaved() : loadMoreRuns()); }}
            onNewWorkflow={() => router.push('/workflows/new' as never)}
            onImportJson={() => router.push({
                pathname: '/workflows/new',
                params: { importJson: '1' },
            } as never)}
            onRetry={() => setReloadToken((token) => token + 1)}
        />
    );
}
