import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierSelect } from '@happier-dev/plugin-ui/presentation';
import type { JsonValue } from '@happier-dev/protocol';
import type { WorkflowInputDefinition } from '@happier-dev/protocol/workflows/workflowV1';
import { actionInputOptionValueKey, isSameActionInputOptionValue, readActionInputOptionValue } from '@happier-dev/protocol/actions/actionInputHintsRuntime';
import { AgentInput } from '@/components/sessions/agentInput';
import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { createExecutionRunStartContentChip } from '@/components/sessions/runs/launcher/executionRunStartChips';
import { useActionFieldOptionsForMachine } from '@/components/sessions/actions/useSessionActionFieldOptions';
import { projectPluginUiTheme } from '@/components/plugins/surfaces/pluginUiThemeProjection';
import { PluginContextualResourceStoreProvider } from '@/components/plugins/surfaces/PluginContextualResourceStoreProvider';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { buildWorkflowRunStartInputs, projectWorkflowRunInputFields, type WorkflowRunInputFieldState } from '@/sync/domains/workflows/workflowAuthoring';
import { formatWorkflowInputValue } from '@/sync/domains/workflows/workflowInputText';
import { describeWorkflowInputRepair } from '@/components/workflows/presentation/workflowBlockedReasonText';

const styles = StyleSheet.create((theme) => ({
    root: { gap: theme.margins.md, minWidth: 0 },
    fields: { gap: theme.margins.md, padding: theme.margins.md },
    secondary: { color: theme.colors.text.secondary },
    required: { color: theme.colors.text.destructive },
}));

const EMPTY_AUTOCOMPLETE_KINDS: React.ComponentProps<typeof AgentInput>['autocompleteKinds'] = [];
const EMPTY_AUTOCOMPLETE_SUGGESTIONS: React.ComponentProps<typeof AgentInput>['autocompleteSuggestions'] = async () => [];

export type WorkflowRunComposerProps = Readonly<{
    inputs: readonly WorkflowInputDefinition[];
    values: Readonly<Record<string, JsonValue | undefined>>;
    onChangeValues: (next: Readonly<Record<string, JsonValue | undefined>>) => void;
    rawTextValues?: Readonly<Record<string, string>>;
    onChangeRawTextValues?: (next: Readonly<Record<string, string>>) => void;
    onRun: (inputs: Readonly<Record<string, JsonValue>> | undefined) => void;
    onCancel: () => void;
    pending?: boolean;
    startDisabled?: boolean;
    testIDPrefix?: string;
    workflowName?: string;
    preview?: string;
    includesUnsavedEdits?: boolean;
    machineId?: string | null;
    serverId?: string | null;
    /** Where and Roles come from their incumbent composer control owners. */
    extraActionChips?: readonly AgentInputExtraActionChip[];
    workflowChip?: AgentInputExtraActionChip;
    /** Retained, but never submitted, when the selection has no text input. */
    retainedText?: string;
    authoringControls?: Pick<React.ComponentProps<typeof AgentInput>,
        'machineName' | 'machinePopover' | 'currentPath' | 'folderChipState' | 'onRemoveFolder' | 'pathPopover'>;
}>;

