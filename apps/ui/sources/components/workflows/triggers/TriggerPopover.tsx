import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { TriggerTargetV1 } from '@happier-dev/protocol';
import { resolveEffectiveActionInputFields } from '@happier-dev/protocol/actions/actionInputHintsRuntime';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { Text } from '@/components/ui/text/Text';
import { formatWorkflowProblemMessage } from '@/components/workflows/presentation/workflowProblemPresentation';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { ActionInputFields } from '@/components/sessions/actions/ActionInputFields';
import { useActionFieldOptionsForMachine } from '@/components/sessions/actions/useSessionActionFieldOptions';
import { findWorkflowActionSpec, listWorkflowStepActionSpecs } from '@/components/workflows/presentation/workflowActionCatalog';
import { useWorkflowExistingSessionOptions } from '@/components/workflows/screens/useWorkflowExistingSessionOptions';

import { formatTriggerSummary, weekdayName } from './formatTriggerSummary';
import {
    NOTIFY_ME_ACTION_ID,
    TRIGGER_THEN_KINDS,
    buildTriggerDefinition,
    buildTriggerTarget,
    createDefaultThen,
    createDefaultWhen,
    type SessionTriggerWhenKind,
    type TriggerFormValue,
    type TriggerRunsIn,
    type TriggerThenValue,
    type TriggerWhenValue,
} from './sessionTriggerForm';
import { buildSimpleScheduleCron, formatClockTime, parseClockTime, type SimpleScheduleRepeat } from './triggerSchedule';
import { useNotifyMeChannelOptions } from './useTriggerThenOptions';

/** A choice the popover lists but cannot offer here, with the reason it says instead. */
export type TriggerKindAvailability = Readonly<Partial<Record<SessionTriggerWhenKind, string>>>;

export type TriggerWorkflowOption = Readonly<{ ref: string; title: string }>;

export type TriggerPopoverProps = Readonly<{
    anchorRef: React.RefObject<View | null>;
    onRequestClose: () => void;
    testID: string;
    /** The kinds **When** offers, in order; an entry in `unavailableKinds` is listed with its reason. */
    whenKinds: readonly SessionTriggerWhenKind[];
    unavailableKinds?: TriggerKindAvailability;
    /** The session a lifecycle kind listens to; `null` for an Account trigger. */
    sessionId: string | null;
    /** `null` adds a new trigger. */
    initial: TriggerFormValue | null;
    workflowOptions: readonly TriggerWorkflowOption[];
    /**
     * Whether **Then** is offered. A workflow's own trigger always runs that workflow, so its popover
     * has none (07 S4) and its write carries no target.
     */
    showThen?: boolean;
    /** The title of a new trigger's popover; defaults to "New trigger". */
    newTitle?: string;
    /** A new trigger's starting When (the "When this turn finishes…" entry binds it to that turn). */
    initialWhen?: TriggerWhenValue;
    /**
     * The Machine whose options an Action's fields and "A session…" read: the session's own Machine,
     * or the trigger set's Runs on Machine.
     */
    machineId?: string | null;
    serverId?: string | null;
    /** Host rows under When (the set's Runs on), and after Then (a workflow's Inputs and Roles). */
    setRows?: React.ReactNode;
    afterRows?: React.ReactNode;
    /** False while a host row the write needs (Runs on) is unresolved. */
    hostComplete?: boolean;
    /**
     * Save as workflow (F1; 07 S16b): opens these steps as a new workflow to review. Offered for a
     * saved trigger whose Then holds its own steps; nothing changes until that workflow is saved.
     */
    onSaveAsWorkflow?: (target: TriggerTargetV1) => void;
    /** Writes the trigger through its owner; a rejection keeps the popover and its edits. */
    onSubmit: (value: TriggerFormValue, write: Readonly<{
        trigger: NonNullable<ReturnType<typeof buildTriggerDefinition>>;
        /** `null` exactly when Then is not offered. */
        target: ReturnType<typeof buildTriggerTarget>;
    }>) => Promise<void>;
    onToggleEnabled?: (next: boolean) => Promise<void>;
    onDelete?: () => Promise<void>;
}>;

