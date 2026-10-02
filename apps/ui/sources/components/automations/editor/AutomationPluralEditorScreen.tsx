import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import {
    AUTOMATION_SESSION_LIFECYCLE_MAX_MATCH_COUNT,
    type AutomationPluginEventDefinitionTriggerInput,
    type AutomationSessionLifecycleEvent,
    type AutomationSessionLifecycleTriggerInput,
    type AutomationTriggerDefinitionInput,
} from '@happier-dev/protocol';

import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { SelectionTiles } from '@/components/ui/forms/SelectionTiles';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { usePressFeedback } from '@/components/ui/interactions/usePressFeedback';
import { layout } from '@/components/ui/layout/layout';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemGroupColumn, ItemGroupColumns } from '@/components/ui/lists/ItemGroupColumns';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import {
    SelectionList,
    type SelectionListOption,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import {
    createAutomationEditorTriggerClientId,
    createAutomationEditorSourceSelectorId,
    getAutomationEditorTriggerEnabled,
    getAutomationEditorTriggerKind,
    type AutomationEditorDraft,
    type AutomationTriggerEditorValue,
    type AutomationEditorTriggerDraft,
} from '@/sync/domains/automations/automationEditorDraft';
import { useKeyboardShortcutHandlers } from '@/keyboard';
import { restoreFocusToBestTarget } from '@/keyboard/focusReturn';
import { clampAutomationIntervalMinutes } from '@/sync/domains/automations/automationDraft';
import { t } from '@/text';

type ScheduleTriggerDefinition = Extract<AutomationTriggerDefinitionInput, Readonly<{ kind: 'schedule' }>>;

const SESSION_LIFECYCLE_EVENTS: readonly AutomationSessionLifecycleEvent[] = [
    'parentTurnCompleted',
    'parentTurnFailed',
    'parentTurnCancelled',
    'userActionRequired',
];

const SESSION_LIFECYCLE_POLICIES: readonly AutomationSessionLifecycleTriggerInput['policy']['kind'][] = [
    'currentTurn',
    'firstMatch',
    'nextMatches',
    'everyMatch',
];

export type AutomationEditorSessionOption = Readonly<{
    sessionId: string;
    label: string;
    subtitle?: string;
    currentParentTurnId: string | null;
    selectable?: boolean;
}>;

export type AutomationPluginEventEditorRender = (props: Readonly<{
    clientId: string;
    value: AutomationPluginEventDefinitionTriggerInput | null;
    onComplete: (definition: AutomationPluginEventDefinitionTriggerInput) => void;
    onCancel: () => void;
}>) => React.ReactNode;

type AutomationTriggerEditorSharedProps = Readonly<{
    sessionOptions?: ReadonlyArray<AutomationEditorSessionOption>;
    /**
     * Re-resolves the Session owner's current exact parent turn at activation.
     * The editor compares it with the rendered row and never silently retargets
     * a stale selection. Hosts refresh their canonical Session projection and
     * let the user choose the new turn explicitly.
     */
    resolveCurrentSessionTurn?: (sessionId: string) => Readonly<{
        sourceSessionId: string;
        sourceTurnId: string;
    }> | null;
    onSessionSelectionStale?: () => void;
    renderPluginEventEditor?: AutomationPluginEventEditorRender;
    onCancel?: () => void;
    submitting?: boolean;
    submitDisabled?: boolean;
    /**
     * Why Save is refused, in the person's language, when it is.
     *
     * The host already knows the exact blocker it disabled Save for; this
     * carries that same fact to the surface instead of leaving an inert button
     * with no explanation. Nothing is revalidated here — an unnamed blocker
     * stays `null` rather than being guessed at.
     */
    submitDisabledReason?: string | null;
    /**
     * The host's recipe editor, composed in the one shared create/edit position
     * between the Automation's own metadata and its triggers.
     *
     * Every Automation authoring host — create, edit and the Session-origin
     * wrapper — composes the shared Workflow definition editor through this one
     * slot instead of owning a second recipe surface or a second page order, so
     * a saved Automation and a saved workflow are authored by the same controls
     * in the same reading order on every viewport.
     */
    recipeEditor?: React.ReactNode;
    /**
     * Host content that opens the scrolling document, ahead of the Automation's
     * own metadata (the edit host's exact-turn staleness card). It scrolls with
     * the document beneath the pinned page actions rather than competing with
     * them for the fixed region.
     */
    leading?: React.ReactNode;
}>;

export type AutomationPluralEditorScreenProps = AutomationTriggerEditorSharedProps & Readonly<{
    value: AutomationEditorDraft;
    onChange: (next: AutomationEditorDraft) => void;
    onSubmit?: (draft: AutomationEditorDraft) => void;
    variant: 'create' | 'edit';
}>;

export type AutomationTriggerEditorProps = AutomationTriggerEditorSharedProps & Readonly<{
    value: AutomationTriggerEditorValue;
    onChange: (next: AutomationTriggerEditorValue) => void;
    onSubmit?: (draft: AutomationTriggerEditorValue) => void;
}>;

type AutomationTriggerEditorContentsProps = AutomationTriggerEditorSharedProps & Readonly<{
    value: AutomationTriggerEditorValue;
    onChange: (next: AutomationTriggerEditorValue) => void;
    onSubmit?: (draft: AutomationTriggerEditorValue) => void;
    variant: 'create' | 'edit' | 'embedded';
}>;

type EditorState =
    | Readonly<{ kind: 'none' }>
    | Readonly<{ kind: 'chooseKind' }>
    | Readonly<{ kind: 'schedule'; clientId: string }>
    | Readonly<{ kind: 'pluginEvent'; clientId: string | null }>
    | Readonly<{
        kind: 'sessionLifecycle';
        clientId: string | null;
        phase: 'source' | 'configuration';
    }>;

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        width: '100%',
    },
    pickerFrame: {
        marginHorizontal: Platform.select({ ios: 16, default: 24 }),
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    /**
     * The readable content column both authoring hosts used to apply around
     * this composition; the pinned surface and the document share it.
     */
    content: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    /**
     * The pinned page-action surface: opaque page paper plus the canonical hairline,
     * so the document slides beneath it instead of showing through.
     */
    commandBar: {
        backgroundColor: theme.colors.surface.base,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
        paddingTop: 10,
        paddingBottom: 10,
        zIndex: 10,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
    },
    submitBlockedReason: {
        color: theme.colors.text.destructive,
        textAlign: 'right',
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingBottom: 8,
    },
    actionButton: {
        minHeight: Platform.select({ ios: 44, android: 48, default: 44 }),
        minWidth: 112,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: theme.colors.surface.base,
        borderWidth: 0.5,
        borderColor: theme.colors.border.default,
    },
    primaryAction: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    primaryActionText: {
        color: theme.colors.button.primary.tint,
    },
    disabled: {
        opacity: 0.45,
    },
}));

