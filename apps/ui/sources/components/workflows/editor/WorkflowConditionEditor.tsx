import * as React from 'react';
import { Pressable, View } from 'react-native';

import {
    WORKFLOW_COMPARE_OPERATORS,
    type WorkflowCondition,
} from '@happier-dev/protocol/workflows/workflowReferenceV1';

import { Text } from '@/components/ui/text/Text';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { t } from '@/text';

import { workflowEditorStyles } from './workflowEditorStyles';
import { WorkflowValueReferenceEditor } from './WorkflowStepDataEditor';

const DEFAULT_CONDITION: WorkflowCondition = { kind: 'exists', value: { kind: 'literal', value: true } };
const CONDITION_KIND_LABEL_KEYS = {
    exists: 'workflows.condition.exists',
    compare: 'workflows.condition.operatorEq',
    all: 'workflows.condition.allOf',
    any: 'workflows.condition.anyOf',
    not: 'workflows.condition.not',
} as const;
const OPERATOR_LABEL_KEYS = {
    eq: 'workflows.condition.operatorEq',
    neq: 'workflows.condition.operatorNeq',
    lt: 'workflows.condition.operatorLt',
    lte: 'workflows.condition.operatorLte',
    gt: 'workflows.condition.operatorGt',
    gte: 'workflows.condition.operatorGte',
} as const;

function conditionForKind(kind: WorkflowCondition['kind']): WorkflowCondition {
    if (kind === 'exists') return DEFAULT_CONDITION;
    if (kind === 'compare') return {
        kind,
        operator: 'eq',
        left: { kind: 'literal', value: true },
        right: { kind: 'literal', value: true },
    };
    if (kind === 'not') return { kind, condition: DEFAULT_CONDITION };
    return { kind, conditions: [DEFAULT_CONDITION] };
}

function ConditionNode(props: Readonly<{
    condition: WorkflowCondition;
    draft: WorkflowEditorDraft;
    consumerBlockId: string;
    continuation?: boolean;
    onChange: (condition: WorkflowCondition) => void;
    testIDPrefix: string;
    depth: number;
}>): React.ReactElement {
    const { condition } = props;
    const kinds = ['exists', 'compare', 'all', 'any', 'not'] as const;
    return (
        <View style={props.depth === 0 ? undefined : workflowEditorStyles.nestedList}>
            <View style={workflowEditorStyles.metaRow} accessibilityRole="radiogroup">
                {kinds.map((kind) => (
                    <Pressable
                        key={kind}
                        testID={`${props.testIDPrefix}-kind-${kind}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: condition.kind === kind }}
                        onPress={() => props.onChange(conditionForKind(kind))}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={condition.kind === kind
                            ? workflowEditorStyles.metaAction
                            : workflowEditorStyles.metaText}
                        >{t(CONDITION_KIND_LABEL_KEYS[kind])}</Text>
                    </Pressable>
                ))}
            </View>
            {condition.kind === 'exists' ? (
                <WorkflowValueReferenceEditor
                    reference={condition.value}
                    index={props.depth}
                    draft={props.draft}
                    stepId={props.consumerBlockId}
                    {...(props.continuation === true ? { continuation: true } : {})}
                    onChange={(value) => props.onChange({ ...condition, value })}
                    testIDPrefix={`${props.testIDPrefix}-value`}
                />
            ) : null}
            {condition.kind === 'compare' ? (
                <>
                    <View style={workflowEditorStyles.metaRow}>
                        {WORKFLOW_COMPARE_OPERATORS.map((operator) => (
                            <Pressable
                                key={operator}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: condition.operator === operator }}
                                onPress={() => props.onChange({ ...condition, operator })}
                                style={workflowEditorStyles.actionTarget}
                            >
                                <Text style={condition.operator === operator
                                    ? workflowEditorStyles.metaAction
                                    : workflowEditorStyles.metaText}
                                >{t(OPERATOR_LABEL_KEYS[operator])}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <WorkflowValueReferenceEditor
                        reference={condition.left}
                        index={props.depth * 2}
                        draft={props.draft}
                        stepId={props.consumerBlockId}
                        {...(props.continuation === true ? { continuation: true } : {})}
                    {...(props.continuation === true ? { continuation: true } : {})}
                        onChange={(left) => props.onChange({ ...condition, left })}
                        testIDPrefix={`${props.testIDPrefix}-left`}
                    />
                    <WorkflowValueReferenceEditor
                        reference={condition.right}
                        index={props.depth * 2 + 1}
                        draft={props.draft}
                        stepId={props.consumerBlockId}
                        {...(props.continuation === true ? { continuation: true } : {})}
                    {...(props.continuation === true ? { continuation: true } : {})}
                        onChange={(right) => props.onChange({ ...condition, right })}
                        testIDPrefix={`${props.testIDPrefix}-right`}
                    />
                </>
            ) : null}
            {condition.kind === 'not' ? (
                <ConditionNode {...props} condition={condition.condition} onChange={(next) => props.onChange({ kind: 'not', condition: next })} depth={props.depth + 1} />
            ) : null}
            {condition.kind === 'all' || condition.kind === 'any' ? (
                <>
                    {condition.conditions.map((child, index) => (
                        <ConditionNode
                            key={index}
                            {...props}
                            condition={child}
                            onChange={(next) => props.onChange({
                                ...condition,
                                conditions: condition.conditions.map((current, candidate) => candidate === index ? next : current),
                            })}
                            testIDPrefix={`${props.testIDPrefix}-${index}`}
                            depth={props.depth + 1}
                        />
                    ))}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => props.onChange({ ...condition, conditions: [...condition.conditions, DEFAULT_CONDITION] })}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={workflowEditorStyles.metaAction}>{t('workflows.condition.addCondition')}</Text>
                    </Pressable>
                </>
            ) : null}
        </View>
    );
}

export function WorkflowConditionEditor(props: Readonly<{
    label: string;
    condition: WorkflowCondition | undefined;
    draft: WorkflowEditorDraft;
    consumerBlockId: string;
    /** True for a loop's after-each-round condition (`stopWhen`), which resolves inside the body. */
    continuation?: boolean;
    required?: boolean;
    onChange: (condition: WorkflowCondition | undefined) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    return (
        <View testID={props.testIDPrefix}>
            <View style={workflowEditorStyles.metaRow}>
                <Text style={workflowEditorStyles.metaText}>{props.label}</Text>
                {props.condition === undefined ? (
                    <Pressable accessibilityRole="button" onPress={() => props.onChange(DEFAULT_CONDITION)} style={workflowEditorStyles.actionTarget}>
                        <Text style={workflowEditorStyles.metaAction}>{t('workflows.condition.addCondition')}</Text>
                    </Pressable>
                ) : props.required === true ? null : (
                    <Pressable accessibilityRole="button" onPress={() => props.onChange(undefined)} style={workflowEditorStyles.actionTarget}>
                        <Text style={workflowEditorStyles.metaAction}>{t('workflows.condition.always')}</Text>
                    </Pressable>
                )}
            </View>
            {props.condition === undefined ? null : (
                <ConditionNode
                    condition={props.condition}
                    draft={props.draft}
                    consumerBlockId={props.consumerBlockId}
                    {...(props.continuation === true ? { continuation: true } : {})}
                    onChange={(condition) => props.onChange(condition)}
                    testIDPrefix={props.testIDPrefix}
                    depth={0}
                />
            )}
        </View>
    );
}
