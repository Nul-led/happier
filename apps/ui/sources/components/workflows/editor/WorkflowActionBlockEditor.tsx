import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { HappierPressable } from '@happier-dev/plugin-ui/presentation';

import type { ActionSpec } from '@happier-dev/protocol/actions/actionSpecs';
import type { EffectiveActionInputField } from '@happier-dev/protocol/actions/actionInputHintsRuntime';
import type { WorkflowActionFieldBindingV1, WorkflowActionLeafV1 } from '@happier-dev/protocol/workflows/workflowLeafV1';
import type { WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';

import { ActionInputFields } from '@/components/sessions/actions/ActionInputFields';
import { findWorkflowActionSpec } from '@/components/workflows/presentation/workflowActionCatalog';
import type { ResolveSessionActionFieldOptions } from '@/components/sessions/actions/sessionActionFieldOptions';
import { Text } from '@/components/ui/text/Text';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { t } from '@/text';

import type { WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowBlockHeading } from './WorkflowBlockHeading';
import { formatWorkflowConditionSentence } from './WorkflowConditionEditor';
import { WorkflowContainerSummary } from './WorkflowContainerSummary';
import type { WorkflowDocumentStepSlots } from './workflowDocumentPresentation';
import { workflowEditorStyles, workflowPressFeedbackStyle } from './workflowEditorStyles';
import { WorkflowValueReferenceEditor } from './WorkflowStepDataEditor';

/**
 * A field fed by an options source (for example `review.engines.available`,
 * the review-engine inventory) offers exactly what that source returns for
 * this Machine — never a static enum from the Action schema, and nothing
 * until the source answers (04 §5.3 E20).
 */
function resolveActionFieldChoices(
    field: EffectiveActionInputField,
    resolveFieldOptions: ResolveSessionActionFieldOptions | undefined,
) {
    const resolved = resolveFieldOptions?.(field);
    if (resolved !== undefined) return resolved;
    return field.optionsSourceId === undefined ? (field.options ?? []) : [];
}

/** The literal a newly set field starts from: an empty selection for a multi-select, empty text otherwise. */
function initialActionFieldLiteral(hint: EffectiveActionInputField | null): WorkflowActionFieldBindingV1 {
    return { kind: 'literal', value: hint?.widget === 'multiselect' ? [] : '' };
}

type ActionFieldRow = Readonly<{
    key: string;
    label: string;
    description?: string;
    required: boolean;
    /** The canonical hint, when the Action declares one: it draws a literal with its own widget. */
    hint: EffectiveActionInputField | null;
}>;

/**
 * One row per field of the Action's input: every declared top-level field, then
 * any field already bound that the declaration no longer lists (kept visible,
 * never dropped).
 */
function resolveActionFieldRows(spec: ActionSpec | null, input: WorkflowActionLeafV1['input']): readonly ActionFieldRow[] {
    const rows: ActionFieldRow[] = [];
    const seen = new Set<string>();
    for (const field of spec?.inputHints?.fields ?? []) {
        if (field.path.includes('.') || seen.has(field.path)) continue;
        seen.add(field.path);
        rows.push({
            key: field.path,
            label: field.title,
            ...(field.description === undefined ? {} : { description: field.description }),
            required: field.required === true,
            hint: { ...field, visible: true, required: field.required === true, disabled: false },
        });
    }
    for (const key of Object.keys(input)) {
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ key, label: key, required: false, hint: null });
    }
    return rows;
}

/**
 * An Action step (U4, 04 §4.3): the Action's name and "No agent turn", then one
 * row per input field, each bound on its own — a literal (drawn with the
 * Action's own field, options from the canonical options sources), a workflow
 * input, an earlier result, or the current item. The binding shape is the
 * leaf's (`WorkflowActionFieldBindingV1`); this owns only its presentation.
 */
