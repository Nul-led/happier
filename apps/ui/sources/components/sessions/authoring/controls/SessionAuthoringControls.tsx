import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { WorkflowSessionAuthoringSelection } from '@happier-dev/protocol/workflows/workflowV1';

import { DEFAULT_AGENT_ID } from '@/agents/catalog/catalog';
import type { AgentInputExtraActionChipRenderContext } from '@/components/sessions/agentInput/agentInputContracts';
import { AgentInputSelectionListPopover } from '@/components/sessions/agentInput/components/AgentInputSelectionListPopover';
import { Text, TextInput } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import type { SelectionListStep } from '@/components/ui/selectionList';
import { Typography } from '@/constants/Typography';
import { isPermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

import {
    resolveSessionAuthoringAgentId,
    resolveSessionAuthoringFieldControl,
    resolveSessionAuthoringFieldValue,
    type SessionAuthoringControlFacts,
    type SessionAuthoringFieldControlModel,
    type SessionAuthoringFieldId,
    type SessionAuthoringFieldOption,
} from './sessionAuthoringFieldControls';
import { SessionAuthoringConnectedServicesField } from './SessionAuthoringConnectedServicesField';
import { SessionAuthoringMcpSelectionField } from './SessionAuthoringMcpSelectionField';
import { useSessionAuthoringControls } from './useSessionAuthoringControls';
import { motionTokens } from '@/components/ui/motion/motionTokens';

/**
 * The standalone, controlled Session-authoring controls.
 *
 * Values in, `onChangeField` out. This composition deliberately has no composer,
 * no submit affordance and registers no keyboard command: launching is the
 * host's own explicit action (page Run now / Save), never a side effect of
 * editing a value here. It also never selects a draft, navigates, creates a
 * resource or records a remembered selection — choosing a value only reports
 * that value to its owner.
 *
 * The chips, popovers and effective-policy owner are the ones ordinary Session
 * authoring already uses, so a workflow step and New Session cannot offer
 * different choices for the same field.
 */

/**
 * These chips and the window-name input are the real press frames, not icons
 * inside a larger row, so they take the canonical platform target as a minimum
 * height. `hitSlop` cannot stand in for it: react-native-web's `Pressable`
 * never reads it and the desktop app is the web bundle, so a slop-declared
 * target there is a target that does not exist. Growth is on the free vertical
 * axis, so a wrapping chip row still meets at its gap rather than overlapping.
 */
const MINIMUM_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    // The composer bar keeps its own denser variant; this is the same chip in
    // the roomier authoring context, from the same theme tokens.
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 10,
        paddingVertical: 6,
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
        gap: 6,
    },
    chipPressed: {
        opacity: motionTokens.press.opacity,
    },
    chipText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.composer.chipTint,
    },
    unavailableText: {
        ...Typography.default('regular'),
        fontSize: 13,
        color: theme.colors.text.tertiary,
    },
    textInput: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
        paddingVertical: 6,
        paddingHorizontal: 10,
        minHeight: MINIMUM_TARGET_SIZE,
        minWidth: 160,
    },
}));

function buildRootStep(params: Readonly<{
    id: string;
    title: string;
    options: readonly SessionAuthoringFieldOption[];
    onSelect: (optionId: string) => void;
}>): SelectionListStep {
    return {
        id: `${params.id}-root`,
        title: params.title,
        sections: [{
            kind: 'static',
            id: params.id,
            options: params.options.map((option) => ({
                id: option.id,
                label: option.label,
                ...(option.subtitle === undefined ? {} : { subtitle: option.subtitle }),
                ...(option.disabled === true ? { disabled: true } : {}),
                ...(option.disabled === true ? {} : { onSelect: () => params.onSelect(option.id) }),
            })),
        }],
    };
}