function formatSchedule(definition: ScheduleTriggerDefinition): string {
    if (definition.schedule.kind === 'cron') {
        return t('automations.pluralEditor.scheduleCron', {
            expression: definition.schedule.scheduleExpr,
            timezone: definition.schedule.timezone,
        });
    }
    return t('automations.pluralEditor.scheduleInterval', {
        minutes: Math.max(1, Math.round(definition.schedule.everyMs / 60_000)),
        timezone: definition.schedule.timezone,
    });
}

function triggerTitle(trigger: AutomationEditorTriggerDraft): string {
    switch (getAutomationEditorTriggerKind(trigger)) {
        case 'schedule':
            return t('automations.pluralEditor.scheduleTitle');
        case 'pluginEvent':
            return trigger.definition?.kind === 'pluginEvent' && 'displayLabel' in trigger.definition
                ? trigger.definition.displayLabel
                : trigger.retainedEvent?.displayLabel ?? t('automations.pluralEditor.eventTitle');
        case 'sessionLifecycle':
            return t('automations.pluralEditor.lifecycleTitle');
    }
}

function triggerSubtitle(
    trigger: AutomationEditorTriggerDraft,
    sessionOptions: ReadonlyArray<AutomationEditorSessionOption>,
    lifecycleOrdinal: number,
): string {
    const definition = trigger.definition;
    if (!definition) {
        return t('automations.pluralEditor.eventSubtitle', {
            pluginId: trigger.retainedEvent?.eventRef.pluginId ?? '',
            eventId: trigger.retainedEvent?.eventRef.localId ?? '',
        });
    }
    switch (definition.kind) {
        case 'schedule':
            return formatSchedule(definition);
        case 'pluginEvent':
            return t('automations.pluralEditor.eventSubtitle', {
                pluginId: definition.eventRef.pluginId,
                eventId: definition.eventRef.localId,
            });
        case 'sessionLifecycle':
            return t('automations.pluralEditor.lifecycleSource', {
                session: sessionOptions.find((option) => (
                    option.sessionId === definition.sourceSessionId
                ))?.label ?? t('automations.pluralEditor.selectedSession'),
                ordinal: lifecycleOrdinal,
            });
    }
}

function replaceTrigger(
    draft: AutomationTriggerEditorValue,
    clientId: string,
    definition: AutomationTriggerDefinitionInput,
): AutomationTriggerEditorValue {
    return {
        ...draft,
        triggers: draft.triggers.map((trigger) => (
            trigger.clientId === clientId
                ? {
                    ...trigger,
                    definition,
                    retainedEvent: undefined,
                    retainedEventPrivateDefinition: undefined,
                    ...(definition.kind === 'pluginEvent' && 'sourceInstanceId' in definition ? {
                        eventSourceBinding: trigger.eventSourceBinding?.sourceInstanceId === definition.sourceInstanceId
                            ? trigger.eventSourceBinding
                            : {
                                sourceSelectorId: createAutomationEditorSourceSelectorId(),
                                sourceInstanceId: definition.sourceInstanceId,
                            },
                    } : { eventSourceBinding: undefined }),
                    // Persisted rows are reconciled only when the editor
                    // actually changed them. This preserves schedule runtime
                    // state and Event source identity for untouched rows.
                    isDirty: trigger.persisted !== null || trigger.isDirty === true,
                }
                : trigger
        )),
    };
}

function appendTrigger(
    draft: AutomationTriggerEditorValue,
    definition: AutomationTriggerDefinitionInput,
): Readonly<{ draft: AutomationTriggerEditorValue; clientId: string }> {
    const clientId = createAutomationEditorTriggerClientId();
    return {
        clientId,
        draft: {
            ...draft,
            triggers: [...draft.triggers, {
                clientId,
                persisted: null,
                definition,
                ...(definition.kind === 'pluginEvent' && 'sourceInstanceId' in definition ? {
                    eventSourceBinding: {
                        sourceSelectorId: createAutomationEditorSourceSelectorId(clientId),
                        sourceInstanceId: definition.sourceInstanceId,
                    },
                } : {}),
            }],
        },
    };
}

function createDefaultSchedule(): ScheduleTriggerDefinition {
    return {
        kind: 'schedule',
        enabled: true,
        schedule: {
            kind: 'interval',
            scheduleExpr: null,
            everyMs: 60 * 60_000,
            timezone: null,
        },
    };
}

