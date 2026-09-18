import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native-unistyles';

import type {
    JsonValue,
    StructuredQuestionAnswersV1,
    WorkflowAuthoredInputV1,
    WorkflowDefinitionV1,
    WorkflowProgressEnvelopeV1,
    WorkflowRunInvocationIndexV1,
    WorkflowRunAcceptedContextV1,
    WorkflowRunSummaryV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { workflowBlockReferenceLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import { walkWorkflowBlocks } from '@/sync/domains/workflows/workflowEditorDraft';
import { getStorage, useActiveServerAccountScope, useMachine, useWorkflowRun } from '@/sync/domains/state/storage';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';
import { workflowRunDetailActions } from '@/sync/domains/workflows/workflowRunDetailActions';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { Modal } from '@/modal';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';
import { useMountedRef } from '@/hooks/ui/useMountedRef';

import {
    WorkflowRunContent,
    type WorkflowRunDetailView,
    type WorkflowRunOperationKind,
} from '../run/WorkflowRunContent';
import {
    isWorkflowWorkspaceUnavailableReason,
    projectWorkflowInvocationRecovery,
    requiresUncertainPriorEffectsAcknowledgement,
    type WorkflowRecoveryContinuation,
} from '../run/workflowRunDetailPresentation';
import { isTerminalWorkflowRunState } from '../presentation/workflowLifecyclePresentation';
import { projectWorkflowInvocationStructure } from '../run/workflowInvocationStructure';
import { hasWorkflowInvocationRequest } from '../run/workflowPermissionRequests';
import {
    buildWorkflowReviewedRunSeed,
    storeWorkflowReviewedRunSeed,
} from '@/sync/domains/workflows/workflowReviewedRunSeed';
import { useWorkflowCompletionMoment } from '../run/useWorkflowCompletionMoment';
import { useWorkflowAnnouncements } from '../accessibility/useWorkflowAnnouncements';
import type { WorkflowAnnouncementTerminalKind } from '../accessibility/workflowAnnouncementSelection';
import {
    WORKFLOW_ATTENTION_LIFECYCLES,
    summarizeWorkflowInvocationCoverage,
} from '@/components/workflows/presentation/workflowLifecyclePresentation';
import { useWorkflowRunNowController } from '../run/useWorkflowRunNowController';
import {
    useWorkflowRunInputModal,
    type WorkflowRunInputModalProps,
} from '../run/useWorkflowRunInputModal';
import { projectAcceptedWorkflowRunTarget } from '../run/projectAcceptedWorkflowRunTarget';
import { createMachineExecutionRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import { formatWorkflowProblemMessage } from '@/components/workflows/presentation/workflowProblemPresentation';
import { readWorkflowInvocationId, readWorkflowRunId } from '@/sync/domains/workflows/workflowRunRoute';
import { useOpenProject } from '@/components/projects/useOpenProject';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { normalizeResultPreview } from '../presentation/resultPreview';
import { formatWorkflowUsageLabel } from '../presentation/workflowUsagePresentation';
import {
    formatWorkflowRunDisplayName,
    resolveWorkflowRunDisplayName,
} from '../presentation/workflowRunDisplayName';
import { createWorkflowDefinition } from '@/sync/domains/workflows/workflowDefinitionActions';
import { workflowDefinitionPromptTitle } from '@/sync/domains/workflows/workflowBlockLabel';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

/**
 * The exact managed Run route.
 *
 * It resolves its Run from the one Account-scoped `workflowRunsById` owner by
 * `runId`, so a deep link, a list tap, an agent result and the Automation
 * provenance wrapper all render one body. The screen owns route state only —
 * selected invocation, view, in-flight command — never a second lifecycle
 * interpretation.
 */

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    content: {
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.lg,
        gap: theme.margins.lg,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.margins.sm,
        paddingHorizontal: theme.margins.lg,
    },
    stateTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    stateBody: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
}));

const EMPTY_INVOCATIONS: readonly WorkflowRunInvocationIndexV1[] = Object.freeze([]);
const EMPTY_PROGRESS_BY_INVOCATION_ID: ReadonlyMap<string, WorkflowProgressEnvelopeV1> = new Map();
type ActiveAccountScopeLifetime = NonNullable<ReturnType<typeof captureActiveServerAccountScopeLifetime>>;
type ExactInvocationResponse = Awaited<ReturnType<typeof workflowRunDetailActions.getInvocation>>;

type PendingPermissionDecision = Readonly<{
    accountLifetime: ActiveAccountScopeLifetime;
    contentIdentity: string;
    runId: string;
    invocationId: string;
    executionRunId: string;
    requestId: string;
}>;

const EMPTY_PERMISSION_DECISIONS: ReadonlyMap<string, PendingPermissionDecision> = new Map();
const EMPTY_PERMISSION_REQUEST_IDS: ReadonlySet<string> = new Set();

/**
 * The one durable Run operation this screen has issued and not seen settle.
 *
 * Every durable operation — pause, resume, cancel, retry, continuation,
 * reattach, workspace restoration, deletion — carries the Run's
 * `expectedRevision`, so two in flight at once are a currentness race the
 * person did not ask for. This token is the mutex: it is taken at issuance,
 * scoped to the exact Account and Run it was issued for, and released only by
 * the operation that took it. A settlement that arrives after the token moved
 * on belongs to nobody on screen and cannot overwrite a newer result.
 */
type PendingRunOperation = Readonly<{
    kind: WorkflowRunOperationKind;
    contentIdentity: string;
}>;

/**
 * A continuation page that could not be appended, for exactly one Account, Run
 * and window.
 *
 * It is presentation state, not a durable Run operation failure: the window
 * keeps every row it already read and the cursor Retry needs, so Retry asks for
 * the same next page again rather than reloading the Run. Routed through
 * `controlError` it borrowed the outcome region's voice, outlived the page it
 * described and was cleared by the next unrelated control — this is the same
 * shape the Workflows collection already uses at `WorkflowsHostScreen`. Keying
 * it by the content identity is what retires it with everything else private to
 * this Run when the Account or the Run changes.
 */
type WorkflowRunPagingFailure = Readonly<{
    contentIdentity: string;
    window: 'history' | 'attention';
}>;

function firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * The exact identity of a permission request.
 *
 * The daemon settles a request against its execution Run, so a request id is
 * unique only inside that Run. Keying the decision by both is what keeps a
 * withdrawn control — and its settlement — attached to the request the person
 * actually answered rather than a same-named one on another attempt.
 */
function permissionRequestKey(executionRunId: string, requestId: string): string {
    return `${executionRunId}\u0000${requestId}`;
}

function isDefinitivePermissionDecisionPreIssuanceResponse(response: Readonly<{
    ok: boolean;
    errorCode?: string;
}>): boolean {
    if (response.ok) return false;
    return response.errorCode === 'execution_run_target_unavailable';
}

function resolveAnnouncementTerminal(
    state: WorkflowRunSummaryV1['state'],
    failedInvocationCount: number,
): WorkflowAnnouncementTerminalKind | null {
    switch (state) {
        case 'succeeded': return failedInvocationCount > 0 ? 'completed_with_failures' : 'completed';
        case 'failed': return 'failed';
        case 'outcome_uncertain': return 'outcome_uncertain';
        case 'paused': return 'paused';
        case 'interrupted': return 'interrupted';
        default: return null;
    }
}