/** One selectable value: a chip that names the current choice and its picker. */
function SessionAuthoringOptionChip(props: Readonly<{
    controlId: string;
    title: string;
    options: readonly SessionAuthoringFieldOption[];
    selectedOptionId: string;
    /** Shown instead of "Default" when the selection names no offered option. */
    unselectedLabel?: string;
    disabled?: boolean;
    onSelect: (optionId: string) => void;
    testID: string;
}>): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef<React.ComponentRef<typeof View> | null>(null);
    const selected = props.options.find((option) => option.id === props.selectedOptionId) ?? null;
    const currentLabel = selected?.label ?? props.unselectedLabel ?? t('common.default');
    const rootStep = React.useMemo(() => buildRootStep({
        id: props.controlId,
        title: props.title,
        options: props.options,
        onSelect: props.onSelect,
    }), [props.controlId, props.onSelect, props.options, props.title]);

    return (
        <>
            <View ref={anchorRef} collapsable={false} style={{ alignSelf: 'flex-start' }}>
                <Pressable
                    testID={props.testID}
                    accessibilityRole="button"
                    accessibilityLabel={`${props.title}: ${currentLabel}`}
                    accessibilityState={{ disabled: props.disabled === true }}
                    disabled={props.disabled === true}
                    onPress={() => setOpen((current) => !current)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
                >
                    <Text numberOfLines={1} style={styles.chipText}>
                        {currentLabel}
                    </Text>
                </Pressable>
            </View>

            <AgentInputSelectionListPopover
                open={open}
                anchorRef={anchorRef}
                rootStep={rootStep}
                selectedOptionId={props.selectedOptionId}
                onSelect={() => {
                    // The per-option `onSelect` above is the action source; this
                    // wrapper owns the (web-deferred) close path.
                }}
                onRequestClose={() => setOpen(false)}
                maxHeightCap={360}
            />
        </>
    );
}

function SessionAuthoringFieldControl(props: Readonly<{
    control: SessionAuthoringFieldControlModel;
    values: WorkflowSessionAuthoringSelection;
    facts: SessionAuthoringControlFacts;
    disabled?: boolean;
    onChangeField: (
        field: SessionAuthoringFieldId,
        value: WorkflowSessionAuthoringSelection[SessionAuthoringFieldId],
    ) => void;
    chipRenderContext: AgentInputExtraActionChipRenderContext;
    testIDPrefix: string;
}>): React.ReactElement {
    const { control, facts, onChangeField, values } = props;
    const testID = `${props.testIDPrefix}-${control.field}`;

    const apply = React.useCallback((optionId: string, groupId?: string) => {
        onChangeField(control.field, resolveSessionAuthoringFieldValue({
            selection: groupId === undefined
                ? { field: control.field, optionId }
                : { field: control.field, optionId, groupId },
            values,
            facts,
            now: Date.now(),
        }));
    }, [control.field, facts, onChangeField, values]);

    switch (control.kind) {
        case 'unavailable':
            // Explicitly unavailable, never silently missing: the reader can see
            // that the field exists and that this target cannot offer it.
            return (
                <Text testID={`${testID}-unavailable`} style={styles.unavailableText}>
                    {t('common.unavailable')}
                </Text>
            );

        case 'connectedServices':
            return (
                <SessionAuthoringConnectedServicesField
                    agentId={control.agentId}
                    agentIdentity={control.agentIdentity}
                    connectedAccounts={control.connectedAccounts}
                    context={control.context}
                    value={values.connectedServices}
                    onChange={(bindings) => onChangeField('connectedServices', bindings)}
                    chipRenderContext={props.chipRenderContext}
                    testID={`${testID}-connected-services`}
                />
            );

        case 'mcp':
            return (
                <SessionAuthoringMcpSelectionField
                    agentId={control.agentId}
                    context={control.context}
                    value={values.mcpSelection}
                    onChange={(selection) => onChangeField('mcpSelection', selection)}
                    chipRenderContext={props.chipRenderContext}
                    testID={`${testID}-mcp`}
                />
            );

        case 'text':
            return (
                <TextInput
                    testID={`${testID}-input`}
                    style={styles.textInput}
                    value={control.value}
                    placeholder={control.placeholder}
                    accessibilityLabel={control.title}
                    editable={props.disabled !== true}
                    onChangeText={(next) => apply(next)}
                />
            );

        case 'options':
            return (
                <SessionAuthoringOptionChip
                    controlId={control.field}
                    title={control.title}
                    options={control.options}
                    selectedOptionId={control.selectedOptionId}
                    {...(control.unselectedLabel === undefined
                        ? {}
                        : { unselectedLabel: control.unselectedLabel })}
                    {...(props.disabled === true ? { disabled: true } : {})}
                    onSelect={(optionId) => apply(optionId)}
                    testID={testID}
                />
            );

        case 'optionGroups':
            return (
                <View style={styles.root}>
                    {control.groups.map((group) => (
                        <SessionAuthoringOptionChip
                            key={group.id}
                            controlId={`${control.field}-${group.id}`}
                            title={group.title}
                            options={group.options}
                            selectedOptionId={group.selectedOptionId}
                            {...(props.disabled === true ? { disabled: true } : {})}
                            onSelect={(optionId) => apply(optionId, group.id)}
                            testID={`${testID}-${group.id}`}
                        />
                    ))}
                </View>
            );
    }
}

