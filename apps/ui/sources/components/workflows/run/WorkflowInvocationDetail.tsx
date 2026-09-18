import * as React from 'react';
import { Pressable, View } from 'react-native';

import type {
    StructuredQuestionAnswersV1,
    WorkflowInvocationRecoveryV1,
    WorkflowProgressEnvelopeV1,
} from '@happier-dev/protocol';

import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { MultiTextInput } from '@/components/ui/forms/MultiTextInput';

import { describeWorkflowInvocationAttempt } from '@/components/workflows/presentation/workflowLifecyclePresentation';
import { formatWorkflowUsageLabel } from '@/components/workflows/presentation/workflowUsagePresentation';

import { workflowRunStyles as styles } from './workflowRunStyles';
import type {
    WorkflowInvocationRecoveryPresentation,
    WorkflowRecoveryContinuation,
} from './workflowRunDetailPresentation';
import { projectWorkflowInvocationRequests, type WorkflowInvocationRequest } from './workflowPermissionRequests';

/**
 * One exact selected invocation.
 *
 * Everything shown here comes from the authorized opened progress projection
 * the caller was handed: this component holds no envelope opener, no Account
 * codec and no lifecycle of its own. Which recovery actions exist is likewise
 * the recovery projection's answer, not a guess from a missing runtime handle,
 * so a possibly-active input can never be replaced from this surface.
 */
export type WorkflowInvocationDetailProps = Readonly<{
    /** The authorized opened progress for the selected row, when it has been read. */
    progress: WorkflowProgressEnvelopeV1 | null;
    recovery: WorkflowInvocationRecoveryPresentation;
    /**
     * The workspace's source block label, already resolved against the frozen
     * definition. `null` means the workspace is not step-derived, or that block
     * is not present in the read definition.
     */
    workspaceSourceLabel: string | null;
    contentUnavailable?: boolean;
    onOpenSession?: (sessionId: string) => void;
    onOpenExecutionRun?: (runId: string) => void;
    onRespondPermission?: (request: Readonly<{ requestId: string; approved: boolean }>) => void;
    onAnswerQuestion?: (request: Readonly<{
        requestId: string;
        answers: StructuredQuestionAnswersV1;
    }>) => void;
    /**
     * Requests whose decision is already in flight. Both controls stay
     * withdrawn until the host sees that answer settle, so the same request
     * cannot be allowed and denied in the same moment.
     */
    pendingPermissionRequestIds?: ReadonlySet<string>;
    onCopyWorkspace?: (directory: string) => void;
    onOpenWorkspace?: (workspaceRefId: string, directory: string) => void;
    onReattach?: () => void;
    onRetrySameConversation?: () => void;
    onRetryFreshAgent?: () => void;
    onRetryWithReplacement?: (input: WorkflowRecoveryContinuation) => void;
    onContinuePrepared?: (choice: WorkflowRecoveryContinuation) => void;
    /** Acknowledgement is owned by the host: it is submitted with the operation. */
    uncertaintyAcknowledged?: boolean;
    onAcknowledgeUncertainPriorEffects?: () => void;
    onStartReviewedNewRun?: () => void;
    onRestoreWorkspace?: () => void;
    /**
     * A durable Run operation the host issued is unsettled. Every durable
     * action here is withdrawn as busy until it settles; inspection, copying
     * and the reviewed text stay live.
     */
    operationPending?: boolean;
    /**
     * The reviewed text buffers for this exact invocation, owned above the
     * Activity/Flow switch.
     *
     * This detail is remounted by that switch — it is a list footer in one arm
     * and a scroll child in the other — so a buffer kept here was discarded
     * mid-sentence whenever someone checked the graph while writing a
     * continuation. `undefined` means nothing has been typed yet, which is what
     * lets a prepared continuation still seed itself from the execution owner.
     */
    continuationText: string | undefined;
    onChangeContinuationText: (next: string) => void;
    replacementText: string | undefined;
    onChangeReplacementText: (next: string) => void;
    testIDPrefix: string;
}>;

/**
 * One reviewed text buffer.
 *
 * Accepting a prepared continuation and replacing a failed step's input are two
 * different decisions, so each gets its own instance of this hook: one
 * disclosure, one draft, one submit. Sharing a single buffer between them meant
 * opening either revealed the other's half-written text — and could submit it.
 *
 * A prepared instance is seeded from whatever the execution owner already
 * resolved, so ordinary recovery is read-and-accept rather than a prompt
 * reconstruction.
 */
