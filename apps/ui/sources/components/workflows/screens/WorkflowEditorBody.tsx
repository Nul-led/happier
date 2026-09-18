import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { KeyboardAwareScrollView } from '@/components/ui/keyboardAvoidance/KeyboardAwareScrollView';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text, TextInput } from '@/components/ui/text/Text';
import { SessionAuthoringControls } from '@/components/sessions/authoring/controls/SessionAuthoringControls';
import type { SessionAuthoringControlFacts } from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';
import type { AuthoringComposerScope } from '@/components/sessions/authoring/ScopedAuthoringComposer';
import { MachineSelector } from '@/components/sessions/new/components/MachineSelector';
import { Typography } from '@/constants/Typography';
import { useKeyboardShortcutHandlers } from '@/keyboard';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';

import {
    firstBlockingWorkflowIssue,
    resolveWorkflowExportBlockedReason,
    resolveEffectiveWorkflowStepExecution,
    resolveWorkflowIssueBlockId,
    resolveWorkflowRunBlockedReason,
    resolveWorkflowSaveBlockedReason,
    resolveWorkflowScheduleBlockedReason,
    validateWorkflowEditorDraft,
    type WorkflowCommandBlockedReason,
    type WorkflowExistingSessionOption,
} from '@/sync/domains/workflows/workflowAuthoring';
import {
    WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS,
    type WorkflowStep,
    type WorkflowValidationIssue,
} from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import type { WorkflowArtifactRevisionV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';
import type { Machine } from '@/sync/domains/state/storageTypes';

import {
    findWorkflowBlock,
    restoreWorkflowBlock,
    setWorkflowDefaultField,
    setWorkflowFinalOutput,
    setWorkflowInputs,
    setWorkflowStepExecutionField,
    setWorkflowStepTimeout,
    walkWorkflowBlocks,
    type WorkflowBlockRemoval,
    type WorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowEditorDraft';
import {
    readSessionAuthoringAgentTargetValue,
    resolveSessionAuthoringRuntimeDescriptorAvailability,
    retireUnavailableSessionAuthoringRuntimeDescriptor,
} from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';

import { announceWorkflowCommandRefused, useWorkflowAnnouncements } from '../accessibility/useWorkflowAnnouncements';
import { WorkflowBlockListEditor } from '../editor/WorkflowBlockListEditor';
import { WorkflowFinalOutputEditor } from '../editor/WorkflowFinalOutputEditor';
import { WorkflowInputsEditor } from '../editor/WorkflowInputsEditor';
import { WorkflowStepInspector } from '../editor/WorkflowStepInspector';
import { WorkflowContinuityControls } from '../editor/WorkflowContinuityControls';
import { WorkflowSaveStatus, type WorkflowSaveConflict } from '../editor/WorkflowSaveStatus';
import { useWorkflowStepFieldControlRenderer } from '../editor/workflowStepFieldControls';
import { WorkflowFlowView } from '../flow/WorkflowFlowView';
import { projectWorkflowFlow, resolveWorkflowFlowEditTarget } from '../flow/workflowFlowProjection';
import { describeWorkflowCommandBlockedReason } from '../presentation/workflowBlockedReasonText';
import { resolveViewportClass } from '@/utils/platform/viewportClass';
import { workflowBlockReferenceLabel, workflowStepPromptLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';
import type { WorkflowRunAsTarget, WorkflowRunAsTargetKind } from '../run/workflowRunAsTargets';

/**
 * The controlled workflow editor body.
 *
 * Both hosts compose it: the neutral `/workflows` routes and the Automation
 * wrapper. It owns no route, no persistence and no admission — the host supplies
 * the draft and the explicit Run now / Save / Schedule effects, which stay three
 * separate commands rather than modes behind one button.
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
    /**
     * The page scroll this body owns when it also owns the page commands.
     *
     * A wrapper host that offers no page command keeps its own single scroll
     * owner and receives the document alone, so no host ever nests two.
     */
    pageScroll: {
        flexGrow: 1,
    },
    pageContent: {
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: theme.margins.md,
        paddingBottom: theme.margins.lg,
    },
    /**
     * The pinned command surface: opaque canvas plus the canonical hairline, so
     * the document slides beneath it instead of showing through.
     */
    commandBar: {
        backgroundColor: theme.colors.background.canvas,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
        paddingTop: theme.margins.sm,
        paddingBottom: theme.margins.sm,
        gap: theme.margins.xs,
        zIndex: 10,
    },
    header: {
        gap: theme.margins.sm,
    },
    nameInput: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        paddingVertical: theme.margins.sm,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
        flexWrap: 'wrap',
    },
    primaryAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.link,
    },
    secondaryAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    disabledAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.disabled,
    },
    reason: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    machineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        flexWrap: 'wrap',
    },
    machineLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    machineValue: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    machineUnresolved: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.placeholder,
    },
    directoryInput: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
        minWidth: 0,
        flexBasis: 220,
        flexGrow: 1,
        flexShrink: 1,
        paddingVertical: theme.margins.xs,
    },
    emptyTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    emptyBody: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    finalOutputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    finalOutputValue: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    section: {
        gap: theme.margins.sm,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    runAsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        flexWrap: 'wrap',
    },
    runAsOption: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
        paddingHorizontal: theme.margins.sm,
        borderRadius: theme.borderRadius.md,
    },
    runAsOptionSelected: {
        backgroundColor: theme.colors.surface.selected,
    },
    runAsLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
    },
    runAsLabelSelected: {
        ...Typography.default('semiBold'),
    },
    runAsLabelUnavailable: {
        ...Typography.default('regular'),
        color: theme.colors.text.disabled,
    },
    editorGrid: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: theme.margins.lg,
    },
    /**
     * The inactive reading mode stays mounted so the authored document keeps its
     * caret, selection and any live IME/dictation binding, but it must not be
     * reachable by pointer or assistive technology while the other mode shows.
     */
    presentationHidden: {
        display: 'none',
    },
    canvas: {
        flexGrow: 1,
        flexBasis: 560,
        minWidth: 0,
        gap: theme.margins.lg,
    },
    inspector: {
        flexGrow: 1,
        flexBasis: 300,
        minWidth: 260,
        maxWidth: 480,
        gap: theme.margins.sm,
    },
}));