function ScheduleEditor(props: Readonly<{
    value: ScheduleTriggerDefinition;
    onChange: (value: ScheduleTriggerDefinition) => void;
    /** Receives focus when the trigger editor opens; whichever schedule field is mounted takes it. */
    fieldRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
}>): React.ReactElement {
    // The interval field owns a local draft so intermediate strings ("", "0",
    // partial numbers) stay editable; validated minutes commit through the
    // editor draft owner on end-editing/submit. A committed change arriving
    // from outside (a schedule-kind switch, another owner, the consumed
    // commit) resets the draft so it can never shadow a foreign value.
    const scheduleKind = props.value.schedule.kind;
    const committedIntervalText = String(scheduleKind === 'interval'
        ? Math.max(1, Math.round(props.value.schedule.everyMs / 60_000))
        : 1);
    const [intervalDraftState, setIntervalDraftState] = React.useState<Readonly<{
        basisKind: typeof scheduleKind;
        basisText: string;
        value: string;
    }> | null>(null);
    const intervalDraft = intervalDraftState?.basisKind === scheduleKind
        && intervalDraftState.basisText === committedIntervalText
        ? intervalDraftState.value
        : null;
    const commitIntervalDraft = React.useCallback(() => {
        if (intervalDraft === null) return;
        setIntervalDraftState(null);
        const normalized = intervalDraft.trim();
        if (!/^\d+$/u.test(normalized)) return;
        const minutes = Number(normalized);
        if (!Number.isSafeInteger(minutes) || minutes < 1) return;
        props.onChange({
            ...props.value,
            schedule: {
                kind: 'interval',
                scheduleExpr: null,
                everyMs: clampAutomationIntervalMinutes(minutes) * 60_000,
                timezone: props.value.schedule.timezone,
            },
        });
    }, [intervalDraft, props]);
    const scheduleKindOptions = React.useMemo(() => [
        {
            id: 'interval' as const,
            label: t('automations.form.schedule.intervalTitle'),
            description: t('automations.form.schedule.intervalSubtitle'),
        },
        {
            id: 'cron' as const,
            label: t('automations.form.schedule.cronTitle'),
            description: t('automations.form.schedule.cronSubtitle'),
        },
    ], []);
    const selectScheduleKind = React.useCallback((kind: 'interval' | 'cron') => {
        if (kind === props.value.schedule.kind) return;
        props.onChange(kind === 'cron'
            ? {
                ...props.value,
                schedule: {
                    kind: 'cron',
                    scheduleExpr: '0 * * * *',
                    everyMs: null,
                    timezone: props.value.schedule.timezone,
                },
            }
            : {
                ...props.value,
                schedule: {
                    kind: 'interval',
                    scheduleExpr: null,
                    everyMs: 60 * 60_000,
                    timezone: props.value.schedule.timezone,
                },
            });
    }, [props]);

    const updateTimezone = React.useCallback((raw: string) => {
        const timezone = raw.trim().length > 0 ? raw : null;
        props.onChange({
            ...props.value,
            schedule: { ...props.value.schedule, timezone },
        } as ScheduleTriggerDefinition);
    }, [props]);

    return (
        <ItemGroup title={t('automations.pluralEditor.editScheduleTitle')}>
            <SegmentedChoiceItem
                testID="automation-trigger-schedule-kind"
                testIDPrefix="automation-trigger-schedule-kind"
                title={t('automations.pluralEditor.scheduleType')}
                options={scheduleKindOptions}
                value={props.value.schedule.kind}
                onChange={selectScheduleKind}
            />
            <ItemGroupColumns paddingVertical={14} rowGap={18}>
                <ItemGroupColumn>
                    {props.value.schedule.kind === 'interval' ? (
                        <FieldItem label={t('automations.form.labels.everyMinutes')}>
                            <FieldTextInput
                                testID="automation-trigger-interval-minutes"
                                value={intervalDraft ?? committedIntervalText}
                                onChangeText={(value) => setIntervalDraftState({
                                    basisKind: scheduleKind,
                                    basisText: committedIntervalText,
                                    value,
                                })}
                                onBlur={commitIntervalDraft}
                                onSubmitEditing={commitIntervalDraft}
                                keyboardType="numeric"
                                accessibilityLabel={t('automations.form.labels.everyMinutes')}
                                autoCapitalize="none"
                                ref={props.fieldRef}
                            />
                        </FieldItem>
                    ) : (
                        <FieldItem
                            label={t('automations.form.labels.cronExpression')}
                            supportingText={t('automations.form.schedule.cronHelpText')}
                        >
                            <FieldTextInput
                                testID="automation-trigger-cron-expression"
                                value={props.value.schedule.scheduleExpr}
                                onChangeText={(scheduleExpr) => props.onChange({
                                    ...props.value,
                                    schedule: {
                                        kind: 'cron',
                                        scheduleExpr,
                                        everyMs: null,
                                        timezone: props.value.schedule.timezone,
                                    },
                                })}
                                autoCapitalize="none"
                                accessibilityLabel={t('automations.form.labels.cronExpression')}
                                ref={props.fieldRef}
                            />
                        </FieldItem>
                    )}
                </ItemGroupColumn>
                <ItemGroupColumn>
                    <FieldItem label={t('automations.form.labels.timezoneOptional')}>
                        <FieldTextInput
                            testID="automation-trigger-timezone"
                            value={props.value.schedule.timezone ?? ''}
                            onChangeText={updateTimezone}
                            placeholder={t('automations.form.placeholders.timezone')}
                            autoCapitalize="none"
                            accessibilityLabel={t('automations.form.labels.timezoneOptional')}
                        />
                    </FieldItem>
                </ItemGroupColumn>
            </ItemGroupColumns>
        </ItemGroup>
    );
}

function EditorActions(props: Readonly<{
    onDone: () => void;
    onRemove?: () => void;
}>): React.ReactElement {
    return (
        <ItemGroup>
            {props.onRemove ? (
                <Item
                    testID="automation-trigger-remove"
                    title={t('common.remove')}
                    onPress={props.onRemove}
                    destructive
                    showChevron={false}
                />
            ) : null}
            <Item
                testID="automation-trigger-editor-done"
                title={t('common.done')}
                onPress={props.onDone}
                showChevron={false}
            />
        </ItemGroup>
    );
}