const styles = StyleSheet.create((theme) => ({
    surface: {
        width: 380,
        maxWidth: '100%',
    },
    foot: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: theme.margins.sm,
        paddingHorizontal: theme.margins.lg,
        paddingBottom: theme.margins.lg,
    },
    footEnd: {
        marginLeft: 'auto',
        flexDirection: 'row',
        gap: theme.margins.sm,
    },
    failure: {
        color: theme.colors.state.danger.foreground,
        paddingHorizontal: theme.margins.lg,
        paddingBottom: theme.margins.sm,
    },
}));


const REPEATS: readonly SimpleScheduleRepeat[] = ['daily', 'weekdays', 'weekly'];
const REPEAT_LABEL_KEYS = { daily: 'everyDay', weekdays: 'weekdays', weekly: 'weekly' } as const;

function whenDescription(kind: SessionTriggerWhenKind): string | undefined {
    switch (kind) {
        case 'turnEnds':
        case 'needsYou':
        case 'sessionArchived':
        case 'sessionStarts':
        case 'schedule':
        case 'prComment':
            return t(`workflows.triggers.kindDescription.${kind}`);
        case 'ciFailed':
            return undefined;
    }
}

/** A field select row: the canonical `DropdownMenu` item trigger, opened from its own row. */
function FieldSelect(props: Readonly<{
    testID: string;
    title: string;
    subtitle?: string;
    /** A long list (the Actions catalog) filters as you type. */
    search?: boolean;
    items: readonly DropdownMenuItem[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}>) {
    const [open, setOpen] = React.useState(false);
    return (
        <DropdownMenu
            testID={props.testID}
            open={open}
            onOpenChange={setOpen}
            items={props.items}
            selectedId={props.selectedId}
            onSelect={(id) => { setOpen(false); props.onSelect(id); }}
            itemTrigger={{ title: props.title, ...(props.subtitle === undefined ? {} : { subtitle: props.subtitle }) }}
            {...(props.search ? { search: true } : {})}
        />
    );
}

/**
 * The one trigger popover (FIN 04 §5.4–§5.5; 07 S4, S16, S16b; lab `editor-T1/T2`): title = the
 * summary, **When** (the kinds), the kind's own rows, **Then** with its four choices and their rows,
 * and a foot with **Turn off** and **Delete trigger**, or **Cancel** and **Add trigger** for a new
 * one. Session and Account triggers differ only in the kinds offered and the write their host makes.
 */
export function TriggerPopover(props: TriggerPopoverProps): React.ReactElement {
    const isNew = props.initial === null;
    const [when, setWhen] = React.useState<TriggerWhenValue>(() => props.initial?.when ?? props.initialWhen ?? createDefaultWhen(props.whenKinds[0] ?? 'turnEnds'));
    const [then, setThen] = React.useState<TriggerThenValue>(() => props.initial?.then ?? createDefaultThen('sendPrompt'));
    const enabled = props.initial?.enabled ?? true;
    const [pending, setPending] = React.useState(false);
    const [failure, setFailure] = React.useState<string | null>(null);

    const trigger = buildTriggerDefinition({ when, enabled, sessionId: props.sessionId });
    const showThen = props.showThen ?? true;
    const target = showThen ? buildTriggerTarget(then, props.sessionId === null ? 'account' : 'session') : null;
    const unavailableWhen = props.unavailableKinds?.[when.kind];
    const complete = trigger !== null && (!showThen || target !== null) && unavailableWhen === undefined
        && props.hostComplete !== false;
    const title = isNew
        ? props.newTitle ?? t('workflows.triggers.popover.newTrigger')
        : trigger === null ? t('workflows.triggers.summary.schedule') : formatTriggerSummary(trigger);

    const run = React.useCallback((operation: () => Promise<void>) => {
        if (pending) return;
        setPending(true);
        setFailure(null);
        operation()
            .then(() => props.onRequestClose())
            .catch((error: unknown) => setFailure(`${t('workflows.triggers.section.saveFailed')} ${formatWorkflowProblemMessage(error)}`))
            .finally(() => setPending(false));
    }, [pending, props]);

    const submit = () => {
        if (!complete || trigger === null) return;
        run(() => props.onSubmit({ when, then, enabled }, { trigger, target }));
    };

    const whenItems: DropdownMenuItem[] = props.whenKinds.map((kind) => {
        const reason = props.unavailableKinds?.[kind];
        return {
            id: kind,
            testID: `${props.testID}-when:${kind}`,
            title: t(`workflows.triggers.kind.${kind}`),
            ...(reason === undefined ? {} : { subtitle: reason, disabled: true }),
        };
    });
    const thenItems: DropdownMenuItem[] = TRIGGER_THEN_KINDS.map((kind) => ({
        id: kind,
        testID: `${props.testID}-then:${kind}`,
        title: t(`workflows.triggers.then.${kind}`),
    }));

    return (
        <Popover
            open
            anchorRef={props.anchorRef}
            placement="auto"
            maxWidthCap={420}
            maxHeightCap={640}
            autoFocusOnOpen
            onRequestClose={props.onRequestClose}
            portal={{ web: true, native: true, matchAnchorWidth: false }}
        >
            {({ maxHeight }) => (
                <FloatingOverlay maxHeight={maxHeight} scrollEnabled>
                    <View testID={props.testID} style={styles.surface}>
                        <ItemGroup title={title} {...(unavailableWhen === undefined ? {} : { description: unavailableWhen })}>
                            <FieldSelect
                                testID={`${props.testID}-when`}
                                title={t('workflows.triggers.popover.when')}
                                {...(whenDescription(when.kind) === undefined ? {} : { subtitle: whenDescription(when.kind) })}
                                items={whenItems}
                                selectedId={when.kind}
                                onSelect={(id) => {
                                    const kind = props.whenKinds.find((candidate) => candidate === id);
                                    if (kind !== undefined) setWhen(createDefaultWhen(kind));
                                }}
                            />
                            {when.kind === 'schedule' ? <ScheduleRows testID={props.testID} when={when} onChange={setWhen} /> : null}
                            {props.setRows ?? null}
                            {showThen ? (
                                <>
                                    <FieldSelect
                                        testID={`${props.testID}-then`}
                                        title={t('workflows.triggers.then.label')}
                                        {...(then.kind === 'sendPrompt' && props.sessionId !== null ? { subtitle: t('workflows.triggers.then.sendPromptDescription') } : {})}
                                        items={thenItems}
                                        selectedId={then.kind === 'kept' ? null : then.kind}
                                        onSelect={(id) => {
                                            const kind = TRIGGER_THEN_KINDS.find((candidate) => candidate === id);
                                            if (kind !== undefined) setThen(createDefaultThen(kind));
                                        }}
                                    />
                                    <ThenRows
                                        testID={props.testID}
                                        then={then}
                                        onChange={setThen}
                                        workflowOptions={props.workflowOptions}
                                        scope={props.sessionId === null ? 'account' : 'session'}
                                        machineId={props.machineId ?? null}
                                        serverId={props.serverId ?? null}
                                    />
                                </>
                            ) : null}
                            {props.afterRows ?? null}
                        </ItemGroup>
                        {failure === null ? null : (
                            <Text testID={`${props.testID}-failure`} accessibilityLiveRegion="polite" style={styles.failure}>{failure}</Text>
                        )}
                        <View style={styles.foot}>
                            {isNew ? (
                                <>
                                    <RoundButton
                                        testID={`${props.testID}-cancel`}
                                        size="small"
                                        display="secondary"
                                        title={t('workflows.triggers.popover.cancel')}
                                        onPress={props.onRequestClose}
                                    />
                                    <View style={styles.footEnd}>
                                        <RoundButton
                                            testID={`${props.testID}-submit`}
                                            size="small"
                                            title={t('workflows.triggers.popover.addTrigger')}
                                            disabled={!complete}
                                            loading={pending}
                                            onPress={submit}
                                        />
                                    </View>
                                </>
                            ) : (
                                <>
                                    {props.onToggleEnabled ? (
                                        <RoundButton
                                            testID={`${props.testID}-toggle`}
                                            size="small"
                                            display="secondary"
                                            title={t(enabled ? 'workflows.triggers.popover.turnOff' : 'workflows.triggers.popover.turnOn')}
                                            onPress={() => run(() => props.onToggleEnabled!(!enabled))}
                                        />
                                    ) : null}
                                    {props.onDelete ? (
                                        <RoundButton
                                            testID={`${props.testID}-delete`}
                                            size="small"
                                            display="destructive"
                                            title={t('workflows.triggers.popover.deleteTrigger')}
                                            onPress={() => run(props.onDelete!)}
                                        />
                                    ) : null}
                                    {props.onSaveAsWorkflow && target?.kind === 'inline' ? (
                                        <RoundButton
                                            testID={`${props.testID}-save-as-workflow`}
                                            size="small"
                                            display="secondary"
                                            title={t('workflows.triggers.popover.saveAsWorkflow')}
                                            accessibilityHint={t('workflows.triggers.popover.saveAsWorkflowDescription')}
                                            onPress={() => {
                                                props.onSaveAsWorkflow?.(target);
                                                props.onRequestClose();
                                            }}
                                        />
                                    ) : null}
                                    <View style={styles.footEnd}>
                                        <RoundButton
                                            testID={`${props.testID}-submit`}
                                            size="small"
                                            title={t('workflows.triggers.popover.done')}
                                            disabled={!complete}
                                            loading={pending}
                                            onPress={submit}
                                        />
                                    </View>
                                </>
                            )}
                        </View>
                    </View>
                </FloatingOverlay>
            )}
        </Popover>
    );
}

/** Repeat · Day · At, or the expression a schedule was written with when it is not a simple one. */
function ScheduleRows(props: Readonly<{
    testID: string;
    when: Extract<TriggerWhenValue, Readonly<{ kind: 'schedule' }>>;
    onChange: (next: TriggerWhenValue) => void;
}>) {
    const { when } = props;
    const schedule = when.schedule;
    if (schedule === null) {
        return (
            <FieldValueItem
                testID={`${props.testID}-expression`}
                title={t('workflows.triggers.popover.expression')}
                {...(when.timezone ? { subtitle: when.timezone } : {})}
                value={when.expression}
                monospace
                autoCapitalize="none"
                onCommit={(expression) => props.onChange({ ...when, expression })}
            />
        );
    }
    const setSchedule = (next: typeof schedule) => props.onChange({ ...when, schedule: next, expression: buildSimpleScheduleCron(next) });
    return (
        <>
            <SegmentedChoiceItem<SimpleScheduleRepeat>
                testIDPrefix={`${props.testID}-repeat`}
                title={t('workflows.triggers.popover.repeat')}
                value={schedule.repeat}
                onChange={(repeat) => setSchedule({ ...schedule, repeat })}
                options={REPEATS.map((repeat) => ({ id: repeat, label: t(`workflows.triggers.popover.${REPEAT_LABEL_KEYS[repeat]}`) }))}
            />
            {schedule.repeat === 'weekly' ? (
                <FieldSelect
                    testID={`${props.testID}-day`}
                    title={t('workflows.triggers.popover.day')}
                    items={[1, 2, 3, 4, 5, 6, 0].map((day) => ({ id: String(day), title: weekdayName(day) }))}
                    selectedId={String(schedule.day)}
                    onSelect={(id) => setSchedule({ ...schedule, day: Number(id) })}
                />
            ) : null}
            <FieldValueItem
                testID={`${props.testID}-at`}
                title={t('workflows.triggers.popover.at')}
                {...(when.timezone ? { subtitle: when.timezone } : {})}
                value={formatClockTime(schedule)}
                onCommit={(draft) => {
                    const time = parseClockTime(draft);
                    if (time === null) return formatClockTime(schedule);
                    setSchedule({ ...schedule, ...time });
                    return undefined;
                }}
            />
        </>
    );
}

/** The chosen Then's own rows (07 S16b); "kept" steps show no editor and stay as they are. */
function ThenRows(props: Readonly<{
    testID: string;
    then: TriggerThenValue;
    onChange: (next: TriggerThenValue) => void;
    workflowOptions: readonly TriggerWorkflowOption[];
    scope: 'session' | 'account';
    machineId: string | null;
    serverId: string | null;
}>) {
    const { then } = props;
    switch (then.kind) {
        case 'sendPrompt':
            return (
                <>
                    {props.scope === 'account' ? (
                        <RunsInRows
                            testID={props.testID}
                            runsIn={then.runsIn ?? { kind: 'newSession' }}
                            machineId={props.machineId}
                            serverId={props.serverId}
                            onChange={(runsIn) => props.onChange({ ...then, runsIn })}
                        />
                    ) : null}
                    <FieldItem label={t('workflows.triggers.then.promptLabel')}>
                        <FieldTextInput
                            testID={`${props.testID}-prompt`}
                            value={then.prompt}
                            multiline
                            placeholder={t('workflows.triggers.then.promptPlaceholder')}
                            accessibilityLabel={t('workflows.triggers.then.promptLabel')}
                            onChangeText={(prompt) => props.onChange({ ...then, prompt })}
                        />
                    </FieldItem>
                </>
            );
        case 'doAction':
            return (
                <DoActionRows
                    testID={props.testID}
                    value={then}
                    machineId={props.machineId}
                    serverId={props.serverId}
                    onChange={props.onChange}
                />
            );
        case 'notifyMe':
            return (
                <>
                    <FieldValueItem
                        testID={`${props.testID}-message`}
                        title={t('workflows.triggers.then.message')}
                        value={then.message}
                        onCommit={(message) => props.onChange({ ...then, message })}
                    />
                    <FieldValueItem
                        testID={`${props.testID}-title`}
                        title={t('workflows.triggers.then.title')}
                        value={then.title}
                        allowEmpty
                        onCommit={(title) => props.onChange({ ...then, title })}
                    />
                    <SendToSelect
                        testID={`${props.testID}-send-to`}
                        selected={then.channels}
                        onChange={(channels) => props.onChange({ ...then, channels })}
                    />
                </>
            );
        case 'runWorkflow':
            return (
                <FieldSelect
                    testID={`${props.testID}-workflow`}
                    title={t('workflows.triggers.then.workflow')}
                    items={props.workflowOptions.map((option) => ({ id: option.ref, title: option.title }))}
                    selectedId={then.ref}
                    onSelect={(ref) => props.onChange({ kind: 'runWorkflow', ref })}
                />
            );
        case 'kept':
            return null;
    }
}

const RUNS_IN_KINDS = ['newSession', 'session', 'backgroundRun'] as const;

/**
 * Runs in (07 S16b, X12): A new session · A session… · A background run, over existing leaf
 * capabilities. "A session…" lists the sessions on Runs on's machine (01 §5.5).
 */
function RunsInRows(props: Readonly<{
    testID: string;
    runsIn: TriggerRunsIn;
    machineId: string | null;
    serverId: string | null;
    onChange: (next: TriggerRunsIn) => void;
}>) {
    const activeServerId = useActiveServerAccountScope()?.serverId ?? null;
    const { existingSessions } = useWorkflowExistingSessionOptions({ serverId: props.serverId ?? activeServerId, machineId: props.machineId });
    const first = existingSessions[0];
    return (
        <>
            <SegmentedChoiceItem<(typeof RUNS_IN_KINDS)[number]>
                testIDPrefix={`${props.testID}-runs-in`}
                title={t('workflows.triggers.then.runsIn')}
                value={props.runsIn.kind}
                onChange={(kind) => {
                    if (kind === 'session') {
                        if (first !== undefined) props.onChange({ kind: 'session', sessionId: first.sessionId, machineId: first.machineId });
                        return;
                    }
                    props.onChange({ kind });
                }}
                options={RUNS_IN_KINDS.map((kind) => ({
                    id: kind,
                    label: t(`workflows.triggers.then.runsInChoice.${kind}`),
                    ...(kind === 'session' && first === undefined ? { unavailableReason: t('workflows.triggers.then.noSessionOnMachine') } : {}),
                }))}
            />
            {props.runsIn.kind === 'session' ? (
                <FieldSelect
                    testID={`${props.testID}-runs-in-session`}
                    title={t('workflows.triggers.then.session')}
                    items={existingSessions.map((option) => ({ id: option.sessionId, title: option.label }))}
                    selectedId={props.runsIn.sessionId}
                    onSelect={(sessionId) => {
                        const option = existingSessions.find((candidate) => candidate.sessionId === sessionId);
                        if (option) props.onChange({ kind: 'session', sessionId: option.sessionId, machineId: option.machineId });
                    }}
                />
            ) : null}
        </>
    );
}

/**
 * Do an action (07 S16b): the Actions catalog a workflow's Action step offers (Notify me has its own
 * Then), then the chosen Action's fields from its own input hints, with pickers from its options
 * sources on the trigger's Machine. Values are written as literals of one Action step.
 */
function DoActionRows(props: Readonly<{
    testID: string;
    value: Extract<TriggerThenValue, Readonly<{ kind: 'doAction' }>>;
    machineId: string | null;
    serverId: string | null;
    onChange: (next: TriggerThenValue) => void;
}>) {
    const { value } = props;
    const specs = React.useMemo(
        () => listWorkflowStepActionSpecs().filter((spec) => spec.id !== NOTIFY_ME_ACTION_ID),
        [],
    );
    const spec = value.actionId === null ? null : findWorkflowActionSpec(value.actionId);
    const fields = React.useMemo(
        () => (spec === null ? [] : resolveEffectiveActionInputFields(spec, value.input).filter((field) => !field.path.includes('.'))),
        [spec, value.input],
    );
    const activeServerId = useActiveServerAccountScope()?.serverId ?? null;
    const resolveFieldOptions = useActionFieldOptionsForMachine({
        machineId: props.machineId,
        serverId: props.serverId ?? activeServerId,
        enabled: spec !== null,
    });
    return (
        <>
            <FieldSelect
                testID={`${props.testID}-action`}
                title={t('workflows.triggers.then.action')}
                search
                items={specs.map((candidate) => ({
                    id: candidate.id,
                    title: candidate.title,
                    ...(candidate.description ? { subtitle: candidate.description } : {}),
                }))}
                selectedId={value.actionId}
                onSelect={(actionId) => props.onChange({ kind: 'doAction', actionId, input: {} })}
            />
            {spec === null || fields.length === 0 ? null : (
                <ActionInputFields
                    fields={fields}
                    input={{ ...value.input }}
                    editable
                    resolveFieldOptions={resolveFieldOptions}
                    onPatch={(patch) => props.onChange({ ...value, input: { ...value.input, ...patch } })}
                    resolveFieldTestID={(field) => `${props.testID}-action-field-${field.path}`}
                />
            )}
        </>
    );
}

/**
 * Send to (F2): a multi-select over Notify me's own channel options, read only while this row is
 * shown; none chosen means your notification settings (03 §3.4).
 */
function SendToSelect(props: Readonly<{
    testID: string;
    selected: readonly string[];
    onChange: (channels: readonly string[]) => void;
}>) {
    const [open, setOpen] = React.useState(false);
    const options = useNotifyMeChannelOptions();
    const labels = new Map(options.map((option) => [option.value, option.label]));
    const summary = props.selected.length === 0
        ? t('workflows.triggers.then.sendToDefault')
        : props.selected.map((channel) => labels.get(channel) ?? channel).join(', ');
    return (
        <DropdownMenu
            testID={props.testID}
            open={open}
            onOpenChange={setOpen}
            closeOnSelect={false}
            items={options.map((option) => ({
                id: option.value,
                testID: `${props.testID}:${option.value}`,
                title: option.label,
                checked: props.selected.includes(option.value),
            }))}
            onSelect={(id) => props.onChange(props.selected.includes(id)
                ? props.selected.filter((channel) => channel !== id)
                : [...props.selected, id])}
            itemTrigger={{ title: t('workflows.triggers.then.sendTo'), detailFormatter: () => summary }}
        />
    );
}
