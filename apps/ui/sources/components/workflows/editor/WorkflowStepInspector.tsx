import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';

import {
    WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS,
    type WorkflowStep,
    type WorkflowStepExecutionSelection,
} from '@happier-dev/protocol/workflows/workflowV1';

import {
    findSessionAuthoringAgentTargetOption,
    resolveSessionAuthoringFieldTitle,
    type SessionAuthoringControlFacts,
} from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';
import {
    resolveEffectiveWorkflowStepExecution,
    resolveWorkflowStepFieldInheritance,
} from '@/sync/domains/workflows/workflowAuthoring';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { workflowStepPromptLabel } from '@/sync/domains/workflows/workflowBlockLabel';

import { WorkflowNumberField } from './WorkflowNumberField';
import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * The selected step's settings, shown in the wide inspector or the phone
 * focused-detail presentation. Both use this one composition and the same
 * selected-step owner, so switching layout never changes what can be authored.
 *
 * Value editing is delegated to `renderFieldControl`, which the host fills from
 * the shared Session-authoring controls. This module owns the part that is
 * workflow-specific: whether a field is inherited or explicitly overridden, and
 * the reset that returns it to the workflow default. An override equal to the
 * current default stays visibly explicit.
 */

const styles = StyleSheet.create((theme) => ({
    root: {
        gap: theme.margins.md,
    },
    scopeLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
    },
    fieldRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingVertical: theme.margins.xs,
    },
    fieldName: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    inheritedBadge: {
        ...Typography.default('regular'),
        color: theme.colors.text.tertiary,
    },
    overrideBadge: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
    },
    resetAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
        marginLeft: 'auto',
    },
    control: {
        paddingBottom: theme.margins.sm,
    },
}));

export type WorkflowStepInspectorFieldId = (typeof WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS)[number];

export function WorkflowStepInspector(props: Readonly<{
    draft: WorkflowEditorDraft;
    step: WorkflowStep;
    /**
     * The host supplies the canonical Session-authoring control for a field.
     * Returning `null` means this build cannot edit that field's value yet; the
     * inheritance state and reset still render, so nothing is silently hidden.
     */
    renderFieldControl?: (params: Readonly<{
        field: WorkflowStepInspectorFieldId;
        effective: WorkflowStepExecutionSelection;
        inheritance: 'inherited' | 'override';
        onChange: (value: WorkflowStepExecutionSelection[WorkflowStepInspectorFieldId] | undefined) => void;
    }>) => React.ReactNode;
    onResetField: (field: WorkflowStepInspectorFieldId) => void;
    onChangeField: (
        field: WorkflowStepInspectorFieldId,
        value: WorkflowStepExecutionSelection[WorkflowStepInspectorFieldId] | undefined,
    ) => void;
    /**
     * The step's authored result-wait deadline. `undefined` clears it: omission
     * means no workflow-authored deadline, never a default duration.
     */
    onChangeTimeout: (timeoutMs: number | undefined) => void;
    /** Fields to show; defaults to the canonical chip order. */
    fields?: readonly WorkflowStepInspectorFieldId[];
    /**
     * The host's option sources. Only the selected Agent is read here, and only
     * so an Agent-named field can be named by the Agent that names it.
     */
    authoringFacts?: SessionAuthoringControlFacts;
    testIDPrefix?: string;
}>): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-inspector';
    const fields = props.fields ?? WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS;
    const effective = React.useMemo(
        () => resolveEffectiveWorkflowStepExecution(props.draft, props.step),
        [props.draft, props.step],
    );
    const selectedAgentTarget = React.useMemo(() => findSessionAuthoringAgentTargetOption(
        props.authoringFacts?.agentTargets,
        effective.agentTarget,
    ), [effective.agentTarget, props.authoringFacts?.agentTargets]);

    return (
        <View testID={testIDPrefix} style={styles.root}>
            <Text style={styles.scopeLabel}>
                {workflowStepPromptLabel(props.step) ?? props.step.id}
            </Text>

            <WorkflowNumberField
                label={t('workflows.editor.timeoutTitle')}
                value={props.step.timeoutMs}
                onChange={props.onChangeTimeout}
                placeholder={t('workflows.editor.noDeadline')}
                testID={`${testIDPrefix}-timeout`}
            />
            <Text style={styles.inheritedBadge}>{t('workflows.editor.timeoutExplain')}</Text>

            {fields.map((field) => {
                const inheritance = resolveWorkflowStepFieldInheritance(props.step, field);
                const fieldId = `${testIDPrefix}-${field}`;
                const control = props.renderFieldControl?.({
                    field,
                    effective,
                    inheritance,
                    onChange: (value) => props.onChangeField(field, value),
                });

                return (
                    <View key={field}>
                        <View style={styles.fieldRow}>
                            {/* The field's own canonical name, the same string
                                its picker is titled with. Agent-contributed
                                runtime copy wins over the localized generic
                                fallback. */}
                            <Text testID={fieldId} style={styles.fieldName}>
                                {resolveSessionAuthoringFieldTitle(field, selectedAgentTarget) ?? field}
                            </Text>
                            <Text
                                testID={`${fieldId}-state`}
                                style={inheritance === 'inherited' ? styles.inheritedBadge : styles.overrideBadge}
                            >
                                {inheritance === 'inherited'
                                    ? t('workflows.a11y.inherited')
                                    : t('workflows.a11y.overridden')}
                            </Text>
                            {inheritance === 'override' ? (
                                <Pressable
                                    testID={`${fieldId}-reset`}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('workflows.editor.useWorkflowDefault')}
                                    onPress={() => props.onResetField(field)}
                                    style={workflowEditorStyles.actionTarget}
                                >
                                    <Text style={styles.resetAction}>
                                        {t('workflows.editor.useWorkflowDefault')}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                        {control === null || control === undefined ? null : (
                            <View style={styles.control}>{control}</View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}