function useReviewedContinuation(
    prepared: WorkflowInvocationRecoveryV1 | null,
    buffer: Readonly<{ text: string | undefined; onChangeText: (next: string) => void }>,
    initiallyOpen = prepared === null,
): Readonly<{
    text: string;
    setText: (next: string) => void;
    open: boolean;
    toggle: () => void;
    document: WorkflowRecoveryContinuation['document'];
    input: WorkflowRecoveryContinuation['input'];
}> {
    const preparedDocument = prepared?.input.kind === 'replacement' ? prepared.input.value.document : null;
    const text = buffer.text ?? preparedDocument?.text ?? '';
    const setText = buffer.onChangeText;
    // The Protocol's continuation always carries an authored input. When the
    // owner prepared one there is something to accept, so editing stays
    // disclosed; when it only says "the original objective", the person has to
    // supply the continuation, so the field opens rather than hiding behind a
    // disclosure that looks optional. Text the person already wrote keeps it
    // open, so a buffer that survived a view switch is not hidden behind a
    // collapsed row — the owner's prepared seed is not such text, or a prepared
    // continuation could never open closed.
    const [open, setOpen] = React.useState(initiallyOpen || (buffer.text ?? '').length > 0);
    const toggle = React.useCallback(() => setOpen((current) => !current), []);
    return {
        text,
        setText,
        open,
        toggle,
        document: {
            text,
            references: preparedDocument?.references ?? [],
            attachments: preparedDocument?.attachments ?? [],
        },
        input: prepared?.input.kind === 'replacement' ? prepared.input.value.input : [],
    };
}

