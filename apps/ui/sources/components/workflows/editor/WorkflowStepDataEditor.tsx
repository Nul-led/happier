import * as React from 'react';
import { Pressable, View } from 'react-native';

import type { JsonValue } from '@happier-dev/protocol';
import type { WorkflowReferenceScope, WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type { WorkflowResultContract, WorkflowStep } from '@happier-dev/protocol/workflows/workflowV1';

import { Text, TextInput } from '@/components/ui/text/Text';
import {
    listWorkflowProducerOptions,
    resolveWorkflowReferenceScopeFacts,
} from '@/sync/domains/workflows/workflowAuthoring';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { t } from '@/text';

import { workflowEditorStyles } from './workflowEditorStyles';

type ItemReferenceField = Extract<WorkflowValueReference, { kind: 'item' }>['field'];
type IterationReferenceField = Extract<WorkflowValueReference, { kind: 'iteration' }>['field'];

/** The canonical field vocabulary of each loop-scoped reference kind, in the schema's order. */
const ITEM_REFERENCE_FIELDS: readonly ItemReferenceField[] = ['value', 'index', 'position', 'count'];
const ITERATION_REFERENCE_FIELDS: readonly IterationReferenceField[] = ['index', 'position', 'count', 'stopReason'];

function literalText(value: JsonValue): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseLiteral(value: string): JsonValue {
    try { return JSON.parse(value) as JsonValue; } catch { return value; }
}

function scopeKey(scope: WorkflowReferenceScope): string {
    if (scope.kind === 'outer') return `outer-${scope.levels}`;
    if (scope.kind === 'previous_iteration') return `previous-${scope.loopBlockId}`;
    return 'current';
}

function scopeLabel(scope: WorkflowReferenceScope): string {
    if (scope.kind === 'outer') return t('workflows.input.scopeOuter', { levels: scope.levels });
    if (scope.kind === 'previous_iteration') return t('workflows.input.scopePreviousIteration');
    return t('workflows.input.scopeCurrent');
}

function referenceKindLabel(kind: WorkflowValueReference['kind']): string {
    if (kind === 'literal') return t('workflows.condition.valuePlaceholder');
    if (kind === 'input') return t('workflows.input.label');
    if (kind === 'result') return t('workflows.finalOutput.title');
    if (kind === 'workspace') return t('workflows.workspace.title');
    if (kind === 'item') return t('workflows.input.currentItem');
    return t('workflows.input.iteration');
}

export function WorkflowValueReferenceEditor(props: Readonly<{
    reference: WorkflowValueReference;
    index: number;
    draft: WorkflowEditorDraft;
    stepId: string;
    /** True for a loop's after-each-round consumer (`stopWhen`), which resolves inside the body. */
    continuation?: boolean;
    onChange: (value: WorkflowValueReference) => void;
    onRemove?: () => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const rowId = `${props.testIDPrefix}-input-${props.index}`;
    const consumer = props.continuation === true ? { continuation: true } : {};
    const producers = listWorkflowProducerOptions(props.draft, props.stepId, consumer);
    const reference = props.reference;
    const inputName = reference.kind === 'input' ? reference.name : undefined;
    const producerReference = reference.kind === 'result' || reference.kind === 'workspace'
        ? reference
        : undefined;
    const resultReference = reference.kind === 'result' ? reference : undefined;
    const workspaceReference = reference.kind === 'workspace' ? reference : undefined;
    const itemReference = reference.kind === 'item' ? reference : undefined;
    const iterationReference = reference.kind === 'iteration' ? reference : undefined;
    // Loop-scoped kinds are offered only where the canonical validator accepts
    // them; a reference already authored there stays visible for repair.
    const scopeFacts = resolveWorkflowReferenceScopeFacts(props.draft, props.stepId, consumer);
    const kinds: readonly WorkflowValueReference['kind'][] = [
        'literal',
        'input',
        'result',
        'workspace',
        ...(scopeFacts.insideItemsLoop || itemReference !== undefined ? ['item' as const] : []),
        ...(scopeFacts.insideLoop || iterationReference !== undefined ? ['iteration' as const] : []),
    ];
    const setKind = (kind: WorkflowValueReference['kind']): void => {
        if (kind === 'literal') props.onChange({ kind, value: '' });
        else if (kind === 'input') props.onChange({ kind, name: props.draft.inputs[0]?.name ?? 'input' });
        else if (kind === 'result') props.onChange({
            kind,
            producer: producers[0] === undefined
                ? { blockId: props.stepId, scope: { kind: 'current' } }
                : { blockId: producers[0].blockId, scope: producers[0].scope },
            path: [],
        });
        else if (kind === 'workspace') props.onChange({
            kind,
            producer: producers[0] === undefined
                ? { blockId: props.stepId, scope: { kind: 'current' } }
                : { blockId: producers[0].blockId, scope: producers[0].scope },
            field: 'directory',
        });
        else if (kind === 'item') props.onChange({ kind, field: 'value' });
        else props.onChange({ kind, field: 'index' });
    };
    return (
        <View style={workflowEditorStyles.inlineControl}>
            {kinds.map((kind) => (
                <Pressable
                    key={kind}
                    testID={`${rowId}-kind-${kind}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: reference.kind === kind }}
                    onPress={() => setKind(kind)}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={reference.kind === kind
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{referenceKindLabel(kind)}</Text>
                </Pressable>
            ))}
            {reference.kind === 'literal' ? (
                <TextInput
                    testID={`${rowId}-literal`}
                    style={workflowEditorStyles.inlineValue}
                    value={literalText(reference.value)}
                    accessibilityLabel={t('workflows.condition.valuePlaceholder')}
                    onChangeText={(value) => props.onChange({ kind: 'literal', value: parseLiteral(value) })}
                />
            ) : null}
            {inputName === undefined ? null : props.draft.inputs.map((input) => (
                <Pressable key={input.name} onPress={() => props.onChange({ kind: 'input', name: input.name })} style={workflowEditorStyles.actionTarget}>
                    <Text style={inputName === input.name
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{input.name}</Text>
                </Pressable>
            ))}
            {producerReference === undefined ? null : producers.map((producer) => (
                <Pressable
                    key={`${producer.blockId}:${producer.scope.kind}:${producer.scope.kind === 'outer'
                        ? producer.scope.levels
                        : producer.scope.kind === 'previous_iteration' ? producer.scope.loopBlockId : ''}`}
                    testID={`${rowId}-producer-${producer.blockId}-${scopeKey(producer.scope)}`}
                    onPress={() => props.onChange({
                        ...producerReference,
                        producer: { blockId: producer.blockId, scope: producer.scope },
                    })}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={producerReference.producer.blockId === producer.blockId
                        && JSON.stringify(producerReference.producer.scope) === JSON.stringify(producer.scope)
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{`${producer.label} · ${scopeLabel(producer.scope)}`}</Text>
                </Pressable>
            ))}
            {resultReference === undefined ? null : (
                <TextInput
                    testID={`${rowId}-path`}
                    style={workflowEditorStyles.inlineValue}
                    value={resultReference.path.join('.')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={t('workflows.finalOutput.fieldPath')}
                    placeholder={t('workflows.finalOutput.fieldPath')}
                    onChangeText={(value) => props.onChange({
                        ...resultReference,
                        path: value.trim().length === 0
                            ? []
                            : value.split('.').filter(Boolean).map((part) => (/^(0|[1-9][0-9]*)$/u.test(part) ? Number(part) : part)),
                    })}
                />
            )}
            {workspaceReference === undefined ? null : (['directory', 'checkoutRootPath'] as const).map((field) => (
                <Pressable
                    key={field}
                    testID={`${rowId}-workspace-field-${field}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: workspaceReference.field === field }}
                    onPress={() => props.onChange({ ...workspaceReference, field })}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={workspaceReference.field === field
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{field === 'directory'
                        ? t('workflows.workspace.title')
                        : t('workflows.workspace.projectCheckout')}</Text>
                </Pressable>
            ))}
            {itemReference === undefined ? null : ITEM_REFERENCE_FIELDS.map((field) => (
                <Pressable
                    key={field}
                    testID={`${rowId}-item-field-${field}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: itemReference.field === field }}
                    accessibilityLabel={t(`workflows.input.itemField.${field}`)}
                    onPress={() => props.onChange({ kind: 'item', field })}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={itemReference.field === field
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{t(`workflows.input.itemField.${field}`)}</Text>
                </Pressable>
            ))}
            {iterationReference === undefined ? null : ITERATION_REFERENCE_FIELDS.map((field) => (
                <Pressable
                    key={field}
                    testID={`${rowId}-iteration-field-${field}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: iterationReference.field === field }}
                    accessibilityLabel={t(`workflows.input.iterationField.${field}`)}
                    onPress={() => props.onChange({ kind: 'iteration', field })}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={iterationReference.field === field
                        ? workflowEditorStyles.metaAction
                        : workflowEditorStyles.metaText}
                    >{t(`workflows.input.iterationField.${field}`)}</Text>
                </Pressable>
            ))}
            {props.onRemove === undefined ? null : (
                <Pressable accessibilityRole="button" onPress={props.onRemove} style={workflowEditorStyles.actionTarget}>
                    <Text style={workflowEditorStyles.issueText}>{t('workflows.editor.remove')}</Text>
                </Pressable>
            )}
        </View>
    );
}

export function WorkflowStepDataEditor(props: Readonly<{
    draft: WorkflowEditorDraft;
    step: WorkflowStep;
    onChangeInput: (input: readonly WorkflowValueReference[]) => void;
    onChangeResult: (result: WorkflowResultContract) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const id = `${props.testIDPrefix}-step-${props.step.id}`;
    return (
        <View>
            <View style={workflowEditorStyles.metaRow}>
                <Text style={workflowEditorStyles.metaText}>{t('workflows.input.label')}</Text>
                <Pressable
                    testID={`${id}-add-input`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.inputs.addInput')}
                    onPress={() => props.onChangeInput([...props.step.input, { kind: 'literal', value: '' }])}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={workflowEditorStyles.metaAction}>{t('workflows.editor.add')}</Text>
                </Pressable>
            </View>
            {props.step.input.map((reference, index) => (
                <WorkflowValueReferenceEditor
                    key={index}
                    reference={reference}
                    index={index}
                    draft={props.draft}
                    stepId={props.step.id}
                    onChange={(value) => props.onChangeInput(props.step.input.map((current, candidate) => (
                        candidate === index ? value : current
                    )))}
                    onRemove={() => props.onChangeInput(props.step.input.filter((_current, candidate) => candidate !== index))}
                    // Rows are addressed by their step, exactly as the loop editors
                    // address theirs; the bare editor prefix gave every step's first
                    // input the same identity.
                    testIDPrefix={id}
                />
            ))}
            {props.step.result.kind === 'decision' ? null : (
                <View style={workflowEditorStyles.metaRow}>
                    <Text style={workflowEditorStyles.metaText}>{t('workflows.finalOutput.title')}</Text>
                    <Pressable
                        testID={`${id}-result-text`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: props.step.result.kind === 'text' }}
                        onPress={() => props.onChangeResult({ kind: 'text' })}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={props.step.result.kind === 'text'
                            ? workflowEditorStyles.metaAction
                            : workflowEditorStyles.metaText}
                        >{t('workflows.inputs.typeString')}</Text>
                    </Pressable>
                    <Pressable
                        testID={`${id}-result-json`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: props.step.result.kind === 'json' }}
                        onPress={() => props.onChangeResult(props.step.result.kind === 'json'
                            ? props.step.result
                            : { kind: 'json', schema: { type: 'object' } })}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={props.step.result.kind === 'json'
                            ? workflowEditorStyles.metaAction
                            : workflowEditorStyles.metaText}
                        >{t('workflows.inputs.typeJson')}</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}