/** One start presentation; FIN owns defaults, validation and the admitted input map. */
export function WorkflowRunComposer(props: WorkflowRunComposerProps): React.ReactElement {
    const prefix = props.testIDPrefix ?? 'workflow-run-inputs';
    const [localRawTextValues, setLocalRawTextValues] = React.useState<Readonly<Record<string, string>>>({});
    const rawTextValues = props.rawTextValues ?? localRawTextValues;
    const setRawTextValues = props.onChangeRawTextValues ?? setLocalRawTextValues;
    const fields = React.useMemo(() => projectWorkflowRunInputFields({
        inputs: props.inputs, values: props.values, rawTextValues,
    }), [props.inputs, props.values, rawTextValues]);
    const main = fields.find((field) => field.definition.valueType === 'string') ?? null;
    const remaining = fields.filter((field) => field !== main);
    const missing = fields.filter((field) => field.errorCode === 'missing_required_input').length;
    const blocked = fields.find((field) => field.blocking) ?? null;
    const disabled = props.pending === true || props.startDisabled === true || blocked !== null;
    const reason = blocked === null ? null : blocked.errorCode === 'missing_required_input'
        ? t('workflows.start.required') : t('workflows.issue.invalid_input');
    const changeText = React.useCallback((name: string, text: string) => {
        // Raw buffers survive intermediate numbers and malformed JSON. Only FIN parses them.
        setRawTextValues({ ...rawTextValues, [name]: text });
    }, [rawTextValues, setRawTextValues]);
    const changeValue = React.useCallback((name: string, value: JsonValue | undefined) => {
        const next = { ...rawTextValues };
        delete next[name];
        setRawTextValues(next);
        props.onChangeValues({ ...props.values, [name]: value });
    }, [props.onChangeValues, props.values, rawTextValues, setRawTextValues]);
    const submit = React.useCallback(() => {
        if (disabled) return;
        props.onRun(buildWorkflowRunStartInputs(fields));
    }, [disabled, fields, props.onRun]);
    const chips = React.useMemo<readonly AgentInputExtraActionChip[]>(() => [
        ...(props.workflowChip ? [props.workflowChip] : [createExecutionRunStartContentChip({
            key: 'workflow-start-definition', icon: 'git-branch', label: props.workflowName ?? t('workflows.start.workflow'),
            title: t('workflows.start.workflow'), testID: `${prefix}-workflow-chip`,
            renderContent: <View style={styles.fields}><Text>{props.preview ?? props.workflowName ?? t('workflows.start.preview')}</Text></View>,
        })]),
        ...(remaining.length === 0 ? [] : [createExecutionRunStartContentChip({
            key: 'workflow-start-inputs', icon: 'sliders-horizontal',
            label: missing > 0 ? t('workflows.start.needed', { count: missing }) : t('workflows.start.inputs'),
            title: t('workflows.start.inputs'), testID: `${prefix}-inputs-chip`,
            revision: JSON.stringify([props.values, rawTextValues]),
            renderContent: <WorkflowRunInputs fields={remaining} values={props.values} rawTextValues={rawTextValues}
                onChangeText={changeText} onChangeValue={changeValue} pending={props.pending === true}
                machineId={props.machineId ?? null} serverId={props.serverId ?? null} prefix={prefix} />,
        })]),
        ...(props.extraActionChips ?? []),
    ].map((chip) => ({
        ...chip,
        ...(chip.key === 'workflow-start-definition' ? { controlId: 'workflow' as const }
            : chip.key === 'workflow-start-inputs' ? { controlId: 'workflowInputs' as const } : {}),
    })), [changeText, changeValue, missing, prefix, props.extraActionChips, props.machineId, props.pending,
        props.preview, props.serverId, props.values, props.workflowChip, props.workflowName, rawTextValues, remaining]);
    return (
        <View testID={prefix} style={styles.root}>
            {props.includesUnsavedEdits ? <Text testID={`${prefix}-unsaved`} style={styles.secondary}>{t('workflows.start.unsaved')}</Text> : null}
            <View testID={`${prefix}-${main === null ? 'preview' : 'main'}`}>
                <PluginContextualResourceStoreProvider>
                    <AgentInput
                        {...props.authoringControls}
                        value={main === null ? props.preview ?? props.workflowName ?? t('workflows.start.preview')
                            : rawTextValues[main.definition.name] ?? formatWorkflowInputValue(main.value)}
                        onChangeText={(text) => { if (main !== null) changeText(main.definition.name, text); }}
                        placeholder={main?.definition.description ?? main?.definition.name ?? t('workflows.start.preview')}
                        inputAccessibilityLabel={main?.definition.name ?? t('workflows.start.preview')}
                        inputAccessibilityHint={main?.blocking ? reason ?? undefined : undefined}
                        disabled={props.pending === true || main === null}
                        voiceAffordance="none"
                        autocompleteKinds={EMPTY_AUTOCOMPLETE_KINDS}
                        autocompleteSuggestions={EMPTY_AUTOCOMPLETE_SUGGESTIONS}
                        barControlIds={[...new Set([
                            ...chips.flatMap((chip) => chip.controlId ? [chip.controlId] : []),
                            ...(props.authoringControls ? ['machine' as const, 'path' as const] : []),
                        ])]}
                        extraActionChips={chips}
                        autoActionBarLayout="collapsed"
                        collapseEmptyStatusRow
                        trailingAccessory={<RoundButton testID={`${prefix}-run`} size="small"
                            title={props.pending ? t('workflows.start.starting') : t('workflows.start.start')}
                            disabled={disabled} loading={props.pending}
                            accessibilityHint={reason ?? undefined} onPress={submit} />}
                    />
                </PluginContextualResourceStoreProvider>
            </View>
            {main === null && props.retainedText ? <Text testID={`${prefix}-retained-text`} style={styles.secondary}>{props.retainedText}</Text> : null}
            {reason === null ? null : <Text testID={`${prefix}-reason`} accessibilityRole="alert" style={styles.required}>{reason}</Text>}
            <RoundButton testID={`${prefix}-cancel`} size="small" display="inverted" title={t('common.cancel')} onPress={props.onCancel} />
        </View>
    );
}