const AutomationTriggerEditorContents = React.memo(function AutomationTriggerEditorContents(
    props: AutomationTriggerEditorContentsProps,
): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [editor, setEditor] = React.useState<EditorState>({ kind: 'none' });
    const [lifecycleSelectionStale, setLifecycleSelectionStale] = React.useState(false);
    // Focus continuity for the trigger-kind transition. Choosing a kind
    // unmounts the pressed control and mounts an editor; the shared
    // focus-return owner moves focus into the new editor and hands it back to
    // the originating trigger row (or the add-trigger row) when the editor
    // closes, so keyboard and assistive-tech users are never stranded.
    const editorFieldRef = React.useRef<React.ComponentRef<typeof TextInput> | null>(null);
    const pendingEditorFieldFocusRef = React.useRef(false);
    const addTriggerRowRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
    const triggerRowRefsByClientIdRef = React.useRef(
        new Map<string, React.RefObject<React.ComponentRef<typeof Pressable> | null>>(),
    );
    const getTriggerRowRef = React.useCallback((clientId: string) => {
        const existing = triggerRowRefsByClientIdRef.current.get(clientId);
        if (existing) return existing;
        const created: React.RefObject<React.ComponentRef<typeof Pressable> | null> = { current: null };
        triggerRowRefsByClientIdRef.current.set(clientId, created);
        return created;
    }, []);
    const closeTriggerEditor = React.useCallback((editedClientId: string | null) => {
        setEditor({ kind: 'none' });
        restoreFocusToBestTarget(
            editedClientId === null ? null : getTriggerRowRef(editedClientId),
            addTriggerRowRef,
        );
    }, [getTriggerRowRef]);
    // A save commits the captured draft under CAS. Ignore late editor events
    // while that request is in flight so the mounted draft cannot diverge
    // from the bytes whose witnesses are being submitted.
    const emitChange = React.useCallback((next: AutomationTriggerEditorValue) => {
        if (props.submitting === true) return;
        props.onChange(next);
    }, [props.onChange, props.submitting]);
    const chooseTriggerKind = React.useCallback((kind: 'schedule' | 'pluginEvent' | 'sessionLifecycle') => {
        setLifecycleSelectionStale(false);
        if (kind === 'schedule') {
            const appended = appendTrigger(props.value, createDefaultSchedule());
            emitChange(appended.draft);
            pendingEditorFieldFocusRef.current = true;
            setEditor({ kind: 'schedule', clientId: appended.clientId });
            return;
        }
        setEditor(kind === 'sessionLifecycle'
            ? { kind, clientId: null, phase: 'source' }
            : { kind, clientId: null });
    }, [emitChange, props.value]);
    React.useEffect(() => {
        if (editor.kind !== 'schedule' || !pendingEditorFieldFocusRef.current) return;
        pendingEditorFieldFocusRef.current = false;
        restoreFocusToBestTarget(editorFieldRef);
    }, [editor]);

    const updateMetadata = React.useCallback((patch: Partial<AutomationTriggerEditorValue>) => {
        emitChange({ ...props.value, ...patch });
    }, [emitChange, props.value]);

    const removeTrigger = React.useCallback(async (clientId: string) => {
        const trigger = props.value.triggers.find((candidate) => candidate.clientId === clientId);
        if (!trigger) return;
        const confirmed = await Modal.confirm(
            t('automations.pluralEditor.removeTitle'),
            t('automations.pluralEditor.removeBody'),
            { destructive: true, confirmText: t('common.remove'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        emitChange({
            ...props.value,
            triggers: props.value.triggers.filter((candidate) => candidate.clientId !== clientId),
            removedTriggers: trigger.persisted
                ? [...props.value.removedTriggers, trigger.persisted]
                : props.value.removedTriggers,
        });
        closeTriggerEditor(null);
    }, [closeTriggerEditor, emitChange, props.value]);

    const lifecycleOptions = React.useMemo<ReadonlyArray<SelectionListOption>>(() => (
        (props.sessionOptions ?? []).map((option) => ({
            id: option.sessionId,
            label: option.label,
            subtitle: option.subtitle,
            disabled: option.selectable === false,
            testID: `automation-lifecycle-session-${option.sessionId}`,
        }))
    ), [props.sessionOptions]);
    const lifecycleStep = React.useMemo<SelectionListStep>(() => ({
        id: 'automation-lifecycle-session',
        inputPlaceholder: t('sessionsList.searchSessionsPlaceholder'),
        sections: [{
            kind: 'static',
            id: 'sessions',
            options: lifecycleOptions,
            virtualization: 'force',
        }],
    }), [lifecycleOptions]);

    const selectedSchedule = editor.kind === 'schedule'
        ? props.value.triggers.find((trigger) => trigger.clientId === editor.clientId) ?? null
        : null;
    const selectedPluginEvent = editor.kind === 'pluginEvent' && editor.clientId
        ? props.value.triggers.find((trigger) => trigger.clientId === editor.clientId) ?? null
        : null;
    const selectedLifecycle = editor.kind === 'sessionLifecycle' && editor.clientId
        ? props.value.triggers.find((trigger) => trigger.clientId === editor.clientId) ?? null
        : null;
    const selectedLifecycleDefinition = selectedLifecycle?.definition?.kind === 'sessionLifecycle'
        ? selectedLifecycle.definition
        : null;
    const lifecycleOrdinalByClientId = React.useMemo(() => {
        const ordinals = new Map<string, number>();
        let ordinal = 0;
        for (const trigger of props.value.triggers) {
            if (trigger.definition?.kind !== 'sessionLifecycle') continue;
            ordinal += 1;
            ordinals.set(trigger.clientId, ordinal);
        }
        return ordinals;
    }, [props.value.triggers]);

    const completePluginEvent = React.useCallback((definition: AutomationPluginEventDefinitionTriggerInput) => {
        if (editor.kind !== 'pluginEvent') return;
        if (editor.clientId) {
            const current = props.value.triggers.find((trigger) => trigger.clientId === editor.clientId);
            emitChange(replaceTrigger(props.value, editor.clientId, {
                ...definition,
                // Setup edits do not own independent trigger enablement.
                enabled: current ? getAutomationEditorTriggerEnabled(current) : definition.enabled,
            }));
        } else {
            emitChange(appendTrigger(props.value, definition).draft);
        }
        closeTriggerEditor(editor.clientId);
    }, [closeTriggerEditor, editor, emitChange, props.value]);

    const selectLifecycleSession = React.useCallback((sessionId: string) => {
        if (editor.kind !== 'sessionLifecycle') return;
        const option = (props.sessionOptions ?? []).find((candidate) => candidate.sessionId === sessionId);
        if (!option || option.selectable === false) return;
        const currentTrigger = editor.clientId
            ? props.value.triggers.find((trigger) => trigger.clientId === editor.clientId) ?? null
            : null;
        const currentDefinition = currentTrigger?.definition?.kind === 'sessionLifecycle'
            ? currentTrigger.definition
            : null;
        const wantsCurrentTurn = currentDefinition?.policy.kind === 'currentTurn'
            || (currentDefinition === null && option.currentParentTurnId !== null);
        const exactSource = !wantsCurrentTurn
            ? null
            : props.resolveCurrentSessionTurn?.(sessionId) ?? null;
        if (wantsCurrentTurn && (
            !exactSource
            || exactSource.sourceSessionId !== sessionId
            || exactSource.sourceTurnId !== option.currentParentTurnId
        )) {
            setLifecycleSelectionStale(true);
            props.onSessionSelectionStale?.();
            return;
        }
        const definition: AutomationSessionLifecycleTriggerInput = {
            kind: 'sessionLifecycle',
            enabled: true,
            sourceSessionId: sessionId,
            events: currentDefinition?.events ?? ['parentTurnCompleted'],
            policy: currentDefinition?.policy.kind === 'currentTurn'
                ? { kind: 'currentTurn', sourceTurnId: exactSource!.sourceTurnId }
                : currentDefinition?.policy
                    ?? (exactSource
                        ? { kind: 'currentTurn', sourceTurnId: exactSource.sourceTurnId }
                        : { kind: 'firstMatch' }),
        };
        let clientId = editor.clientId;
        if (editor.clientId) {
            emitChange(replaceTrigger(props.value, editor.clientId, {
                ...definition,
                enabled: currentTrigger ? getAutomationEditorTriggerEnabled(currentTrigger) : true,
            }));
        } else {
            const appended = appendTrigger(props.value, definition);
            clientId = appended.clientId;
            emitChange(appended.draft);
        }
        setLifecycleSelectionStale(false);
        setEditor({ kind: 'sessionLifecycle', clientId, phase: 'configuration' });
    }, [editor, emitChange, props.resolveCurrentSessionTurn, props.sessionOptions, props.value, props.onSessionSelectionStale]);

    const updateLifecycleDefinition = React.useCallback((
        update: (definition: AutomationSessionLifecycleTriggerInput) => AutomationSessionLifecycleTriggerInput,
    ) => {
        if (editor.kind !== 'sessionLifecycle' || !editor.clientId) return;
        const current = props.value.triggers.find((trigger) => trigger.clientId === editor.clientId);
        if (current?.definition?.kind !== 'sessionLifecycle') return;
        emitChange(replaceTrigger(props.value, editor.clientId, update(current.definition)));
    }, [editor, emitChange, props.value]);

    // The lifecycle occurrence-count field owns a local draft so intermediate
    // strings ("", "0", partial numbers) stay editable; a validated count
    // clamps/commits through the editor draft owner on end-editing/submit,
    // mirroring the schedule interval field. A committed change arriving from
    // outside (a policy switch, another owner, the consumed commit) resets the
    // draft so it can never shadow a foreign value.
    const lifecyclePolicyKind = selectedLifecycleDefinition?.policy.kind ?? null;
    const committedMatchCountText = String(
        selectedLifecycleDefinition?.policy.kind === 'nextMatches'
            ? selectedLifecycleDefinition.policy.count
            : 1,
    );
    const [matchCountDraftState, setMatchCountDraftState] = React.useState<Readonly<{
        basisClientId: string | null;
        basisKind: AutomationSessionLifecycleTriggerInput['policy']['kind'] | null;
        basisText: string;
        value: string;
    }> | null>(null);
    const lifecycleClientId = selectedLifecycle?.clientId ?? null;
    React.useEffect(() => {
        setMatchCountDraftState(null);
    }, [lifecycleClientId]);
    const matchCountDraft = matchCountDraftState?.basisClientId === lifecycleClientId
        && matchCountDraftState.basisKind === lifecyclePolicyKind
        && matchCountDraftState.basisText === committedMatchCountText
        ? matchCountDraftState.value
        : null;
    const commitMatchCountDraft = React.useCallback((): AutomationTriggerEditorValue | null => {
        if (matchCountDraft === null) return props.value;
        const normalized = matchCountDraft.trim();
        if (!/^\d+$/u.test(normalized)) return null;
        const parsed = Number(normalized);
        if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
        if (editor.kind !== 'sessionLifecycle' || !editor.clientId) return null;
        const current = props.value.triggers.find((trigger) => trigger.clientId === editor.clientId);
        if (current?.definition?.kind !== 'sessionLifecycle') return null;
        const nextDraft = replaceTrigger(props.value, editor.clientId, current.definition.policy.kind === 'nextMatches'
            ? {
                ...current.definition,
                policy: {
                    kind: 'nextMatches',
                    count: Math.max(1, Math.min(
                        AUTOMATION_SESSION_LIFECYCLE_MAX_MATCH_COUNT,
                        parsed,
                    )),
                },
            }
            : current.definition);
        setMatchCountDraftState(null);
        emitChange(nextDraft);
        return nextDraft;
    }, [editor, emitChange, matchCountDraft, props.value]);

    const toggleLifecycleEvent = React.useCallback((event: AutomationSessionLifecycleEvent) => {
        updateLifecycleDefinition((definition) => {
            const selected = definition.events.includes(event);
            if (selected && definition.events.length === 1) return definition;
            return {
                ...definition,
                events: selected
                    ? definition.events.filter((candidate) => candidate !== event)
                    : [...definition.events, event],
            };
        });
    }, [updateLifecycleDefinition]);

    const selectLifecyclePolicy = React.useCallback((
        kind: AutomationSessionLifecycleTriggerInput['policy']['kind'],
    ) => {
        updateLifecycleDefinition((definition) => {
            if (kind === 'currentTurn') {
                const exact = props.resolveCurrentSessionTurn?.(definition.sourceSessionId) ?? null;
                if (!exact || exact.sourceSessionId !== definition.sourceSessionId) {
                    setLifecycleSelectionStale(true);
                    props.onSessionSelectionStale?.();
                    return definition;
                }
                return { ...definition, policy: { kind, sourceTurnId: exact.sourceTurnId } };
            }
            if (kind === 'nextMatches') {
                return { ...definition, policy: { kind, count: 2 } };
            }
            return { ...definition, policy: { kind } };
        });
    }, [props.onSessionSelectionStale, props.resolveCurrentSessionTurn, updateLifecycleDefinition]);

    /**
     * The page actions and the refusal reason, as one pinned surface.
     *
     * Every decision stays where it was — the host's `onSubmit`/`onCancel`,
     * its `submitDisabled` fact and the reason it names — this only moves where
     * they are presented. Rendered at the very bottom of the document, Create
     * and Save sat beneath the composed recipe, the triggers and the software
     * keyboard on a phone; here they stay on screen while the document scrolls
     * beneath them, and the reason explaining a refused action travels with it.
     */
    const hasPageActions = props.onSubmit !== undefined || props.onCancel !== undefined;
    // Page actions keep a near-static press: an eased opacity, no movement.
    const cancelFeedback = usePressFeedback({ static: true });
    const submitFeedback = usePressFeedback({ static: true });
    /**
     * The pinned Save, as the one submit path the control, the keyboard command
     * and a host intent all press. Eligibility is enforced here rather than
     * only on the pressable, so a refused Save stays refused however it is
     * reached; the host names the reason beside the control.
     */
    const { onSubmit: submitPage } = props;
    const submitBlocked = props.submitDisabled === true || props.submitting === true;
    const submit = React.useCallback(() => {
        if (submitPage === undefined || submitBlocked) return;
        const submittedDraft = commitMatchCountDraft();
        if (!submittedDraft) return;
        submitPage(submittedDraft);
    }, [commitMatchCountDraft, submitBlocked, submitPage]);
    // `workflow.save` answers the same page Save as the visible control (UX
    // §3.6); this page has no Run, so `workflow.run` is deliberately absent.
    useKeyboardShortcutHandlers(React.useMemo(
        () => (submitPage === undefined ? {} : { 'workflow.save': submit }),
        [submit, submitPage],
    ));
    const actionSurface = hasPageActions ? (
        <View testID="automation-editor-command-bar" style={styles.commandBar}>
            <View style={styles.content}>
                {props.onSubmit && props.submitDisabled === true && props.submitDisabledReason ? (
                    /* The repairable cause, beside the control it disables. An
                       inert Save with no sentence is the silent no-op the UX
                       contract forbids. */
                    <Text
                        testID="automation-editor-submit-blocked-reason"
                        accessibilityRole="alert"
                        style={styles.submitBlockedReason}
                    >
                        {props.submitDisabledReason}
                    </Text>
                ) : null}
                <View style={styles.actions}>
                    {props.onCancel ? (
                        <Pressable
                            testID="automation-editor-cancel"
                            accessibilityRole="button"
                            disabled={props.submitting}
                            onPress={props.onCancel}
                            onPressIn={cancelFeedback.onPressIn}
                            onPressOut={cancelFeedback.onPressOut}
                            style={props.submitting ? styles.disabled : null}
                        >
                            <Animated.View style={[styles.actionButton, cancelFeedback.animatedStyle]}>
                                <Text>{t('common.cancel')}</Text>
                            </Animated.View>
                        </Pressable>
                    ) : null}
                    {props.onSubmit ? (
                        <Pressable
                            testID="automation-editor-submit"
                            accessibilityRole="button"
                            accessibilityState={{
                                disabled: props.submitDisabled === true || props.submitting === true,
                                busy: props.submitting === true,
                            }}
                            {...(props.submitDisabled === true && props.submitDisabledReason
                                ? { accessibilityHint: props.submitDisabledReason }
                                : {})}
                            disabled={submitBlocked}
                            onPress={submit}
                            onPressIn={submitFeedback.onPressIn}
                            onPressOut={submitFeedback.onPressOut}
                            style={props.submitDisabled || props.submitting ? styles.disabled : null}
                        >
                            <Animated.View style={[styles.actionButton, styles.primaryAction, submitFeedback.animatedStyle]}>
                                <Text style={styles.primaryActionText}>
                                    {props.submitting
                                        ? t('artifacts.saving')
                                        : props.variant === 'edit' ? t('common.save') : t('common.create')}
                                </Text>
                            </Animated.View>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    ) : null;

    const document = (
        <View testID="automation-plural-editor" style={styles.root}>
            <ItemGroup title={t('automations.form.groupAutomationTitle')}>
                <Item
                    title={t('automations.form.toggleEnabledTitle')}
                    subtitle={t('automations.pluralEditor.enabledSubtitle')}
                    subtitleLines={0}
                    showChevron={false}
                    rightElement={(
                        <Switch
                            value={props.value.enabled}
                            onValueChange={(enabled) => updateMetadata({ enabled })}
                            accessibilityLabel={t('automations.form.toggleEnabledTitle')}
                            accessibilityHint={t('automations.pluralEditor.enabledSubtitle')}
                        />
                    )}
                    rightElementOutsidePressable
                />
                <ItemGroupColumns paddingVertical={14} rowGap={18}>
                    <ItemGroupColumn>
                        <FieldItem label={t('automations.form.labels.name')}>
                            <FieldTextInput
                                testID="automation-name"
                                value={props.value.name}
                                onChangeText={(name) => updateMetadata({ name })}
                                placeholder={t('automations.form.placeholders.name')}
                                autoCapitalize="words"
                                accessibilityLabel={t('automations.form.labels.name')}
                            />
                        </FieldItem>
                    </ItemGroupColumn>
                    <ItemGroupColumn>
                        <FieldItem label={t('automations.form.labels.descriptionOptional')}>
                            <FieldTextInput
                                testID="automation-description"
                                value={props.value.description ?? ''}
                                onChangeText={(description) => updateMetadata({
                                    description: description.length > 0 ? description : null,
                                })}
                                placeholder={t('automations.form.placeholders.description')}
                                autoCapitalize="sentences"
                                accessibilityLabel={t('automations.form.labels.descriptionOptional')}
                            />
                        </FieldItem>
                    </ItemGroupColumn>
                </ItemGroupColumns>
            </ItemGroup>

            {props.recipeEditor ?? null}

            <ItemGroup
                title={t('automations.pluralEditor.triggersTitle')}
                description={props.value.triggers.length === 0
                    ? t('automations.pluralEditor.emptyBody')
                    : t('automations.pluralEditor.orSemantics')}
            >
                {props.value.triggers.map((trigger) => {
                    const subtitle = triggerSubtitle(
                            trigger,
                        props.sessionOptions ?? [],
                        lifecycleOrdinalByClientId.get(trigger.clientId) ?? 0,
                    );
                    return (
                    <Item
                        key={trigger.clientId}
                        testID={`automation-trigger-row-${trigger.clientId}`}
                        title={triggerTitle(trigger)}
                        subtitle={subtitle}
                        subtitleLines={0}
                        pressableRef={getTriggerRowRef(trigger.clientId)}
                        icon={<Icon
                            name={getAutomationEditorTriggerKind(trigger) === 'schedule'
                                ? 'repeat'
                                : getAutomationEditorTriggerKind(trigger) === 'pluginEvent' ? 'radio' : 'timer'}
                            size={18}
                            color={theme.colors.text.secondary}
                        />}
                        onPress={() => setEditor(getAutomationEditorTriggerKind(trigger) === 'schedule'
                            ? { kind: 'schedule', clientId: trigger.clientId }
                            : getAutomationEditorTriggerKind(trigger) === 'pluginEvent'
                                ? { kind: 'pluginEvent', clientId: trigger.clientId }
                                : {
                                    kind: 'sessionLifecycle',
                                    clientId: trigger.clientId,
                                    phase: 'configuration',
                                })}
                        rightElement={(
                            <Switch
                                testID={`automation-trigger-enabled-${trigger.clientId}`}
                                value={getAutomationEditorTriggerEnabled(trigger)}
                                onValueChange={(enabled) => emitChange(trigger.definition
                                    ? replaceTrigger(props.value, trigger.clientId, {
                                        ...trigger.definition,
                                        enabled,
                                    })
                                    : {
                                        ...props.value,
                                        triggers: props.value.triggers.map((candidate) => (
                                            candidate.clientId === trigger.clientId
                                                ? {
                                                    ...candidate,
                                                    isDirty: true,
                                                    retainedEvent: candidate.retainedEvent
                                                        ? { ...candidate.retainedEvent, enabled }
                                                        : candidate.retainedEvent,
                                                }
                                                : candidate
                                        )),
                                    })}
                                accessibilityLabel={t('automations.pluralEditor.triggerEnabledLabel', {
                                    title: `${triggerTitle(trigger)} — ${subtitle}`,
                                })}
                            />
                        )}
                        rightElementOutsidePressable
                        keepChevronWithRightElement
                    />
                    );
                })}
                <Item
                    testID="automation-trigger-add"
                    title={t('automations.pluralEditor.addTrigger')}
                    subtitle={t('automations.pluralEditor.addTriggerSubtitle')}
                    icon={<Icon name="plus" size={18} color={theme.colors.text.secondary} />}
                    onPress={() => setEditor({ kind: 'chooseKind' })}
                    pressableRef={addTriggerRowRef}
                />
            </ItemGroup>

            {editor.kind === 'chooseKind' ? (
                <ItemGroup surface="none">
                    <SelectionTiles
                        variant="action"
                        accessibilityLabel={t('automations.pluralEditor.addTrigger')}
                        options={[
                            { id: 'schedule', title: t('automations.pluralEditor.scheduleTitle'), icon: 'repeat', testID: 'automation-trigger-kind-schedule' },
                            { id: 'pluginEvent', title: t('automations.pluralEditor.eventTitle'), icon: 'radio', testID: 'automation-trigger-kind-pluginEvent' },
                            { id: 'sessionLifecycle', title: t('automations.pluralEditor.lifecycleTitle'), icon: 'timer', testID: 'automation-trigger-kind-sessionLifecycle' },
                        ]}
                        onPress={chooseTriggerKind}
                    />
                </ItemGroup>
            ) : null}

            {editor.kind === 'schedule' && selectedSchedule?.definition?.kind === 'schedule' ? (
                <>
                    <ScheduleEditor
                        value={selectedSchedule.definition}
                        fieldRef={editorFieldRef}
                        onChange={(definition) => emitChange(replaceTrigger(
                            props.value,
                            selectedSchedule.clientId,
                            definition,
                        ))}
                    />
                    <EditorActions
                        onDone={() => closeTriggerEditor(selectedSchedule.clientId)}
                        onRemove={() => { void removeTrigger(selectedSchedule.clientId); }}
                    />
                </>
            ) : null}

            {editor.kind === 'pluginEvent' ? (
                props.renderPluginEventEditor ? (
                    <>
                        {props.renderPluginEventEditor({
                            clientId: editor.clientId ?? 'new-plugin-event',
                            value: selectedPluginEvent?.definition?.kind === 'pluginEvent'
                                ? selectedPluginEvent.definition
                                : null,
                            onComplete: completePluginEvent,
                            onCancel: () => closeTriggerEditor(editor.clientId),
                        })}
                        {editor.clientId ? (
                            <EditorActions
                                onDone={() => closeTriggerEditor(editor.clientId!)}
                                onRemove={() => { void removeTrigger(editor.clientId!); }}
                            />
                        ) : null}
                    </>
                ) : (
                    <ItemGroup>
                        <Item
                            title={t('automations.pluralEditor.eventEditorUnavailable')}
                            mode="info"
                            showChevron={false}
                        />
                        <Item
                            title={t('common.done')}
                            onPress={() => closeTriggerEditor(editor.clientId)}
                            showChevron={false}
                        />
                    </ItemGroup>
                )
            ) : null}

            {editor.kind === 'sessionLifecycle' ? (
                <>
                    {lifecycleSelectionStale ? (
                        <ItemGroup>
                            <Item
                                testID="automation-lifecycle-selection-stale"
                                title={t('automations.exactTurn.staleTitle')}
                                subtitle={t('automations.exactTurn.staleBody')}
                                subtitleLines={0}
                                mode="info"
                                showChevron={false}
                                accessibilityRole="alert"
                                accessibilityLiveRegion="assertive"
                                webRole="alert"
                            />
                        </ItemGroup>
                    ) : null}
                    {editor.phase === 'source' ? (
                        <View style={styles.pickerFrame}>
                            <SelectionList
                                testID="automation-lifecycle-session-picker"
                                rootStep={lifecycleStep}
                                listAccessibilityLabel={t('automations.pluralEditor.chooseSession')}
                                onSelect={(id) => selectLifecycleSession(id)}
                                onRequestClose={() => closeTriggerEditor(editor.clientId)}
                                autoFocusInputOnWeb
                                maxHeight={360}
                                heightBehavior="stabilizedContentHeight"
                            />
                        </View>
                    ) : null}
                    {editor.phase === 'configuration'
                    && selectedLifecycleDefinition ? (
                        <>
                            <ItemGroup title={t('automations.pluralEditor.lifecycleSourceTitle')}>
                                <Item
                                    testID="automation-lifecycle-change-source"
                                    title={(props.sessionOptions ?? []).find((option) => (
                                        option.sessionId === selectedLifecycleDefinition.sourceSessionId
                                    ))?.label ?? t('automations.pluralEditor.selectedSession')}
                                    subtitle={t('automations.pluralEditor.changeLifecycleSource')}
                                    onPress={() => setEditor({
                                        kind: 'sessionLifecycle',
                                        clientId: editor.clientId,
                                        phase: 'source',
                                    })}
                                />
                            </ItemGroup>
                            <ItemGroup title={t('automations.pluralEditor.lifecycleEventsTitle')}>
                                {SESSION_LIFECYCLE_EVENTS.map((event) => (
                                    <Item
                                        key={event}
                                        testID={`automation-lifecycle-event-${event}`}
                                        title={t(`automations.pluralEditor.lifecycleEvent.${event}`)}
                                        subtitle={event === 'userActionRequired'
                                            ? t('automations.pluralEditor.lifecycleAttentionPrivacy')
                                            : undefined}
                                        subtitleLines={0}
                                        showChevron={false}
                                        rightElement={(
                                            <Switch
                                                value={selectedLifecycleDefinition.events.includes(event)}
                                                onValueChange={() => toggleLifecycleEvent(event)}
                                                accessibilityLabel={t(`automations.pluralEditor.lifecycleEvent.${event}`)}
                                            />
                                        )}
                                        rightElementOutsidePressable
                                    />
                                ))}
                            </ItemGroup>
                            <ItemGroup title={t('automations.pluralEditor.lifecyclePolicyTitle')}>
                                {SESSION_LIFECYCLE_POLICIES.map((policy) => {
                                    const selected = selectedLifecycleDefinition.policy.kind === policy;
                                    return (
                                        <Item
                                            key={policy}
                                            testID={`automation-lifecycle-policy-${policy}`}
                                            title={t(`automations.pluralEditor.lifecyclePolicy.${policy}`)}
                                            subtitle={t(`automations.pluralEditor.lifecyclePolicyDescription.${policy}`)}
                                            subtitleLines={0}
                                            onPress={() => selectLifecyclePolicy(policy)}
                                            rightElement={selected
                                                ? <Icon name="check" size={18} color={theme.colors.text.primary} />
                                                : undefined}
                                            rightElementOutsidePressable={selected}
                                        />
                                    );
                                })}
                                {selectedLifecycleDefinition.policy.kind === 'nextMatches' ? (
                                    <ItemGroupColumns paddingVertical={14} rowGap={18}>
                                        <ItemGroupColumn>
                                            <FieldItem label={t('automations.pluralEditor.lifecycleMatchCount')}>
                                                <FieldTextInput
                                                    testID="automation-lifecycle-match-count"
                                                    value={matchCountDraft ?? committedMatchCountText}
                                                    keyboardType="number-pad"
                                                    onChangeText={(value) => setMatchCountDraftState({
                                                        basisClientId: lifecycleClientId,
                                                        basisKind: lifecyclePolicyKind,
                                                        basisText: committedMatchCountText,
                                                        value,
                                                    })}
                                                    onBlur={() => {
                                                        if (commitMatchCountDraft() === null) setMatchCountDraftState(null);
                                                    }}
                                                    onSubmitEditing={() => { commitMatchCountDraft(); }}
                                                    accessibilityLabel={t('automations.pluralEditor.lifecycleMatchCount')}
                                                />
                                            </FieldItem>
                                        </ItemGroupColumn>
                                    </ItemGroupColumns>
                                ) : null}
                            </ItemGroup>
                        </>
                    ) : null}
                    {editor.clientId ? (
                        <EditorActions
                            onDone={() => {
                                if (commitMatchCountDraft() === null) return;
                                closeTriggerEditor(editor.clientId!);
                            }}
                            onRemove={() => { void removeTrigger(editor.clientId!); }}
                        />
                    ) : null}
                </>
            ) : null}
        </View>
    );

    // A host that offers no page action has nothing to pin and keeps its own
    // single scroll owner; it receives the document alone, so no host nests two.
    if (actionSurface === null) return document;

    return (
        <ItemList
            testID="automation-editor-scroll"
            // A form with focusable name, description, prompt and trigger
            // fields: the list's shared native keyboard owner keeps the
            // focused field above the keyboard instead of beneath it.
            keyboardAware
            keyboardShouldPersistTaps="handled"
            // The action surface is the pinned first child, so the page's
            // primary action stays reachable while the document scrolls under
            // it and while the software keyboard occupies the bottom.
            stickyHeaderIndices={[0]}
        >
            {actionSurface}
            <PageHeader
                title={props.variant === 'edit' ? t('automations.edit.title') : t('navigation.newAutomation')}
                description={t('automationPages.editor.description')}
            />
            <View style={styles.content}>
                {props.leading ?? null}
                {document}
            </View>
        </ItemList>
    );
});

/**
 * Metadata + trigger editor for a host that owns the recipe draft itself.
 *
 * It is the same composition the full editor uses — including the shared
 * `recipeEditor` position — for a host whose recipe is not yet an
 * `AutomationEditorDraft`, so creation does not fabricate a recipe its save
 * owner would immediately discard.
 */
export const AutomationTriggerEditor = React.memo(function AutomationTriggerEditor(
    props: AutomationTriggerEditorProps,
): React.ReactElement {
    return <AutomationTriggerEditorContents {...props} variant="embedded" />;
});

/** Full Automation editor composes the shared trigger editor with its host's recipe editor. */
export const AutomationPluralEditorScreen = React.memo(function AutomationPluralEditorScreen(
    props: AutomationPluralEditorScreenProps,
): React.ReactElement {
    const emitChange = React.useCallback((next: AutomationEditorDraft) => {
        if (props.submitting === true) return;
        props.onChange(next);
    }, [props.onChange, props.submitting]);
    return (
        <AutomationTriggerEditorContents
            {...props}
            onChange={(next) => emitChange({ ...props.value, ...next })}
            onSubmit={props.onSubmit
                ? (next) => props.onSubmit?.({ ...props.value, ...next })
                : undefined}
        />
    );
});