type WorkflowStepInspectorPanelProps = Readonly<{
    draft: WorkflowEditorDraft;
    step: WorkflowStep;
    onChange: (next: WorkflowEditorDraft) => void;
    authoringFacts?: SessionAuthoringControlFacts;
    existingSessions?: readonly WorkflowExistingSessionOption[];
    testIDPrefix: string;
}>;

function WorkflowStepInspectorPanel(props: WorkflowStepInspectorPanelProps): React.ReactElement {
    const renderStepFieldControl = useWorkflowStepFieldControlRenderer({
        ...(props.authoringFacts === undefined ? {} : { facts: props.authoringFacts }),
        testIDPrefix: `${props.testIDPrefix}-control`,
    });
    const effectiveExecution = resolveEffectiveWorkflowStepExecution(props.draft, props.step);

    return (
        <View style={styles.inspector}>
            <WorkflowContinuityControls
                draft={props.draft}
                consumerBlockId={props.step.id}
                conversation={props.step.execution?.conversation ?? props.draft.defaults.conversation}
                workspace={props.step.execution?.workspace ?? props.draft.defaults.workspace}
                {...(props.existingSessions === undefined ? {} : { existingSessions: props.existingSessions })}
                onChangeConversation={(value) => props.onChange(setWorkflowStepExecutionField(
                    props.draft, props.step.id, 'conversation', value,
                ))}
                onChangeWorkspace={(value) => props.onChange(setWorkflowStepExecutionField(
                    props.draft, props.step.id, 'workspace', value,
                ))}
                testIDPrefix={`${props.testIDPrefix}-continuity`}
            />
            <WorkflowStepInspector
                draft={props.draft}
                step={props.step}
                renderFieldControl={renderStepFieldControl}
                onResetField={(field) => props.onChange(setWorkflowStepExecutionField(
                    props.draft, props.step.id, field, undefined,
                ))}
                onChangeField={(field, value) => {
                    let next = setWorkflowStepExecutionField(props.draft, props.step.id, field, value);
                    if (field === 'agentTarget') {
                        const retired = retireUnavailableSessionAuthoringRuntimeDescriptor({
                            runtimeDescriptorV1: effectiveExecution.runtimeDescriptorV1,
                            agentTarget: readSessionAuthoringAgentTargetValue(value),
                            facts: props.authoringFacts,
                        });
                        if (retired !== effectiveExecution.runtimeDescriptorV1) {
                            next = setWorkflowStepExecutionField(
                                next,
                                props.step.id,
                                'runtimeDescriptorV1',
                                retired,
                            );
                        }
                    }
                    props.onChange(next);
                }}
                onChangeTimeout={(timeoutMs) => props.onChange(setWorkflowStepTimeout(
                    props.draft, props.step.id, timeoutMs,
                ))}
                {...(props.authoringFacts === undefined ? {} : { authoringFacts: props.authoringFacts })}
                testIDPrefix={props.testIDPrefix}
            />
        </View>
    );
}

/**
 * The page commands, reachable by a host for an intent it carries into the
 * page (a saved row's Run now, the unsaved-changes guard's Save). Each goes
 * through exactly the same eligibility as the visible action and the keyboard
 * shortcut, so a host can never bypass the reason the page shows.
 */
export type WorkflowEditorCommands = Readonly<{
    runNow: () => void;
    save: () => void;
    schedule: () => void;
    exportJson: () => void;
    /** Focuses a step's prompt through the page's one focus owner, once that prompt is mounted. */
    focusPrompt: (blockId: string) => void;
}>;

function WorkflowStepInspectorModal(
    props: WorkflowStepInspectorPanelProps & CustomModalInjectedProps,
): React.ReactElement {
    return <WorkflowStepInspectorPanel {...props} />;
}

export type WorkflowEditorView = 'steps' | 'flow';

