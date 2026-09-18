import * as React from 'react';
import { Platform, Pressable, View, type GestureResponderEvent } from 'react-native';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { formatWorkflowAgentStatusLabel } from '@/components/workflows/presentation/workflowStatusLabel';
import { WorkflowLifecycleStatus } from '@/components/workflows/presentation/WorkflowLifecycleStatus';
import {
    describeWorkflowInvocationAttempt,
    describeWorkflowInvocationLifecycle,
} from '@/components/workflows/presentation/workflowLifecyclePresentation';
import { StyleSheet } from 'react-native-unistyles';

import {
    resolveWorkflowFlowEditTarget,
    type WorkflowFlowEditTarget,
    type WorkflowFlowNode,
    type WorkflowFlowNodeRunState,
    type WorkflowFlowProjection,
} from './workflowFlowProjection';

/**
 * Flow: a derived reading mode, not a second editor and not a canvas.
 *
 * Narrow and wide layouts share one vertical outline with the same execution
 * rails, so a phone never has to pan a desktop canvas to read a prompt. The
 * accessible order is the linear DOM order, connectors are decorative and
 * motionless, and every node action has a non-drag equivalent.
 */

/**
 * Text-labelled controls take the canonical platform target as a real minimum
 * height. `hitSlop` is inert on react-native-web's `Pressable`, and the desktop
 * app IS the web bundle, so a slop-declared target there is a target that does
 * not exist.
 */
const MINIMUM_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    actionTarget: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
    },
    container: {
        gap: theme.margins.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingVertical: theme.margins.sm,
        paddingHorizontal: theme.margins.sm,
        borderRadius: theme.borderRadius.md,
    },
    rowSelected: {
        backgroundColor: theme.colors.surface.selected,
    },
    rail: {
        width: StyleSheet.hairlineWidth,
        alignSelf: 'stretch',
        backgroundColor: theme.colors.border.default,
    },
    label: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    labelSelected: {
        ...Typography.default('semiBold'),
    },
    meta: {
        ...Typography.default('regular'),
        color: theme.colors.text.tertiary,
        marginLeft: 'auto',
    },
    trailingStatus: {
        marginLeft: 'auto',
    },
    occurrenceList: {
        gap: theme.margins.xs,
        marginLeft: theme.margins.lg,
    },
    occurrenceRow: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
        paddingHorizontal: theme.margins.sm,
        borderRadius: theme.borderRadius.md,
    },
    occurrenceSelected: {
        backgroundColor: theme.colors.surface.selected,
    },
    occurrenceMeta: {
        ...Typography.default('regular'),
        color: theme.colors.text.tertiary,
    },
    incomplete: {
        ...Typography.default('regular'),
        color: theme.colors.text.tertiary,
    },
    editAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
}));

function orderedNodes(projection: WorkflowFlowProjection): readonly WorkflowFlowNode[] {
    const ordered: WorkflowFlowNode[] = [];
    const visit = (nodeId: string): void => {
        const node = projection.nodesById.get(nodeId);
        if (node === undefined) return;
        ordered.push(node);
        for (const childId of node.childNodeIds) visit(childId);
    };
    for (const rootId of projection.rootNodeIds) visit(rootId);
    return ordered;
}

