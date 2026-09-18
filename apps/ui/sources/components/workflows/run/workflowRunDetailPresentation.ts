import type {
    WorkflowAuthoredInputV1,
    WorkflowInvocationRecoveryV1,
    WorkflowProgressEnvelopeV1,
    WorkflowInvocationLifecycleV1,
    WorkflowRunInvocationIndexV1,
    WorkflowRunStateV1,
    WorkflowRunSummaryV1,
} from '@happier-dev/protocol';

import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';
import {
    isTerminalWorkflowRunState,
    type WorkflowRunCoverage,
} from '@/components/workflows/presentation/workflowLifecyclePresentation';

/**
 * Managed Run-detail presentation.
 *
 * Parent Run state and per-invocation lifecycle are two different closed
 * contracts and are mapped separately here; they are never flattened into one
 * guessed enum. Nothing in this module decides a lifecycle: every value comes
 * from the canonical server projection, and the only composition performed is
 * the outcome sentence, which reads real child coverage.
 */

const REATTACHABLE_INVOCATION_LIFECYCLES: ReadonlySet<WorkflowInvocationLifecycleV1> = new Set([
    'admitting',
    'running',
    'waiting_for_approval',
    'needs_attention',
    'cancel_requested',
    'outcome_uncertain',
]);

/**
 * Whether Run detail may expose the exact-input Reattach operation.
 *
 * Run-level recovery availability also covers creating a continuation attempt.
 * It is therefore insufficient by itself: a failed/cancelled/superseded input
 * is stopped and must use the canonical continue/retry path, never Reattach.
 * This mirrors the Action owner's exact-input eligibility while remaining only
 * a fail-closed presentation decision; the Action revalidates on submission.
 */
export function canOfferWorkflowInvocationReattach(params: Readonly<{
    run: WorkflowRunSummaryV1;
    invocation: WorkflowRunInvocationIndexV1 | null;
    progress: WorkflowProgressEnvelopeV1 | null;
}>): boolean {
    if (params.run.state !== 'interrupted') return false;
    if (!params.run.availability.recoverSameConversation) return false;
    if (params.invocation === null || params.progress?.execution === undefined) return false;
    if (params.progress.reason?.code === 'workspace_unavailable') return false;
    return REATTACHABLE_INVOCATION_LIFECYCLES.has(params.invocation.lifecycle);
}

const RETRYABLE_INVOCATION_LIFECYCLES: ReadonlySet<WorkflowInvocationLifecycleV1> = new Set([
    'failed',
    'cancelled',
]);

const POSSIBLY_ACTIVE_INVOCATION_LIFECYCLES: ReadonlySet<WorkflowInvocationLifecycleV1> = new Set([
    'admitting',
    'running',
    'waiting_for_approval',
    'needs_attention',
    'cancel_requested',
    'outcome_uncertain',
]);

const WORKSPACE_UNAVAILABLE_REASON_CODES: ReadonlySet<string> = new Set([
    'conversation_workspace_mismatch',
    'source_workspace_unavailable',
    'committed_revision_unavailable',
    'workspace_unavailable',
    'workspace_conflict',
    'scm_unavailable',
]);

/**
 * Every reason code that means the recorded workspace cannot be used as it
 * stands. They differ in cause, not in what the person can do next, so they all
 * reach the same offer instead of five of them dead-ending in a warning.
 */
export function isWorkflowWorkspaceUnavailableReason(code: string | undefined): code is string {
    return code !== undefined && WORKSPACE_UNAVAILABLE_REASON_CODES.has(code);
}

/**
 * One reviewed continuation: which conversation it uses and the complete
 * authored input the person accepted. `document` is the prepared objective
 * unless they edited it; resolved context remains the exact recorded values.
 */
export type WorkflowRecoveryContinuation = Readonly<{
    conversation: 'same_conversation' | 'fresh_agent';
    document: WorkflowAuthoredInputV1['document'];
    input: WorkflowAuthoredInputV1['input'];
}>;

/**
 * Whether this exact attempt's prior effects are unknown.
 *
 * `outcome_uncertain` means the input stopped before reporting, so the
 * workspace may already have changed. Continuation and retry are refused until
 * the person acknowledges that for this attempt; the acknowledgement is never
 * implied, inherited from a sibling, or remembered across selections.
 */
export function requiresUncertainPriorEffectsAcknowledgement(params: Readonly<{
    invocation: WorkflowRunInvocationIndexV1 | null;
    progress: WorkflowProgressEnvelopeV1 | null;
}>): boolean {
    return params.invocation?.lifecycle === 'outcome_uncertain'
        || params.progress?.reason?.code === 'outcome_uncertain';
}