export function WorkflowEditorBody(props: Readonly<{
    draft: WorkflowEditorDraft;
    onChange: (next: WorkflowEditorDraft) => void;
    /** The one exact Machine this workflow runs on; `null` stays visibly unresolved. */
    machineName: string | null;
    onPressMachine?: () => void;
    /** Host placement is deliberately separate from the portable definition. */
    projectTarget?: WorkflowProjectTargetV1 | null;
    projectMachines?: readonly Machine[];
    onChangeProjectTarget?: (target: WorkflowProjectTargetV1) => void;
    onBrowseProjectDirectory?: () => void;
    selectedBlockId: string | null;
    onSelectBlock: (blockId: string | null) => void;
    onCustomizeBlock: (blockId: string) => void;
    view: WorkflowEditorView;
    onChangeView: (view: WorkflowEditorView) => void;
    /**
     * The page-level, Run-scoped **Run as** choice. It is deliberately not a
     * step override: one Run executes under exactly one runtime. Supply both
     * the current selection and the resolved availability, or neither.
     */
    executionTarget?: WorkflowRunAsTargetKind;
    runAsTargets?: readonly WorkflowRunAsTarget[];
    onChangeExecutionTarget?: (kind: WorkflowRunAsTargetKind) => void;
    /** Explicit, separate effects. Omit one to hide it in a host that cannot offer it. */
    onRunNow?: () => void;
    onSave?: () => void;
    onSchedule?: () => void;
    onImportJson?: () => void;
    onExportJson?: () => void;
    /** True while the matching command is in flight, so it cannot be submitted twice. */
    runPending?: boolean;
    savePending?: boolean;
    savedRevision?: WorkflowArtifactRevisionV1 | null;
    saveConflict?: WorkflowSaveConflict | null;
    onSaveAsCopy?: () => void;
    /** The Automation wrapper makes Save its one primary action. */
    primaryAction?: 'run' | 'save';
    /**
     * Automation metadata owns the wrapper's visible name. The copied workflow
     * definition still uses this body, but suppresses its otherwise duplicate
     * title field rather than introducing a second recipe editor.
     */
    showNameField?: boolean;
    /** Host-owned catalogs and target facts consumed by the shared Session controls. */
    authoringFacts?: SessionAuthoringControlFacts;
    /**
     * Existing Sessions a step may continue, as the host's canonical Session
     * candidacy and machine-target owners project them. Absent means the host
     * offers none, which the conversation control states rather than hides.
     */
    existingSessions?: readonly WorkflowExistingSessionOption[];
    /**
     * Where every step prompt addresses reference/file search and portable
     * attachment pickers. The host owns it because only the host knows whether
     * this draft captured a Session or runs on a chosen Machine and folder.
     */
    composerScope: AuthoringComposerScope;
    /** Lets a host invoke a page command under the page's own eligibility. */
    commandsRef?: React.Ref<WorkflowEditorCommands | null>;
    testIDPrefix?: string;
}>): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-editor';
    const { draft, onChange, onRunNow, onSave, onSchedule, onExportJson, runPending, savePending } = props;
    /**
     * Whether this composition owns page commands at all.
     *
     * It is derived from the effects the host actually offers rather than from a
     * separate mode flag, so the two cannot disagree: the neutral editor routes
     * offer Run now / Save / Schedule and get the pinned surface plus this page's
     * scroll, while the Automation wrappers offer none, keep their own single
     * scroll owner, and receive the authored document alone.
     */
    const hasPageCommands = onRunNow !== undefined
        || onSave !== undefined
        || onSchedule !== undefined
        || props.onImportJson !== undefined
        || onExportJson !== undefined;
    const maxWidthStyle = useLayoutMaxWidthStyle();
    const viewport = useWindowDimensions();
    const compactLayout = resolveViewportClass(viewport) === 'compact';
    const inspectorModalRef = React.useRef<{ id: string; blockId: string } | null>(null);
    const promptFocusByBlockId = React.useRef(new Map<string, () => void>());
    const pendingPromptFocusId = React.useRef<string | null>(null);
    const registerPromptRef = React.useCallback((blockId: string, focus: (() => void) | null) => {
        if (focus === null) {
            promptFocusByBlockId.current.delete(blockId);
            return;
        }
        promptFocusByBlockId.current.set(blockId, focus);
        if (pendingPromptFocusId.current === blockId) {
            pendingPromptFocusId.current = null;
            focus();
        }
    }, []);
    const requestPromptFocus = React.useCallback((blockId: string) => {
        const focus = promptFocusByBlockId.current.get(blockId);
        if (focus !== undefined) {
            focus();
            return;
        }
        pendingPromptFocusId.current = blockId;
    }, []);

    const validation = React.useMemo(() => {
        const targetIssues: WorkflowValidationIssue[] = [];
        if (resolveSessionAuthoringRuntimeDescriptorAvailability({
            values: draft.defaults,
            facts: props.authoringFacts,
        }) === 'unavailable') {
            targetIssues.push({
                code: 'target_unavailable' as const,
                path: '/defaults/runtimeDescriptorV1',
                message: t('workflows.issue.target_unavailable'),
                severity: 'error' as const,
            });
        }
        for (const block of walkWorkflowBlocks(draft.blocks)) {
            if (block.kind !== 'step') continue;
            if (resolveSessionAuthoringRuntimeDescriptorAvailability({
                values: resolveEffectiveWorkflowStepExecution(draft, block),
                facts: props.authoringFacts,
            }) !== 'unavailable') continue;
            targetIssues.push({
                code: 'target_unavailable' as const,
                path: `/blocks/${block.id}/execution/runtimeDescriptorV1`,
                blockId: block.id,
                message: t('workflows.issue.target_unavailable'),
                severity: 'error' as const,
            });
        }
        return validateWorkflowEditorDraft(draft, {
            targetValidation: props.authoringFacts === undefined ? 'unavailable' : 'checked',
            targetIssues,
        });
    }, [draft, props.authoringFacts]);
    const blockingIssue = React.useMemo(() => firstBlockingWorkflowIssue(validation), [validation]);
    const saveBlockedReason = React.useMemo(
        () => resolveWorkflowSaveBlockedReason({ draft, validation }),
        [draft, validation],
    );
    const flowProjection = React.useMemo(
        () => (validation.normalizedDefinition === undefined
            ? null
            : projectWorkflowFlow(validation.normalizedDefinition)),
        [validation.normalizedDefinition],
    );
    const selectedStep = React.useMemo((): WorkflowStep | null => {
        if (props.selectedBlockId === null) return null;
        const block = findWorkflowBlock(draft, props.selectedBlockId);
        return block?.kind === 'step' ? block : null;
    }, [draft, props.selectedBlockId]);
    const inspectorPanelProps = React.useMemo(() => selectedStep === null ? null : ({
        draft,
        step: selectedStep,
        onChange,
        ...(props.authoringFacts === undefined ? {} : { authoringFacts: props.authoringFacts }),
        ...(props.existingSessions === undefined ? {} : { existingSessions: props.existingSessions }),
        testIDPrefix: `${testIDPrefix}-inspector`,
    }), [draft, onChange, props.authoringFacts, props.existingSessions, selectedStep, testIDPrefix]);

    const closeInspectorModal = React.useCallback(() => {
        inspectorModalRef.current = null;
    }, []);

    const openInspector = React.useCallback((blockId: string) => {
        props.onCustomizeBlock(blockId);
        if (!compactLayout) return;
        const block = findWorkflowBlock(draft, blockId);
        if (block?.kind !== 'step') return;
        const panelProps: WorkflowStepInspectorPanelProps = {
            draft,
            step: block,
            onChange,
            ...(props.authoringFacts === undefined ? {} : { authoringFacts: props.authoringFacts }),
            ...(props.existingSessions === undefined ? {} : { existingSessions: props.existingSessions }),
            testIDPrefix: `${testIDPrefix}-inspector`,
        };
        const id = Modal.show({
            component: WorkflowStepInspectorModal,
            props: panelProps,
            focusReturnRef: { current: { focus: () => requestPromptFocus(blockId) } },
            onRequestClose: closeInspectorModal,
            closeOnBackdrop: true,
            chrome: {
                kind: 'card',
                title: workflowStepPromptLabel(block) ?? t('workflows.editor.customize'),
                testID: `${testIDPrefix}-inspector-modal`,
                bodyScroll: 'auto',
                dimensions: { width: 520, maxHeightRatio: 0.92, size: 'md' },
            },
        });
        inspectorModalRef.current = { id, blockId };
    }, [
        closeInspectorModal,
        compactLayout,
        draft,
        onChange,
        props.authoringFacts,
        props.existingSessions,
        props.onCustomizeBlock,
        requestPromptFocus,
        testIDPrefix,
    ]);

    React.useEffect(() => {
        const open = inspectorModalRef.current;
        if (open === null) return;
        if (!compactLayout || inspectorPanelProps === null || inspectorPanelProps.step.id !== open.blockId) {
            Modal.hide(open.id);
            inspectorModalRef.current = null;
            return;
        }
        Modal.update(open.id, inspectorPanelProps);
    }, [compactLayout, inspectorPanelProps]);

    React.useEffect(() => () => {
        const open = inspectorModalRef.current;
        if (open !== null) Modal.hide(open.id);
    }, []);

    const blockIds = React.useMemo(
        () => walkWorkflowBlocks(draft.blocks).map((block) => block.id),
        [draft.blocks],
    );
    const resolveBlockLabel = React.useCallback((blockId: string): string => {
        const block = findWorkflowBlock(draft, blockId);
        return block === null ? blockId : workflowBlockReferenceLabel(block);
    }, [draft]);

    useWorkflowAnnouncements({
        state: React.useMemo(() => ({
            blockIds,
            selectedBlockId: props.selectedBlockId,
            blockingIssue: blockingIssue === null
                ? null
                : (() => {
                    const blockId = resolveWorkflowIssueBlockId(draft, blockingIssue);
                    return blockId === null
                        ? { code: blockingIssue.code }
                        : { code: blockingIssue.code, blockId };
                })(),
            attentionCount: 0,
            terminal: null,
            changedRowCount: 0,
            selectedRowChanged: false,
        }), [blockIds, blockingIssue, draft, props.selectedBlockId]),
        resolveBlockLabel,
    });

    const projectUnresolved = props.projectTarget === null
        || (props.projectTarget !== undefined && props.projectTarget.directory.trim().length === 0);
    const projectMachineHomeDir = props.projectTarget === undefined || props.projectTarget === null
        ? undefined
        : props.projectMachines?.find((machine) => machine.id === props.projectTarget?.machineId)?.metadata?.homeDir;
    // Every page command answers the same owner, so a disabled control can name
    // its cause instead of going silently inert.
    const runBlockedReason = React.useMemo(() => resolveWorkflowRunBlockedReason({
        validation,
        targetResolved: !projectUnresolved,
        ...(runPending === undefined ? {} : { pending: runPending }),
    }), [projectUnresolved, runPending, validation]);
    const exportBlockedReason = React.useMemo(
        () => resolveWorkflowExportBlockedReason({ validation }),
        [validation],
    );
    // Schedule copies this reviewed draft into the Automation wrapper, so it
    // answers to the same canonical validation as Save and Run — checking only
    // the target accepted a press that could never produce a schedule.
    const scheduleBlockedReason = React.useMemo(() => resolveWorkflowScheduleBlockedReason({
        validation,
        targetResolved: !projectUnresolved,
    }), [projectUnresolved, validation]);
    const describeBlockedReason = React.useCallback((
        reason: WorkflowCommandBlockedReason | null,
    ): string | null => describeWorkflowCommandBlockedReason({ reason, blockingIssue }), [blockingIssue]);
    const runDisabled = runBlockedReason !== null;
    const saveDisabled = savePending === true || saveBlockedReason !== null;
    const exportDisabled = exportBlockedReason !== null;
    const scheduleDisabled = scheduleBlockedReason !== null;
    const runReason = describeBlockedReason(runBlockedReason);
    const saveReason = describeBlockedReason(saveBlockedReason);
    const exportReason = describeBlockedReason(exportBlockedReason);
    const scheduleReason = describeBlockedReason(scheduleBlockedReason);

    // Eligibility is enforced at the handler, not only on the pressable, so a
    // command that cannot make progress stays inert however it is reached —
    // press, keyboard shortcut or a host-supplied action. A refused command is
    // not a silent no-op: it announces the same repairable reason the page
    // already shows beside the control.
    const refuse = React.useCallback((reason: string | null) => {
        if (reason === null) return;
        announceWorkflowCommandRefused(reason);
        // When the cause lives in a step, focus lands on that step's prompt so
        // the repair is where the person already is, not somewhere to search for.
        const blockId = blockingIssue === null ? null : resolveWorkflowIssueBlockId(draft, blockingIssue);
        if (blockId !== null && findWorkflowBlock(draft, blockId)?.kind === 'step') {
            props.onSelectBlock(blockId);
            requestPromptFocus(blockId);
        }
    }, [blockingIssue, draft, props.onSelectBlock, requestPromptFocus]);
    const submitRun = React.useCallback(() => {
        if (runDisabled) { refuse(runReason); return; }
        onRunNow?.();
    }, [onRunNow, refuse, runDisabled, runReason]);
    const submitSave = React.useCallback(() => {
        if (saveDisabled) { refuse(saveReason); return; }
        onSave?.();
    }, [onSave, refuse, saveDisabled, saveReason]);
    const submitSchedule = React.useCallback(() => {
        if (scheduleDisabled) { refuse(scheduleReason); return; }
        onSchedule?.();
    }, [onSchedule, refuse, scheduleDisabled, scheduleReason]);
    const submitExport = React.useCallback(() => {
        if (exportDisabled) { refuse(exportReason); return; }
        onExportJson?.();
    }, [exportDisabled, exportReason, onExportJson, refuse]);

    React.useImperativeHandle(props.commandsRef, () => ({
        runNow: submitRun,
        save: submitSave,
        schedule: submitSchedule,
        exportJson: submitExport,
        focusPrompt: requestPromptFocus,
    }), [requestPromptFocus, submitExport, submitRun, submitSave, submitSchedule]);

    // Both shortcuts call the same gated owners as the visible actions: a
    // repeat while the command is pending is ignored, and a shortcut pressed
    // while the command is blocked announces the reason instead of vanishing.
    useKeyboardShortcutHandlers(React.useMemo(() => {
        const handlers: Partial<Record<'workflow.save' | 'workflow.run', () => void>> = {};
        if (onSave !== undefined) handlers['workflow.save'] = submitSave;
        if (onRunNow !== undefined) handlers['workflow.run'] = submitRun;
        return handlers;
    }, [onRunNow, onSave, submitRun, submitSave]));

    /**
     * The last removal, offered back for one in-place Undo.
     *
     * It holds a coordinate rather than a draft snapshot, so Undo re-inserts the
     * block at its original position without discarding anything edited since.
     * A later removal supersedes it; nothing is persisted.
     */
    const [lastRemoval, setLastRemoval] = React.useState<WorkflowBlockRemoval | null>(null);
    const undoRemoval = React.useCallback(() => {
        if (lastRemoval === null) return;
        onChange(restoreWorkflowBlock(draft, lastRemoval));
        props.onSelectBlock(lastRemoval.block.id);
        setLastRemoval(null);
    }, [draft, lastRemoval, onChange, props.onSelectBlock]);

    /**
     * The page commands and their refusal reasons, as one pinned surface.
     *
     * Every command decision stays where it already was — the same gated
     * submitters the keyboard shortcuts and host intents call — this only moves
     * where they are presented: the commands and the reason explaining a refused
     * one travel together, and they stay on screen while the document scrolls
     * beneath, which is what makes them reachable on a phone with the software
     * keyboard open.
     */
    const commandSurface = hasPageCommands ? (
        <View testID={`${testIDPrefix}-command-bar`} style={styles.commandBar}>
                <View style={styles.actionRow}>
                    {onRunNow === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-run-now`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.editor.runNow')}
                            {...(runReason === null ? {} : { accessibilityHint: runReason })}
                            accessibilityState={{ disabled: runDisabled }}
                            disabled={runDisabled}
                            onPress={submitRun}
                            style={styles.actionTarget}
                        >
                            <Text style={runDisabled
                                ? styles.disabledAction
                                : props.primaryAction === 'save' ? styles.secondaryAction : styles.primaryAction}
                            >
                                {t('workflows.editor.runNow')}
                            </Text>
                        </Pressable>
                    )}
                    {onSave === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-save`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.editor.save')}
                            {...(saveReason === null ? {} : { accessibilityHint: saveReason })}
                            accessibilityState={{ disabled: saveDisabled }}
                            disabled={saveDisabled}
                            onPress={submitSave}
                            style={styles.actionTarget}
                        >
                            <Text style={saveDisabled
                                ? styles.disabledAction
                                : props.primaryAction === 'save' ? styles.primaryAction : styles.secondaryAction}
                            >
                                {t('workflows.editor.save')}
                            </Text>
                        </Pressable>
                    )}
                    {props.onSchedule === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-schedule`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.editor.schedule')}
                            {...(scheduleReason === null ? {} : { accessibilityHint: scheduleReason })}
                            accessibilityState={{ disabled: scheduleDisabled }}
                            disabled={scheduleDisabled}
                            onPress={submitSchedule}
                            style={styles.actionTarget}
                        >
                            <Text style={scheduleDisabled
                                ? styles.disabledAction
                                : styles.secondaryAction}
                            >
                                {t('workflows.editor.schedule')}
                            </Text>
                        </Pressable>
                    )}
                    {props.onImportJson === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-import-json`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.importJson')}
                            onPress={props.onImportJson}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.secondaryAction}>{t('workflows.importJson')}</Text>
                        </Pressable>
                    )}
                    {props.onExportJson === undefined ? null : (
                        <Pressable
                            testID={`${testIDPrefix}-export-json`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.exportJson')}
                            {...(exportReason === null ? {} : { accessibilityHint: exportReason })}
                            accessibilityState={{ disabled: exportDisabled }}
                            disabled={exportDisabled}
                            // The canonical codec rejects an invalid draft, so Export
                            // is refused before the press rather than failing after it.
                            onPress={submitExport}
                            style={styles.actionTarget}
                        >
                            <Text style={exportDisabled ? styles.disabledAction : styles.secondaryAction}>
                                {t('workflows.exportJson')}
                            </Text>
                        </Pressable>
                    )}
                </View>

                {/* Every disabled page command states its nearby, actionable reason. */}
                {runReason === null || onRunNow === undefined ? null : (
                    <Text testID={`${testIDPrefix}-run-reason`} style={styles.reason}>{runReason}</Text>
                )}
                {scheduleReason === null || props.onSchedule === undefined ? null : (
                    <Text testID={`${testIDPrefix}-schedule-reason`} style={styles.reason}>{scheduleReason}</Text>
                )}
                {exportReason === null || props.onExportJson === undefined ? null : (
                    <Text testID={`${testIDPrefix}-export-reason`} style={styles.reason}>{exportReason}</Text>
                )}
                {saveReason === null || onSave === undefined ? null : (
                    <Text testID={`${testIDPrefix}-save-reason`} style={styles.reason}>{saveReason}</Text>
                )}
        </View>
    ) : null;

    const isSingleEmptyPrompt = draft.blocks.length === 1
        && draft.blocks[0]?.kind === 'step'
        && draft.blocks[0].document.text.length === 0;

    const document = (
        <View testID={testIDPrefix} style={styles.root}>
            <View style={styles.header}>
                {props.showNameField === false ? null : (
                    <TextInput
                        testID={`${testIDPrefix}-name`}
                        style={styles.nameInput}
                        value={draft.name}
                        placeholder={t('workflows.editor.namePlaceholder')}
                        accessibilityLabel={t('workflows.editor.namePlaceholder')}
                        onChangeText={(name) => onChange({ ...draft, name })}
                    />
                )}

                <View testID={`${testIDPrefix}-machine-row`} style={styles.machineRow}>
                    <Text style={styles.machineLabel}>{t('workflows.editor.whereTitle')}</Text>
                    {props.projectMachines !== undefined && props.onChangeProjectTarget !== undefined ? (
                        <MachineSelector
                            machines={props.projectMachines}
                            selectedMachine={props.projectTarget === null
                                ? null
                                : props.projectMachines.find((machine) => machine.id === props.projectTarget?.machineId) ?? null}
                            onSelect={(machine) => props.onChangeProjectTarget?.({
                                ...(props.projectTarget?.machineId === machine.id ? props.projectTarget : {}),
                                machineId: machine.id,
                                directory: props.projectTarget?.machineId === machine.id
                                    ? props.projectTarget.directory
                                    : machine.metadata?.homeDir ?? '',
                            })}
                            presentation="dropdown"
                            showFavorites={false}
                            showRecent={false}
                            showCliGlyphs={false}
                            dropdownTitle={t('workflows.editor.whereTitle')}
                            dropdownTestID={`${testIDPrefix}-machine`}
                            testIdPrefix={`${testIDPrefix}-machine`}
                        />
                    ) : (
                        <Pressable
                            testID={`${testIDPrefix}-machine`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.editor.whereTitle')}
                            onPress={props.onPressMachine}
                            disabled={props.onPressMachine === undefined}
                            style={styles.actionTarget}
                        >
                            <Text style={props.machineName === null ? styles.machineUnresolved : styles.machineValue}>
                                {props.machineName ?? t('workflows.issue.target_unavailable')}
                            </Text>
                        </Pressable>
                    )}
                    {props.projectTarget === undefined || props.projectTarget === null || props.onChangeProjectTarget === undefined
                        ? props.projectTarget === undefined || props.projectTarget === null ? null : (
                            <Text
                                testID={`${testIDPrefix}-project-directory-readonly`}
                                style={styles.machineValue}
                            >
                                {formatPathRelativeToHome(props.projectTarget.directory, projectMachineHomeDir)}
                            </Text>
                        )
                        : (
                            <>
                                <TextInput
                                    testID={`${testIDPrefix}-project-directory`}
                                    style={styles.directoryInput}
                                    value={props.projectTarget.directory}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    accessibilityLabel={t('workflows.workspace.projectCheckout')}
                                    placeholder={t('workflows.workspace.projectCheckout')}
                                    onChangeText={(directory) => props.onChangeProjectTarget?.({
                                        ...props.projectTarget!,
                                        directory,
                                    })}
                                />
                                {props.onBrowseProjectDirectory === undefined ? null : (
                                    <Pressable
                                        testID={`${testIDPrefix}-project-browse`}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('workflows.workspace.inspect')}
                                        onPress={props.onBrowseProjectDirectory}
                                        style={styles.actionTarget}
                                    >
                                        <Text style={styles.secondaryAction}>{t('workflows.workspace.inspect')}</Text>
                                    </Pressable>
                                )}
                            </>
                        )}
                </View>

                {props.runAsTargets === undefined || props.onChangeExecutionTarget === undefined ? null : (
                    <View
                        testID={`${testIDPrefix}-run-as`}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('workflows.editor.runAsTitle')}
                        style={styles.runAsRow}
                    >
                        <Text style={styles.machineLabel}>{t('workflows.editor.runAsTitle')}</Text>
                        {props.runAsTargets.map((target) => {
                            const selected = props.executionTarget === target.kind;
                            const reason = target.available
                                ? null
                                : t(`workflows.editor.runAsUnavailableReason.${target.unavailableReason}`);
                            return (
                                <Pressable
                                    key={target.kind}
                                    testID={`${testIDPrefix}-run-as-${target.kind}`}
                                    accessibilityRole="radio"
                                    accessibilityLabel={t(`workflows.editor.runAs.${target.kind}`)}
                                    // The reason reaches assistive technology on the
                                    // control itself, not only as nearby text.
                                    {...(reason === null ? {} : { accessibilityHint: reason })}
                                    accessibilityState={{
                                        selected,
                                        ...(target.available ? {} : { disabled: true }),
                                    }}
                                    disabled={!target.available}
                                    // Eligibility is enforced here, not only on the
                                    // pressable: an unavailable runtime is refused
                                    // rather than quietly downgraded to a Session.
                                    onPress={() => {
                                        if (!target.available) return;
                                        props.onChangeExecutionTarget?.(target.kind);
                                    }}
                                    style={[
                                        styles.runAsOption,
                                        selected ? styles.runAsOptionSelected : null,
                                    ]}
                                >
                                    <Text style={[
                                        target.available ? styles.runAsLabel : styles.runAsLabelUnavailable,
                                        selected ? styles.runAsLabelSelected : null,
                                    ]}>
                                        {t(`workflows.editor.runAs.${target.kind}`)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                        {/* Each unavailable runtime states its own cause; one blanket
                            "not available yet" hid four different reasons. */}
                        {props.runAsTargets.map((target) => (target.available ? null : (
                            <Text
                                key={`${target.kind}-reason`}
                                testID={`${testIDPrefix}-run-as-${target.kind}-reason`}
                                style={styles.reason}
                            >
                                {t(`workflows.editor.runAsUnavailableReason.${target.unavailableReason}`)}
                            </Text>
                        )))}
                    </View>
                )}
            </View>

            <WorkflowSaveStatus
                revision={props.savedRevision ?? null}
                conflict={props.saveConflict ?? null}
                localDraft={draft}
                onSaveAsCopy={props.onSaveAsCopy ?? (() => {})}
                savePending={savePending}
                testIDPrefix={testIDPrefix}
            />

            {isSingleEmptyPrompt ? (
                <View>
                    <Text style={styles.emptyTitle}>{t('workflows.editor.firstPromptTitle')}</Text>
                    <Text style={styles.emptyBody}>{t('workflows.editor.firstPromptBody')}</Text>
                </View>
            ) : null}

            <SegmentedTabBar<WorkflowEditorView>
                testIDPrefix={`${testIDPrefix}-view`}
                accessibilityLabel={t('workflows.tabsAccessibility.stepsFlow')}
                tabs={[
                    { id: 'steps', label: t('workflows.tabs.steps') },
                    { id: 'flow', label: t('workflows.tabs.flow') },
                ]}
                activeTabId={props.view}
                onSelectTab={props.onChangeView}
                compact
            />

            <View style={styles.editorGrid}>
                <View style={styles.canvas}>
                    {/*
                      * Steps is the authored document and stays mounted across the
                      * reading-mode switch. Unmounting it would destroy every step
                      * composer instance — and with it the caret, selection and any
                      * active IME/dictation correlation — which is precisely the
                      * continuity this editor promises. Flow derives entirely from
                      * the draft and holds no editing state, so it mounts on demand.
                      */}
                    <View
                        testID={`${testIDPrefix}-steps-presentation`}
                        style={props.view === 'steps' ? undefined : styles.presentationHidden}
                        {...(props.view === 'steps' ? {} : {
                            accessibilityElementsHidden: true,
                            importantForAccessibility: 'no-hide-descendants' as const,
                            pointerEvents: 'none' as const,
                        })}
                    >
                        <WorkflowBlockListEditor
                            draft={draft}
                            list={{ kind: 'root' }}
                            blocks={draft.blocks}
                            depth={0}
                            selectedBlockId={props.selectedBlockId}
                            composerScope={props.composerScope}
                            validation={validation}
                            onChange={onChange}
                            onSelect={props.onSelectBlock}
                            onCustomize={openInspector}
                            onBlockRemoved={setLastRemoval}
                            registerPromptRef={registerPromptRef}
                            requestPromptFocus={requestPromptFocus}
                            testIDPrefix={testIDPrefix}
                        />
                        {lastRemoval === null ? null : (
                            <View testID={`${testIDPrefix}-removal-undo`} style={styles.runAsRow}>
                                <Text style={styles.reason}>
                                    {t('workflows.editor.removedBlock', {
                                        block: workflowBlockReferenceLabel(lastRemoval.block),
                                    })}
                                </Text>
                                <Pressable
                                    testID={`${testIDPrefix}-undo-removal`}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('workflows.editor.undo')}
                                    onPress={undoRemoval}
                                    style={styles.actionTarget}
                                >
                                    <Text style={styles.secondaryAction}>{t('workflows.editor.undo')}</Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                    {props.view === 'steps' ? null : flowProjection === null ? (
                        <Text testID={`${testIDPrefix}-flow-unavailable`} style={styles.reason}>
                            {blockingIssue === null ? '' : t(`workflows.issue.${blockingIssue.code}`)}
                        </Text>
                    ) : (
                        <WorkflowFlowView
                            projection={flowProjection}
                            selectedNodeId={props.selectedBlockId}
                            // Selection is the editor's: a branch frame has no
                            // block of its own, so the projection resolves it to
                            // the group it belongs to and that is what is selected.
                            onSelectNode={(nodeId) => props.onSelectBlock(
                                resolveWorkflowFlowEditTarget(flowProjection, nodeId)?.blockId ?? nodeId,
                            )}
                            onEditStep={(target) => {
                                props.onSelectBlock(target.blockId);
                                props.onChangeView('steps');
                                if (target.kind === 'prompt') requestPromptFocus(target.blockId);
                            }}
                            testIDPrefix={`${testIDPrefix}-flow`}
                        />
                    )}
                </View>

                {compactLayout || inspectorPanelProps === null ? null : (
                    <WorkflowStepInspectorPanel {...inspectorPanelProps} />
                )}
            </View>

            <WorkflowInputsEditor
                inputs={draft.inputs}
                onChange={(inputs) => onChange(setWorkflowInputs(draft, inputs))}
                testIDPrefix={testIDPrefix}
            />

            <View testID={`${testIDPrefix}-defaults`} style={styles.section}>
                <Text style={styles.sectionTitle}>{t('workflows.editor.defaultsTitle')}</Text>
                <SessionAuthoringControls
                    fields={WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS}
                    values={draft.defaults}
                    onChangeField={(field, value) => {
                        let next = setWorkflowDefaultField(draft, field, value);
                        if (field === 'agentTarget') {
                            const retired = retireUnavailableSessionAuthoringRuntimeDescriptor({
                                runtimeDescriptorV1: draft.defaults.runtimeDescriptorV1,
                                agentTarget: readSessionAuthoringAgentTargetValue(value),
                                facts: props.authoringFacts,
                            });
                            if (retired !== draft.defaults.runtimeDescriptorV1) {
                                next = setWorkflowDefaultField(next, 'runtimeDescriptorV1', retired);
                            }
                        }
                        onChange(next);
                    }}
                    {...(props.authoringFacts === undefined ? {} : { facts: props.authoringFacts })}
                    testIDPrefix={`${testIDPrefix}-defaults`}
                />
                <WorkflowContinuityControls
                    draft={draft}
                    conversation={draft.defaults.conversation}
                    workspace={draft.defaults.workspace}
                    {...(props.existingSessions === undefined ? {} : { existingSessions: props.existingSessions })}
                    onChangeConversation={(value) => onChange(setWorkflowDefaultField(draft, 'conversation', value))}
                    onChangeWorkspace={(value) => onChange(setWorkflowDefaultField(draft, 'workspace', value))}
                    testIDPrefix={`${testIDPrefix}-defaults-continuity`}
                />
            </View>

            <WorkflowFinalOutputEditor
                draft={draft}
                onChange={(finalOutput) => onChange(setWorkflowFinalOutput(draft, finalOutput))}
                testIDPrefix={testIDPrefix}
            />

            <Text testID={`${testIDPrefix}-final-output`} style={styles.finalOutputValue}>
                {draft.finalOutput === undefined
                    ? t('workflows.finalOutput.none')
                    : resolveBlockLabel(draft.finalOutput.producer.blockId)}
            </Text>
        </View>
    );

    if (!hasPageCommands) return document;

    return (
        <KeyboardAwareScrollView
            testID={`${testIDPrefix}-scroll`}
            style={styles.pageScroll}
            contentContainerStyle={[styles.pageContent, maxWidthStyle]}
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            // The command surface is the pinned first child, so the page's one
            // dominant action stays reachable while the document scrolls under
            // it and while the software keyboard occupies the bottom.
            stickyHeaderIndices={[0]}
        >
            {commandSurface}
            {document}
        </KeyboardAwareScrollView>
    );
}
