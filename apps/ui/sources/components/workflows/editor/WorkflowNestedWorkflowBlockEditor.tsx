import * as React from 'react';
import { View } from 'react-native';

import {
    parseWorkflowDefinitionRefV1,
    resolveBuiltinWorkflowDefinitionV1,
} from '@happier-dev/protocol/workflows';
import type { WorkflowNestedLeafV1 } from '@happier-dev/protocol/workflows/workflowLeafV1';
import type { WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type { WorkflowInputDefinition } from '@happier-dev/protocol/workflows/workflowV1';

import { Text } from '@/components/ui/text/Text';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { t } from '@/text';

import type { WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowBlockHeading } from './WorkflowBlockHeading';
import { formatWorkflowConditionSentence } from './WorkflowConditionEditor';
import { WorkflowContainerSummary } from './WorkflowContainerSummary';
import type { WorkflowDocumentStepSlots } from './workflowDocumentPresentation';
import {
    listBuiltinWorkflowReferenceOptions,
    useWorkflowLibraryReferenceOptions,
} from '@/components/workflows/presentation/workflowReferenceOptions';

import { workflowEditorStyles } from './workflowEditorStyles';
import { WorkflowValueReferenceEditor } from './WorkflowStepDataEditor';

/** The child's declared inputs where this client can read them (built-ins); `null` when it cannot. */
function readChildInputs(workflowRef: string): readonly WorkflowInputDefinition[] | null {
    const parsed = parseWorkflowDefinitionRefV1(workflowRef);
    if (parsed?.kind !== 'builtin') return null;
    return resolveBuiltinWorkflowDefinitionV1(parsed.id)?.definition.inputs ?? null;
}

/**
 * A Run a workflow step (U4, 04 §4.3): the child named with its origin, "Runs
 * another workflow · its steps show in this run", and its declared inputs as
 * rows bound by reference. Inputs already bound but not declared (a child this
 * client cannot read, or one that changed) stay visible.
 */
export function WorkflowNestedWorkflowBlockEditor(props: Readonly<{
    block: WorkflowNestedLeafV1;
    draft: WorkflowEditorDraft;
    ordinal: number;
    total: number;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeBlock: (next: WorkflowNestedLeafV1) => void;
    editable?: boolean;
    slots?: WorkflowDocumentStepSlots | null;
    /** Opens this block's Step options, anchored beside its options control; absent when read-only. */
    onOpenOptions?: (anchorRef: React.RefObject<View | null>) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const { block, testIDPrefix } = props;
    const editable = props.editable !== false;
    const libraryOptions = useWorkflowLibraryReferenceOptions();
    const known = [...listBuiltinWorkflowReferenceOptions(), ...libraryOptions]
        .find((option) => option.ref === block.workflowRef) ?? null;
    const displayName = known?.title ?? block.workflowRef;
    const declared = React.useMemo(() => readChildInputs(block.workflowRef), [block.workflowRef]);
    const inputNames = React.useMemo(() => {
        const names = (declared ?? []).map((input) => input.name);
        for (const name of Object.keys(block.input)) if (!names.includes(name)) names.push(name);
        return names;
    }, [block.input, declared]);
    const rowPrefix = `${testIDPrefix}-workflow-${block.id}`;

    const setBinding = (name: string, binding: WorkflowValueReference | undefined) => {
        const { [name]: _previous, ...rest } = block.input;
        props.onChangeBlock({ ...block, input: binding === undefined ? rest : { ...rest, [name]: binding } });
    };

    return (
        <View testID={rowPrefix} style={workflowEditorStyles.blockBody}>
            <WorkflowBlockHeading
                ordinal={props.ordinal}
                displayName={known?.origin === 'builtin' ? `${displayName} · ${t('workflows.page.blocks.builtin')}` : displayName}
                accessibilityLabel={t('workflows.a11y.stepContext', { block: displayName, position: props.ordinal, total: props.total })}
                actions={editable ? props.actions : []}
                accessory={props.slots?.state}
                onSelect={props.onSelect}
                testID={`${rowPrefix}-label`}
                actionsTestID={`${rowPrefix}-actions`}
            />
            {props.onOpenOptions === undefined || props.editable === false ? null : (
                <WorkflowContainerSummary
                    sentence={props.block.onlyWhen === undefined
                        ? t('workflows.page.inspector.stepOptions')
                        : t('workflows.page.inspector.onlyWhenSentence', {
                            condition: formatWorkflowConditionSentence(props.draft, props.block.onlyWhen),
                        })}
                    onOpenOptions={props.onOpenOptions}
                    optionsLabel={t('workflows.page.inspector.stepOptions')}
                    testID={`${rowPrefix}-options`}
                />
            )}
            <Text style={workflowEditorStyles.metaText}>{t('workflows.page.blocks.workflowSub')}</Text>
            {inputNames.length === 0 && declared === null ? (
                <Text style={workflowEditorStyles.groupSummary}>
                    {t('workflows.page.blocks.childInputs', { workflow: displayName })}
                </Text>
            ) : null}
            {inputNames.map((name) => {
                const binding = block.input[name];
                const declaration = declared?.find((input) => input.name === name);
                const fieldId = `${rowPrefix}-input-${name}`;
                return (
                    <View key={name} testID={fieldId} style={workflowEditorStyles.actionFieldRow}>
                        <View style={workflowEditorStyles.metaRow}>
                            <Text style={workflowEditorStyles.actionFieldLabel}>{name}</Text>
                            {declaration?.required === true ? (
                                <Text style={workflowEditorStyles.groupSummary}>{t('workflows.page.blocks.required')}</Text>
                            ) : null}
                        </View>
                        <WorkflowValueReferenceEditor
                            reference={binding ?? { kind: 'literal', value: '' }}
                            index={0}
                            draft={props.draft}
                            stepId={block.id}
                            onChange={(next) => setBinding(name, next)}
                            {...(binding === undefined || !editable || declaration?.required === true
                                ? {}
                                : { onRemove: () => setBinding(name, undefined) })}
                            testIDPrefix={fieldId}
                        />
                    </View>
                );
            })}
        </View>
    );
}