export type WorkflowInvocationWorkspacePresentation = Readonly<{
    directory: string;
    displayDirectory: string;
    checkoutRootPath: string;
    displayCheckoutRootPath: string;
    workspaceRefId: string | null;
    branchName: string | null;
    sourceBlockId: string | null;
    sourceInvocationRecordId: string | null;
}>;

export type WorkflowInvocationRecoveryPresentation = Readonly<{
    canInspectExecution: boolean;
    canReattach: boolean;
    canRetrySameConversation: boolean;
    canRetryFreshAgent: boolean;
    /** The execution owner prepared a continuation this attempt can accept. */
    canContinuePrepared: boolean;
    canRestoreWorkspace: boolean;
    /**
     * D4's second arm, and only its second arm.
     *
     * Restoring resumes this Run and keeps every completed result; a reviewed
     * new whole Run repeats them. They are therefore mutually exclusive by
     * construction here rather than by each screen remembering to hide one:
     * offering both asked the person to choose between recovering and
     * repeating without saying one was strictly better.
     */
    canStartReviewedNewRun: boolean;
    preparedRecovery: WorkflowInvocationRecoveryV1 | null;
    /** Continuation and retry stay refused until this exact attempt is acknowledged. */
    requiresUncertaintyAcknowledgement: boolean;
    waitingForStop: boolean;
    remainingNotStartedSiblingCount: number | null;
    workspaceUnavailable: boolean;
    workspace: WorkflowInvocationWorkspacePresentation | null;
}>;

export function formatWorkflowWorkspaceSourceLabel(
    blockLabel: string,
    invocationRecordId: string | null,
): string {
    return invocationRecordId === null
        ? blockLabel
        : `${blockLabel} · ${invocationRecordId}`;
}

/**
 * Fail-closed Run-detail recovery projection for one exact selected row.
 *
 * The parent availability object says that an operation exists somewhere in
 * the Run; it does not make every visible historical row eligible. This pure
 * presentation owner intersects that broad capability with the exact public
 * row lifecycle and opened progress facts. Mutation eligibility is still
 * revalidated by the Workflow Action owner on submission.
 */
export function projectWorkflowInvocationRecovery(params: Readonly<{
    run: WorkflowRunSummaryV1;
    invocation: WorkflowRunInvocationIndexV1 | null;
    progress: WorkflowProgressEnvelopeV1 | null;
    machineHomeDirectory: string | null;
    invocations?: readonly WorkflowRunInvocationIndexV1[];
    invocationHistoryComplete?: boolean;
}>): WorkflowInvocationRecoveryPresentation {
    const workspaceUnavailable = params.progress?.reason?.code !== undefined
        && WORKSPACE_UNAVAILABLE_REASON_CODES.has(params.progress.reason.code);
    const descriptor = params.progress?.workspace?.descriptor;
    const workspace = descriptor === undefined
        ? null
        : {
            directory: descriptor.directory,
            displayDirectory: formatPathRelativeToHome(
                descriptor.directory,
                params.machineHomeDirectory ?? undefined,
            ),
            checkoutRootPath: descriptor.checkoutRootPath,
            displayCheckoutRootPath: formatPathRelativeToHome(
                descriptor.checkoutRootPath,
                params.machineHomeDirectory ?? undefined,
            ),
            workspaceRefId: descriptor.workspaceRefId ?? null,
            branchName: descriptor.checkout?.branchName ?? null,
            sourceBlockId: descriptor.sourceInvocation?.producer.blockId ?? null,
            sourceInvocationRecordId: descriptor.sourceInvocation?.invocationRecordId ?? null,
        } satisfies WorkflowInvocationWorkspacePresentation;
    const invocation = params.invocation;
    const retryable = params.run.state === 'interrupted'
        && params.run.availability.retry
        && !workspaceUnavailable
        && invocation !== null
        && RETRYABLE_INVOCATION_LIFECYCLES.has(invocation.lifecycle);
    const waitingForStop = params.run.workflowCustodyState === 'pending'
        && (
            workspaceUnavailable
            || (invocation !== null
                && POSSIBLY_ACTIVE_INVOCATION_LIFECYCLES.has(invocation.lifecycle)
                && (invocation.lifecycle === 'cancel_requested' || invocation.lifecycle === 'outcome_uncertain'))
        );
    const remainingNotStartedSiblingCount = invocation === null
        || params.invocationHistoryComplete !== true
        ? null
        : (params.invocations ?? []).filter((candidate) => (
            candidate.id !== invocation.id
            && candidate.parentRecordId === invocation.parentRecordId
            && (candidate.lifecycle === 'pending' || candidate.lifecycle === 'waiting_for_capacity')
        )).length;

    // A prepared continuation is offered only while the Run owner still reports
    // a recovery capability and the input is proven stopped. A possibly-active
    // input keeps Waiting for stop; no acknowledgement can bypass that.
    const canContinuePrepared = params.progress?.recovery !== undefined
        && !workspaceUnavailable
        && !waitingForStop
        && (params.progress.recovery.conversation === 'same_conversation'
            ? params.run.availability.recoverSameConversation
            : params.run.availability.recoverFreshAgent);

    const canRestoreWorkspace = params.run.state === 'interrupted'
        && params.run.availability.restoreWorkspace
        && params.progress?.reason?.code === 'workspace_unavailable'
        && params.progress.workspace?.creationIntent !== undefined
        && params.progress.workspace.descriptor?.checkout?.kind === 'git_worktree';

    return {
        canInspectExecution: params.run.availability.inspectExecution
            && params.progress?.execution !== undefined,
        canReattach: !workspaceUnavailable && canOfferWorkflowInvocationReattach(params),
        // The existing retry Action supports both exact conversation requests;
        // replacement input rides the same Action and is reviewed in the shared
        // authoring composer before submission.
        canRetrySameConversation: retryable,
        canRetryFreshAgent: retryable,
        canContinuePrepared,
        canRestoreWorkspace,
        // Every workspace-unavailable cause reaches the same pair of offers, and
        // the reviewed new Run is the strictly worse one: it is offered only
        // when this Run cannot be restored at all, and never while the previous
        // input may still be running — no acknowledgement starts replacement
        // work while `workflow_outcome_unresolved` stands.
        canStartReviewedNewRun: workspaceUnavailable && !canRestoreWorkspace && !waitingForStop,
        preparedRecovery: params.progress?.recovery ?? null,
        requiresUncertaintyAcknowledgement: requiresUncertainPriorEffectsAcknowledgement(params),
        waitingForStop,
        remainingNotStartedSiblingCount,
        workspaceUnavailable,
        workspace,
    };
}

