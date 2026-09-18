import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';

import type { JsonValue } from '@happier-dev/protocol';
import type { WorkflowInputDefinition } from '@happier-dev/protocol/workflows/workflowV1';

import {
    buildWorkflowRunStartInputs,
    projectWorkflowRunInputFields,
} from '@/sync/domains/workflows/workflowAuthoring';
import { describeWorkflowInputRepair } from '@/components/workflows/presentation/workflowBlockedReasonText';

/**
 * The Run-now input sheet.
 *
 * Fields stay in authored declaration order; required status marks a field and
 * blocks the command but never reorders the form. Closing cancels only the
 * unsubmitted command — the draft is untouched.
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
    root: {
        gap: theme.margins.lg,
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    body: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    field: {
        gap: theme.margins.xs,
    },
    label: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    description: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    input: {
        ...Typography.default('regular'),
        color: theme.colors.input.text,
        backgroundColor: theme.colors.input.background,
        borderRadius: theme.borderRadius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.surface,
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.sm,
    },
    inputInvalid: {
        borderColor: theme.colors.text.destructive,
    },
    error: {
        ...Typography.default('regular'),
        color: theme.colors.text.destructive,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.lg,
    },
    primary: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.link,
    },
    disabled: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.disabled,
    },
    secondary: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
}));

function parseFieldText(definition: WorkflowInputDefinition, text: string): JsonValue | undefined {
    if (text.length === 0) return undefined;
    switch (definition.valueType) {
        case 'string':
            return text;
        case 'number': {
            const parsed = Number(text);
            return Number.isFinite(parsed) ? parsed : text;
        }
        case 'boolean': {
            const normalized = text.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
            return text;
        }
        case 'json':
            try {
                return JSON.parse(text) as JsonValue;
            } catch {
                // Keep the raw text so the type error is reported by the one
                // projection rather than silently discarding what was typed.
                return text;
            }
    }
}

function formatFieldValue(value: JsonValue | undefined): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

export function WorkflowRunInputSheet(props: Readonly<{
    inputs: readonly WorkflowInputDefinition[];
    /** Retained in the pending draft so reopening the sheet keeps what was typed. */
    values: Readonly<Record<string, JsonValue | undefined>>;
    onChangeValues: (next: Readonly<Record<string, JsonValue | undefined>>) => void;
    onRun: (inputs: Readonly<Record<string, JsonValue>> | undefined) => void;
    onCancel: () => void;
    pending?: boolean;
    testIDPrefix?: string;
}>): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-run-inputs';
    const fields = React.useMemo(
        () => projectWorkflowRunInputFields({ inputs: props.inputs, values: props.values }),
        [props.inputs, props.values],
    );
    const firstBlocking = fields.find((field) => field.blocking) ?? null;
    const runDisabled = props.pending === true || firstBlocking !== null;
    // The disabled primary action carries its first blocking reason itself, so
    // anyone who reaches it directly — rather than reading the sentence beneath
    // the form — is told why it cannot proceed.
    const runBlockedReason = firstBlocking === null
        ? null
        : firstBlocking.errorCode === 'missing_required_input'
            ? t('workflows.inputs.missingRequired')
            : t('workflows.issue.invalid_input');

    const submit = React.useCallback(() => {
        if (runDisabled) return;
        props.onRun(buildWorkflowRunStartInputs(fields));
    }, [fields, props, runDisabled]);

    return (
        <View testID={testIDPrefix} style={styles.root}>
            <View>
                <Text style={styles.title}>{t('workflows.inputs.runSheetTitle')}</Text>
                <Text style={styles.body}>{t('workflows.inputs.runSheetBody')}</Text>
            </View>

            {fields.map((field) => {
                const fieldId = `${testIDPrefix}-${field.definition.name}`;
                const repair = describeWorkflowInputRepair({
                    valueType: field.definition.valueType,
                    errorCode: field.errorCode,
                });
                return (
                    <View key={field.definition.name} style={styles.field}>
                        <Text style={styles.label}>
                            {field.definition.name}
                            {field.definition.required ? ` · ${t('workflows.inputs.required')}` : ''}
                        </Text>
                        {field.definition.description === undefined ? null : (
                            <Text style={styles.description}>{field.definition.description}</Text>
                        )}
                        <TextInput
                            testID={fieldId}
                            style={[styles.input, field.blocking ? styles.inputInvalid : null]}
                            value={formatFieldValue(field.value)}
                            accessibilityLabel={field.definition.name}
                            // The same association the editor's own fields use: the
                            // repair reaches assistive technology on the field it
                            // belongs to, not only as nearby text.
                            {...(repair === null ? {} : { accessibilityHint: repair })}
                            onChangeText={(text) => props.onChangeValues({
                                ...props.values,
                                [field.definition.name]: parseFieldText(field.definition, text),
                            })}
                        />
                        {repair === null ? null : (
                            <Text
                                testID={`${fieldId}-error`}
                                accessibilityRole="alert"
                                style={styles.error}
                            >
                                {repair}
                            </Text>
                        )}
                    </View>
                );
            })}

            <View style={styles.actions}>
                <Pressable
                    testID={`${testIDPrefix}-run`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.editor.runNow')}
                    // A refused Run names its first repairable issue on the
                    // control itself; the sentence below the form is not
                    // reachable from a control read in isolation.
                    {...(runBlockedReason === null ? {} : { accessibilityHint: runBlockedReason })}
                    accessibilityState={{ disabled: runDisabled }}
                    disabled={runDisabled}
                    onPress={submit}
                    style={styles.actionTarget}
                >
                    <Text style={runDisabled ? styles.disabled : styles.primary}>
                        {t('workflows.editor.runNow')}
                    </Text>
                </Pressable>
                <Pressable
                    testID={`${testIDPrefix}-cancel`}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={props.onCancel}
                    style={styles.actionTarget}
                >
                    <Text style={styles.secondary}>{t('common.cancel')}</Text>
                </Pressable>
            </View>

            {/* The disabled primary action always names its first repairable issue. */}
            {runBlockedReason === null ? null : (
                <Text testID={`${testIDPrefix}-reason`} style={styles.body}>
                    {runBlockedReason}
                </Text>
            )}
        </View>
    );
}
