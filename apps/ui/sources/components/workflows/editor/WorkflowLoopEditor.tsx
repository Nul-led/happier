import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type {
    WorkflowBlock,
    WorkflowEvaluatorHistoryMode,
    WorkflowFailurePolicy,
    WorkflowItemExecutionMode,
    WorkflowRepetition,
} from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';

import { WorkflowBlockActionsMenu, type WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowFailurePolicyControl, WorkflowMaxConcurrentControl } from './WorkflowGroupEditor';
import { WorkflowNumberField } from './WorkflowNumberField';
import { workflowEditorStyles } from './workflowEditorStyles';

type LoopBlock = Extract<WorkflowBlock, Readonly<{ kind: 'loop' }>>;

/**
 * Loop composition: the repetition mode, its mode-specific controls, the body
 * (supplied by the caller as the same recursive block list) and the continuation
 * section that runs after each round.
 *
 * Only the agent mode needs an extra evaluation composer, and its history
 * selection refers to saved decisions and feedback — never to whole transcripts.
 */

const MODES: ReadonlyArray<Readonly<{ kind: WorkflowRepetition['kind']; labelKey: 'modeCount' | 'modeItems' | 'modeUntil' | 'modeEvaluate' }>> = [
    { kind: 'count', labelKey: 'modeCount' },
    { kind: 'items', labelKey: 'modeItems' },
    { kind: 'until', labelKey: 'modeUntil' },
    { kind: 'evaluate', labelKey: 'modeEvaluate' },
];

export function WorkflowLoopEditor(props: Readonly<{
    block: LoopBlock;
    ordinal: number;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeMode: (kind: WorkflowRepetition['kind']) => void;
    onChangeItemExecution: (execution: WorkflowItemExecutionMode) => void;
    onChangeItemFailurePolicy: (policy: WorkflowFailurePolicy) => void;
    onChangeMaxConcurrent: (value: number | undefined) => void;
    onChangeMaxIterations: (value: number) => void;
    onChangeEvaluatorHistory: (history: WorkflowEvaluatorHistoryMode) => void;
    renderCount: (count: WorkflowValueReference) => React.ReactNode;
    renderItems: (items: WorkflowValueReference) => React.ReactNode;
    renderBody: () => React.ReactNode;
    renderContinuation?: () => React.ReactNode;
    testIDPrefix: string;
}>): React.ReactElement {
    const { block, testIDPrefix } = props;
    const displayName = `${t('workflows.editor.unnamedLoop')} ${props.ordinal}`;
    const idPrefix = `${testIDPrefix}-loop-${block.id}`;
    const repetition = block.repetition;

    return (
        <View testID={idPrefix} style={workflowEditorStyles.blockBody}>
            <View style={workflowEditorStyles.heading}>
                <Text style={workflowEditorStyles.ordinal} accessibilityElementsHidden>
                    {t('workflows.editor.stepOrdinal', { position: props.ordinal })}
                </Text>
                <Text
                    testID={`${idPrefix}-label`}
                    style={workflowEditorStyles.headingNameInput}
                    onPress={props.onSelect}
                >
                    {displayName}
                </Text>
                <View style={workflowEditorStyles.headingActions}>
                    <WorkflowBlockActionsMenu
                        blockLabel={displayName}
                        actions={props.actions}
                        testID={`${idPrefix}-actions`}
                    />
                </View>
            </View>

            <View style={workflowEditorStyles.metaRow}>
                <Text style={workflowEditorStyles.metaText}>{t('workflows.loop.modeTitle')}</Text>
                {MODES.map((mode) => (
                    <Pressable
                        key={mode.kind}
                        testID={`${idPrefix}-mode-${mode.kind}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: repetition.kind === mode.kind }}
                        accessibilityLabel={t(`workflows.loop.${mode.labelKey}`)}
                        onPress={() => props.onChangeMode(mode.kind)}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={repetition.kind === mode.kind
                            ? workflowEditorStyles.metaAction
                            : workflowEditorStyles.metaText}
                        >
                            {t(`workflows.loop.${mode.labelKey}`)}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {repetition.kind === 'count' ? props.renderCount(repetition.count) : null}

            {repetition.kind === 'items' ? (
                <>
                    {props.renderItems(repetition.items)}
                    <View style={workflowEditorStyles.metaRow}>
                        {(['sequential', 'parallel'] as const).map((execution) => (
                            <Pressable
                                key={execution}
                                testID={`${idPrefix}-items-${execution}`}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: repetition.execution === execution }}
                                accessibilityLabel={execution === 'sequential'
                                    ? t('workflows.loop.sequential')
                                    : t('workflows.loop.parallel')}
                                onPress={() => props.onChangeItemExecution(execution)}
                                style={workflowEditorStyles.actionTarget}
                            >
                                <Text style={repetition.execution === execution
                                    ? workflowEditorStyles.metaAction
                                    : workflowEditorStyles.metaText}
                                >
                                    {execution === 'sequential'
                                        ? t('workflows.loop.sequential')
                                        : t('workflows.loop.parallel')}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <WorkflowFailurePolicyControl
                        value={repetition.failurePolicy}
                        onChange={props.onChangeItemFailurePolicy}
                        testID={`${idPrefix}-failure-policy`}
                    />
                    {repetition.execution === 'parallel' ? (
                        <WorkflowMaxConcurrentControl
                            label={t('workflows.loop.maxConcurrentItems')}
                            value={repetition.maxConcurrent}
                            onChange={props.onChangeMaxConcurrent}
                            testID={`${idPrefix}-max-concurrent`}
                        />
                    ) : null}
                    <Text style={workflowEditorStyles.groupSummary}>
                        {t('workflows.loop.emptyListCompletes')}
                    </Text>
                </>
            ) : null}

            {repetition.kind === 'until' || repetition.kind === 'evaluate' ? (
                // The guard is required: clearing it leaves an unresolved
                // number the validator rejects rather than the previous value.
                <WorkflowNumberField
                    label={t('workflows.loop.maxIterations')}
                    value={repetition.maxIterations}
                    onChange={(next) => props.onChangeMaxIterations(next ?? Number.NaN)}
                    required
                    testID={`${idPrefix}-max-iterations`}
                />
            ) : null}

            <Text style={workflowEditorStyles.branchLabel}>{t('workflows.editor.loopBody')}</Text>
            {props.renderBody()}

            {repetition.kind === 'evaluate' ? (
                <>
                    <Text style={workflowEditorStyles.branchLabel}>{t('workflows.editor.continuation')}</Text>
                    <View style={workflowEditorStyles.metaRow}>
                        <Text style={workflowEditorStyles.metaText}>{t('workflows.loop.historyTitle')}</Text>
                        {(['none', 'latest', 'all'] as const).map((history) => (
                            <Pressable
                                key={history}
                                testID={`${idPrefix}-history-${history}`}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: repetition.history === history }}
                                accessibilityLabel={t(`workflows.loop.history${history === 'none' ? 'None' : history === 'latest' ? 'Latest' : 'All'}`)}
                                onPress={() => props.onChangeEvaluatorHistory(history)}
                                style={workflowEditorStyles.actionTarget}
                            >
                                <Text style={repetition.history === history
                                    ? workflowEditorStyles.metaAction
                                    : workflowEditorStyles.metaText}
                                >
                                    {t(`workflows.loop.history${history === 'none' ? 'None' : history === 'latest' ? 'Latest' : 'All'}`)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={workflowEditorStyles.groupSummary}>
                        {t('workflows.loop.historyExplain')}
                    </Text>
                    {props.renderContinuation?.()}
                </>
            ) : null}
        </View>
    );
}