export type SessionAuthoringControlsProps = Readonly<{
    metadata?: Metadata | null;
    /** Which fields to render, in the caller's order. */
    fields: readonly SessionAuthoringFieldId[];
    values: WorkflowSessionAuthoringSelection;
    onChangeField: (
        field: SessionAuthoringFieldId,
        value: WorkflowSessionAuthoringSelection[SessionAuthoringFieldId],
    ) => void;
    facts?: SessionAuthoringControlFacts;
    /** Renders the current values without allowing a change. */
    disabled?: boolean;
    testIDPrefix?: string;
}>;

export function SessionAuthoringControls(props: SessionAuthoringControlsProps): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'session-authoring-control';
    const facts = props.facts ?? {};
    const overlayAnchorRef = React.useRef<React.ComponentRef<typeof View> | null>(null);
    const { theme } = useUnistyles();

    // Which Agent answers these fields is decided here, once, from the selected
    // target and the host's catalog facts. A caller that resolved its own id
    // could only re-derive it — and the workflow editor's re-derivation was how
    // a plugin Agent ended up displaying and persisting the bundled default's
    // models, permission modes and configuration.
    const agentId = resolveSessionAuthoringAgentId({
        agentTarget: props.values.agentTarget ?? null,
        facts,
    });

    const controls = useSessionAuthoringControls({
        // The policy hook always answers for some Agent; an unresolved
        // selection is handled by the field projection below, which refuses to
        // present Agent-owned fields rather than show this one's answers.
        agentId: agentId ?? DEFAULT_AGENT_ID,
        metadata: props.metadata ?? null,
        permissionMode: isPermissionMode(props.values.permissionMode) ? props.values.permissionMode : null,
        modelMode: props.values.modelSelection?.ref.modelId ?? null,
        // Authoring a definition can always change these; whether the *target*
        // supports a field is answered by that field's own capability facts.
        canChangeModel: true,
        canChangeSessionMode: true,
        canChangeConfigOption: true,
        acpSessionModeSelectedIdOverride: props.values.acpSessionModeId ?? null,
        acpConfigOptionOverridesOverride: props.values.sessionConfigOptionOverrides ?? null,
    });

    const chipRenderContext = React.useMemo<AgentInputExtraActionChipRenderContext>(() => ({
        chipStyle: (pressed: boolean) => [styles.chip, pressed ? styles.chipPressed : null],
        showLabel: true,
        iconColor: theme.colors.composer.chipTint,
        textStyle: styles.chipText,
        countTextStyle: styles.chipText,
        popoverAnchorRef: overlayAnchorRef,
    }), [theme.colors.composer.chipTint]);

    return (
        <View ref={overlayAnchorRef} testID={testIDPrefix} style={styles.root}>
            {props.fields.map((field) => (
                <SessionAuthoringFieldControl
                    key={field}
                    control={resolveSessionAuthoringFieldControl({
                        field,
                        values: props.values,
                        controls,
                        facts,
                        agentId,
                    })}
                    values={props.values}
                    facts={facts}
                    {...(props.disabled === true ? { disabled: true } : {})}
                    onChangeField={props.onChangeField}
                    chipRenderContext={chipRenderContext}
                    testIDPrefix={testIDPrefix}
                />
            ))}
        </View>
    );
}