/** Only mounted while Inputs is open; option reads stay local to this leaf. */
function WorkflowRunInputs(props: Readonly<{
    fields: readonly WorkflowRunInputFieldState[];
    values: WorkflowRunComposerProps['values'];
    rawTextValues: Readonly<Record<string, string>>;
    onChangeText: (name: string, text: string) => void;
    onChangeValue: (name: string, value: JsonValue | undefined) => void;
    pending: boolean;
    machineId: string | null;
    serverId: string | null;
    prefix: string;
}>) {
    const { theme } = useUnistyles();
    const selectTheme = React.useMemo(() => projectPluginUiTheme(theme), [theme]);
    const resolveOptions = useActionFieldOptionsForMachine({
        machineId: props.machineId, serverId: props.serverId,
        enabled: props.fields.some((field) => field.definition.optionsSourceId !== undefined),
    });
    return <View style={styles.fields}>{props.fields.map((field) => {
        const definition = field.definition;
        const id = `${props.prefix}-${definition.name}`;
        const repair = field.errorCode === 'missing_required_input' ? t('workflows.start.required')
            : describeWorkflowInputRepair({ valueType: definition.valueType, errorCode: field.errorCode });
        const state = props.values[definition.name] === undefined && props.rawTextValues[definition.name] === undefined
            ? definition.default === undefined ? t('workflows.start.optional')
                : t('workflows.start.defaultValue', { value: formatWorkflowInputValue(definition.default) })
            : definition.description;
        if (definition.optionsSourceId !== undefined || definition.enum !== undefined) {
            const options = resolveOptions({
                optionsSourceId: definition.optionsSourceId,
                options: definition.enum?.map((value) => ({ value, label: value })),
            });
            const selected = Array.isArray(field.value)
                ? field.value.flatMap((value) => {
                    const option = readActionInputOptionValue(value);
                    return option === undefined ? [] : [option];
                })
                : readActionInputOptionValue(field.value);
            return <FieldItem key={definition.name} label={definition.name} supportingText={repair ?? state}>
                <HappierSelect label={definition.name} options={options}
                    value={selected} multiple={Array.isArray(field.value) || (field.value === undefined && definition.valueType === 'json')}
                    isEqual={isSameActionInputOptionValue} keyForOption={(option) => actionInputOptionValueKey(option.value)}
                    theme={selectTheme} disabled={props.pending}
                    onChange={(value) => props.onChangeValue(definition.name, Array.isArray(value) ? [...value] : readActionInputOptionValue(value))} />
            </FieldItem>;
        }
        if (definition.valueType === 'boolean') return <SegmentedChoiceItem
            key={definition.name} title={definition.name} subtitle={repair ?? state}
            value={field.value === true ? 'yes' : field.value === false ? 'no' : 'unset'}
            options={[
                ...(!definition.required ? [{ id: 'unset', label: t('common.notSet') }] : []),
                { id: 'yes', label: t('common.yes') }, { id: 'no', label: t('common.no') },
            ]}
            onChange={(value) => props.onChangeValue(definition.name, value === 'unset' ? undefined : value === 'yes')}
            disabled={props.pending} testIDPrefix={id} />;
        const value = props.rawTextValues[definition.name] ?? (definition.valueType === 'json' && field.value !== undefined
            ? JSON.stringify(field.value) : formatWorkflowInputValue(field.value));
        return <FieldItem key={definition.name} label={definition.name} supportingText={state}>
            <FieldTextInput testID={id} value={value}
                accessibilityLabel={definition.name} error={repair}
                multiline={definition.valueType !== 'number'} monospace={definition.valueType === 'json'}
                inputMode={definition.valueType === 'number' ? 'decimal' : undefined}
                editable={!props.pending} onChangeText={(text) => props.onChangeText(definition.name, text)} />
        </FieldItem>;
    })}</View>;
}
