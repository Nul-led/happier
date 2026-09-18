import * as React from 'react';
import {
    Pressable,
    ScrollView,
    View,
    useWindowDimensions,
    type GestureResponderEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type StyleProp,
    type ViewStyle,
} from 'react-native';

import {
    isWorkflowResultDeliveryUnavailableV1,
    type StructuredQuestionAnswersV1,
    type WorkflowDefinitionV1,
    type WorkflowInvocationRecoveryV1,
    type WorkflowRunInvocationIndexV1,
    type WorkflowRunSummaryV1,
    type WorkflowProgressEnvelopeV1,
} from '@happier-dev/protocol';

import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { WorkflowRunStateStatus } from '@/components/workflows/presentation/WorkflowLifecycleStatus';
import {
    WORKFLOW_ATTENTION_LIFECYCLES,
    isTerminalWorkflowRunState,
    summarizeWorkflowInvocationCoverage,
} from '@/components/workflows/presentation/workflowLifecyclePresentation';
import { t } from '@/text';
import {
    indexWorkflowFlowRunStates,
    projectWorkflowFlow,
    type WorkflowFlowNodeRunState,
} from '@/components/workflows/flow/workflowFlowProjection';
import { WorkflowFlowView } from '@/components/workflows/flow/WorkflowFlowView';
import type { VirtualizedListRef } from '@/components/ui/lists/virtualized';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { readPressFocusReturnTarget, type FocusReturnTarget } from '@/keyboard/focusReturn';
import type { CustomModalInjectedProps } from '@/modal';
import { resolveViewportClass } from '@/utils/platform/viewportClass';

import { WorkflowInvocationDetail, type WorkflowInvocationDetailProps } from './WorkflowInvocationDetail';
import { useWorkflowCardModal } from './useWorkflowCardModal';
import { WorkflowInvocationList } from './WorkflowInvocationList';
import {
    projectWorkflowInvocationStructure,
    type WorkflowInvocationStructureEntry,
    type WorkflowOccurrenceCoordinate,
} from './workflowInvocationStructure';
import { workflowRunStyles as styles } from './workflowRunStyles';
import {
    formatWorkflowRunOriginLabel,
    formatWorkflowRunOutcomeLabel,
    formatWorkflowRunOutcomeSentence,
    formatWorkflowWorkspaceSourceLabel,
    projectWorkflowInvocationRecovery,
    type WorkflowRecoveryContinuation,
} from './workflowRunDetailPresentation';

/**
 * One managed Run's detail body, shared by the exact Run route, the Automation
 * provenance wrapper and any agent-origin entry.
 *
 * Composition is outcome first: what happened, then what needs you, then the
 * timeline, then technical detail behind deliberate disclosure. Nothing here
 * derives a lifecycle — every status comes from the canonical projection the
 * caller was handed, and a control shows the durable intent it submitted rather
 * than claiming the effect already applied.
 */

export type WorkflowRunDetailView = 'activity' | 'flow';

/**
 * The durable operations a Run accepts against its `expectedRevision`. The
 * host issues one at a time; while any is unsettled every other one is
 * withdrawn here as busy, so the person cannot race their own request.
 */
export type WorkflowRunOperationKind =
    | 'pause'
    | 'resume'
    | 'cancel'
    | 'retry'
    | 'continue'
    | 'reattach'
    | 'restore_workspace'
    | 'delete';