export function WorkflowInvocationDetail(props: WorkflowInvocationDetailProps): React.ReactElement {
    const { recovery, testIDPrefix } = props;
    const execution = props.progress?.execution;
    const workspace = recovery.workspace;
    const prepared = recovery.preparedRecovery;
    const continuation = useReviewedContinuation(prepared, {
        text: props.continuationText,
        onChangeText: props.onChangeContinuationText,
    });
    /** The replacement retry's own buffer; it never inherits the prepared text. */
    const replacement = useReviewedContinuation(null, {
        text: props.replacementText,
        onChangeText: props.onChangeReplacementText,
    }, false);
    /**
     * Which conversation a replacement retry uses.
     *
     * The execution owner may allow both; choosing by "whichever capability is
     * true first" made the fresh-agent arm unreachable whenever same-conversation
     * recovery was also available. Same conversation stays the default because it
     * preserves the agent's history.
     */
    const [replacementConversation, setReplacementConversation] =
        React.useState<WorkflowRecoveryContinuation['conversation']>(
            recovery.canRetrySameConversation ? 'same_conversation' : 'fresh_agent',
        );
    const replacementConversationChoices = ([
        ...(recovery.canRetrySameConversation ? ['same_conversation' as const] : []),
        ...(recovery.canRetryFreshAgent ? ['fresh_agent' as const] : []),
    ]);
    const effectiveReplacementConversation = replacementConversationChoices.includes(replacementConversation)
        ? replacementConversation
        : replacementConversationChoices[0] ?? 'same_conversation';
    // Blocked until this exact attempt is acknowledged; nothing here can bypass
    // an unresolved outcome, which stays the Action owner's refusal.
    const acknowledgementSatisfied = !recovery.requiresUncertaintyAcknowledgement
        || props.uncertaintyAcknowledged === true;
    const operationPending = props.operationPending === true;
    const durableActionState = (enabled: boolean) => ({
        disabled: !enabled || operationPending,
        ...(operationPending ? { busy: true } : {}),
    });
    // The Protocol's continuation input is required and its text is non-empty,
    // so an unwritten continuation is refused here rather than rejected later.
    const continuationSubmittable = acknowledgementSatisfied
        && continuation.document.text.trim().length > 0
        && !operationPending;
    const replacementSubmittable = acknowledgementSatisfied
        && replacement.document.text.trim().length > 0
        && !operationPending;
    const retryable = acknowledgementSatisfied && !operationPending;
    const pendingRequests = projectWorkflowInvocationRequests(props.progress);
    const attempt = props.progress === null ? null : describeWorkflowInvocationAttempt(props.progress.attempt);
    // A step that executed and reported no usage is explicitly unavailable
    // (UX-26), never zero and never silently absent. A container frame runs no
    // agent of its own, so it has no usage row; an unopened row has nothing to
    // say yet.
    const usageLabel = props.progress === null || props.progress.blockKind !== 'step'
        ? null
        : props.progress.usage === undefined
            ? t('workflows.run.usageUnavailable')
            : formatWorkflowUsageLabel(props.progress.usage, {
                tokens: t('usage.tokens'),
                input: t('usage.tokenMix.input'),
                output: t('usage.tokenMix.output'),
            });

    return (
        <View testID={`${testIDPrefix}-selected-detail`} style={styles.section}>
            {props.contentUnavailable === true ? (
                <Text testID={`${testIDPrefix}-content-unavailable`} style={styles.provenance}>
                    {t('workflows.contentUnavailable')}
                </Text>
            ) : null}
            {/* A retried attempt says which one it is, in the same words as its row. */}
            {attempt?.retried ? (
                <Text testID={`${testIDPrefix}-invocation-attempt`} style={styles.provenance}>
                    {attempt.label}
                </Text>
            ) : null}
            {props.progress?.reason?.message === undefined ? null : (
                <Text style={styles.provenance}>{props.progress.reason.message}</Text>
            )}
            {pendingRequests.length === 0 ? null : (
                <View testID={`${testIDPrefix}-permission-requests`} style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('workflows.run.needsYou')}</Text>
                    {pendingRequests.map((request) => {
                        if (request.kind === 'user_action') {
                            return (
                                <WorkflowQuestionRequest
                                    key={request.requestId}
                                    request={request}
                                    testIDPrefix={testIDPrefix}
                                    responding={props.pendingPermissionRequestIds?.has(request.requestId) === true}
                                    onAnswer={props.onAnswerQuestion}
                                />
                            );
                        }
                        const responding = props.pendingPermissionRequestIds?.has(request.requestId) === true;
                        return (
                            <View key={request.requestId} style={styles.section}>
                                <Text testID={`${testIDPrefix}-permission-${request.requestId}`} style={styles.detailValue} selectable>
                                    {request.tool}
                                    {request.arguments === undefined ? '' : `\n${JSON.stringify(request.arguments, null, 2)}`}
                                </Text>
                                {props.onRespondPermission === undefined ? null : (
                                    <View style={styles.actions}>
                                        <Pressable
                                            testID={`${testIDPrefix}-permission-${request.requestId}-allow`}
                                            accessibilityRole="button"
                                            accessibilityState={{ disabled: responding, busy: responding }}
                                            disabled={responding}
                                            onPress={() => {
                                                if (responding) return;
                                                props.onRespondPermission?.({ requestId: request.requestId, approved: true });
                                            }}
                                            style={styles.actionTarget}
                                        >
                                            <Text style={responding ? styles.provenance : styles.action}>
                                                {t('notifications.actions.allow')}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            testID={`${testIDPrefix}-permission-${request.requestId}-deny`}
                                            accessibilityRole="button"
                                            accessibilityState={{ disabled: responding, busy: responding }}
                                            disabled={responding}
                                            onPress={() => {
                                                if (responding) return;
                                                props.onRespondPermission?.({ requestId: request.requestId, approved: false });
                                            }}
                                            style={styles.actionTarget}
                                        >
                                            <Text style={responding ? styles.provenance : styles.action}>
                                                {t('notifications.actions.deny')}
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        );
                    })}
                </View>
            )}
            {recovery.remainingNotStartedSiblingCount === null
                || recovery.remainingNotStartedSiblingCount === 0 ? null : (
                    <Text testID={`${testIDPrefix}-remaining-not-started`} style={styles.provenance}>
                        {t('workflows.recovery.remainingNotStarted', {
                            count: recovery.remainingNotStartedSiblingCount,
                        })}
                    </Text>
                )}
            {props.progress?.input === undefined ? null : (
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('workflows.input.label')}</Text>
                    <Text testID={`${testIDPrefix}-invocation-input`} style={styles.detailValue} selectable>
                        {typeof props.progress.input === 'string'
                            ? props.progress.input
                            : JSON.stringify(props.progress.input, null, 2)}
                    </Text>
                </View>
            )}
            {props.progress?.result === undefined ? null : (
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('workflows.finalOutput.title')}</Text>
                    <Text testID={`${testIDPrefix}-invocation-result`} style={styles.detailValue} selectable>
                        {typeof props.progress.result === 'string'
                            ? props.progress.result
                            : JSON.stringify(props.progress.result, null, 2)}
                    </Text>
                </View>
            )}
            {usageLabel === null ? null : (
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('usage.tokens')}</Text>
                    <Text testID={`${testIDPrefix}-invocation-usage`} style={styles.detailValue}>
                        {usageLabel}
                    </Text>
                </View>
            )}
            {recovery.workspaceUnavailable ? (
                <View style={styles.section}>
                    {/*
                      * Exactly one of D4's arms is reachable, so the copy names
                      * that one. Restoring keeps this Run's completed work;
                      * only the reviewed new Run can repeat it, and saying so
                      * unconditionally warned people away from the recovery
                      * that loses nothing.
                      */}
                    <Text testID={`${testIDPrefix}-workspace-unavailable-body`} style={styles.provenance}>
                        {recovery.canRestoreWorkspace
                            ? t('workflows.workspace.unavailableRestoreBody')
                            : recovery.canStartReviewedNewRun
                                ? t('workflows.workspace.unavailableNewRunBody')
                                : t('workflows.workspace.unavailableBody')}
                    </Text>
                    {!recovery.canRestoreWorkspace || props.onRestoreWorkspace === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-restore-workspace`}
                            accessibilityRole="button"
                            accessibilityState={durableActionState(true)}
                            disabled={operationPending}
                            onPress={props.onRestoreWorkspace}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.workspace.restore')}</Text>
                        </Pressable>
                    )}
                    {!recovery.canStartReviewedNewRun || props.onStartReviewedNewRun === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-start-reviewed-new-run`}
                            accessibilityRole="button"
                            onPress={props.onStartReviewedNewRun}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.recovery.startReviewedRun')}</Text>
                        </Pressable>
                    )}
                </View>
            ) : null}
            {workspace === null ? null : (
                <View testID={`${testIDPrefix}-workspace`} style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('workflows.workspace.title')}</Text>
                    <Text
                        testID={`${testIDPrefix}-workspace-path`}
                        style={styles.detailValue}
                        selectable
                    >
                        {workspace.displayDirectory}
                    </Text>
                    {workspace.checkoutRootPath === workspace.directory ? null : (
                        <Text testID={`${testIDPrefix}-workspace-checkout-root`} style={styles.provenance}>
                            {t('workflows.workspace.projectCheckout')}: {workspace.displayCheckoutRootPath}
                        </Text>
                    )}
                    {workspace.branchName === null ? null : (
                        <Text testID={`${testIDPrefix}-workspace-branch`} style={styles.provenance}>
                            {t('workflows.editor.branch')}: {workspace.branchName}
                        </Text>
                    )}
                    {props.workspaceSourceLabel === null ? null : (
                        <Text testID={`${testIDPrefix}-workspace-source`} style={styles.provenance}>
                            {t('workflows.workspace.fromStep', { block: props.workspaceSourceLabel })}
                        </Text>
                    )}
                    <View style={styles.actions}>
                        {props.onCopyWorkspace === undefined ? null : (
                            <ToolbarButton
                                testID={`${testIDPrefix}-copy-workspace`}
                                label={t('files.repositoryTree.actions.copyPath')}
                                onPress={() => props.onCopyWorkspace?.(workspace.directory)}
                                size="md"
                                style={styles.actionTarget}
                            />
                        )}
                        {workspace.workspaceRefId === null || props.onOpenWorkspace === undefined ? null : (
                            <ToolbarButton
                                testID={`${testIDPrefix}-open-workspace`}
                                label={t('sessionInfo.openWorkspaceTitle')}
                                onPress={() => props.onOpenWorkspace?.(
                                    workspace.workspaceRefId!,
                                    workspace.directory,
                                )}
                                size="md"
                                style={styles.actionTarget}
                            />
                        )}
                    </View>
                </View>
            )}
            {execution?.kind === 'session'
                && recovery.canInspectExecution
                && props.onOpenSession !== undefined ? (
                    <Pressable
                        testID={`${testIDPrefix}-open-session`}
                        accessibilityRole="link"
                        onPress={() => props.onOpenSession?.(execution.sessionId)}
                        style={styles.actionTarget}
                    >
                        <Text style={styles.action}>{t('workflows.run.openSourceSession')}</Text>
                    </Pressable>
                ) : null}
            {execution !== undefined
                && recovery.canInspectExecution
                && execution.kind !== 'session'
                && props.onOpenExecutionRun !== undefined ? (
                    <Pressable
                        testID={`${testIDPrefix}-open-execution-run`}
                        accessibilityRole="link"
                        onPress={() => props.onOpenExecutionRun?.(execution.runId)}
                        style={styles.actionTarget}
                    >
                        <Text style={styles.action}>{t('workflows.run.openExecution')}</Text>
                    </Pressable>
                ) : null}
            {!recovery.canReattach || props.onReattach === undefined ? null : (
                <View style={styles.section}>
                    <Pressable
                        testID={`${testIDPrefix}-reattach`}
                        accessibilityRole="button"
                        accessibilityState={durableActionState(true)}
                        disabled={operationPending}
                        onPress={props.onReattach}
                        style={styles.actionTarget}
                    >
                        <Text style={styles.action}>{t('workflows.recovery.reattach')}</Text>
                    </Pressable>
                    <Text style={styles.provenance}>{t('workflows.recovery.reattachExplain')}</Text>
                </View>
            )}

            {/*
              * Uncertain prior effects are acknowledged for this exact attempt,
              * beside the operation they gate — never as a blanket setting and
              * never inherited from a sibling selection.
              */}
            {recovery.requiresUncertaintyAcknowledgement
                && props.onAcknowledgeUncertainPriorEffects !== undefined ? (
                    <View testID={`${testIDPrefix}-uncertain-effects`} style={styles.section}>
                        <Text style={styles.provenance}>
                            {t('workflows.recovery.uncertainEffects', {
                                block: props.workspaceSourceLabel ?? t('workflows.run.untitled'),
                            })}
                        </Text>
                        <Pressable
                            testID={`${testIDPrefix}-acknowledge-uncertain`}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: props.uncertaintyAcknowledged === true }}
                            accessibilityLabel={t('workflows.recovery.acknowledgeEffects')}
                            onPress={props.onAcknowledgeUncertainPriorEffects}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.recovery.acknowledgeEffects')}</Text>
                        </Pressable>
                    </View>
                ) : null}

            {/*
              * A prepared continuation: the execution owner already resolved the
              * objective, result contract and recorded context, so Continue is
              * one press. Editing it is the disclosed advanced path.
              */}
            {recovery.canContinuePrepared
                && prepared !== null
                && props.onContinuePrepared !== undefined ? (
                    <View testID={`${testIDPrefix}-prepared-recovery`} style={styles.section}>
                        <Text style={styles.provenance}>
                            {prepared.conversation === 'same_conversation'
                                ? t('workflows.recovery.resumeSameConversationExplain', {
                                    block: props.workspaceSourceLabel ?? t('workflows.run.untitled'),
                                })
                                : t('workflows.recovery.freshAgentExplain')}
                        </Text>
                        <Pressable
                            testID={`${testIDPrefix}-edit-continuation`}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: continuation.open }}
                            onPress={continuation.toggle}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.recovery.editContinuation')}</Text>
                        </Pressable>
                        {continuation.open ? (
                            <MultiTextInput
                                testID={`${testIDPrefix}-continuation-input`}
                                value={continuation.text}
                                onChangeText={continuation.setText}
                                placeholder={t('workflows.recovery.continuationPlaceholder')}
                                accessibilityLabel={t('workflows.recovery.continuationPlaceholder')}
                                submitBehavior="newline"
                            />
                        ) : null}
                        <Pressable
                            testID={`${testIDPrefix}-continue-prepared`}
                            accessibilityRole="button"
                            accessibilityState={durableActionState(continuationSubmittable)}
                            disabled={!continuationSubmittable}
                            onPress={() => {
                                if (!continuationSubmittable) return;
                                props.onContinuePrepared?.({
                                    conversation: prepared.conversation,
                                    document: continuation.document,
                                    input: continuation.input,
                                });
                            }}
                            style={styles.actionTarget}
                        >
                            <Text style={continuationSubmittable ? styles.action : styles.provenance}>
                                {prepared.conversation === 'same_conversation'
                                    ? t('workflows.recovery.resumeSameConversation')
                                    : t('workflows.recovery.freshAgent')}
                            </Text>
                        </Pressable>
                    </View>
                ) : null}

            {recovery.canRetrySameConversation && props.onRetrySameConversation !== undefined ? (
                <Pressable
                    testID={`${testIDPrefix}-retry-same`}
                    accessibilityRole="button"
                    accessibilityState={durableActionState(retryable)}
                    disabled={!retryable}
                    onPress={() => {
                        if (!retryable) return;
                        props.onRetrySameConversation?.();
                    }}
                    style={styles.actionTarget}
                >
                    <Text style={retryable ? styles.action : styles.provenance}>
                        {t('workflows.recovery.resumeSameConversation')}
                    </Text>
                </Pressable>
            ) : null}
            {recovery.canRetryFreshAgent && props.onRetryFreshAgent !== undefined ? (
                <Pressable
                    testID={`${testIDPrefix}-retry-fresh`}
                    accessibilityRole="button"
                    accessibilityState={durableActionState(retryable)}
                    disabled={!retryable}
                    onPress={() => {
                        if (!retryable) return;
                        props.onRetryFreshAgent?.();
                    }}
                    style={styles.actionTarget}
                >
                    <Text style={retryable ? styles.action : styles.provenance}>
                        {t('workflows.recovery.freshAgent')}
                    </Text>
                </Pressable>
            ) : null}
            {/* Retry distinguishes repeating the original input from an inspected replacement. */}
            {(recovery.canRetrySameConversation || recovery.canRetryFreshAgent)
                && props.onRetryWithReplacement !== undefined ? (
                    <View testID={`${testIDPrefix}-retry-replacement`} style={styles.section}>
                        <Pressable
                            testID={`${testIDPrefix}-use-replacement-input`}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: replacement.open }}
                            onPress={replacement.toggle}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.recovery.useReplacementInput')}</Text>
                        </Pressable>
                        {replacement.open ? (
                            <>
                                <MultiTextInput
                                    testID={`${testIDPrefix}-replacement-input`}
                                    value={replacement.text}
                                    onChangeText={replacement.setText}
                                    placeholder={t('workflows.recovery.continuationPlaceholder')}
                                    accessibilityLabel={t('workflows.recovery.continuationPlaceholder')}
                                    submitBehavior="newline"
                                />
                                {replacementConversationChoices.length < 2 ? null : (
                                    <View
                                        accessibilityRole="radiogroup"
                                        accessibilityLabel={t('workflows.conversation.title')}
                                        style={styles.actions}
                                    >
                                        {replacementConversationChoices.map((choice) => (
                                            <Pressable
                                                key={choice}
                                                testID={`${testIDPrefix}-replacement-conversation-${choice}`}
                                                accessibilityRole="radio"
                                                accessibilityState={{
                                                    selected: effectiveReplacementConversation === choice,
                                                }}
                                                accessibilityLabel={choice === 'same_conversation'
                                                    ? t('workflows.recovery.resumeSameConversation')
                                                    : t('workflows.recovery.freshAgent')}
                                                onPress={() => setReplacementConversation(choice)}
                                                style={styles.actionTarget}
                                            >
                                                <Text style={effectiveReplacementConversation === choice
                                                    ? styles.action
                                                    : styles.provenance}
                                                >
                                                    {choice === 'same_conversation'
                                                        ? t('workflows.recovery.resumeSameConversation')
                                                        : t('workflows.recovery.freshAgent')}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                                <Pressable
                                    testID={`${testIDPrefix}-submit-replacement`}
                                    accessibilityRole="button"
                                    accessibilityState={durableActionState(replacementSubmittable)}
                                    disabled={!replacementSubmittable}
                                    onPress={() => {
                                        if (!replacementSubmittable) return;
                                        props.onRetryWithReplacement?.({
                                            conversation: effectiveReplacementConversation,
                                            document: replacement.document,
                                            input: replacement.input,
                                        });
                                    }}
                                    style={styles.actionTarget}
                                >
                                    <Text style={styles.action}>{t('workflows.run.retryStep')}</Text>
                                </Pressable>
                            </>
                        ) : null}
                    </View>
                ) : null}
            {recovery.waitingForStop ? (
                <Text testID={`${testIDPrefix}-recovery-waiting-for-stop`} style={styles.provenance}>
                    {t('workflows.recovery.waitingForStop')}
                </Text>
            ) : null}
        </View>
    );
}

function WorkflowQuestionRequest(props: Readonly<{
    request: WorkflowInvocationRequest;
    testIDPrefix: string;
    responding: boolean;
    onAnswer?: WorkflowInvocationDetailProps['onAnswerQuestion'];
}>): React.ReactElement {
    const [answers, setAnswers] = React.useState<Record<string, readonly string[]>>({});
    const [customAnswers, setCustomAnswers] = React.useState<Record<string, string>>({});
    const updateAnswer = React.useCallback((answerKey: string, values: readonly string[]) => {
        setAnswers((current) => ({ ...current, [answerKey]: values }));
    }, []);
    const complete = props.request.questions.every((question) => (
        !question.required
        || (answers[question.answerKey]?.length ?? 0) > 0
        || (customAnswers[question.answerKey]?.length ?? 0) > 0
    ));
    const submittedAnswers = React.useMemo<StructuredQuestionAnswersV1>(() => Object.fromEntries(
        props.request.questions.flatMap((question) => {
            const selected = answers[question.answerKey] ?? [];
            const custom = customAnswers[question.answerKey] ?? '';
            const values = question.selection === 'multiple'
                ? custom.length > 0 ? [...selected, custom] : selected
                : custom.length > 0 ? [custom] : selected;
            return values.length > 0 ? [[question.answerKey, values] as const] : [];
        }),
    ), [answers, customAnswers, props.request.questions]);
    return (
        <View testID={`${props.testIDPrefix}-question-${props.request.requestId}`} style={styles.section}>
            {props.request.questions.map((question, questionIndex) => (
                <View key={`${question.answerKey}-${questionIndex}`} style={styles.section}>
                    {question.header === undefined || question.header === null ? null : (
                        <Text style={styles.sectionLabel}>{question.header}</Text>
                    )}
                    <Text style={styles.detailValue} selectable>{question.question}</Text>
                    {question.choices.map((choice, choiceIndex) => {
                        const selected = answers[question.answerKey]?.includes(choice.value) === true;
                        return (
                            <Pressable
                                key={`${choice.value}-${choiceIndex}`}
                                testID={`${props.testIDPrefix}-question-${props.request.requestId}-choice-${choiceIndex}`}
                                accessibilityRole={question.selection === 'multiple' ? 'checkbox' : 'radio'}
                                accessibilityState={{ checked: selected, disabled: props.responding }}
                                disabled={props.responding}
                                onPress={() => updateAnswer(
                                    question.answerKey,
                                    question.selection === 'multiple'
                                        ? selected
                                            ? (answers[question.answerKey] ?? []).filter((value) => value !== choice.value)
                                            : [...(answers[question.answerKey] ?? []), choice.value]
                                        : [choice.value],
                                )}
                                style={styles.actionTarget}
                            >
                                <Text style={selected ? styles.action : styles.detailKey}>{choice.label}</Text>
                                {choice.description === undefined || choice.description === null ? null : (
                                    <Text style={styles.provenance}>{choice.description}</Text>
                                )}
                            </Pressable>
                        );
                    })}
                    {question.selection === 'text' || question.allowCustom ? (
                        <MultiTextInput
                            testID={`${props.testIDPrefix}-question-${props.request.requestId}-freeform`}
                            value={customAnswers[question.answerKey] ?? ''}
                            onChangeText={(value) => setCustomAnswers((current) => ({ ...current, [question.answerKey]: value }))}
                            placeholder={question.freeformPlaceholder
                                ?? question.freeformDescription
                                ?? t('notifications.activity.requestLabels.customAnswer')}
                            editable={!props.responding}
                        />
                    ) : null}
                </View>
            ))}
            {props.onAnswer === undefined ? null : (
                <Pressable
                    testID={`${props.testIDPrefix}-question-${props.request.requestId}-submit`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !complete || props.responding, busy: props.responding }}
                    disabled={!complete || props.responding}
                    onPress={() => props.onAnswer?.({ requestId: props.request.requestId, answers: submittedAnswers })}
                    style={styles.actionTarget}
                >
                    <Text style={!complete || props.responding ? styles.provenance : styles.action}>
                        {t('tools.askUserQuestion.submit')}
                    </Text>
                </Pressable>
            )}
        </View>
    );
}