export function WorkflowFlowView(props: Readonly<{
    projection: WorkflowFlowProjection;
    selectedNodeId: string | null;
    onSelectNode?: (nodeId: string) => void;
    /**
     * Present only for an authored definition; observed activity has no
     * editable target. The target is the projection's answer, so a branch
     * frame reveals its owning group rather than an id no editor has.
     */
    onEditStep?: (target: WorkflowFlowEditTarget) => void;
    runStates?: ReadonlyMap<string, readonly WorkflowFlowNodeRunState[]>;
    selectedInvocationId?: string | null;
    /** The press event travels so the caller can return focus to this node later. */
    onSelectOccurrence?: (invocationId: string, event?: GestureResponderEvent) => void;
    testIDPrefix?: string;
}>): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-flow';
    const nodes = React.useMemo(() => orderedNodes(props.projection), [props.projection]);
    const editTarget = props.onEditStep === undefined || props.selectedNodeId === null
        ? null
        : resolveWorkflowFlowEditTarget(props.projection, props.selectedNodeId);
    const editLabel = editTarget?.kind === 'prompt' ? t('workflows.a11y.editStep') : t('workflows.a11y.editBlock');

    return (
        <View testID={testIDPrefix} accessibilityRole="list" style={styles.container}>
            {props.projection.relationships === 'unknown' ? (
                <Text testID={`${testIDPrefix}-observed-note`} style={styles.incomplete}>
                    {t('workflows.run.observedActivityBody')}
                </Text>
            ) : null}

            {nodes.map((node) => {
                const selected = props.selectedNodeId === node.nodeId;
                const occurrences = props.runStates?.get(node.nodeId) ?? [];
                const runState = occurrences.find((state) => state.invocationId === props.selectedInvocationId)
                    ?? (occurrences.length === 1 ? occurrences[0] : undefined);
                // Managed lifecycle and observed native activity are different
                // contracts: the managed one goes through the one neutral
                // presenter (icon + label + semantic colour), while observed
                // activity keeps its own label owner and stays plain text.
                const stateLabel = runState === undefined
                    ? (node.observedStatus === undefined ? null : formatWorkflowAgentStatusLabel(node.observedStatus))
                    : describeWorkflowInvocationLifecycle(runState.lifecycle).label;
                const selectsOccurrence = props.onSelectOccurrence !== undefined;
                const nodeDisabled = selectsOccurrence && occurrences.length !== 1;

                return (
                    <React.Fragment key={node.nodeId}>
                    <Pressable
                        testID={`${testIDPrefix}-node-${node.nodeId}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected, ...(nodeDisabled ? { disabled: true } : {}) }}
                        disabled={nodeDisabled}
                        accessibilityLabel={stateLabel === null
                            ? node.label
                            : t('workflows.a11y.flowNode', { node: node.label, state: stateLabel })}
                        onPress={(event) => {
                            if (selectsOccurrence) {
                                const onlyOccurrence = occurrences[0];
                                if (occurrences.length === 1 && onlyOccurrence !== undefined) {
                                    props.onSelectOccurrence?.(onlyOccurrence.invocationId, event);
                                }
                                return;
                            }
                            props.onSelectNode?.(node.nodeId);
                        }}
                        style={[styles.row, selected ? styles.rowSelected : null]}
                    >
                        {Array.from({ length: node.depth }, (_unused, index) => (
                            <View
                                key={index}
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                style={styles.rail}
                            />
                        ))}
                        <Text style={[styles.label, selected ? styles.labelSelected : null]}>
                            {node.label}
                        </Text>
                        {node.maxConcurrent === undefined && (node.kind === 'parallel' || node.repetition?.kind === 'items') ? (
                            <Text testID={`${testIDPrefix}-node-${node.nodeId}-no-limit`} style={styles.meta}>
                                {t('workflows.loop.noWorkflowLimit')}
                            </Text>
                        ) : null}
                        {runState === undefined || runState.occurrenceLabel === undefined ? null : (
                            <Text style={styles.meta}>{runState.occurrenceLabel}</Text>
                        )}
                        {runState !== undefined ? (
                            <View style={styles.trailingStatus}>
                                <WorkflowLifecycleStatus
                                    testID={`${testIDPrefix}-node-${node.nodeId}-state`}
                                    lifecycle={runState.lifecycle}
                                />
                            </View>
                        ) : stateLabel === null ? null : (
                            <Text testID={`${testIDPrefix}-node-${node.nodeId}-state`} style={styles.meta}>
                                {stateLabel}
                            </Text>
                        )}
                    </Pressable>
                    {selectsOccurrence && occurrences.length > 1 ? (
                        <View
                            testID={`${testIDPrefix}-node-${node.nodeId}-occurrences`}
                            accessibilityRole="list"
                            style={styles.occurrenceList}
                        >
                            {occurrences.map((occurrence) => {
                                const occurrenceSelected = occurrence.invocationId === props.selectedInvocationId;
                                const occurrenceState = describeWorkflowInvocationLifecycle(occurrence.lifecycle).label;
                                const attemptLabel = describeWorkflowInvocationAttempt(occurrence.attempt ?? '0').label;
                                const label = occurrence.occurrenceLabel === undefined
                                    ? `${attemptLabel} · ${occurrenceState}`
                                    : `${occurrence.occurrenceLabel} · ${attemptLabel} · ${occurrenceState}`;
                                return (
                                    <Pressable
                                        key={occurrence.invocationId}
                                        testID={`${testIDPrefix}-node-${node.nodeId}-occurrence-${occurrence.invocationId}`}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: occurrenceSelected }}
                                        accessibilityLabel={t('workflows.a11y.flowNode', { node: node.label, state: label })}
                                        onPress={(event) => props.onSelectOccurrence?.(occurrence.invocationId, event)}
                                        style={[
                                            styles.occurrenceRow,
                                            occurrenceSelected ? styles.occurrenceSelected : null,
                                        ]}
                                    >
                                        <Text style={styles.occurrenceMeta}>{label}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}
                    </React.Fragment>
                );
            })}

            {editTarget === null ? null : (
                <Pressable
                    testID={`${testIDPrefix}-edit-step`}
                    accessibilityRole="button"
                    accessibilityLabel={editLabel}
                    onPress={() => props.onEditStep?.(editTarget)}
                    style={styles.actionTarget}
                >
                    <Text style={styles.editAction}>{editLabel}</Text>
                </Pressable>
            )}
        </View>
    );
}