export function formatWorkflowRunStateLabel(state: WorkflowRunStateV1): string {
    return t(`workflows.runState.${state}`);
}

/**
 * Where a Run came from. A direct Run's originating Session is provenance only:
 * its absence never makes the Run unavailable.
 */
export function formatWorkflowRunOriginLabel(origin: WorkflowRunSummaryV1['origin']): string {
    if (origin.kind === 'automation') return t('workflows.run.origin.automation');
    return origin.originSessionId
        ? t('workflows.run.origin.fromSession')
        : t('workflows.run.origin.direct');
}

/**
 * The outcome sentence.
 *
 * A `succeeded` Run whose loaded children include failures reads **Done with
 * failures**, which is a composition of real children rather than a second
 * terminal state. A nonterminal Run states what it is waiting on instead of
 * claiming a result.
 */
export function formatWorkflowRunOutcomeSentence(params: Readonly<{
    run: WorkflowRunSummaryV1;
    coverage: WorkflowRunCoverage;
    historyComplete?: boolean;
}>): string {
    const { run, coverage } = params;
    if (run.state === 'succeeded') {
        // A loaded page is not necessarily complete history. Until the cursor is
        // exhausted, neither the success count nor the absence of failures is
        // authoritative, so keep terminal copy deliberately neutral.
        if (params.historyComplete === false) return formatWorkflowRunStateLabel(run.state);
        return coverage.failed > 0
            ? t('workflows.run.completedWithFailures', {
                completed: coverage.completed,
                failed: coverage.failed,
            })
            : t('workflows.run.completedCount', { count: coverage.completed });
    }
    if (run.state === 'pause_requested') return t('workflows.run.pausePending');
    if (run.state === 'paused') return t('workflows.run.paused');
    return formatWorkflowRunStateLabel(run.state);
}

/**
 * The label shown on the Run's status pill: the terminal composition when the
 * children warrant it, otherwise the canonical state label.
 */
export function formatWorkflowRunOutcomeLabel(params: Readonly<{
    state: WorkflowRunStateV1;
    coverage: WorkflowRunCoverage;
    historyComplete?: boolean;
}>): string {
    if (params.state === 'succeeded' && params.historyComplete !== false && params.coverage.failed > 0) {
        return t('workflows.runState.completed_with_failures');
    }
    return formatWorkflowRunStateLabel(params.state);
}

/**
 * Whether this mounted detail instance just watched the Run transition from a
 * nonterminal state to authoritative success.
 *
 * The completion moment is keyed to that observed transition, not to a refresh
 * or a remount, so re-entering a finished Run never replays it and no "already
 * played" state has to be persisted.
 */
export function isObservedCompletionTransition(params: Readonly<{
    previousState: WorkflowRunStateV1 | null;
    nextState: WorkflowRunStateV1;
}>): boolean {
    if (params.previousState === null) return false;
    if (isTerminalWorkflowRunState(params.previousState)) return false;
    return params.nextState === 'succeeded';
}
