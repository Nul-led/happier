import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierSelect } from '@happier-dev/plugin-ui/presentation';
import type { JsonValue, RoleOverrideV1, WorkflowDefinitionV1, WorkflowMaterializedLeafV1 } from '@happier-dev/protocol';
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
import { WorkflowAcceptedRunRoles, WorkflowRunRoles, workflowUsedRoleIds } from './WorkflowRunRoles';
import { useWorkflowRunRolePrefill } from './useWorkflowRunRolePrefill';
import { workflowBlockReferenceLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import { walkWorkflowBlocks } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';

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
    onRun: (inputs: Readonly<Record<string, JsonValue>> | undefined, roleOverrides?: readonly RoleOverrideV1[]) => void;
    definition?: WorkflowDefinitionV1;
    sourceArtifactId?: string | null;
    /** Accepted repeat facts: their presence makes targets and Roles read-only. */
    materializedLeaves?: readonly WorkflowMaterializedLeafV1[];
    roleOverrides?: readonly RoleOverrideV1[];
    onCancel: () => void;
    pending?: boolean;
    startDisabled?: boolean;
    testIDPrefix?: string;
    workflowName?: string;
    preview?: string;
    includesUnsavedEdits?: boolean;
    notice?: string;
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
    const roleIds = React.useMemo(() => props.definition ? workflowUsedRoleIds(props.definition) : [], [props.definition]);
    const acceptedRepeat = props.materializedLeaves !== undefined;
    const roleDraft = useWorkflowRunRolePrefill(!acceptedRepeat && roleIds.length > 0 ? props.sourceArtifactId : null);
    const roleOverrides = props.roleOverrides ?? roleDraft.overrides;
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
    // Mitigation until FIN admission carries frozen role/child context: flattened
    // definitions cannot replay role authority, and child refs read today's graph.
    const frozenRepeatUnavailable = props.materializedLeaves?.some((leaf) => leaf.sourceKey !== '$root' || leaf.role !== undefined) === true;
    const disabled = props.pending === true || props.startDisabled === true || blocked !== null
        || frozenRepeatUnavailable || (!acceptedRepeat && roleDraft.status !== 'ready');
    const reason = blocked === null ? (frozenRepeatUnavailable ? t('workflows.start.frozenRepeatUnavailable') : !acceptedRepeat && roleDraft.status !== 'ready'
        ? roleDraft.status === 'failed' ? t('workflows.start.rolesPrefillFailed') : t('common.loading') : null) : blocked.errorCode === 'missing_required_input'
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
        const inputs = buildWorkflowRunStartInputs(fields);
        if (props.definition) props.onRun(inputs, roleOverrides);
        else props.onRun(inputs);
    }, [disabled, fields, props.definition, props.onRun, roleOverrides]);
    const chips = React.useMemo<readonly AgentInputExtraActionChip[]>(() => [
        ...(props.workflowChip ? [props.workflowChip] : [createExecutionRunStartContentChip({
            key: 'workflow-start-definition', icon: 'git-branch', label: props.workflowName ?? t('workflows.start.workflow'),
            title: t('workflows.start.workflow'), testID: `${prefix}-workflow-chip`,
            renderContent: <View style={styles.fields}><Text>{props.preview ?? props.workflowName ?? t('workflows.start.preview')}</Text></View>,
        })]),
        ...(remaining.length === 0 && missing === 0 ? [] : [createExecutionRunStartContentChip({
            key: 'workflow-start-inputs', icon: 'sliders-horizontal',
            label: missing > 0 ? t('workflows.start.needed', { count: missing }) : t('workflows.start.inputs'),
            title: t('workflows.start.inputs'), testID: `${prefix}-inputs-chip`,
            revision: JSON.stringify([props.values, rawTextValues]),
            renderContent: <View>
                {main?.errorCode === 'missing_required_input' ? <View style={styles.fields}>
                    <Text>{main.definition.name}</Text><Text style={styles.required}>{t('workflows.start.required')}</Text>
                </View> : null}
                <WorkflowRunInputs fields={remaining} values={props.values} rawTextValues={rawTextValues}
                onChangeText={changeText} onChangeValue={changeValue} pending={props.pending === true}
                machineId={props.machineId ?? null} serverId={props.serverId ?? null} prefix={prefix} />
            </View>,
        })]),
        ...(props.extraActionChips ?? []),
        ...(!props.definition || (roleIds.length === 0 && roleOverrides.length === 0
            && !props.materializedLeaves?.some((leaf) => leaf.role)) ? [] : [createExecutionRunStartContentChip({
            key: 'workflow-start-roles', icon: 'users', title: t('workflows.start.rolesTitle'),
            label: roleOverrides.length > 0 ? t('workflows.start.rolesChanged', { count: roleOverrides.length }) : t('workflows.start.rolesYour'),
            testID: `${prefix}-roles-chip`, revision: JSON.stringify(roleOverrides),
            renderContent: <View style={styles.fields}>{acceptedRepeat
                ? <WorkflowAcceptedRunRoles leaves={props.materializedLeaves ?? []} />
                : roleDraft.status !== 'ready' ? <View>
                    <Text accessibilityRole={roleDraft.status === 'failed' ? 'alert' : undefined}>
                        {roleDraft.status === 'failed' ? t('workflows.start.rolesPrefillFailed') : t('common.loading')}
                    </Text>
                    {roleDraft.status === 'failed' ? <RoundButton size="small" title={t('common.retry')} onPress={roleDraft.retry} /> : null}
                </View> : <WorkflowRunRoles definition={props.definition} roleIds={roleIds}
                    overrides={roleOverrides} onChange={roleDraft.onChange} pending={props.pending === true} prefix={prefix} />}</View>,
        })]),
        ...(props.materializedLeaves === undefined ? [] : [createExecutionRunStartContentChip({
            key: 'workflow-start-targets', icon: 'layers', label: t('workflows.start.targetsTitle'), title: t('workflows.start.targetsTitle'),
            testID: `${prefix}-targets-chip`, renderContent: <View style={styles.fields}>{props.materializedLeaves.map((leaf) => {
                const block = leaf.sourceKey === '$root' && props.definition
                    ? walkWorkflowBlocks(props.definition.blocks).find((candidate) => candidate.id === leaf.blockId) : null;
                return <FieldItem key={JSON.stringify([leaf.sourceKey, leaf.blockId])}
                    label={block ? workflowBlockReferenceLabel(block) : t('workflows.start.workflow')}>
                    <Text>{leaf.executionTarget.kind === 'session' ? t('workflows.page.sections.aSession') : t('workflows.page.sections.aBackgroundRun')}</Text>
                </FieldItem>;
            })}</View>,
        })]),
    ].map((chip) => ({
        ...chip,
        ...(chip.key === 'workflow-start-definition' ? { controlId: 'workflow' as const }
            : chip.key === 'workflow-start-inputs' ? { controlId: 'workflowInputs' as const }
                : chip.key === 'workflow-start-roles' ? { controlId: 'workflowRoles' as const }
                    : chip.key === 'workflow-start-targets' ? { controlId: 'workflowTargets' as const } : {}),
    })), [changeText, changeValue, main, missing, prefix, props.extraActionChips, props.machineId, props.pending,
        props.preview, props.serverId, props.values, props.workflowChip, props.workflowName, rawTextValues, remaining,
        acceptedRepeat, props.definition, props.materializedLeaves, roleDraft.onChange, roleDraft.retry, roleDraft.status, roleIds, roleOverrides]);
    return (
        <View testID={prefix} style={styles.root}>
            {props.notice ? <Text style={styles.secondary}>{props.notice}</Text> : null}
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
            {reason === null ? null : <Text testID={`${prefix}-reason`} accessibilityRole={roleDraft.status === 'loading' && blocked === null ? undefined : 'alert'}
                style={roleDraft.status === 'loading' && blocked === null && !frozenRepeatUnavailable ? styles.secondary : styles.required}>{reason}</Text>}
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