export type WorkflowRunContentProps = Readonly<{
    run: WorkflowRunSummaryV1;
    /** Frozen Account-private title; null means explicitly unavailable. */
    title?: string | null;
    /** The frozen Machine's display name, as the machine owner resolves it; absent keeps the exact id. */
    machineName?: string | null;
    /** The frozen definition this Run was admitted with, when it has been read. */
    definition: WorkflowDefinitionV1 | null;
    invocations: readonly WorkflowRunInvocationIndexV1[];
    invocationsLoaded: boolean;
    /** True only after the unfiltered history cursor is exhausted. */
    invocationHistoryComplete: boolean;
    selectedInvocationId: string | null;
    onSelectInvocation: (invocationId: string) => void;
    /**
     * The compact layout presents the selected detail as a modal; closing it
     * releases the selection through the same owner that made it.
     */
    onDeselectInvocation?: () => void;
    onLoadMoreInvocations?: () => void;
    loadingMoreInvocations?: boolean;
    /**
     * The next page of that window could not be loaded. Loaded rows stay; this
     * only replaces the paging action with the reason and a Retry that asks for
     * exactly the same page again.
     */
    loadMoreInvocationsFailed?: boolean;
    onLoadMoreAttention?: () => void;
    loadingMoreAttention?: boolean;
    loadMoreAttentionFailed?: boolean;
    view: WorkflowRunDetailView;
    onChangeView: (view: WorkflowRunDetailView) => void;
    /** Present only when the canonical availability projection permits it. */
    onPause?: () => void;
    onResume?: () => void;
    onCancel?: () => void;
    /**
     * The durable operation the host submitted whose settlement is not yet
     * authoritative. Its own control names the request ("Stopping…"); every
     * other durable control is busy until it settles.
     */
    pendingControl?: WorkflowRunOperationKind | null;
    /** Provider usage, or `null` when the provider supplied none. */
    usageLabel?: string | null;
    resultLabel?: string | null;
    /** Exact final-output producer from the encrypted terminal result owner. */
    finalOutputInvocationId?: string | null;
    /** Earliest failed row from the lifecycle-indexed query owner. */
    firstFailedInvocationId?: string | null;
    /**
     * Whether the authoritative lifecycle-indexed failure query has settled.
     * Omitted retains the compatibility path for callers that only have a
     * complete local history window.
     */
    firstFailedInvocationResolution?: 'loading' | 'resolved' | 'error';
    selectedInvocationProgress?: WorkflowProgressEnvelopeV1 | null;
    invocationProgressById?: ReadonlyMap<string, WorkflowProgressEnvelopeV1>;
    /**
     * Navigable identity for every loaded row, derived by the canonical
     * structure owner from the frozen definition plus the public index. The
     * host supplies it because it also announces selection; when a caller does
     * not, this body derives it through that same owner rather than inventing a
     * second mapping.
     */
    invocationStructure?: ReadonlyMap<string, WorkflowInvocationStructureEntry>;
    onOpenSession?: (sessionId: string) => void;
    onOpenExecutionRun?: (runId: string) => void;
    onRespondPermission?: (request: Readonly<{ requestId: string; approved: boolean }>) => void;
    onAnswerQuestion?: (request: Readonly<{ requestId: string; answers: StructuredQuestionAnswersV1 }>) => void;
    /**
     * Requests whose decision the host has sent and not seen settle. Their
     * controls are withdrawn so an opposite press cannot race that answer.
     */
    pendingPermissionRequestIds?: ReadonlySet<string>;
    workspaceHomeDirectory?: string | null;
    onCopyWorkspace?: (directory: string) => void;
    onOpenWorkspace?: (workspaceRefId: string, directory: string) => void;
    onRetrySameConversation?: () => void;
    onRetryFreshAgent?: () => void;
    /** Repeat the selected attempt with an input the person reviewed instead of the original. */
    onRetryWithReplacement?: (input: WorkflowRecoveryContinuation) => void;
    onReattach?: () => void;
    /**
     * The continuation the execution owner already prepared for this attempt:
     * its objective, result contract and selected recorded context. Ordinary
     * recovery therefore needs no prompt reconstruction.
     *
     * The host projects this from the same opened progress this body projects
     * its recovery from, and supplies it so the host's decision to offer
     * `onContinuePrepared` and this body's presentation cannot disagree.
     */
    preparedRecovery?: WorkflowInvocationRecoveryV1 | null;
    onContinuePrepared?: (choice: WorkflowRecoveryContinuation) => void;
    /**
     * Whether this exact attempt's unknown prior effects have been acknowledged.
     * Continuation and retry stay refused until they are; no blanket consent
     * exists and the acknowledgement never survives a change of selection.
     */
    uncertaintyAcknowledged?: boolean;
    onAcknowledgeUncertainPriorEffects?: () => void;
    onStartReviewedNewRun?: () => void;
    onRestoreWorkspace?: () => void;
    onDelete?: () => void;
    onRunAgain?: () => void;
    onSaveAsWorkflow?: () => void;
    saveAsWorkflowPending?: boolean;
    deleteBlockedByCustody?: boolean;
    /**
     * True only while this mounted instance is showing the completion moment it
     * observed. Its owner is `useWorkflowCompletionMoment`, which decides the
     * haptic and this emphasis together and resolves reduced motion to the
     * final semantic state with no emphasis at all.
     */
    completionEmphasis?: boolean;
    errorLabel?: string | null;
    /** Re-run the screen's one canonical detail/index/attention load. */
    onReload?: () => void;
    selectedContentUnavailable?: boolean;
    contentContainerStyle?: StyleProp<ViewStyle>;
    testIDPrefix?: string;
}>;

/**
 * The compact-layout presentation of the selected detail: the same component
 * the wide inspector renders, handed to the canonical modal owner.
 */
function WorkflowInvocationDetailModal(
    props: WorkflowInvocationDetailProps & CustomModalInjectedProps,
): React.ReactElement {
    return <WorkflowInvocationDetail {...props} />;
}

/**
 * The paging control for this body's two inline paging sites.
 *
 * A continuation that failed is not a lost window: every row already read
 * stays, and only the action becomes its reason plus a Retry for exactly the
 * same page. A page in flight withdraws the action rather than letting a second
 * press ask again.
 */
