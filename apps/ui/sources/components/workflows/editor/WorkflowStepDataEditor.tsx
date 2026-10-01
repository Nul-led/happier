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
import { workflowBlockReferenceLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import { findWorkflowBlock } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';
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
    // A step's result is not the workflow's Final output; only the one root
    // binding is, so the reference kind carries its own name.
    if (kind === 'result') return t('workflows.input.result');
    if (kind === 'workspace') return t('workflows.workspace.title');
    if (kind === 'item') return t('workflows.input.currentItem');
    return t('workflows.input.iteration');
}

/**
 * A reference read as words ("Workflow input files", "Check the build result ·
 * verdict", "Item value"): the one reading Step options sentences, container
 * headings and condition summaries share, so a reference is never worded two
 * ways.
 */
export function formatWorkflowValueReference(draft: WorkflowEditorDraft, reference: WorkflowValueReference): string {
    const blockLabel = (blockId: string) => {
        const block = findWorkflowBlock(draft, blockId);
        return block === null ? blockId : workflowBlockReferenceLabel(block);
    };
    const withPath = (label: string, path: readonly (string | number)[] | undefined) => (
        path === undefined || path.length === 0 ? label : `${label} · ${path.join('.')}`
    );
    switch (reference.kind) {
        case 'literal':
            return typeof reference.value === 'string' ? `“${reference.value}”` : JSON.stringify(reference.value);
        case 'input':
            return t('workflows.input.workflowInput', { name: reference.name });
        case 'result':
            return withPath(t('workflows.input.previousResult', { block: blockLabel(reference.producer.blockId) }), reference.path);
        case 'loop_trailing_count':
            return withPath(t('workflows.input.previousResult', { block: blockLabel(reference.producer.blockId) }), reference.path);
        case 'workspace':
            return `${t('workflows.workspace.title')} · ${blockLabel(reference.producer.blockId)}`;
        case 'item':
            return withPath(t(`workflows.input.itemField.${reference.field}`), reference.path);
        default:
            return referenceKindLabel(reference.kind);
    }
}

/** What a result contract returns, in the footer and in Step options' Result row. */
export function formatWorkflowResultSummary(result: WorkflowResultContract | undefined): string {
    if (result === undefined || result.kind === 'text') return t('workflows.page.blocks.returnsText');
    if (result.kind === 'json') return t('workflows.page.inspector.returnsStructured');
    return t('workflows.page.inspector.returnsDecision');
}