export function WorkflowRunScreen(): React.ReactElement {
    const mountedRef = useMountedRef();
    const router = useRouter();
    const openProject = useOpenProject();
    const activelyViewed = useHostActivelyViewed();
    const runNow = useWorkflowRunNowController();
    const params = useLocalSearchParams<{ runId?: string | string[]; invocationId?: string | string[] }>();
    const runId = readWorkflowRunId(firstParam(params.runId));
    const requestedInvocationId = readWorkflowInvocationId(firstParam(params.invocationId));
    const activeAccountScope = useActiveServerAccountScope();
    const accountScopeKey = activeAccountScope === null
        ? null
        : serverAccountScopeKeySuffix(activeAccountScope);

    // The shared row has no embedded Account tag: do not expose it until the
    // exact read establishes that it belongs to this mounted Account scope.
    // This also fails closed when the same opaque Run id exists in two Accounts.
    //
    // Ownership is the Account *and* the Run, because this screen stays mounted
    // across a Run change. Keyed on the Account alone, everything private below
    // — definition, accepted context, result, progress, attention rows, the
    // selection and the acknowledgement — stayed on screen from the previous Run
    // and combined with the next Run's already-cached lifecycle row, which is
    // how Run A's steps and actions appeared under Run B's status.
    const cachedRow = useWorkflowRun(runId);
    const contentIdentity = `${accountScopeKey ?? ''}\u0000${runId ?? ''}`;
    const contentIdentityRef = React.useRef(contentIdentity);
    contentIdentityRef.current = contentIdentity;
    const isContentIdentityCurrent = React.useCallback(
        (expectedIdentity: string) => mountedRef.current && contentIdentityRef.current === expectedIdentity,
        [mountedRef],
    );
    const [contentScopeKey, setContentScopeKey] = React.useState<string | null>(null);
    const contentScopeKeyRef = React.useRef(contentScopeKey);
    contentScopeKeyRef.current = contentScopeKey;
    const [definition, setDefinition] = React.useState<WorkflowDefinitionV1 | null>(null);
    // `null` is a valid authored JSON result; only `undefined` means absent.
    const [result, setResult] = React.useState<JsonValue | undefined>(undefined);
    const [finalOutputInvocationId, setFinalOutputInvocationId] = React.useState<string | null>(null);
    const [firstFailedInvocation, setFirstFailedInvocation] = React.useState<WorkflowRunInvocationIndexV1 | null>(null);
    const [firstFailedInvocationResolution, setFirstFailedInvocationResolution] = React.useState<'loading' | 'resolved' | 'error'>('loading');
    const [acceptedContext, setAcceptedContext] = React.useState<WorkflowRunAcceptedContextV1 | null>(null);
    const [usageLabel, setUsageLabel] = React.useState<string | null>(null);
    const [attentionInvocations, setAttentionInvocations] = React.useState<readonly WorkflowRunInvocationIndexV1[]>([]);
    const [attentionNextCursor, setAttentionNextCursor] = React.useState<string | null>(null);
    const [progressByInvocationId, setProgressByInvocationId] = React.useState<ReadonlyMap<string, WorkflowProgressEnvelopeV1>>(new Map());
    const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
    /**
     * Asking for the Run again.
     *
     * A failed first read is not proof the Run is gone, and the person had no
     * way to ask again: the effect only re-runs when the Account, the Run or the
     * cached revision changes, none of which a transport failure produces. This
     * is the same explicit attempt counter the editor and Session adapters use.
     */
    const [loadAttempt, setLoadAttempt] = React.useState(0);
    const [view, setView] = React.useState<WorkflowRunDetailView>('activity');
    const [selectedInvocationId, setSelectedInvocationId] = React.useState<string | null>(requestedInvocationId);
    const [pendingOperation, setPendingOperation] = React.useState<PendingRunOperation | null>(null);
    /**
     * The issuing authority for the mutex. Two presses can land in one frame,
     * so a guard reading rendered state would admit both; the ref refuses the
     * second before anything is sent.
     */
    const pendingOperationRef = React.useRef<PendingRunOperation | null>(null);
    const [loadingMoreInvocations, setLoadingMoreInvocations] = React.useState(false);
    const [loadingMoreAttention, setLoadingMoreAttention] = React.useState(false);
    /**
     * The attention continuation this screen has issued and not seen settle.
     *
     * Two presses land in one frame, so a guard reading rendered state would
     * admit both and send the same cursor twice — two responses merging the
     * same rows and racing each other's `nextCursor`. This is the same token
     * mutex the durable Run operations use: it is taken at issuance and
     * released only by the request that took it.
     */
    const pendingAttentionPageRef = React.useRef<object | null>(null);
    const [pagingFailure, setPagingFailure] = React.useState<WorkflowRunPagingFailure | null>(null);
    const [controlError, setControlError] = React.useState<string | null>(null);
    /**
     * The permission decisions this screen has sent and not seen settle.
     *
     * The mirror ref is the issuing authority: two presses land in one frame,
     * so a guard reading rendered state would let the opposite decision race
     * the one already in flight. Nothing is settled here — the machine's
     * execution owner records the answer and the canonical read reports it.
     */
    const [pendingPermissionDecisions, setPendingPermissionDecisions] = React.useState<ReadonlyMap<string, PendingPermissionDecision>>(EMPTY_PERMISSION_DECISIONS);
    const pendingPermissionDecisionsRef = React.useRef(pendingPermissionDecisions);
    const [selectedContentUnavailable, setSelectedContentUnavailable] = React.useState(false);
    const [runAgainInputOpen, setRunAgainInputOpen] = React.useState(false);
    const [runAgainValues, setRunAgainValues] = React.useState<Readonly<Record<string, JsonValue | undefined>>>({});
    const [saveAsWorkflowPending, setSaveAsWorkflowPending] = React.useState(false);
    /**
     * The exact attempt whose unknown prior effects the person acknowledged.
     * Storing the id rather than a boolean is what keeps the acknowledgement
     * from silently applying to a different invocation.
     */
    const [acknowledgedUncertainInvocationId, setAcknowledgedUncertainInvocationId] = React.useState<string | null>(null);
    const pendingRunAgainIdRef = React.useRef<string | null>(null);
    /** Which (Run, Account) pair the shared row currently holds, for exact retirement. */
    const loadedRunAccountScopeRef = React.useRef<Readonly<{ runId: string; accountScopeKey: string | null }> | null>(null);
    /**
     * The lifecycle each invocation had at the last committed observation, and
     * whether announcements have a baseline yet. Both belong to one Run: carried
     * across a Run change they turn B's first load into "these rows just changed".
     */
    const previousLifecyclesRef = React.useRef<ReadonlyMap<string, string>>(new Map());
    const [announcementsEnabled, setAnnouncementsEnabled] = React.useState(false);

    /**
     * A different Run (or Account) takes over this mounted screen immediately.
     *
     * Withdrawing during render rather than when the next read resolves is the
     * whole point: between navigation and that response there is a window where
     * the previous Run's private detail would otherwise be rendered beside the
     * new Run's cached lifecycle row, and its still-live actions would address
     * the new Run.
     */
    const [observedContentIdentity, setObservedContentIdentity] = React.useState(contentIdentity);
    if (observedContentIdentity !== contentIdentity) {
        setObservedContentIdentity(contentIdentity);
        setContentScopeKey(null);
        contentScopeKeyRef.current = null;
        setDefinition(null);
        setResult(undefined);
        setFinalOutputInvocationId(null);
        setFirstFailedInvocation(null);
        setAcceptedContext(null);
        setUsageLabel(null);
        setAttentionInvocations([]);
        setAttentionNextCursor(null);
        setProgressByInvocationId(EMPTY_PROGRESS_BY_INVOCATION_ID);
        setSelectedContentUnavailable(false);
        pendingOperationRef.current = null;
        setPendingOperation(null);
        setControlError(null);
        setPendingPermissionDecisions(EMPTY_PERMISSION_DECISIONS);
        pendingPermissionDecisionsRef.current = EMPTY_PERMISSION_DECISIONS;
        setLoadingMoreInvocations(false);
        pendingAttentionPageRef.current = null;
        setLoadingMoreAttention(false);
        setPagingFailure(null);
        setRunAgainInputOpen(false);
        setRunAgainValues({});
        setSaveAsWorkflowPending(false);
        setAcknowledgedUncertainInvocationId(null);
        setSelectedInvocationId(requestedInvocationId);
        setView('activity');
        setLoadState('loading');
        pendingRunAgainIdRef.current = null;
        previousLifecyclesRef.current = new Map();
        setAnnouncementsEnabled(false);
    }

    const storedInvocationWindow = getStorage()((state) => (runId ? state.workflowRunInvocationsByRunId[runId] ?? null : null));
    const contentBelongsToActiveScope = contentScopeKey === contentIdentity;
    const invocationWindow = contentBelongsToActiveScope ? storedInvocationWindow : null;

    React.useEffect(() => {
        if (runId === null) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = contentIdentity;
        let cancelled = false;
        const controller = new AbortController();
        const retirement = lifetime.onRetire(() => controller.abort());
        setLoadState((current) => (
            contentScopeKeyRef.current === requestScopeKey && current === 'ready'
                ? current
                : 'loading'
        ));
        setFirstFailedInvocationResolution('loading');

        void (async () => {
            try {
                const detail = await workflowRunDetailActions.getRun(runId, controller.signal);
                if (cancelled || !lifetime.isCurrent() || !isContentIdentityCurrent(requestScopeKey)) return;
                if (loadedRunAccountScopeRef.current !== null
                    && loadedRunAccountScopeRef.current.runId === runId
                    && loadedRunAccountScopeRef.current.accountScopeKey !== accountScopeKey) {
                    // The same opaque id exists in both Accounts, so the shared
                    // row itself is the other Account's. Retire it before the
                    // new body merges into the one owner.
                    getStorage().getState().removeWorkflowRun(runId);
                }
                // The body lands in the one shared owner; this screen keeps no copy.
                getStorage().getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                    detail.run,
                    detail.acceptedContext.metadata
                        ? { kind: 'available', value: detail.acceptedContext.metadata }
                        : { kind: 'unavailable' },
                )]);
                setDefinition(detail.definition);
                setAcceptedContext(detail.acceptedContext);
                setResult(detail.result);
                setFinalOutputInvocationId(detail.finalOutputInvocationId ?? null);
                setUsageLabel(detail.usage === undefined
                    ? null
                    : formatWorkflowUsageLabel(detail.usage, {
                        tokens: t('usage.tokens'),
                        input: t('usage.tokenMix.input'),
                        output: t('usage.tokenMix.output'),
                    }));
                setContentScopeKey(requestScopeKey);
                loadedRunAccountScopeRef.current = { runId, accountScopeKey };

                const [page, attentionPage, failedPage] = await Promise.all([
                    workflowRunDetailActions.listInvocations({ runId }, controller.signal),
                    workflowRunDetailActions.listInvocations({ runId, lifecycles: WORKFLOW_ATTENTION_LIFECYCLES }, controller.signal),
                    isTerminalWorkflowRunState(detail.run.state)
                        ? workflowRunDetailActions.listInvocations({ runId, lifecycles: ['failed'], limit: 1 }, controller.signal)
                        : Promise.resolve(null),
                ]);
                if (cancelled || !lifetime.isCurrent() || !isContentIdentityCurrent(requestScopeKey)) return;
                getStorage().getState().applyWorkflowRunInvocationPage({
                    runId,
                    invocations: page.invocations,
                    nextCursor: page.nextCursor ?? null,
                    parentRevision: page.parentRevision,
                    mode: 'replace',
                });
                setAttentionInvocations(attentionPage.invocations);
                setAttentionNextCursor(attentionPage.nextCursor ?? null);
                setFirstFailedInvocation(failedPage?.invocations[0] ?? null);
                setFirstFailedInvocationResolution('resolved');
                // Fresh first pages supersede a failed continuation of the ones
                // they replaced.
                setPagingFailure(null);
                setLoadState('ready');
            } catch {
                if (cancelled || !lifetime.isCurrent() || !isContentIdentityCurrent(requestScopeKey)) return;
                setFirstFailedInvocationResolution('error');
                // Last-known-good detail stays visible, but readiness remains
                // truthful until both public invocation windows have loaded.
                setLoadState('failed');
            }
        })();

        return () => {
            cancelled = true;
            controller.abort();
            retirement.dispose();
        };
    }, [accountScopeKey, contentIdentity, isContentIdentityCurrent, loadAttempt, runId, cachedRow?.summary?.revision]);

    const retryLoad = React.useCallback(() => {
        setLoadState('loading');
        setLoadAttempt((attempt) => attempt + 1);
    }, []);

    const summary: WorkflowRunSummaryV1 | null = contentBelongsToActiveScope
        ? cachedRow?.summary ?? null
        : null;
    const runMachine = useMachine(summary?.machineId ?? '', summary !== null);
    const visibleDefinition = contentBelongsToActiveScope ? definition : null;
    const saveAsWorkflowTitle = React.useMemo(
        () => visibleDefinition === null ? null : workflowDefinitionPromptTitle(visibleDefinition),
        [visibleDefinition],
    );
    const visibleAcceptedContext = contentBelongsToActiveScope ? acceptedContext : null;
    const visibleResult = contentBelongsToActiveScope ? result : undefined;
    const visibleFinalOutputInvocationId = contentBelongsToActiveScope ? finalOutputInvocationId : null;
    const visibleFirstFailedInvocation = contentBelongsToActiveScope ? firstFailedInvocation : null;
    const visibleUsageLabel = contentBelongsToActiveScope ? usageLabel : null;
    const visibleAttentionInvocations = contentBelongsToActiveScope ? attentionInvocations : EMPTY_INVOCATIONS;
    const visibleProgressByInvocationId = contentBelongsToActiveScope
        ? progressByInvocationId
        : EMPTY_PROGRESS_BY_INVOCATION_ID;
    const allInvocations = React.useMemo(() => {
        const byId = new Map((invocationWindow?.invocations ?? []).map((entry) => [entry.id, entry]));
        for (const entry of visibleAttentionInvocations) byId.set(entry.id, entry);
        if (visibleFirstFailedInvocation !== null) byId.set(visibleFirstFailedInvocation.id, visibleFirstFailedInvocation);
        return [...byId.values()];
    }, [invocationWindow?.invocations, visibleAttentionInvocations, visibleFirstFailedInvocation]);
    const visibleResultLabel = React.useMemo(() => {
        if (visibleResult === undefined) return null;
        const raw = typeof visibleResult === 'string' ? visibleResult : JSON.stringify(visibleResult);
        return normalizeResultPreview(raw).display;
    }, [visibleResult]);
    // A deep link selects an invocation; losing that query releases the selection
    // it made. Without this the previous link's row stayed selected — and after a
    // Run change it named a row this Run does not have.
    const requestedInvocationIdRef = React.useRef(requestedInvocationId);
    React.useEffect(() => {
        const previousRequested = requestedInvocationIdRef.current;
        requestedInvocationIdRef.current = requestedInvocationId;
        if (requestedInvocationId !== null) setSelectedInvocationId(requestedInvocationId);
        else if (previousRequested !== null) setSelectedInvocationId(null);
    }, [requestedInvocationId]);
    // One navigable identity map for Activity, Flow and the exact selection, so
    // a row that has never been opened still knows which authored node and
    // occurrence it is without decrypting anything.
    const invocationStructure = React.useMemo(() => projectWorkflowInvocationStructure({
        definition: visibleDefinition,
        invocations: allInvocations,
        progressByInvocationId: visibleProgressByInvocationId,
    }), [allInvocations, visibleDefinition, visibleProgressByInvocationId]);
    const selectedInvocation = selectedInvocationId === null
        ? null
        : allInvocations.find((entry) => entry.id === selectedInvocationId) ?? null;
    const selectedInvocationUpdatedAt = selectedInvocation?.updatedAt ?? null;
    const invocationCoverage = React.useMemo(() => summarizeWorkflowInvocationCoverage(allInvocations), [allInvocations]);
    const changedRowCount = React.useMemo(() => allInvocations.reduce((count, invocation) => (
        previousLifecyclesRef.current.get(invocation.id) === invocation.lifecycle ? count : count + 1
    ), 0), [allInvocations]);
    React.useEffect(() => {
        previousLifecyclesRef.current = new Map(allInvocations.map((entry) => [entry.id, entry.lifecycle]));
    }, [allInvocations]);
    React.useEffect(() => {
        if (invocationWindow?.loaded) setAnnouncementsEnabled(true);
    }, [invocationWindow?.loaded]);
    const announcementState = React.useMemo(() => ({
        blockIds: visibleDefinition?.blocks.map((block) => block.id) ?? [],
        selectedBlockId: selectedInvocationId === null
            ? null
            : invocationStructure.get(selectedInvocationId)?.blockId ?? selectedInvocationId,
        blockingIssue: null,
        attentionCount: visibleAttentionInvocations.length,
        terminal: summary === null ? null : resolveAnnouncementTerminal(summary.state, invocationCoverage.failed),
        changedRowCount,
        selectedRowChanged: selectedInvocationId !== null
            && previousLifecyclesRef.current.get(selectedInvocationId) !== allInvocations.find((entry) => entry.id === selectedInvocationId)?.lifecycle,
    } as const), [allInvocations, changedRowCount, invocationCoverage.failed, invocationStructure, selectedInvocationId, summary, visibleAttentionInvocations.length, visibleDefinition?.blocks]);
    useWorkflowAnnouncements({
        state: announcementState,
        enabled: announcementsEnabled,
        resolveBlockLabel: (blockId) => {
            const block = visibleDefinition === null
                ? undefined
                : walkWorkflowBlocks(visibleDefinition.blocks).find((candidate) => candidate.id === blockId);
            return block === undefined ? blockId : workflowBlockReferenceLabel(block);
        },
    });

    /**
     * Publish one authorized exact invocation read through the existing Run
     * index and opened-progress owners. Callers fence Account/content lifetime
     * before using this; the response itself never becomes local settlement.
     */
    const publishExactInvocation = React.useCallback((
        targetRunId: string,
        targetInvocationId: string,
        response: ExactInvocationResponse,
    ) => {
        getStorage().getState().upsertWorkflowRunInvocation({
            runId: targetRunId,
            invocation: response.invocation.index,
            parentRevision: response.invocation.parentRevision,
        });
        setProgressByInvocationId((current) => {
            const next = new Map(current);
            next.set(targetInvocationId, response.invocation.progress);
            return next;
        });
    }, []);

    React.useEffect(() => {
        if (runId === null || selectedInvocationId === null) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        let cancelled = false;
        const controller = new AbortController();
        const retirement = lifetime.onRetire(() => controller.abort());
        setSelectedContentUnavailable(false);
        void (async () => {
            try {
                const response = await workflowRunDetailActions.getInvocation(
                    { runId, invocationId: selectedInvocationId },
                    controller.signal,
                );
                if (cancelled || !lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
                publishExactInvocation(runId, selectedInvocationId, response);
            } catch {
                // The index remains useful when the exact Action read fails.
                if (!cancelled && lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) {
                    setSelectedContentUnavailable(true);
                }
            }
        })();
        return () => {
            cancelled = true;
            controller.abort();
            retirement.dispose();
        };
    }, [accountScopeKey, contentIdentity, isContentIdentityCurrent, publishExactInvocation, runId, selectedInvocationId, selectedInvocationUpdatedAt, summary?.revision]);

    // One owner decides the haptic and its visible twin together, so a device
    // can never buzz for a completion the screen did not show.
    const completionEmphasis = useWorkflowCompletionMoment({
        state: summary?.state ?? null,
        identity: contentIdentity,
        observing: activelyViewed,
    });

    /**
     * Issue one durable operation against this exact Run under the mutex.
     *
     * `operation` receives the Run summary the operation is issued against, so
     * every caller sends the same `expectedRevision` the screen shows. The
     * returned Run lands in the shared row owner only while this token is still
     * the one in flight for this Account and Run; a settlement that lost that
     * race is dropped, and the authoritative state arrives through the
     * canonical read. `settle` runs in that same fenced window for the one
     * operation whose result is not a Run (deletion).
     */
    const issueRunOperation = React.useCallback(async <T,>(
        kind: WorkflowRunOperationKind,
        operation: (current: WorkflowRunSummaryV1) => Promise<T>,
        settle: (result: T) => void,
    ): Promise<void> => {
        if (runId === null || summary === null) return;
        if (pendingOperationRef.current !== null) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const token: PendingRunOperation = { kind, contentIdentity: requestIdentity };
        pendingOperationRef.current = token;
        setPendingOperation(token);
        setControlError(null);
        const owns = () => pendingOperationRef.current === token
            && lifetime.isCurrent()
            && isContentIdentityCurrent(requestIdentity);
        try {
            const result = await operation(summary);
            if (owns()) settle(result);
        } catch (error) {
            // The durable intent may still have been recorded; the authoritative
            // Run state arrives through the canonical read, never from this catch.
            if (owns()) setControlError(formatWorkflowProblemMessage(error));
        } finally {
            if (pendingOperationRef.current === token) {
                pendingOperationRef.current = null;
                if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) setPendingOperation(null);
            }
        }
    }, [contentIdentity, isContentIdentityCurrent, runId, summary]);

    const settleRun = React.useCallback((result: Readonly<{ run: WorkflowRunSummaryV1 }>) => {
        getStorage().getState().upsertWorkflowRuns([workflowRunRowFromSummary(result.run)]);
    }, []);

    const submitControl = React.useCallback(async (
        kind: 'pause' | 'resume' | 'cancel',
    ) => {
        if (runId === null) return;
        await issueRunOperation(kind, (current) => (kind === 'pause'
            ? workflowRunDetailActions.pauseRun({ runId, expectedRevision: current.revision })
            : kind === 'cancel'
                ? workflowRunDetailActions.cancelRun({ runId, expectedRevision: current.revision })
                : workflowRunDetailActions.resumeRun({
                    mode: 'boundary',
                    runId,
                    expectedRevision: current.revision,
                })), settleRun);
    }, [issueRunOperation, runId, settleRun]);

    const loadMoreInvocations = React.useCallback(async () => {
        if (runId === null || invocationWindow?.nextCursor == null || loadingMoreInvocations) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        setLoadingMoreInvocations(true);
        try {
            const page = await workflowRunDetailActions.listInvocations({ runId, cursor: invocationWindow.nextCursor });
            if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
            getStorage().getState().applyWorkflowRunInvocationPage({
                runId, invocations: page.invocations, nextCursor: page.nextCursor ?? null,
                parentRevision: page.parentRevision, mode: 'append',
            });
            // Only the page that actually arrived clears the failure it replaces.
            setPagingFailure((current) => (current?.window === 'history' ? null : current));
        } catch {
            // The loaded rows and the cursor are untouched: only this page is
            // missing, and Retry asks for exactly it again.
            if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) {
                setPagingFailure({ contentIdentity: requestIdentity, window: 'history' });
            }
        } finally {
            if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) setLoadingMoreInvocations(false);
        }
    }, [contentIdentity, invocationWindow?.nextCursor, isContentIdentityCurrent, loadingMoreInvocations, runId]);

    const loadMoreAttention = React.useCallback(async () => {
        if (runId === null || attentionNextCursor === null) return;
        if (pendingAttentionPageRef.current !== null) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const token = {};
        pendingAttentionPageRef.current = token;
        setLoadingMoreAttention(true);
        try {
            const page = await workflowRunDetailActions.listInvocations({
                runId, cursor: attentionNextCursor, lifecycles: WORKFLOW_ATTENTION_LIFECYCLES,
            });
            if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
            setAttentionInvocations((current) => {
                const byId = new Map(current.map((entry) => [entry.id, entry]));
                for (const entry of page.invocations) byId.set(entry.id, entry);
                return [...byId.values()];
            });
            setAttentionNextCursor(page.nextCursor ?? null);
            setPagingFailure((current) => (current?.window === 'attention' ? null : current));
        } catch {
            if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) {
                setPagingFailure({ contentIdentity: requestIdentity, window: 'attention' });
            }
        } finally {
            // Only the request that took the token releases it, so a settlement
            // that lost its Account or Run cannot free a newer one.
            if (pendingAttentionPageRef.current === token) {
                pendingAttentionPageRef.current = null;
                if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) setLoadingMoreAttention(false);
            }
        }
    }, [attentionNextCursor, contentIdentity, isContentIdentityCurrent, runId]);

    /**
     * The window whose continuation failed, once — and only once — the failure
     * still belongs to what is on screen.
     */
    const visiblePagingFailure = pagingFailure !== null && pagingFailure.contentIdentity === contentIdentity
        ? pagingFailure.window
        : null;

    const selectedProgress = selectedInvocationId === null
        ? null
        : visibleProgressByInvocationId.get(selectedInvocationId) ?? null;
    const selectedExecutionRunId = selectedProgress?.execution?.kind === 'detached_run'
        ? selectedProgress.execution.runId
        : null;

    const retirePendingPermissionDecision = React.useCallback((decision: PendingPermissionDecision) => {
        const requestKey = permissionRequestKey(decision.executionRunId, decision.requestId);
        if (pendingPermissionDecisionsRef.current.get(requestKey) !== decision) return;
        const next = new Map(pendingPermissionDecisionsRef.current);
        next.delete(requestKey);
        pendingPermissionDecisionsRef.current = next;
        setPendingPermissionDecisions(next);
    }, []);

    React.useEffect(() => {
        if (selectedInvocationId === null || selectedProgress === null) return;
        for (const decision of pendingPermissionDecisionsRef.current.values()) {
            if (
                decision.accountLifetime.isCurrent()
                && decision.contentIdentity === contentIdentity
                && decision.runId === runId
                && decision.invocationId === selectedInvocationId
                && (
                    selectedExecutionRunId !== decision.executionRunId
                    || !hasWorkflowInvocationRequest(selectedProgress, decision.requestId)
                )
            ) {
                // Only the canonical opened invocation content can establish
                // that the request this screen answered has been withdrawn.
                retirePendingPermissionDecision(decision);
            }
        }
    }, [contentIdentity, pendingPermissionDecisions, retirePendingPermissionDecision, runId, selectedExecutionRunId, selectedInvocationId, selectedProgress]);

    const respondToSelectedRequest = React.useCallback(async (request:
        | Readonly<{ requestId: string; approved: boolean }>
        | Readonly<{ requestId: string; answers: StructuredQuestionAnswersV1 }>
    ) => {
        if (
            activeAccountScope === null
            || summary === null
            || runId === null
            || selectedInvocationId === null
            || selectedExecutionRunId === null
            || !summary.machineId.trim()
        ) return;
        const requestKey = permissionRequestKey(selectedExecutionRunId, request.requestId);
        // The decision already in flight owns this request: the opposite press
        // must not send a competing answer the machine would settle second.
        if (pendingPermissionDecisionsRef.current.has(requestKey)) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const decision: PendingPermissionDecision = {
            accountLifetime: lifetime,
            contentIdentity: requestIdentity,
            runId,
            invocationId: selectedInvocationId,
            executionRunId: selectedExecutionRunId,
            requestId: request.requestId,
        };
        const pending = new Map(pendingPermissionDecisionsRef.current).set(requestKey, decision);
        pendingPermissionDecisionsRef.current = pending;
        setPendingPermissionDecisions(pending);
        setControlError(null);
        const controller = new AbortController();
        const retirement = lifetime.onRetire(() => controller.abort());
        let transportIssued = false;
        let definitivePreIssuanceFailure = false;
        try {
            try {
                const response = await machineRpcWithServerScope<Readonly<{
                    ok: boolean;
                    errorCode?: string;
                }>, Readonly<{
                    runId: string;
                    requestId: string;
                    approved: boolean;
                } | {
                    runId: string;
                    requestId: string;
                    answers: StructuredQuestionAnswersV1;
                }>>({
                    serverId: activeAccountScope.serverId,
                    accountId: activeAccountScope.accountId,
                    machineId: summary.machineId,
                    preferScoped: true,
                    method: RPC_METHODS.DAEMON_EXECUTION_RUN_PERMISSION_RESPOND,
                    payload: {
                        runId: selectedExecutionRunId,
                        requestId: request.requestId,
                        ...('answers' in request ? { answers: request.answers } : { approved: request.approved }),
                    },
                    signal: controller.signal,
                    onIssued: () => {
                        transportIssued = true;
                    },
                });
                if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
                if (!response.ok) {
                    definitivePreIssuanceFailure = isDefinitivePermissionDecisionPreIssuanceResponse(response);
                    setControlError(t('errors.operationFailed'));
                }
            } catch (error) {
                // The daemon may still have recorded the answer; an unreachable
                // machine only means this screen cannot say that it did.
                if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
                definitivePreIssuanceFailure = !transportIssued;
                setControlError(formatWorkflowProblemMessage(error));
            }

            if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
            try {
                const exact = await workflowRunDetailActions.getInvocation({
                    runId,
                    invocationId: selectedInvocationId,
                }, controller.signal);
                if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
                publishExactInvocation(runId, selectedInvocationId, exact);
                const requestStillOpen = exact.invocation.progress.execution?.kind === 'detached_run'
                    && exact.invocation.progress.execution.runId === selectedExecutionRunId
                    && hasWorkflowInvocationRequest(exact.invocation.progress, request.requestId);
                if (!requestStillOpen || definitivePreIssuanceFailure) {
                    retirePendingPermissionDecision(decision);
                }
            } catch (error) {
                // Without current exact content the outcome remains unknown.
                // Keep controls withdrawn; a later canonical read retires them.
                if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) {
                    setControlError(formatWorkflowProblemMessage(error));
                }
            }
        } finally {
            retirement.dispose();
        }
    }, [activeAccountScope, contentIdentity, isContentIdentityCurrent, publishExactInvocation, retirePendingPermissionDecision, runId, selectedExecutionRunId, selectedInvocationId, summary]);
    /**
     * The withdrawn controls for the attempt currently on screen. A decision
     * belonging to another execution Run is not shown here, so its key cannot
     * disable a same-named request on this one.
     */
    const pendingPermissionRequestIds = React.useMemo(() => {
        if (selectedExecutionRunId === null || selectedInvocationId === null || pendingPermissionDecisions.size === 0) {
            return EMPTY_PERMISSION_REQUEST_IDS;
        }
        const requestIds = new Set<string>();
        for (const decision of pendingPermissionDecisions.values()) {
            if (
                decision.accountLifetime.isCurrent()
                && decision.contentIdentity === contentIdentity
                && decision.runId === runId
                && decision.invocationId === selectedInvocationId
                && decision.executionRunId === selectedExecutionRunId
            ) {
                requestIds.add(decision.requestId);
            }
        }
        return requestIds;
    }, [contentIdentity, pendingPermissionDecisions, runId, selectedExecutionRunId, selectedInvocationId]);
    const uncertaintyAcknowledgementRequired = requiresUncertainPriorEffectsAcknowledgement({
        invocation: selectedInvocation,
        progress: selectedProgress,
    });
    /**
     * The one recovery eligibility answer this screen acts on.
     *
     * `WorkflowRunContent` renders its cards from the same projection, so the
     * control that is drawn and the handler it can reach are decided once.
     * While this screen re-derived restoration from a looser condition of its
     * own, D4's two arms could be live together — restore this Run, or start a
     * reviewed new one that repeats its completed work.
     */
    const selectedRecovery = React.useMemo(() => (
        summary === null ? null : projectWorkflowInvocationRecovery({
            run: summary,
            invocation: selectedInvocation,
            progress: selectedProgress,
            machineHomeDirectory: runMachine?.metadata?.homeDir ?? null,
            invocations: allInvocations,
            invocationHistoryComplete: (invocationWindow?.loaded ?? false) && invocationWindow?.nextCursor == null,
        })
    ), [allInvocations, invocationWindow, runMachine, selectedInvocation, selectedProgress, summary]);
    // Acknowledgement is recorded against the exact attempt it was given for.
    // Changing selection therefore withdraws it rather than carrying blanket
    // consent to a different invocation.
    const uncertaintyAcknowledged = acknowledgedUncertainInvocationId !== null
        && acknowledgedUncertainInvocationId === selectedInvocationId;
    const acknowledgeUncertainPriorEffects = React.useCallback(() => {
        if (selectedInvocationId === null) return;
        setAcknowledgedUncertainInvocationId((current) => (
            current === selectedInvocationId ? null : selectedInvocationId
        ));
    }, [selectedInvocationId]);

    const retrySelected = React.useCallback(async (
        conversation: 'same_conversation' | 'fresh_agent',
        replacement?: WorkflowAuthoredInputV1,
    ) => {
        if (runId === null || selectedInvocationId === null) return;
        // An attempt whose prior effects are unknown is not retried until this
        // exact attempt has been acknowledged. The Action owner revalidates.
        if (uncertaintyAcknowledgementRequired && !uncertaintyAcknowledged) return;
        await issueRunOperation('retry', (current) => workflowRunDetailActions.retryInvocation({
            runId,
            expectedRevision: current.revision,
            invocation: { recordId: selectedInvocationId },
            conversation,
            input: replacement === undefined
                ? { kind: 'original' }
                : { kind: 'replacement', value: replacement },
            ...(uncertaintyAcknowledgementRequired ? { acknowledgeUncertainPriorEffects: true as const } : {}),
        }), settleRun);
    }, [issueRunOperation, runId, selectedInvocationId, settleRun, uncertaintyAcknowledged, uncertaintyAcknowledgementRequired]);

    /**
     * Accepts the continuation the execution owner prepared for this exact
     * invocation. It records a new attempt on the same logical invocation and
     * preserves the previous one; it never repeats completed predecessors.
     */
    const continuePrepared = React.useCallback(async (choice: WorkflowRecoveryContinuation) => {
        if (runId === null || selectedInvocationId === null) return;
        if (uncertaintyAcknowledgementRequired && !uncertaintyAcknowledged) return;
        // The canonical continuation input is required and non-empty.
        if (choice.document.text.trim().length === 0) return;
        // A stale revision or lost response preserves the review state; the
        // authoritative attempt arrives through the canonical read.
        await issueRunOperation('continue', (current) => workflowRunDetailActions.resumeRun({
            mode: 'recover',
            runId,
            expectedRevision: current.revision,
            invocations: [{
                kind: 'continue',
                invocation: { recordId: selectedInvocationId },
                conversation: choice.conversation,
                input: { document: choice.document, input: choice.input },
                ...(uncertaintyAcknowledgementRequired ? { acknowledgeUncertainPriorEffects: true as const } : {}),
            }],
        }), settleRun);
    }, [issueRunOperation, runId, selectedInvocationId, settleRun, uncertaintyAcknowledged, uncertaintyAcknowledgementRequired]);

    const restoreSelectedWorkspace = React.useCallback(async () => {
        if (runId === null || selectedInvocationId === null) return;
        await issueRunOperation('restore_workspace', (current) => workflowRunDetailActions.restoreWorkspace({
            mode: 'recover', runId, expectedRevision: current.revision,
            invocations: [{
                kind: 'restore_workspace',
                invocation: { recordId: selectedInvocationId },
                conversation: selectedProgress?.recovery?.conversation ?? 'fresh_agent',
                input: selectedProgress?.recovery?.input ?? { kind: 'original' },
            }],
        }, current.machineId), settleRun);
    }, [issueRunOperation, runId, selectedInvocationId, selectedProgress, settleRun]);

    const reattachSelected = React.useCallback(async () => {
        if (runId === null || selectedInvocationId === null) return;
        await issueRunOperation('reattach', (current) => workflowRunDetailActions.resumeRun({
            mode: 'recover', runId, expectedRevision: current.revision,
            invocations: [{ kind: 'reattach', invocation: { recordId: selectedInvocationId } }],
        }), settleRun);
    }, [issueRunOperation, runId, selectedInvocationId, settleRun]);

    const deleteRun = React.useCallback(async () => {
        if (runId === null || summary === null) return;
        const requestIdentity = contentIdentity;
        const confirmed = await Modal.confirm(
            t('workflows.run.deleteHistory'), t('workflows.run.deleteHistoryConfirm'),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed || !isContentIdentityCurrent(requestIdentity)) return;
        await issueRunOperation(
            'delete',
            (current) => workflowRunDetailActions.deleteRun({ runId, expectedRevision: current.revision }),
            () => {
                getStorage().getState().removeWorkflowRun(runId);
                router.back();
            },
        );
    }, [contentIdentity, isContentIdentityCurrent, issueRunOperation, router, runId, summary]);

    const admitRunAgain = React.useCallback(async (inputs: Readonly<Record<string, JsonValue>> | undefined) => {
        if (visibleDefinition === null || visibleAcceptedContext === null) return;
        const requestIdentity = contentIdentity;
        const nextRunId = pendingRunAgainIdRef.current ?? randomUUID();
        pendingRunAgainIdRef.current = nextRunId;
        const admitted = await runNow.runNow({
            runId: nextRunId,
            ...(visibleAcceptedContext.metadata ? { metadata: visibleAcceptedContext.metadata } : {}),
            source: {
                kind: 'inline',
                definition: { ...visibleDefinition, inputs: [...visibleDefinition.inputs], blocks: [...visibleDefinition.blocks] },
            },
            // "Run again" repeats this Run. Its accepted runtime is part of what
            // it was: dropping it would silently repeat effectful work under
            // different execution, approval and lifecycle semantics.
            executionTarget: visibleAcceptedContext.executionTarget,
            project: projectAcceptedWorkflowRunTarget(visibleAcceptedContext.workspaceTarget.project),
            ...(inputs === undefined ? {} : { inputs }),
        });
        if (admitted === null || !isContentIdentityCurrent(requestIdentity)) return;
        pendingRunAgainIdRef.current = null;
        setRunAgainInputOpen(false);
        router.push({ pathname: '/workflows/runs/[runId]', params: { runId: admitted.run.id } } as never);
    }, [contentIdentity, isContentIdentityCurrent, router, runNow, visibleAcceptedContext, visibleDefinition]);

    const requestRunAgain = React.useCallback(async () => {
        if (visibleDefinition === null || visibleAcceptedContext === null) return;
        const requestIdentity = contentIdentity;
        const confirmed = await Modal.confirm(
            t('workflows.run.runAgain'),
            t('workflows.recovery.repeatedEffectWarning'),
            { cancelText: t('common.cancel'), confirmText: t('workflows.recovery.startReviewedRun') },
        );
        if (!confirmed || !isContentIdentityCurrent(requestIdentity)) return;
        setRunAgainValues(visibleAcceptedContext.inputs);
        if (visibleDefinition.inputs.length > 0) {
            setRunAgainInputOpen(true);
            return;
        }
        void admitRunAgain(undefined);
    }, [admitRunAgain, contentIdentity, isContentIdentityCurrent, visibleAcceptedContext, visibleDefinition]);

    /**
     * D4's second arm: when the recorded workspace cannot be used and no
     * restoration producer exists, the only truthful offer is opening the
     * accepted definition as a **new** Run the person reviews and starts. This
     * admits nothing — it hands the editor a reviewed copy — and the original
     * Run keeps its own history, results and identity.
     */
    const startReviewedNewRun = React.useCallback(() => {
        if (summary === null || visibleDefinition === null || visibleAcceptedContext === null) return;
        const reasonCode = selectedProgress?.reason?.code;
        if (!isWorkflowWorkspaceUnavailableReason(reasonCode)) return;
        const seedId = storeWorkflowReviewedRunSeed(buildWorkflowReviewedRunSeed({
            run: summary,
            definition: visibleDefinition,
            acceptedContext: visibleAcceptedContext,
            reasonCode,
        }));
        router.push({ pathname: '/workflows/new', params: { reviewedRunSeedId: seedId } } as never);
    }, [router, selectedProgress, summary, visibleAcceptedContext, visibleDefinition]);

    const copyWorkspace = React.useCallback(async (directory: string) => {
        const requestIdentity = contentIdentity;
        const copied = await setClipboardStringSafe(directory);
        if (!isContentIdentityCurrent(requestIdentity)) return;
        Modal.alert(
            copied ? t('common.copied') : t('common.error'),
            copied
                ? t('items.copiedToClipboard', { label: t('common.path') })
                : t('items.failedToCopyToClipboard'),
        );
    }, [contentIdentity, isContentIdentityCurrent]);

    const openWorkspace = React.useCallback((workspaceRefId: string, directory: string) => {
        const opened = openProject(workspaceRefId, { activeRootPath: directory });
        if (!opened) setControlError(t('workflows.workspace.unavailableBody'));
    }, [openProject]);

    const saveAsWorkflow = React.useCallback(async () => {
        if (visibleDefinition === null || saveAsWorkflowPending) return;
        if (saveAsWorkflowTitle === null) return;
        const requestIdentity = contentIdentity;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        setSaveAsWorkflowPending(true);
        try {
            const savedDefinition = await createWorkflowDefinition({
                definitionId: randomUUID(),
                definition: visibleDefinition,
                metadata: { title: saveAsWorkflowTitle },
            });
            if (!lifetime.isCurrent() || !isContentIdentityCurrent(requestIdentity)) return;
            router.push({
                pathname: '/workflows/[id]',
                params: { id: savedDefinition.definitionId },
            } as never);
        } catch {
            if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) {
                await Modal.alert(t('workflows.save.failedTitle'), t('workflows.save.failedBody'));
            }
        } finally {
            if (lifetime.isCurrent() && isContentIdentityCurrent(requestIdentity)) setSaveAsWorkflowPending(false);
        }
    }, [contentIdentity, isContentIdentityCurrent, router, saveAsWorkflowPending, saveAsWorkflowTitle, visibleDefinition]);

    const runAgainModalProps = React.useMemo<WorkflowRunInputModalProps | null>(
        () => visibleDefinition === null ? null : ({
            inputs: visibleDefinition.inputs,
            values: runAgainValues,
            onChangeValues: setRunAgainValues,
            onRun: (inputs) => { void admitRunAgain(inputs); },
            onCancel: () => setRunAgainInputOpen(false),
            pending: runNow.stateFor(pendingRunAgainIdRef.current ?? '') === 'submitting',
        }),
        [admitRunAgain, runAgainValues, runNow, visibleDefinition],
    );

    useWorkflowRunInputModal({
        open: runAgainInputOpen,
        props: runAgainModalProps,
        testID: 'workflow-run-again-inputs-modal',
    });

    if (runId === null) {
        return (
            <View style={[styles.root, styles.centered]}>
                <Text style={styles.stateTitle}>{t('workflows.loadFailedTitle')}</Text>
            </View>
        );
    }

    if (summary === null) {
        return (
            <View testID="workflow-run-screen" style={[styles.root, styles.centered]}>
                {loadState === 'failed' ? (
                    <SurfaceStateCard
                        testID="workflow-run-load-failed"
                        kind="error"
                        title={t('workflows.loadFailedTitle')}
                        reason={t('workflows.loadFailedBody')}
                        action={{ label: t('common.retry'), onPress: retryLoad }}
                        accessibilitySemantics="alert"
                    />
                ) : (
                    <ActivitySpinner testID="workflow-run-loading" />
                )}
            </View>
        );
    }

    return (
        <View
            testID="workflow-run-screen"
            style={styles.root}
        >
            <WorkflowRunContent
                run={summary}
                machineName={getMachineDisplayName(runMachine)}
                // An opened accepted context with no metadata is an untitled
                // Run — the unnamed-draft case — not private content this
                // device cannot open; only an unopened context is unavailable.
                title={visibleAcceptedContext === null
                    ? null
                    : formatWorkflowRunDisplayName(resolveWorkflowRunDisplayName(
                        visibleAcceptedContext.metadata === undefined
                            ? null
                            : { kind: 'available', value: visibleAcceptedContext.metadata },
                    ))}
                definition={visibleDefinition}
                invocations={allInvocations}
                invocationsLoaded={invocationWindow?.loaded ?? false}
                invocationHistoryComplete={(invocationWindow?.loaded ?? false) && invocationWindow?.nextCursor == null}
                selectedInvocationId={selectedInvocationId}
                onSelectInvocation={setSelectedInvocationId}
                onDeselectInvocation={() => setSelectedInvocationId(null)}
                view={view}
                onChangeView={setView}
                pendingControl={pendingOperation?.kind ?? null}
                onPause={() => { void submitControl('pause'); }}
                onResume={() => { void submitControl('resume'); }}
                onCancel={() => { void submitControl('cancel'); }}
                usageLabel={visibleUsageLabel}
                resultLabel={visibleResultLabel}
                finalOutputInvocationId={visibleFinalOutputInvocationId}
                firstFailedInvocationId={visibleFirstFailedInvocation?.id ?? null}
                firstFailedInvocationResolution={firstFailedInvocationResolution}
                selectedInvocationProgress={selectedProgress}
                invocationProgressById={visibleProgressByInvocationId}
                invocationStructure={invocationStructure}
                onOpenSession={activeAccountScope === null ? undefined : (sessionId) => router.push(
                    buildScopedSessionRouteHref({ sessionId, serverId: activeAccountScope.serverId }) as never,
                )}
                onOpenExecutionRun={activeAccountScope === null || !summary.machineId.trim() ? undefined : (executionRunId) => {
                    const route = createMachineExecutionRunRoute(
                        activeAccountScope.serverId,
                        summary.machineId,
                        executionRunId,
                    );
                    if (route !== null) router.push(route as never);
                }}
                onRespondPermission={selectedExecutionRunId === null
                    ? undefined
                    : (request) => { void respondToSelectedRequest(request); }}
                onAnswerQuestion={selectedExecutionRunId === null
                    ? undefined
                    : (request) => { void respondToSelectedRequest(request); }}
                pendingPermissionRequestIds={pendingPermissionRequestIds}
                workspaceHomeDirectory={runMachine?.metadata?.homeDir ?? null}
                onCopyWorkspace={(directory) => { void copyWorkspace(directory); }}
                onOpenWorkspace={openWorkspace}
                onLoadMoreInvocations={invocationWindow?.nextCursor == null ? undefined : () => { void loadMoreInvocations(); }}
                loadingMoreInvocations={loadingMoreInvocations}
                loadMoreInvocationsFailed={visiblePagingFailure === 'history'}
                onLoadMoreAttention={attentionNextCursor === null ? undefined : () => { void loadMoreAttention(); }}
                loadingMoreAttention={loadingMoreAttention}
                loadMoreAttentionFailed={visiblePagingFailure === 'attention'}
                onRetrySameConversation={selectedInvocationId && summary.availability.retry ? () => { void retrySelected('same_conversation'); } : undefined}
                onRetryFreshAgent={selectedInvocationId && summary.availability.retry ? () => { void retrySelected('fresh_agent'); } : undefined}
                onRetryWithReplacement={selectedInvocationId && summary.availability.retry
                    ? (input) => { void retrySelected(input.conversation, { document: input.document, input: input.input }); }
                    : undefined}
                preparedRecovery={selectedProgress?.recovery ?? null}
                onContinuePrepared={selectedInvocationId !== null && selectedProgress?.recovery !== undefined
                    ? (choice) => { void continuePrepared(choice); }
                    : undefined}
                uncertaintyAcknowledged={uncertaintyAcknowledged}
                onAcknowledgeUncertainPriorEffects={uncertaintyAcknowledgementRequired
                    ? acknowledgeUncertainPriorEffects
                    : undefined}
                onReattach={selectedInvocationId !== null && selectedRecovery?.canReattach === true
                    ? () => { void reattachSelected(); }
                    : undefined}
                onDelete={isTerminalWorkflowRunState(summary.state) && summary.workflowCustodyState === 'settled' ? () => { void deleteRun(); } : undefined}
                deleteBlockedByCustody={isTerminalWorkflowRunState(summary.state) && summary.workflowCustodyState === 'pending'}
                onRunAgain={visibleAcceptedContext !== null && isTerminalWorkflowRunState(summary.state)
                    ? () => { void requestRunAgain(); }
                    : undefined}
                onSaveAsWorkflow={visibleDefinition === null
                    || saveAsWorkflowTitle === null
                    ? undefined
                    : () => { void saveAsWorkflow(); }}
                saveAsWorkflowPending={saveAsWorkflowPending}
                onStartReviewedNewRun={visibleAcceptedContext !== null
                    && selectedInvocationId !== null
                    && selectedRecovery?.canStartReviewedNewRun === true
                    ? startReviewedNewRun
                    : undefined}
                onRestoreWorkspace={selectedInvocationId !== null
                    && selectedRecovery?.canRestoreWorkspace === true
                    ? () => { void restoreSelectedWorkspace(); }
                    : undefined}
                completionEmphasis={completionEmphasis}
                errorLabel={controlError ?? (loadState === 'failed' ? t('workflows.loadFailedBody') : null)}
                onReload={loadState === 'failed' ? retryLoad : undefined}
                selectedContentUnavailable={selectedContentUnavailable}
                contentContainerStyle={styles.content}
            />
        </View>
    );
}