function WorkflowRunPagingAction(props: Readonly<{
    testIDPrefix: string;
    onLoadMore: () => void;
    loading: boolean;
    failed: boolean;
}>): React.ReactElement {
    if (props.failed) {
        return (
            <View
                testID={`${props.testIDPrefix}-load-more-error`}
                accessibilityRole="alert"
                style={styles.section}
            >
                <Text style={styles.sectionLabel}>{t('workflows.loadFailedBody')}</Text>
                <Pressable
                    testID={`${props.testIDPrefix}-load-more-retry`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.retry')}
                    accessibilityState={{ disabled: props.loading }}
                    disabled={props.loading}
                    onPress={props.onLoadMore}
                    style={styles.actionTarget}
                >
                    <Text style={styles.action}>{t('workflows.retry')}</Text>
                </Pressable>
            </View>
        );
    }
    return (
        <Pressable
            testID={`${props.testIDPrefix}-load-more`}
            accessibilityRole="button"
            accessibilityState={{ disabled: props.loading }}
            disabled={props.loading}
            onPress={props.onLoadMore}
            style={styles.actionTarget}
        >
            <Text style={styles.action}>
                {props.loading ? t('common.loading') : t('workflows.run.loadMore')}
            </Text>
        </Pressable>
    );
}

export function WorkflowRunContent(props: WorkflowRunContentProps): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-run';
    const [technicalOpen, setTechnicalOpen] = React.useState(false);
    const operationPending = props.pendingControl !== null && props.pendingControl !== undefined;
    const maxWidthStyle = useLayoutMaxWidthStyle();
    /**
     * Wide layouts keep the selected detail in a neighbouring inspector beside
     * the outline; compact ones present it through the canonical modal (UX
     * §3.2, §4.5). Both read the same selection and the same reviewed buffers.
     */
    const compactLayout = resolveViewportClass(useWindowDimensions()) === 'compact';
    /**
     * Where focus returns when the compact modal closes: the exact row or node
     * whose press selected the invocation. Recorded at the press, because by
     * the time the modal opens the selection has already moved.
     */
    const detailFocusReturnRef = React.useRef<FocusReturnTarget>(null);
    const { onSelectInvocation } = props;
    const selectInvocation = React.useCallback((invocationId: string, event?: GestureResponderEvent) => {
        detailFocusReturnRef.current = readPressFocusReturnTarget(event);
        onSelectInvocation(invocationId);
    }, [onSelectInvocation]);
    /**
     * Half-written recovery text, owned above the selected detail.
     *
     * The buffers are keyed by the exact invocation, so they can never be shown
     * against a different attempt, and they outlive the detail's presentation:
     * a resize that moves the detail between the inspector and the modal, or a
     * Run change, cannot lose someone's own words. This is the one reviewed
     * buffer, not a second recovery store, and nothing here is persisted.
     */
    const [recoveryTextByInvocationId, setRecoveryTextByInvocationId] = React.useState<
        ReadonlyMap<string, Readonly<{ continuation?: string; replacement?: string }>>
    >(() => new Map());
    const selectedRecoveryText = props.selectedInvocationId === null
        ? undefined
        : recoveryTextByInvocationId.get(props.selectedInvocationId);
    const setSelectedRecoveryText = React.useCallback((
        field: 'continuation' | 'replacement',
        next: string,
    ) => {
        const invocationId = props.selectedInvocationId;
        if (invocationId === null) return;
        setRecoveryTextByInvocationId((current) => {
            const updated = new Map(current);
            updated.set(invocationId, { ...current.get(invocationId), [field]: next });
            return updated;
        });
    }, [props.selectedInvocationId]);
    const activityListRef = React.useRef<VirtualizedListRef | null>(null);
    const activityScrollOffsetRef = React.useRef(0);
    const flowScrollRef = React.useRef<ScrollView | null>(null);
    const flowScrollOffsetRef = React.useRef(0);
    const captureActivityScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        activityScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    }, []);
    const captureFlowScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        flowScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    }, []);
    React.useEffect(() => {
        if (props.view !== 'activity' || activityScrollOffsetRef.current <= 0) return;
        void activityListRef.current?.scrollToOffset({
            offset: activityScrollOffsetRef.current,
            animated: false,
        });
    }, [props.view]);
    React.useEffect(() => {
        if (props.view !== 'flow' || flowScrollOffsetRef.current <= 0) return;
        flowScrollRef.current?.scrollTo({
            y: flowScrollOffsetRef.current,
            animated: false,
        });
    }, [props.view]);
    const coverage = React.useMemo(
        () => summarizeWorkflowInvocationCoverage(props.invocations),
        [props.invocations],
    );
    const attentionRows = React.useMemo(
        () => props.invocations.filter((entry) => WORKFLOW_ATTENTION_LIFECYCLES.includes(entry.lifecycle)),
        [props.invocations],
    );
    const deliveryUnavailable = isWorkflowResultDeliveryUnavailableV1(props.run.workflowResultDeliveryState)
        ? props.run.workflowResultDeliveryState
        : null;

    const flowProjection = React.useMemo(
        () => (props.definition === null ? null : projectWorkflowFlow(props.definition)),
        [props.definition],
    );
    const derivedStructure = React.useMemo(
        () => (props.invocationStructure !== undefined
            ? props.invocationStructure
            : projectWorkflowInvocationStructure({
                definition: props.definition,
                invocations: props.invocations,
                ...(props.invocationProgressById === undefined
                    ? {}
                    : { progressByInvocationId: props.invocationProgressById }),
            })),
        [props.definition, props.invocationProgressById, props.invocationStructure, props.invocations],
    );

    /**
     * Row identity comes from the authored definition, not from whether the
     * private detail has already been opened. A row the frozen definition
     * cannot place keeps the explicit unavailable treatment; the structural
     * root frame says what it is rather than borrowing that phrase.
     */
    const invocationLabel = React.useCallback((invocation: WorkflowRunInvocationIndexV1): string | null => {
        const entry = derivedStructure.get(invocation.id);
        if (entry === undefined) return null;
        if (entry.nodeId !== null && flowProjection !== null) {
            const node = flowProjection.nodesById.get(entry.nodeId);
            if (node !== undefined) return node.label;
        }
        return entry.blockId === '$root' ? t('workflows.run.untitled') : null;
    }, [derivedStructure, flowProjection]);

    const formatOccurrence = React.useCallback((
        occurrence: readonly WorkflowOccurrenceCoordinate[],
    ): string | undefined => {
        if (occurrence.length === 0) return undefined;
        return occurrence.map((coordinate) => {
            if (coordinate.kind === 'branch') {
                return flowProjection?.nodesById.get(`${coordinate.blockId}#${coordinate.branchId}`)?.label
                    ?? coordinate.branchId;
            }
            const noun = coordinate.kind === 'item'
                ? t('workflows.input.currentItem')
                : t('workflows.input.iteration');
            return `${noun} ${coordinate.index + 1}`;
        }).join(' / ');
    }, [flowProjection]);
    const overflowActions = React.useMemo((): ItemAction[] => {
        const actions: ItemAction[] = [];
        if (props.onSaveAsWorkflow !== undefined) actions.push({
            id: `${testIDPrefix}-save-as-workflow`,
            title: t('workflows.run.saveAsWorkflow'),
            icon: 'copy',
            disabled: props.saveAsWorkflowPending === true,
            onPress: props.onSaveAsWorkflow,
        });
        if (props.onDelete !== undefined) actions.push({
            id: `${testIDPrefix}-delete-history`,
            title: t('workflows.run.deleteHistory'),
            icon: 'trash',
            destructive: true,
            disabled: operationPending,
            onPress: props.onDelete,
        });
        return actions;
    }, [
        operationPending,
        props.onDelete,
        props.onSaveAsWorkflow,
        props.saveAsWorkflowPending,
        testIDPrefix,
    ]);
    const flowRunStates = React.useMemo(() => {
        if (flowProjection === null) return undefined;
        // Flow renders exactly the lifecycles the invocation owner supplied; it
        // never derives one from structure or timing. Which authored node a row
        // belongs to is the structure owner's answer, so an occurrence stays
        // selectable before its private detail has ever been opened. Structural
        // frames are scopes, not executions of their block, and are excluded.
        const states: WorkflowFlowNodeRunState[] = [];
        for (const invocation of props.invocations) {
            const entry = derivedStructure.get(invocation.id);
            if (entry === undefined || entry.nodeId === null || entry.isFrame) continue;
            const occurrenceLabel = formatOccurrence(entry.occurrence);
            states.push({
                nodeId: entry.nodeId,
                invocationId: invocation.id,
                lifecycle: invocation.lifecycle,
                attempt: invocation.attempt,
                ...(occurrenceLabel === undefined ? {} : { occurrenceLabel }),
            });
        }
        return indexWorkflowFlowRunStates(states);
    }, [derivedStructure, flowProjection, formatOccurrence, props.invocations]);

    /**
     * The terminal primary action (UX §3.3).
     *
     * Both arms navigate to an exact invocation the canonical structure owner
     * already resolved — the authored `finalOutput` producer, or the first
     * failed row — rather than to "the latest row". When the Run is terminal and
     * no selected final result exists, the absence is stated instead of implied.
     */
    const terminalOutcome = React.useMemo((): Readonly<{
        kind: 'open_result'; invocationId: string;
    } | {
        kind: 'see_failures'; invocationId: string;
    } | {
        kind: 'result_absent';
    }> | null => {
        if (!isTerminalWorkflowRunState(props.run.state)) return null;
        if (props.firstFailedInvocationResolution !== undefined
            && props.firstFailedInvocationResolution !== 'resolved') return null;
        const firstFailedInvocationId = props.firstFailedInvocationResolution === 'resolved'
            ? props.firstFailedInvocationId ?? null
            : props.firstFailedInvocationId === undefined
                ? props.invocations.find((invocation) => invocation.lifecycle === 'failed')?.id
                : props.firstFailedInvocationId;
        if (firstFailedInvocationId !== undefined && firstFailedInvocationId !== null) {
            return { kind: 'see_failures', invocationId: firstFailedInvocationId };
        }
        if (props.run.state === 'failed') return null;
        const producerBlockId = props.definition?.finalOutput?.producer.blockId ?? null;
        if (producerBlockId === null
            || props.resultLabel === null
            || props.resultLabel === undefined) return { kind: 'result_absent' };
        // The producing row is a fact the canonical Run owner reports with the
        // result; this consumer opens exactly that row. Deriving it from history
        // would pick an attempt nobody selected — a retried step has several
        // completed rows for one block — so its absence leaves the outcome
        // without a navigation action rather than pointing somewhere plausible.
        return props.finalOutputInvocationId === undefined || props.finalOutputInvocationId === null
            ? null
            : { kind: 'open_result', invocationId: props.finalOutputInvocationId };
    }, [props.definition, props.finalOutputInvocationId, props.firstFailedInvocationId, props.firstFailedInvocationResolution, props.invocations, props.resultLabel, props.run.state]);

    const outcomeLabel = formatWorkflowRunOutcomeLabel({
        state: props.run.state,
        coverage,
        historyComplete: props.invocationHistoryComplete,
    });
    const sourceSessionId = props.run.origin.kind === 'direct'
        ? props.run.origin.originSessionId ?? null
        : null;
    const selectedInvocation = props.selectedInvocationId === null
        ? null
        : props.invocations.find((invocation) => invocation.id === props.selectedInvocationId) ?? null;
    const recovery = React.useMemo(() => {
        const projected = projectWorkflowInvocationRecovery({
            run: props.run,
            invocation: selectedInvocation,
            progress: props.selectedInvocationProgress ?? null,
            machineHomeDirectory: props.workspaceHomeDirectory ?? null,
            invocations: props.invocations,
            invocationHistoryComplete: props.invocationHistoryComplete,
        });
        return props.preparedRecovery === undefined
            ? projected
            : { ...projected, preparedRecovery: props.preparedRecovery };
    }, [props.invocationHistoryComplete, props.invocations, props.preparedRecovery, props.run, selectedInvocation, props.selectedInvocationProgress, props.workspaceHomeDirectory]);
    const selectedWorkspace = recovery.workspace;
    const workspaceSourceBlockLabel = selectedWorkspace?.sourceBlockId === null
        || selectedWorkspace?.sourceBlockId === undefined
        ? null
        : flowProjection?.nodesById.get(selectedWorkspace.sourceBlockId)?.label
            ?? selectedWorkspace.sourceBlockId;
    const workspaceSourceLabel = workspaceSourceBlockLabel === null
        ? null
        : formatWorkflowWorkspaceSourceLabel(
            workspaceSourceBlockLabel,
            selectedWorkspace?.sourceInvocationRecordId ?? null,
        );

    const header = (
        <View style={styles.root}>
            <Text
                testID={`${testIDPrefix}-title`}
                style={styles.pageTitle}
                accessibilityRole="header"
            >
                {props.title ?? t('workflows.contentUnavailable')}
            </Text>
            <View
                testID={`${testIDPrefix}-outcome-region`}
                style={[styles.outcome, props.completionEmphasis === true ? styles.outcomeCompleted : null]}
                accessibilityRole="summary"
            >
                {props.completionEmphasis === true ? <View testID={`${testIDPrefix}-outcome-emphasis`} /> : null}
                <View style={styles.outcomeHeader}>
                    <WorkflowRunStateStatus
                        testID={`${testIDPrefix}-state`}
                        state={props.run.state}
                        label={outcomeLabel}
                    />
                    <Text testID={`${testIDPrefix}-origin`} style={styles.provenance}>
                        {formatWorkflowRunOriginLabel(props.run.origin)}
                    </Text>
                </View>

                <Text testID={`${testIDPrefix}-outcome`} style={styles.outcomeSentence}>
                    {formatWorkflowRunOutcomeSentence({
                        run: props.run,
                        coverage,
                        historyComplete: props.invocationHistoryComplete,
                    })}
                </Text>

                <Text testID={`${testIDPrefix}-usage`} style={styles.metric}>
                    {props.usageLabel ?? t('workflows.run.usageUnavailable')}
                </Text>
                {/* One final-output row: either the selected result, or its
                    explicit absence once the Run has settled. Never both. */}
                {terminalOutcome?.kind === 'result_absent' ? (
                    <Text testID={`${testIDPrefix}-result-absent`} style={styles.metric}>
                        {t('workflows.finalOutput.none')}
                    </Text>
                ) : props.resultLabel === null || props.resultLabel === undefined ? null : (
                    <Text testID={`${testIDPrefix}-result`} style={styles.metric}>{props.resultLabel}</Text>
                )}

                <View style={styles.actions}>
                    {terminalOutcome?.kind === 'open_result' ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-open-result`}
                            onPress={(event) => selectInvocation(terminalOutcome.invocationId, event)}
                            style={styles.actionTarget}
                            label={t('workflows.run.openResult')}
                            tone="primary"
                            size="md"
                        />
                    ) : null}
                    {terminalOutcome?.kind === 'see_failures' ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-see-failures`}
                            onPress={(event) => selectInvocation(terminalOutcome.invocationId, event)}
                            style={styles.actionTarget}
                            label={t('workflows.run.seeFailures')}
                            tone="primary"
                            size="md"
                        />
                    ) : null}
                    {props.run.availability.cancel && props.onCancel !== undefined ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-cancel`}
                            disabled={operationPending}
                            busy={operationPending}
                            onPress={props.onCancel}
                            label={props.pendingControl === 'cancel'
                                ? t('workflows.run.stopping')
                                : props.deleteBlockedByCustody ? t('workflows.run.stopAgain') : t('workflows.run.stop')}
                            tone="danger"
                            size="md"
                            style={styles.actionTarget}
                        />
                    ) : null}

                    {props.run.availability.pause && props.onPause !== undefined ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-pause`}
                            disabled={operationPending}
                            busy={operationPending}
                            onPress={props.onPause}
                            style={styles.actionTarget}
                            label={t('workflows.run.pauseAtBoundary')}
                            size="md"
                        />
                    ) : null}

                    {props.run.availability.resumeBoundary && props.onResume !== undefined ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-resume`}
                            disabled={operationPending}
                            busy={operationPending}
                            onPress={props.onResume}
                            style={styles.actionTarget}
                            label={t('workflows.run.resume')}
                            tone="primary"
                            size="md"
                        />
                    ) : null}

                    {props.onRunAgain !== undefined ? (
                        <ToolbarButton
                            testID={`${testIDPrefix}-run-again`}
                            onPress={props.onRunAgain}
                            style={styles.actionTarget}
                            label={t('workflows.run.runAgain')}
                            tone="primary"
                            size="md"
                        />
                    ) : null}
                    {sourceSessionId !== null && props.onOpenSession !== undefined ? (
                            <Pressable
                                testID={`${testIDPrefix}-open-origin-session`}
                                accessibilityRole="button"
                                onPress={() => props.onOpenSession?.(sourceSessionId)}
                                style={styles.actionTarget}
                            >
                                <Text style={styles.action}>{t('workflows.run.openSourceSession')}</Text>
                            </Pressable>
                        ) : null}
                    {overflowActions.length === 0 ? null : (
                        <ItemRowActions
                            title={t('common.moreActions')}
                            actions={overflowActions}
                            compactThreshold={Number.POSITIVE_INFINITY}
                            compactActionIds={[]}
                            overflowTriggerTestID={`${testIDPrefix}-overflow`}
                        />
                    )}
                </View>
                {props.deleteBlockedByCustody ? (
                    <Text testID={`${testIDPrefix}-custody-pending`} style={styles.provenance}>
                        {t('workflows.recovery.waitingForStop')}
                    </Text>
                ) : null}
                {props.errorLabel === null || props.errorLabel === undefined ? null : (
                    <Text testID={`${testIDPrefix}-error`} style={styles.provenance}>{props.errorLabel}</Text>
                )}
                {props.onReload === undefined ? null : (
                    <ToolbarButton
                        testID={`${testIDPrefix}-reload`}
                        label={t('common.retry')}
                        onPress={props.onReload}
                        style={styles.actionTarget}
                        size="md"
                    />
                )}
            </View>

            {deliveryUnavailable === null && attentionRows.length === 0 ? null : (
                <View testID={`${testIDPrefix}-needs-you`} style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('workflows.run.needsYou')}</Text>
                    {deliveryUnavailable === null ? null : (
                        <View testID={`${testIDPrefix}-result-delivery-unavailable`} style={styles.attentionRow}>
                            <Text style={styles.attentionLabel}>
                                {t('workflows.contentUnavailable')}
                                {deliveryUnavailable.reason ? ` (${deliveryUnavailable.reason})` : ''}
                            </Text>
                        </View>
                    )}
                    {attentionRows.map((invocation) => (
                        <Pressable
                            key={invocation.id}
                            testID={`${testIDPrefix}-needs-you-${invocation.id}`}
                            accessibilityRole="button"
                            onPress={(event) => selectInvocation(invocation.id, event)}
                            style={styles.attentionRow}
                        >
                            <Text style={styles.attentionLabel} numberOfLines={1}>
                                {invocationLabel(invocation) ?? t('workflows.contentUnavailable')}
                            </Text>
                            <Text style={styles.action}>{t('workflows.run.review')}</Text>
                        </Pressable>
                    ))}
                    {props.onLoadMoreAttention === undefined ? null : (
                        <WorkflowRunPagingAction
                            testIDPrefix={`${testIDPrefix}-needs-you`}
                            onLoadMore={props.onLoadMoreAttention}
                            loading={props.loadingMoreAttention === true}
                            failed={props.loadMoreAttentionFailed === true}
                        />
                    )}
                </View>
            )}

            <SegmentedTabBar
                testIDPrefix={`${testIDPrefix}-view`}
                accessibilityLabel={t('workflows.tabsAccessibility.activityFlow')}
                tabs={[
                    { id: 'activity' as const, label: t('workflows.tabs.activity') },
                    { id: 'flow' as const, label: t('workflows.tabs.flow') },
                ]}
                activeTabId={props.view}
                onSelectTab={props.onChangeView}
            />
        </View>
    );

    /**
     * The one selected detail, built once and handed to whichever presentation
     * the layout selects. A different attempt is a different review — the
     * reviewed continuation and its disclosure never carry across — which the
     * modal presenter honours through `identity` and the inspector through
     * `key`.
     */
    const detailProps = React.useMemo((): WorkflowInvocationDetailProps | null => (
        props.selectedInvocationId === null ? null : {
            continuationText: selectedRecoveryText?.continuation,
            onChangeContinuationText: (next) => setSelectedRecoveryText('continuation', next),
            replacementText: selectedRecoveryText?.replacement,
            onChangeReplacementText: (next) => setSelectedRecoveryText('replacement', next),
            progress: props.selectedInvocationProgress ?? null,
            recovery,
            workspaceSourceLabel,
            operationPending,
            testIDPrefix,
            ...(props.selectedContentUnavailable === undefined
                ? {}
                : { contentUnavailable: props.selectedContentUnavailable }),
            ...(props.onOpenSession === undefined ? {} : { onOpenSession: props.onOpenSession }),
            ...(props.onOpenExecutionRun === undefined
                ? {}
                : { onOpenExecutionRun: props.onOpenExecutionRun }),
            ...(props.onRespondPermission === undefined
                ? {}
                : { onRespondPermission: props.onRespondPermission }),
            ...(props.onAnswerQuestion === undefined
                ? {}
                : { onAnswerQuestion: props.onAnswerQuestion }),
            ...(props.pendingPermissionRequestIds === undefined
                ? {}
                : { pendingPermissionRequestIds: props.pendingPermissionRequestIds }),
            ...(props.onCopyWorkspace === undefined ? {} : { onCopyWorkspace: props.onCopyWorkspace }),
            ...(props.onOpenWorkspace === undefined ? {} : { onOpenWorkspace: props.onOpenWorkspace }),
            ...(props.onReattach === undefined ? {} : { onReattach: props.onReattach }),
            ...(props.onRetrySameConversation === undefined
                ? {}
                : { onRetrySameConversation: props.onRetrySameConversation }),
            ...(props.onRetryFreshAgent === undefined
                ? {}
                : { onRetryFreshAgent: props.onRetryFreshAgent }),
            ...(props.onRetryWithReplacement === undefined
                ? {}
                : { onRetryWithReplacement: props.onRetryWithReplacement }),
            ...(props.onContinuePrepared === undefined
                ? {}
                : { onContinuePrepared: props.onContinuePrepared }),
            ...(props.uncertaintyAcknowledged === undefined
                ? {}
                : { uncertaintyAcknowledged: props.uncertaintyAcknowledged }),
            ...(props.onAcknowledgeUncertainPriorEffects === undefined
                ? {}
                : { onAcknowledgeUncertainPriorEffects: props.onAcknowledgeUncertainPriorEffects }),
            ...(props.onStartReviewedNewRun === undefined
                ? {}
                : { onStartReviewedNewRun: props.onStartReviewedNewRun }),
            ...(props.onRestoreWorkspace === undefined ? {} : { onRestoreWorkspace: props.onRestoreWorkspace }),
        }
    ), [
        operationPending,
        props.onAcknowledgeUncertainPriorEffects,
        props.onContinuePrepared,
        props.onCopyWorkspace,
        props.onOpenExecutionRun,
        props.onOpenSession,
        props.onOpenWorkspace,
        props.onReattach,
        props.onAnswerQuestion,
        props.onRespondPermission,
        props.onRestoreWorkspace,
        props.onRetryFreshAgent,
        props.onRetrySameConversation,
        props.onRetryWithReplacement,
        props.onStartReviewedNewRun,
        props.pendingPermissionRequestIds,
        props.selectedContentUnavailable,
        props.selectedInvocationId,
        props.selectedInvocationProgress,
        props.uncertaintyAcknowledged,
        recovery,
        selectedRecoveryText,
        setSelectedRecoveryText,
        testIDPrefix,
        workspaceSourceLabel,
    ]);
    const selectedDetailTitle = selectedInvocation === null
        ? t('workflows.run.untitled')
        : invocationLabel(selectedInvocation) ?? t('workflows.run.untitled');

    useWorkflowCardModal({
        open: compactLayout,
        component: WorkflowInvocationDetailModal,
        props: detailProps,
        identity: props.selectedInvocationId,
        title: selectedDetailTitle,
        testID: `${testIDPrefix}-detail-modal`,
        focusReturnRef: detailFocusReturnRef,
        ...(props.onDeselectInvocation === undefined ? {} : { onRequestClose: props.onDeselectInvocation }),
    });

    const inspector = compactLayout || detailProps === null ? null : (
        <ScrollView
            testID={`${testIDPrefix}-inspector`}
            accessibilityLabel={selectedDetailTitle}
            style={styles.inspector}
            contentContainerStyle={styles.inspectorContent}
        >
            <WorkflowInvocationDetail key={props.selectedInvocationId} {...detailProps} />
        </ScrollView>
    );

    const footer = (
        <View style={styles.root}>
            <View testID={`${testIDPrefix}-technical`} style={styles.section}>
                <Pressable
                    testID={`${testIDPrefix}-technical-toggle`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: technicalOpen }}
                    onPress={() => setTechnicalOpen((open) => !open)}
                    style={styles.actionTarget}
                >
                    <Text style={styles.sectionLabel}>{t('workflows.run.technicalDetails')}</Text>
                </Pressable>
                {technicalOpen ? (
                    <>
                        <View style={styles.detailRow}>
                            <Text style={styles.detailKey}>{t('workflows.run.technical.runId')}</Text>
                            <Text testID={`${testIDPrefix}-run-id`} style={styles.detailValue} numberOfLines={1}>
                                {props.run.id}
                            </Text>
                        </View>
                        {props.selectedInvocationId === null ? null : (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailKey}>{t('workflows.run.technical.invocationId')}</Text>
                                <Text testID={`${testIDPrefix}-invocation-id`} style={styles.detailValue} numberOfLines={1}>
                                    {props.selectedInvocationId}
                                </Text>
                            </View>
                        )}
                        <View style={styles.detailRow}>
                            <Text style={styles.detailKey}>{t('workflows.run.technical.machine')}</Text>
                            <Text testID={`${testIDPrefix}-machine`} style={styles.detailValue} numberOfLines={1}>
                                {props.machineName ?? props.run.machineId}
                            </Text>
                        </View>
                        {/* The name identifies; the exact id still distinguishes. */}
                        {props.machineName === undefined
                            || props.machineName === null
                            || props.machineName === props.run.machineId ? null : (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailKey}>{t('workflows.run.technical.machineId')}</Text>
                                <Text testID={`${testIDPrefix}-machine-id`} style={styles.detailValue} numberOfLines={1}>
                                    {props.run.machineId}
                                </Text>
                            </View>
                        )}
                        <View style={styles.detailRow}>
                            <Text style={styles.detailKey}>{t('workflows.run.technical.revision')}</Text>
                            <Text testID={`${testIDPrefix}-revision`} style={styles.detailValue} numberOfLines={1}>
                                {String(props.run.revision)}
                            </Text>
                        </View>
                    </>
                ) : null}
            </View>
        </View>
    );

    const outline = props.view === 'activity' || flowProjection === null ? (
        <WorkflowInvocationList
            listRef={activityListRef}
            onScroll={captureActivityScroll}
            testIDPrefix={`${testIDPrefix}-invocations`}
            invocations={props.invocations}
            loaded={props.invocationsLoaded}
            selectedInvocationId={props.selectedInvocationId}
            onSelectInvocation={selectInvocation}
            resolveInvocationLabel={invocationLabel}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={props.contentContainerStyle}
            {...(props.onLoadMoreInvocations === undefined
                ? {}
                : { onLoadMore: props.onLoadMoreInvocations })}
            {...(props.loadingMoreInvocations === undefined
                ? {}
                : { loadingMore: props.loadingMoreInvocations })}
            {...(props.loadMoreInvocationsFailed === undefined
                ? {}
                : { loadMoreFailed: props.loadMoreInvocationsFailed })}
        />
    ) : (
        <ScrollView
            ref={flowScrollRef}
            testID={testIDPrefix}
            style={styles.scroll}
            contentContainerStyle={[styles.root, props.contentContainerStyle]}
            onScroll={captureFlowScroll}
            scrollEventThrottle={32}
        >
            {header}
            {/*
              * Flow shows the occurrences the invocation window has loaded. Paging
              * is therefore reachable from here too — otherwise an older occurrence
              * would be selectable only by first switching back to Activity.
              */}
            {props.onLoadMoreInvocations === undefined ? null : (
                <WorkflowRunPagingAction
                    testIDPrefix={`${testIDPrefix}-flow`}
                    onLoadMore={props.onLoadMoreInvocations}
                    loading={props.loadingMoreInvocations === true}
                    failed={props.loadMoreInvocationsFailed === true}
                />
            )}
            <WorkflowFlowView
                testIDPrefix={`${testIDPrefix}-flow`}
                projection={flowProjection}
                selectedNodeId={props.selectedInvocationId === null
                    ? null
                    : derivedStructure.get(props.selectedInvocationId)?.nodeId ?? null}
                selectedInvocationId={props.selectedInvocationId}
                onSelectOccurrence={selectInvocation}
                {...(flowRunStates === undefined ? {} : { runStates: flowRunStates })}
            />
            {footer}
        </ScrollView>
    );

    return (
        <View style={[styles.grid, maxWidthStyle]}>
            <View style={styles.outline}>{outline}</View>
            {inspector}
        </View>
    );
}
