import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { WorkflowBlock, WorkflowFailurePolicy } from '@happier-dev/protocol/workflows/workflowV1';

import { WorkflowBlockActionsMenu, type WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowNumberField } from './WorkflowNumberField';
import { workflowEditorStyles } from './workflowEditorStyles';

type ParallelBlock = Extract<WorkflowBlock, Readonly<{ kind: 'parallel' }>>;

/**
 * Parallel-group composition: heading, the authored failure policy, the optional
 * per-container concurrency and one heading per branch.
 *
 * The group is an open structure with a rail and indentation, not another
 * rounded card wrapped around rounded step cards. Its body is supplied by the
 * caller so the same recursive block list renders every nesting level.
 */

export function WorkflowFailurePolicyControl(props: Readonly<{
    value: WorkflowFailurePolicy;
    onChange: (value: WorkflowFailurePolicy) => void;
    testID: string;
}>): React.ReactElement {
    return (
        <View style={workflowEditorStyles.metaRow}>
            <Text style={workflowEditorStyles.metaText}>{t('workflows.failurePolicy.title')}</Text>
            {(['fail_stop', 'collect_outcomes'] as const).map((policy) => (
                <Pressable
                    key={policy}
                    testID={`${props.testID}-${policy}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: props.value === policy }}
                    accessibilityLabel={policy === 'fail_stop'
                        ? t('workflows.failurePolicy.failStop')
                        : t('workflows.failurePolicy.collectOutcomes')}
                    accessibilityHint={policy === 'fail_stop'
                        ? t('workflows.failurePolicy.failStopExplain')
                        : t('workflows.failurePolicy.collectOutcomesExplain')}
                    onPress={() => props.onChange(policy)}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={props.value === policy
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >
                        {policy === 'fail_stop'
                            ? t('workflows.failurePolicy.failStop')
                            : t('workflows.failurePolicy.collectOutcomes')}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

/**
 * Optional authored concurrency. An empty field is not zero and not a machine
 * policy: it displays **No workflow limit**, which is the precise meaning of an
 * omitted authored value. Text that is not a whole number stays visible as the
 * unresolved value the canonical validator rejects; it is never read as a
 * limit of 1 or as no limit.
 */
export function WorkflowMaxConcurrentControl(props: Readonly<{
    label: string;
    value: number | undefined;
    onChange: (value: number | undefined) => void;
    testID: string;
}>): React.ReactElement {
    return (
        <WorkflowNumberField
            label={props.label}
            value={props.value}
            onChange={props.onChange}
            placeholder={t('workflows.loop.noWorkflowLimit')}
            testID={props.testID}
        />
    );
}

export function WorkflowGroupEditor(props: Readonly<{
    block: ParallelBlock;
    ordinal: number;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeFailurePolicy: (value: WorkflowFailurePolicy) => void;
    onChangeMaxConcurrent: (value: number | undefined) => void;
    onAddBranch: () => void;
    onRemoveBranch: (branchId: string) => void;
    renderBranch: (branch: ParallelBlock['branches'][number], index: number) => React.ReactNode;
    testIDPrefix: string;
}>): React.ReactElement {
    const displayName = `${t('workflows.editor.unnamedParallel')} ${props.ordinal}`;

    return (
        <View testID={`${props.testIDPrefix}-parallel-${props.block.id}`} style={workflowEditorStyles.blockBody}>
            <View style={workflowEditorStyles.heading}>
                <Text style={workflowEditorStyles.ordinal} accessibilityElementsHidden>
                    {t('workflows.editor.stepOrdinal', { position: props.ordinal })}
                </Text>
                <Text
                    testID={`${props.testIDPrefix}-parallel-${props.block.id}-label`}
                    style={workflowEditorStyles.headingNameInput}
                    onPress={props.onSelect}
                >
                    {displayName}
                </Text>
                <View style={workflowEditorStyles.headingActions}>
                    <WorkflowBlockActionsMenu
                        blockLabel={displayName}
                        actions={props.actions}
                        testID={`${props.testIDPrefix}-parallel-${props.block.id}-actions`}
                    />
                </View>
            </View>

            <WorkflowFailurePolicyControl
                value={props.block.failurePolicy}
                onChange={props.onChangeFailurePolicy}
                testID={`${props.testIDPrefix}-parallel-${props.block.id}-failure-policy`}
            />
            <WorkflowMaxConcurrentControl
                label={t('workflows.loop.maxConcurrentBranches')}
                value={props.block.maxConcurrent}
                onChange={props.onChangeMaxConcurrent}
                testID={`${props.testIDPrefix}-parallel-${props.block.id}-max-concurrent`}
            />

            {props.block.branches.map((branch, index) => (
                <View key={branch.id} accessibilityRole="none">
                    <View style={workflowEditorStyles.heading}>
                        <Text
                            testID={`${props.testIDPrefix}-parallel-${props.block.id}-branch-${branch.id}-label`}
                            style={workflowEditorStyles.headingNameInput}
                        >
                            {`${t('workflows.editor.branch')} ${index + 1}`}
                        </Text>
                        {props.block.branches.length > 1 ? (
                            <Pressable
                                testID={`${props.testIDPrefix}-parallel-${props.block.id}-branch-${branch.id}-remove`}
                                accessibilityRole="button"
                                accessibilityLabel={t('workflows.editor.remove')}
                                onPress={() => props.onRemoveBranch(branch.id)}
                                style={workflowEditorStyles.actionTarget}
                            >
                                <Text style={workflowEditorStyles.issueText}>{t('workflows.editor.remove')}</Text>
                            </Pressable>
                        ) : null}
                    </View>
                    {props.renderBranch(branch, index)}
                </View>
            ))}

            <Pressable
                testID={`${props.testIDPrefix}-parallel-${props.block.id}-add-branch`}
                accessibilityRole="button"
                accessibilityLabel={t('workflows.editor.addBranch')}
                onPress={props.onAddBranch}
                style={workflowEditorStyles.actionTarget}
            >
                <Text style={workflowEditorStyles.metaAction}>{t('workflows.editor.addBranch')}</Text>
            </Pressable>
        </View>
    );
}