export function WorkflowActionBlockEditor(props: Readonly<{
    block: WorkflowActionLeafV1;
    draft: WorkflowEditorDraft;
    ordinal: number;
    total: number;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeBlock: (next: WorkflowActionLeafV1) => void;
    resolveFieldOptions?: ResolveSessionActionFieldOptions;
    editable?: boolean;
    slots?: WorkflowDocumentStepSlots | null;
    /** Opens this block's Step options, anchored beside its options control; absent when read-only. */
    onOpenOptions?: (anchorRef: React.RefObject<View | null>) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const { block, testIDPrefix } = props;
    const { theme } = useUnistyles();
    const editable = props.editable !== false;
    const spec = React.useMemo(() => findWorkflowActionSpec(block.actionId), [block.actionId]);
    const rows = React.useMemo(() => resolveActionFieldRows(spec, block.input), [block.input, spec]);
    const displayName = spec?.title ?? block.actionId;
    const rowPrefix = `${testIDPrefix}-action-${block.id}`;

    const setBinding = (key: string, binding: WorkflowActionFieldBindingV1 | undefined) => {
        const { [key]: _previous, ...rest } = block.input;
        props.onChangeBlock({ ...block, input: binding === undefined ? rest : { ...rest, [key]: binding } });
    };

    return (
        <View testID={rowPrefix} style={workflowEditorStyles.blockBody}>
            <WorkflowBlockHeading
                ordinal={props.ordinal}
                displayName={displayName}
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
            <Text style={workflowEditorStyles.metaText}>
                {spec === null
                    ? t('workflows.page.blocks.actionUnavailable', { action: block.actionId })
                    : t('workflows.page.blocks.actionSub')}
            </Text>
            {rows.length === 0 ? (
                <Text style={workflowEditorStyles.groupSummary}>{t('workflows.page.blocks.noFields')}</Text>
            ) : rows.map((row) => {
                const binding = block.input[row.key];
                const fieldId = `${rowPrefix}-field-${row.key}`;
                return (
                    <View key={row.key} testID={fieldId} style={workflowEditorStyles.actionFieldRow}>
                        <View style={workflowEditorStyles.metaRow}>
                            <Text style={workflowEditorStyles.actionFieldLabel}>{row.label}</Text>
                            {row.required ? (
                                <Text style={workflowEditorStyles.groupSummary}>{t('workflows.page.blocks.required')}</Text>
                            ) : null}
                        </View>
                        {binding === undefined ? (
                            <View style={workflowEditorStyles.metaRow}>
                                <Text style={workflowEditorStyles.metaText}>{t('workflows.page.blocks.notSet')}</Text>
                                {editable ? (
                                    <HappierPressable
                                        testID={`${fieldId}-set`}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${t('workflows.page.blocks.set')} ${row.label}`}
                                        onPress={() => setBinding(row.key, initialActionFieldLiteral(row.hint))}
                                        style={(state) => [
                                            workflowEditorStyles.actionTarget,
                                            workflowPressFeedbackStyle(state, theme.colors.border.focus),
                                        ]}
                                    >
                                        <Text style={workflowEditorStyles.metaAction}>{t('workflows.page.blocks.set')}</Text>
                                    </HappierPressable>
                                ) : null}
                            </View>
                        ) : binding.kind === 'list' ? (
                            binding.items.map((item, index) => (
                                <WorkflowValueReferenceEditor
                                    key={index}
                                    reference={item as WorkflowValueReference}
                                    index={index}
                                    draft={props.draft}
                                    stepId={block.id}
                                    onChange={(next) => setBinding(row.key, {
                                        kind: 'list',
                                        items: binding.items.map((current, at) => (at === index ? next : current)),
                                    })}
                                    // One list item is one choice from the field's own options source.
                                    {...(row.hint === null || row.hint.widget !== 'multiselect' ? {} : {
                                        renderLiteral: (value: unknown, onChange: (next: unknown) => void) => (
                                            <ActionInputFields
                                                fields={[{ ...(row.hint as EffectiveActionInputField), widget: 'select' }]}
                                                input={{ [row.key]: value }}
                                                editable={editable}
                                                resolveFieldOptions={(field) => resolveActionFieldChoices(field, props.resolveFieldOptions)}
                                                onPatch={(patch) => onChange(patch[row.key])}
                                                resolveFieldTestID={() => `${fieldId}-item-${index}-literal`}
                                            />
                                        ),
                                    })}
                                    testIDPrefix={`${fieldId}-item-${index}`}
                                />
                            ))
                        ) : (
                            <WorkflowValueReferenceEditor
                                reference={binding as WorkflowValueReference}
                                index={0}
                                draft={props.draft}
                                stepId={block.id}
                                onChange={(next) => setBinding(row.key, next)}
                                {...(row.hint === null || row.hint.widget === 'json' ? {} : {
                                    renderLiteral: (value: unknown, onChange: (next: unknown) => void) => (
                                        <ActionInputFields
                                            fields={[row.hint as EffectiveActionInputField]}
                                            input={{ [row.key]: value }}
                                            editable={editable}
                                            resolveFieldOptions={(field) => resolveActionFieldChoices(field, props.resolveFieldOptions)}
                                            onPatch={(patch) => onChange(patch[row.key])}
                                            resolveFieldTestID={() => `${fieldId}-literal`}
                                        />
                                    ),
                                })}
                                {...(!editable || row.required ? {} : { onRemove: () => setBinding(row.key, undefined) })}
                                testIDPrefix={fieldId}
                            />
                        )}
                    </View>
                );
            })}
        </View>
    );
}