/** One mutually exclusive choice set: a labelled radiogroup row of radio chips. */
function ChoiceGroup(props: Readonly<{
    label: string;
    children: React.ReactNode;
}>): React.ReactElement {
    return (
        <View style={workflowEditorStyles.metaRow} accessibilityRole="radiogroup" accessibilityLabel={props.label}>
            {props.children}
        </View>
    );
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
    /**
     * Draws a literal value with the consumer's own field (an Action field's
     * options picker), in place of the plain text entry. The binding stays this
     * owner's: the callback receives the literal and reports the next one.
     */
    renderLiteral?: (value: unknown, onChange: (next: unknown) => void) => React.ReactNode;
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
    const kinds = [
        'literal',
        'input',
        'result',
        'workspace',
        ...(scopeFacts.insideItemsLoop || itemReference !== undefined ? ['item' as const] : []),
        ...(scopeFacts.insideLoop || iterationReference !== undefined ? ['iteration' as const] : []),
    ] as const satisfies readonly WorkflowValueReference['kind'][];
    const setKind = (kind: (typeof kinds)[number]): void => {
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
            <ChoiceGroup label={t('workflows.input.valueKindGroup')}>
                {kinds.map((kind) => (
                    <Pressable
                        key={kind}
                        testID={`${rowId}-kind-${kind}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: reference.kind === kind }}
                        accessibilityLabel={referenceKindLabel(kind)}
                        onPress={() => setKind(kind)}
                        style={workflowEditorStyles.actionTarget}
                    >
                        <Text style={reference.kind === kind
                            ? workflowEditorStyles.metaAction
                            : workflowEditorStyles.metaText}
                        >{referenceKindLabel(kind)}</Text>
                    </Pressable>
                ))}
            </ChoiceGroup>
            {reference.kind === 'literal' && props.renderLiteral !== undefined
                ? props.renderLiteral(reference.value, (next) => props.onChange({
                    kind: 'literal',
                    value: next as Extract<WorkflowValueReference, { kind: 'literal' }>['value'],
                }))
                : null}
            {reference.kind === 'literal' && props.renderLiteral === undefined ? (
                <TextInput
                    testID={`${rowId}-literal`}
                    style={workflowEditorStyles.inlineValue}
                    value={literalText(reference.value)}
                    accessibilityLabel={t('workflows.condition.valuePlaceholder')}
                    onChangeText={(value) => props.onChange({ kind: 'literal', value: parseLiteral(value) })}
                />
            ) : null}
            {inputName === undefined ? null : (
                <ChoiceGroup label={t('workflows.input.inputNameGroup')}>
                    {props.draft.inputs.map((input) => (
                        <Pressable
                            key={input.name}
                            testID={`${rowId}-input-name-${input.name}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: inputName === input.name }}
                            accessibilityLabel={input.name}
                            onPress={() => props.onChange({ kind: 'input', name: input.name })}
                            style={workflowEditorStyles.actionTarget}
                        >
                            <Text style={inputName === input.name
                                ? workflowEditorStyles.metaAction
                                : workflowEditorStyles.metaText}
                            >{input.name}</Text>
                        </Pressable>
                    ))}
                </ChoiceGroup>
            )}
            {producerReference === undefined ? null : (
                <ChoiceGroup label={t('workflows.input.producerGroup')}>
                    {producers.map((producer) => (
                        <Pressable
                            key={`${producer.blockId}:${producer.scope.kind}:${producer.scope.kind === 'outer'
                                ? producer.scope.levels
                                : producer.scope.kind === 'previous_iteration' ? producer.scope.loopBlockId : ''}`}
                            testID={`${rowId}-producer-${producer.blockId}-${scopeKey(producer.scope)}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: producerReference.producer.blockId === producer.blockId
                                && JSON.stringify(producerReference.producer.scope) === JSON.stringify(producer.scope) }}
                            accessibilityLabel={`${producer.label} · ${scopeLabel(producer.scope)}`}
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
                </ChoiceGroup>
            )}
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
            {workspaceReference === undefined ? null : (
                <ChoiceGroup label={t('workflows.input.workspaceFieldGroup')}>
                    {(['directory', 'checkoutRootPath'] as const).map((field) => (
                        <Pressable
                            key={field}
                            testID={`${rowId}-workspace-field-${field}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: workspaceReference.field === field }}
                            accessibilityLabel={field === 'directory'
                                ? t('workflows.workspace.title')
                                : t('workflows.workspace.projectCheckout')}
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
                </ChoiceGroup>
            )}
            {itemReference === undefined ? null : (
                <ChoiceGroup label={t('workflows.input.itemFieldGroup')}>
                    {ITEM_REFERENCE_FIELDS.map((field) => (
                        <Pressable
                            key={field}
                            testID={`${rowId}-item-field-${field}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: itemReference.field === field }}
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
                </ChoiceGroup>
            )}
            {iterationReference === undefined ? null : (
                <ChoiceGroup label={t('workflows.input.iterationFieldGroup')}>
                    {ITERATION_REFERENCE_FIELDS.map((field) => (
                        <Pressable
                            key={field}
                            testID={`${rowId}-iteration-field-${field}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: iterationReference.field === field }}
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
                </ChoiceGroup>
            )}
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
            <Text testID={`${id}-returns`} style={workflowEditorStyles.groupSummary}>
                {formatWorkflowResultSummary(props.step.result)}
            </Text>
        </View>
    );
}
