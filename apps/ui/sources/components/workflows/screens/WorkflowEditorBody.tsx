import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierPressable } from '@happier-dev/plugin-ui/presentation';

import { AppPaneScopeHost, type AppPaneDestinationDetails } from '@/components/appShell/panes/AppPaneScopeHost';
import { DEFAULT_MAIN_MIN_PX } from '@/components/ui/panels/paneBreakpoints';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover/Popover';
import { useDetailsPaneAvailable } from '@/components/appShell/panes/details/detailsPaneAvailability';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { PaneHeader } from '@/components/appShell/panes/PaneHeader';
import type { PaneBuiltinAdapter } from '@/components/appShell/panes/types';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { SelectionListFilterChip } from '@/components/ui/selectionList/SelectionListFilterChips';
import { KeyboardAwareScrollView } from '@/components/ui/keyboardAvoidance/KeyboardAwareScrollView';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { PageHeaderMarkTile, PageHeaderMenu, type PageHeaderMenuAction } from '@/components/ui/layout/PageHeaderEntityParts';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { SessionAuthoringControls } from '@/components/sessions/authoring/controls/SessionAuthoringControls';
import type { SessionAuthoringControlFacts } from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';
import type { AuthoringComposerScope } from '@/components/sessions/authoring/ScopedAuthoringComposer';
import {
    useWorkflowAuthoringComposerCustody,
    type AuthoringComposerSeed,
} from '@/components/sessions/authoring/authoringComposerCustody';
import { Typography } from '@/constants/Typography';
import { useKeyboardShortcutHandlers } from '@/keyboard';
import { useKeyboardShortcutLabel } from '@/keyboard/shortcutLabels';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { t } from '@/text';

import {
    firstBlockingWorkflowIssue,
    resolveWorkflowExportBlockedReason,
    resolveEffectiveWorkflowStepExecution,
    resolveWorkflowIssueBlockId,
    resolveWorkflowRunBlockedReason,
    resolveWorkflowSaveBlockedReason,
    validateWorkflowEditorDraft,
    type WorkflowCommandBlockedReason,
    type WorkflowDraftValidation,
    type WorkflowExistingSessionOption,
} from '@/sync/domains/workflows/workflowAuthoring';
import type { WorkflowValidationIssue } from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowAuthoringTarget } from '@/sync/domains/workflows/workflowProjectTarget';
import type { Machine } from '@/sync/domains/state/storageTypes';

import {
    findWorkflowBlock,
    restoreWorkflowBlock,
    setWorkflowDefaultField,
    setWorkflowStepExecutionField,
    walkWorkflowBlocks,
    type WorkflowBlockRemoval,
} from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import {
    resolveSessionAuthoringRuntimeDescriptorAvailability,
} from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';

import { EMPTY_WORKFLOW_ANNOUNCEMENT_STATE } from '../accessibility/workflowAnnouncementSelection';
import { announceWorkflowCommandRefused, useWorkflowAnnouncements } from '../accessibility/useWorkflowAnnouncements';
import { WorkflowBlockListEditor, type WorkflowDocumentPresentation } from '../editor/WorkflowBlockListEditor';
import type { ResolveSessionActionFieldOptions } from '@/components/sessions/actions/sessionActionFieldOptions';
import { WorkflowInspector } from '../editor/WorkflowInspector';
import { resolveWorkflowSessionDrop, type WorkflowSessionDrop } from '../editor/WorkflowStepSessionDropZone';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import {
    WorkflowProjectTargetControl,
    formatWorkflowWhereSummary,
    type WorkflowProjectTargetControlHandle,
} from '../editor/WorkflowProjectTargetControl';
import { workflowPressFeedbackStyle } from '../editor/workflowEditorStyles';
import {
    WorkflowSaveStatus,
    type WorkflowSaveConflict,
    type WorkflowSaveStatusState,
} from '../editor/WorkflowSaveStatus';
import { WorkflowFlowView } from '../flow/WorkflowFlowView';
import { projectWorkflowFlow, resolveWorkflowFlowEditTarget } from '../flow/workflowFlowProjection';
import { describeWorkflowCommandBlockedReason } from '../presentation/workflowBlockedReasonText';
import { workflowBlockReferenceLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import type { WorkflowRunAsTarget, WorkflowRunAsTargetKind } from '../run/workflowRunAsTargets';

/**
 * The workflow editor page (04 §4, lab `editor-E1`).
 *
 * Identity first: the glyph mark, the name and description edited in place,
 * one primary **Run now**, and under it the save status that is its own
 * receipt. The header chips (Where, Agent & model) and the Workflow settings
 * sections render one owner each. The document is the execution order.
 *
 * Panes are the one pane primitive's slots (INT §3.1 #5): **Flow** is the
 * editor scope's right pane, rendered through `rightPaneBuiltinAdapter`;
 * **Workflow settings** is the destination-owned details pane. Where each docks
 * or overlays is `resolvePaneLayout`'s decision — this page passes no Details
 * opener and adds no placement rule of its own. On a phone there are no side
 * slots: Flow is the **Steps | Flow** switch and settings open in `@/modal`.
 *
 * It owns no route, no persistence and no admission: the host supplies the
 * draft and the explicit Run now / Save effects.
 */

/**
 * The editor's own pane scope: Flow's open state and width persist across
 * workflows like a preference, and the App scope's plugin tabs are not shared.
 */
export const WORKFLOW_EDITOR_PANE_SCOPE_ID = 'workflow-editor';
const WORKFLOW_FLOW_PANE_DESTINATION_ID = 'workflow-flow';

/** The Agent & model chips the header shows; every field is in Workflow settings. */
const HEADER_ENGINE_FIELDS = ['agentTarget', 'modelSelection'] as const;

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    pageScroll: {
        flexGrow: 1,
    },
    pageContent: {
        alignSelf: 'center',
        width: '100%',
        paddingBottom: theme.margins.xl,
    },
    headerActions: {
        alignItems: 'flex-end',
        gap: theme.margins.xs,
    },
    headerActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.xs,
    },
    keyHint: {
        ...Typography.keyHint(),
        color: theme.colors.button.primary.tint,
        opacity: 0.7,
    },
    chipsLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingHorizontal: theme.margins.lg,
        paddingBottom: theme.margins.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
    },
    document: {
        paddingHorizontal: theme.margins.lg,
        paddingTop: theme.margins.lg,
        gap: theme.margins.lg,
    },
    validity: {
        alignSelf: 'flex-end',
        paddingHorizontal: theme.margins.xs,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    validityText: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
    undoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        flexWrap: 'wrap',
    },
    reason: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
    action: {
        paddingHorizontal: theme.margins.xs,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    actionLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    phoneViewSwitch: {
        paddingHorizontal: theme.margins.lg,
        paddingTop: theme.margins.md,
    },
    phoneBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.default,
        backgroundColor: theme.colors.background.canvas,
    },
    phoneBarSpacer: {
        flex: 1,
    },
    paneBody: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
    flowBody: {
        padding: theme.margins.md,
    },
    statusLine: {
        paddingHorizontal: theme.margins.lg,
        paddingBottom: theme.margins.sm,
        alignItems: 'flex-start',
    },
}));

/**
 * The page commands, reachable by a host for an intent it carries into the
 * page (a saved row's Run now, the unsaved-changes guard's Save). Each goes
 * through exactly the same eligibility as the visible action and the keyboard
 * shortcut, so a host can never bypass the reason the page shows.
 */
export type WorkflowEditorCommands = Readonly<{
    runNow: () => void;
    save: () => void;
    /** Reveals Runs automatically in Workflow settings (a saved row's "add a trigger" intent, 04 §5.4). */
    schedule: () => void;
    exportJson: () => void;
    /** Focuses a step's prompt through the page's one focus owner, once that prompt is mounted. */
    focusPrompt: (blockId: string) => void;
}>;

/** Step options on a phone: the same inspector content, in `@/modal`. */
function WorkflowStepOptionsModal(props: WorkflowSettingsModalProps & CustomModalInjectedProps): React.ReactElement {
    return (
        <ItemList presentation="page">
            <WorkflowInspector {...props.inspector} />
        </ItemList>
    );
}

type WorkflowSettingsModalProps = Readonly<{
    inspector: React.ComponentProps<typeof WorkflowInspector>;
}>;

/** Workflow settings on a phone: the same inspector content, in `@/modal`. */
function WorkflowSettingsModal(props: WorkflowSettingsModalProps & CustomModalInjectedProps): React.ReactElement {
    return (
        <ItemList presentation="page">
            <WorkflowInspector {...props.inspector} />
        </ItemList>
    );
}

/**
 * The document column's floor (07 §3 width contract): the composer's minimum.
 * The composer has no intrinsic width of its own (its chips wrap, its field
 * flexes); its established floor is the Session main column it is built for,
 * `DEFAULT_MAIN_MIN_PX`. Passing it keeps that floor when Flow and Settings are
 * both docked, where the pane host would otherwise allow its narrower
 * three-pane default. Placement stays the resolver's.
 */
const WORKFLOW_EDITOR_MAIN_MIN_WIDTH_PX = DEFAULT_MAIN_MIN_PX;

/** Step options popover: the lab `E1o` card's width, capped by the space beside the anchor. */
const STEP_OPTIONS_MAX_WIDTH_PX = 420;
const STEP_OPTIONS_MAX_HEIGHT_PX = 640;

export type WorkflowEditorView = 'steps' | 'flow';

export type WorkflowEditorBodyProps = Readonly<{
    draft: WorkflowEditorDraft;
    onChange: (next: WorkflowEditorDraft) => void;
    /** The one exact Machine this workflow runs on; `null` stays visibly unresolved. */
    machineName: string | null;
    /**
     * Host placement is deliberately separate from the portable definition.
     * Supplying the Machines and a change handler makes it editable through
     * the canonical Where owner; otherwise it is shown read-only.
     */
    projectTarget?: WorkflowAuthoringTarget | null;
    projectMachines?: readonly Machine[];
    onChangeProjectTarget?: (target: WorkflowAuthoringTarget) => void;
    selectedBlockId: string | null;
    onSelectBlock: (blockId: string | null) => void;
    onCustomizeBlock: (blockId: string) => void;
    /** The person's open/closed settings groups (`WorkflowEditorViewState.inspectorGroupDisclosure`). */
    inspectorGroupDisclosure?: ReadonlyMap<string, boolean>;
    onChangeInspectorGroup?: (groupId: string, expanded: boolean) => void;
    /** The phone's Steps | Flow switch. Wide layouts show Flow as a pane instead. */
    view: WorkflowEditorView;
    onChangeView: (view: WorkflowEditorView) => void;
    /** "Each step runs in": the run default and each class's availability. Supply both or neither. */
    executionTarget?: WorkflowRunAsTargetKind;
    runAsTargets?: readonly WorkflowRunAsTarget[];
    onChangeExecutionTarget?: (kind: WorkflowRunAsTargetKind) => void;
    /** Explicit, separate effects. Omit one to hide it in a host that cannot offer it. */
    onRunNow?: () => void;
    runNowAnchorRef?: React.RefObject<View | null>;
    onSave?: () => void;
    onImportJson?: () => void;
    onExportJson?: () => void;
    /**
     * The workflow's description: Artifact metadata the host owns beside the
     * name, outside the portable definition. Absent change handler: read-only.
     */
    description?: string;
    onChangeDescription?: (next: string) => void;
    /** A draft opened from a Run (Save as workflow) returns to it (07 S20). */
    onBackToRun?: () => void;
    /** Review context and portability disclosures inside this page's one scroll. */
    reviewNotice?: React.ReactNode;
    /** Rare operations for the header `⋯`, in order (Delete workflow last). */
    menuActions?: readonly PageHeaderMenuAction[];
    /** True while the matching command is in flight, so it cannot be submitted twice. */
    runPending?: boolean;
    savePending?: boolean;
    /** Where the explicit Save stands (the host's save owner decides it). */
    saveStatus?: WorkflowSaveStatusState;
    saveConflict?: WorkflowSaveConflict | null;
    onSaveAsCopy?: () => void;
    /**
     * Automation metadata owns the wrapper's visible name. The copied workflow
     * definition still uses this body, but suppresses its otherwise duplicate
     * identity rather than introducing a second recipe editor.
     */
    showNameField?: boolean;
    /** Host-owned catalogs and target facts consumed by the shared Session controls. */
    authoringFacts?: SessionAuthoringControlFacts;
    /**
     * Existing Sessions a step may continue, as the host's canonical Session
     * candidacy and machine-target owners project them.
     */
    existingSessions?: readonly WorkflowExistingSessionOption[];
    /** Every continuable Session on any Machine (the authoring host's): enables the web Session drop onto a step. */
    sessionDropCandidates?: readonly WorkflowExistingSessionOption[];
    /**
     * Where every step prompt addresses reference/file search and portable
     * attachment pickers.
     */
    composerScope: AuthoringComposerScope;
    /**
     * Exact live documents handed over with the draft — the New Session chip's
     * composer — adopted once by their steps' composer custody.
     */
    composerSeeds?: readonly AuthoringComposerSeed[];
    /** The page's canonical validation, including the facts only its live composers hold. */
    onValidationChange?: (validation: WorkflowDraftValidation) => void;
    /** Lets a host invoke a page command under the page's own eligibility. */
    commandsRef?: React.Ref<WorkflowEditorCommands | null>;
    /**
     * The workflow's triggers (04 §5.4): the one summary the header chip shows, and the Runs
     * automatically section Workflow settings opens with. The chip reveals that section.
     */
    triggersSummary?: string;
    triggersSection?: React.ReactNode;
    /** The document's reading presentation (04 §4.11), for a read-only workflow. */
    documentPresentation?: WorkflowDocumentPresentation;
    /** Options for Action-step fields with an `optionsSourceId`, for the workflow's Where Machine. */
    resolveActionFieldOptions?: ResolveSessionActionFieldOptions;
    /** This workflow's saved reference, which a Run a workflow step cannot call. */
    currentWorkflowRef?: string | null;
    testIDPrefix?: string;
}>;

export function WorkflowEditorBody(props: WorkflowEditorBodyProps): React.ReactElement {
    const testIDPrefix = props.testIDPrefix ?? 'workflow-editor';
    const { draft, onChange, onRunNow, onSave, onExportJson, runPending, savePending } = props;
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
        || props.onImportJson !== undefined
        || onExportJson !== undefined;
    const maxWidthStyle = useLayoutMaxWidthStyle();
    // Placement follows the pane host, not the window: a phone has no side
    // slots, so its panes become `@/modal` and the Steps | Flow switch.
    const detailsPaneAvailable = useDetailsPaneAvailable();
    const compactLayout = !detailsPaneAvailable;
    const whereRef = React.useRef<WorkflowProjectTargetControlHandle | null>(null);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const settingsModalRef = React.useRef<string | null>(null);
    /** Field-level issues stay silent until an explicit Run or Save is refused (B3). */
    const [issuesRevealed, setIssuesRevealed] = React.useState(false);
    const stepOptionsModalRef = React.useRef<{ id: string; blockId: string } | null>(null);
    /** Step options open as an anchored popover beside the step's Customize control (wide layouts). */
    const [stepOptionsPopover, setStepOptionsPopover] = React.useState<Readonly<{
        blockId: string;
        anchorRef: React.RefObject<View | null>;
    }> | null>(null);
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

    const blockIds = React.useMemo(
        () => walkWorkflowBlocks(draft.blocks).map((block) => block.id),
        [draft.blocks],
    );
    /**
     * Custody of every step's live prompt document, held here rather than in the
     * recursive list that re-parents the rows. Moving a block between parents is
     * then pure presentation, and only deleting it ends its document.
     */
    const composerCustody = useWorkflowAuthoringComposerCustody({
        draftId: draft.draftId,
        blockIds,
        ...(props.composerSeeds === undefined ? {} : { seeds: props.composerSeeds }),
    });
    const stagedAttachmentKey = React.useSyncExternalStore(
        composerCustody.observe,
        composerCustody.readStagedAttachmentKey,
        composerCustody.readStagedAttachmentKey,
    );

    const validation = React.useMemo(() => {
        const targetIssues: WorkflowValidationIssue[] = [];
        // Device-local staged bytes cannot reach a stored definition, and the
        // portable document cannot carry them either. Rather than letting Save
        // drop them, the host reads the live composers it owns and raises the
        // canonical issue the save owner already refuses on.
        for (const staged of composerCustody.readStagedAttachments()) {
            targetIssues.push({
                code: 'unsupported_persisted_attachment' as const,
                path: `/blocks/${staged.blockId}/document/attachments/${staged.index}/content`,
                blockId: staged.blockId,
                message: t('workflows.issue.unsupported_persisted_attachment'),
                severity: 'error' as const,
            });
        }
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
    }, [composerCustody, draft, props.authoringFacts, stagedAttachmentKey]);
    const { onValidationChange } = props;
    // Published before paint, so a host gating on it never shows a stale answer.
    React.useLayoutEffect(() => {
        onValidationChange?.(validation);
    }, [onValidationChange, validation]);
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
    const resolveBlockLabel = React.useCallback((blockId: string): string => {
        const block = findWorkflowBlock(draft, blockId);
        return block === null ? blockId : workflowBlockReferenceLabel(block);
    }, [draft]);

    useWorkflowAnnouncements({
        state: React.useMemo(() => ({
            // Defaults come from the canonical empty state, so the editor never
            // restates run-window fields it does not own.
            ...EMPTY_WORKFLOW_ANNOUNCEMENT_STATE,
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
        }), [blockIds, blockingIssue, draft, props.selectedBlockId]),
        resolveBlockLabel,
    });

    const projectUnresolved = props.projectTarget === null
        || (props.projectTarget !== undefined && typeof props.projectTarget.directory === 'string' && props.projectTarget.directory.trim().length === 0);
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
    const describeBlockedReason = React.useCallback((
        reason: WorkflowCommandBlockedReason | null,
    ): string | null => describeWorkflowCommandBlockedReason({ reason, blockingIssue }), [blockingIssue]);
    const runDisabled = runBlockedReason !== null;
    const saveDisabled = savePending === true || saveBlockedReason !== null;
    const exportDisabled = exportBlockedReason !== null;
    const runReason = describeBlockedReason(runBlockedReason);
    const saveReason = describeBlockedReason(saveBlockedReason);
    const exportReason = describeBlockedReason(exportBlockedReason);

    // Eligibility is enforced at the handler, not only on the pressable, so a
    // command that cannot make progress stays inert however it is reached —
    // press, keyboard shortcut or a host-supplied action. A refused command is
    // not a silent no-op: it announces the same repairable reason the page
    // already shows beside the control.
    const refuse = React.useCallback((reason: string | null) => {
        if (reason === null) return;
        setIssuesRevealed(true);
        announceWorkflowCommandRefused(reason);
        // When the cause lives in a step, focus lands on that step's prompt so
        // the repair is where the person already is, not somewhere to search for.
        const blockId = blockingIssue === null ? null : resolveWorkflowIssueBlockId(draft, blockingIssue);
        if (blockId !== null && findWorkflowBlock(draft, blockId)?.kind === 'step') {
            props.onSelectBlock(blockId);
            requestPromptFocus(blockId);
        }
    }, [blockingIssue, draft, props.onSelectBlock, requestPromptFocus]);
    const openSettings = React.useCallback(() => setSettingsOpen(true), []);
    const submitRun = React.useCallback(() => {
        // Run now is never a dead end for a missing machine: it opens the Where
        // owner's picker (the settings on a phone), and choosing continues here.
        if (projectUnresolved && props.onChangeProjectTarget !== undefined && runPending !== true) {
            if (compactLayout) openSettings();
            else whereRef.current?.openPicker();
            return;
        }
        if (runDisabled) { refuse(runReason); return; }
        onRunNow?.();
    }, [compactLayout, onRunNow, openSettings, projectUnresolved, props.onChangeProjectTarget, refuse, runDisabled, runPending, runReason]);
    const submitSave = React.useCallback(() => {
        if (saveDisabled) { refuse(saveReason); return; }
        onSave?.();
    }, [onSave, refuse, saveDisabled, saveReason]);
    // Triggers are part of this page's draft (04 §5.4): "schedule" reveals them, never a handoff.
    const submitSchedule = openSettings;
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

    const { theme } = useUnistyles();
    const runKeyHint = useKeyboardShortcutLabel('workflow.run');
    const pane = useAppPaneScope(WORKFLOW_EDITOR_PANE_SCOPE_ID);
    const flowOpen = pane.scopeState?.right.isOpen === true;
    const closeSettings = React.useCallback(() => setSettingsOpen(false), []);

    const errorCount = React.useMemo(
        () => validation.issues.filter((issue) => issue.severity === 'error').length,
        [validation.issues],
    );
    // Once every issue is repaired the readout goes quiet again.
    React.useEffect(() => {
        if (errorCount === 0) setIssuesRevealed(false);
    }, [errorCount]);
    const focusFirstIssue = React.useCallback(() => {
        const blockId = blockingIssue === null ? null : resolveWorkflowIssueBlockId(draft, blockingIssue);
        if (blockId === null) return;
        props.onSelectBlock(blockId);
        requestPromptFocus(blockId);
    }, [blockingIssue, draft, props.onSelectBlock, requestPromptFocus]);

    // One inspector content for both subjects; only the subject and its
    // presentation differ (04 §5.2). Issues keep a group open only once the
    // page reveals them, so a pristine draft stays quiet.
    const inspectorBaseProps = React.useMemo(() => ({
        draft,
        onChange,
        ...(hasPageCommands && !issuesRevealed ? {} : { validation }),
        ...(props.inspectorGroupDisclosure === undefined ? {} : { groupDisclosure: props.inspectorGroupDisclosure }),
        ...(props.onChangeInspectorGroup === undefined ? {} : { onChangeGroupDisclosure: props.onChangeInspectorGroup }),
        ...(props.authoringFacts === undefined ? {} : { authoringFacts: props.authoringFacts }),
        ...(props.existingSessions === undefined ? {} : { existingSessions: props.existingSessions }),
        ...(props.projectTarget === undefined ? {} : { projectTarget: props.projectTarget }),
        machineName: props.machineName,
        ...(props.projectMachines === undefined ? {} : { projectMachines: props.projectMachines }),
        ...(props.onChangeProjectTarget === undefined ? {} : { onChangeProjectTarget: props.onChangeProjectTarget }),
        ...(props.executionTarget === undefined ? {} : { executionTarget: props.executionTarget }),
        ...(props.runAsTargets === undefined ? {} : { runAsTargets: props.runAsTargets }),
        ...(props.onChangeExecutionTarget === undefined ? {} : { onChangeExecutionTarget: props.onChangeExecutionTarget }),
        ...(props.triggersSection === undefined ? {} : { runsAutomatically: props.triggersSection }),
    }), [
        props.triggersSection,
        draft,
        hasPageCommands,
        issuesRevealed,
        onChange,
        props.authoringFacts,
        props.existingSessions,
        props.executionTarget,
        props.inspectorGroupDisclosure,
        props.machineName,
        props.onChangeExecutionTarget,
        props.onChangeInspectorGroup,
        props.onChangeProjectTarget,
        props.projectMachines,
        props.projectTarget,
        props.runAsTargets,
        validation,
    ]);
    const inspectorProps = React.useMemo((): React.ComponentProps<typeof WorkflowInspector> => ({
        ...inspectorBaseProps,
        subject: { kind: 'workflow' },
        presentation: 'pane',
        testIDPrefix,
    }), [inspectorBaseProps, testIDPrefix]);
    const buildStepOptionsProps = React.useCallback((blockId: string): React.ComponentProps<typeof WorkflowInspector> => ({
        ...inspectorBaseProps,
        subject: { kind: 'block', blockId },
        presentation: 'popover',
        testIDPrefix: `${testIDPrefix}-inspector`,
    }), [inspectorBaseProps, testIDPrefix]);

    const closeStepOptions = React.useCallback(() => setStepOptionsPopover(null), []);
    // Step options: an anchored popover beside the step's Customize control on
    // wide layouts, `@/modal` on a phone — one content either way.
    const openInspector = React.useCallback((blockId: string, anchorRef: React.RefObject<View | null>) => {
        props.onCustomizeBlock(blockId);
        // Every block kind has Step options (04 §5.2): a step's, a leaf's or a container's.
        if (findWorkflowBlock(draft, blockId) === null) return;
        if (!compactLayout) {
            setStepOptionsPopover({ blockId, anchorRef });
            return;
        }
        const id = Modal.show({
            component: WorkflowStepOptionsModal,
            props: { inspector: buildStepOptionsProps(blockId) },
            focusReturnRef: { current: { focus: () => requestPromptFocus(blockId) } },
            onRequestClose: () => {
                stepOptionsModalRef.current = null;
            },
            closeOnBackdrop: true,
            chrome: {
                kind: 'card',
                title: t('workflows.page.inspector.stepOptions'),
                testID: `${testIDPrefix}-inspector-modal`,
                bodyScroll: 'auto',
                dimensions: { width: 520, maxHeightRatio: 0.92, size: 'md' },
            },
        });
        stepOptionsModalRef.current = { id, blockId };
    }, [buildStepOptionsProps, compactLayout, draft, props.onCustomizeBlock, requestPromptFocus, testIDPrefix]);

    // Keep an open Step options current with the draft; close it when its step is gone.
    React.useEffect(() => {
        const open = stepOptionsModalRef.current;
        if (open === null) return;
        if (findWorkflowBlock(draft, open.blockId) === null) {
            Modal.hide(open.id);
            stepOptionsModalRef.current = null;
            return;
        }
        Modal.update(open.id, { inspector: buildStepOptionsProps(open.blockId) });
    }, [buildStepOptionsProps, draft]);
    React.useEffect(() => () => {
        const open = stepOptionsModalRef.current;
        if (open !== null) Modal.hide(open.id);
    }, []);
    const stepOptionsPopoverBlockId = stepOptionsPopover !== null
        && !compactLayout
        && findWorkflowBlock(draft, stepOptionsPopover.blockId) !== null
        ? stepOptionsPopover.blockId
        : null;

    // Phone: Workflow settings is the same content in `@/modal`, kept current
    // while open and closed with the page.
    React.useEffect(() => {
        if (!compactLayout) {
            if (settingsModalRef.current !== null) {
                Modal.hide(settingsModalRef.current);
                settingsModalRef.current = null;
            }
            return;
        }
        if (!settingsOpen) return;
        if (settingsModalRef.current === null) {
            settingsModalRef.current = Modal.show({
                component: WorkflowSettingsModal,
                props: { inspector: inspectorProps },
                onRequestClose: () => {
                    settingsModalRef.current = null;
                    setSettingsOpen(false);
                },
                closeOnBackdrop: true,
                chrome: {
                    kind: 'card',
                    title: t('workflows.page.settings'),
                    testID: `${testIDPrefix}-settings-modal`,
                    bodyScroll: 'auto',
                    dimensions: { width: 560, maxHeightRatio: 0.92, size: 'md' },
                },
            });
            return;
        }
        Modal.update(settingsModalRef.current, { inspector: inspectorProps });
    }, [compactLayout, inspectorProps, settingsOpen, testIDPrefix]);
    React.useEffect(() => () => {
        if (settingsModalRef.current !== null) Modal.hide(settingsModalRef.current);
    }, []);

    const removalUndo = lastRemoval === null ? null : (
        <View testID={`${testIDPrefix}-removal-undo`} style={styles.undoRow}>
            <Text style={styles.reason}>
                {t('workflows.editor.removedBlock', { block: workflowBlockReferenceLabel(lastRemoval.block) })}
            </Text>
            <HappierPressable
                testID={`${testIDPrefix}-undo-removal`}
                accessibilityRole="button"
                accessibilityLabel={t('workflows.editor.undo')}
                onPress={undoRemoval}
                style={(state) => [styles.action, workflowPressFeedbackStyle(state, theme.colors.border.focus)]}
            >
                <Text style={styles.actionLabel}>{t('workflows.editor.undo')}</Text>
            </HappierPressable>
        </View>
    );

    // Dropping a Session onto an Agent step writes the same `existing_session`
    // binding as Conversation › A session…, as one draft change; a Session on
    // another Machine than the Where is refused with its reason (07 J19).
    const sessionDrop = React.useMemo((): WorkflowSessionDrop | undefined => {
        const candidates = props.sessionDropCandidates;
        if (candidates === undefined) return undefined;
        const machines = props.projectMachines ?? [];
        return {
            resolve: (sessionId) => resolveWorkflowSessionDrop({
                sessionId,
                candidates,
                whereMachineId: props.projectTarget?.machineId ?? null,
                whereMachineName: props.machineName,
                machineName: (machineId) => {
                    const machine = machines.find((candidate) => candidate.id === machineId);
                    return machine === undefined ? machineId : getMachineDisplayName(machine);
                },
            }),
            bind: (stepId, option) => onChange(setWorkflowStepExecutionField(draft, stepId, 'conversation', {
                kind: 'existing_session',
                sessionId: option.sessionId,
                machineId: option.machineId,
            })),
        };
    }, [draft, onChange, props.machineName, props.projectMachines, props.projectTarget?.machineId, props.sessionDropCandidates]);

    const stepOptionsPopoverNode = stepOptionsPopover === null || stepOptionsPopoverBlockId === null ? null : (
        <Popover
            open
            anchorRef={stepOptionsPopover.anchorRef}
            focusReturnRef={stepOptionsPopover.anchorRef}
            boundaryRef={null}
            placement="auto-horizontal"
            edgePadding={{ horizontal: 12, vertical: 12 }}
            portal={{ web: { target: 'body' }, native: true, matchAnchorWidth: false }}
            maxWidthCap={STEP_OPTIONS_MAX_WIDTH_PX}
            maxHeightCap={STEP_OPTIONS_MAX_HEIGHT_PX}
            onRequestClose={closeStepOptions}
        >
            {({ maxHeight, maxWidth }) => (
                <FloatingOverlay
                    maxHeight={Math.min(maxHeight, STEP_OPTIONS_MAX_HEIGHT_PX)}
                    surfaceChrome="theme"
                    containerStyle={{ width: Math.min(maxWidth, STEP_OPTIONS_MAX_WIDTH_PX) }}
                >
                    <WorkflowInspector
                        {...buildStepOptionsProps(stepOptionsPopoverBlockId)}
                        onDone={closeStepOptions}
                    />
                </FloatingOverlay>
            )}
        </Popover>
    );

    const blockList = (
        <WorkflowBlockListEditor
            draft={draft}
            list={{ kind: 'root' }}
            blocks={draft.blocks}
            depth={0}
            selectedBlockId={props.selectedBlockId}
            composerScope={props.composerScope}
            composerCustody={composerCustody}
            validation={validation}
            onChange={onChange}
            onSelect={props.onSelectBlock}
            onCustomize={openInspector}
            onBlockRemoved={setLastRemoval}
            registerPromptRef={registerPromptRef}
            requestPromptFocus={requestPromptFocus}
            {...(props.documentPresentation === undefined ? {} : { presentation: props.documentPresentation })}
            // The page's commands own when issues speak; a composition without
            // them (the Automation wrapper) keeps its incumbent always-on text.
            revealIssues={!hasPageCommands || issuesRevealed}
            {...(props.resolveActionFieldOptions === undefined ? {} : { resolveActionFieldOptions: props.resolveActionFieldOptions })}
            {...(sessionDrop === undefined ? {} : { sessionDrop })}
            {...(props.currentWorkflowRef === undefined ? {} : { currentWorkflowRef: props.currentWorkflowRef })}
            testIDPrefix={testIDPrefix}
        />
    );

    const flowContent = flowProjection === null ? (
        <Text testID={`${testIDPrefix}-flow-unavailable`} style={styles.reason}>
            {blockingIssue === null ? '' : t(`workflows.issue.${blockingIssue.code}`)}
        </Text>
    ) : (
        <WorkflowFlowView
            projection={flowProjection}
            selectedNodeId={props.selectedBlockId}
            // Selection is the editor's: a branch frame has no block of its
            // own, so the projection resolves it to the group it belongs to.
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
    );

    const saveStatusNode = (
        <WorkflowSaveStatus
            state={props.saveConflict ? { kind: 'conflict', conflict: props.saveConflict } : (props.saveStatus ?? { kind: 'notSaved' })}
            localDraft={draft}
            {...(onSave === undefined ? {} : { onSave: submitSave })}
            onSaveAsCopy={props.onSaveAsCopy ?? (() => {})}
            testIDPrefix={testIDPrefix}
        />
    );
    const validityNode = !issuesRevealed || errorCount === 0 ? null : (
        <HappierPressable
            testID={`${testIDPrefix}-validity`}
            accessibilityRole="button"
            accessibilityLabel={t('workflows.page.issuesToFix', { count: errorCount })}
            onPress={focusFirstIssue}
            style={(state) => [styles.validity, workflowPressFeedbackStyle(state, theme.colors.border.focus)]}
        >
            <Text style={styles.validityText}>{t('workflows.page.issuesToFix', { count: errorCount })}</Text>
        </HappierPressable>
    );

    const backToRun = props.onBackToRun === undefined ? null : (
        <HappierPressable
            testID={`${testIDPrefix}-back-to-run`}
            accessibilityRole="button"
            accessibilityLabel={t('workflows.page.backToRun')}
            onPress={props.onBackToRun}
            style={(state) => [styles.action, workflowPressFeedbackStyle(state, theme.colors.border.focus)]}
        >
            <Text style={styles.actionLabel}>{t('workflows.page.backToRun')}</Text>
        </HappierPressable>
    );
    const pageMenu = props.menuActions === undefined || props.menuActions.length === 0 ? null : (
        <PageHeaderMenu testID={`${testIDPrefix}-menu`} actions={props.menuActions} />
    );
    const menu = backToRun === null ? pageMenu : <>{backToRun}{pageMenu}</>;
    const runNowButton = onRunNow === undefined ? null : (
        <View ref={props.runNowAnchorRef} collapsable={false}>
        <RoundButton
            testID={`${testIDPrefix}-run-now`}
            size="small"
            title={t('workflows.editor.runNow')}
            accessibilityLabel={t('workflows.editor.runNow')}
            {...(runReason === null ? {} : { accessibilityHint: runReason })}
            loading={runPending === true}
            leading={<Icon name="play" size={14} color={theme.colors.button.primary.tint} />}
            {...(runKeyHint === undefined ? {} : { trailing: <Text style={styles.keyHint}>{runKeyHint}</Text> })}
            onPress={submitRun}
        />
        </View>
    );

    const identity = (
        <PageHeader
            testID={`${testIDPrefix}-header`}
            title={draft.name.trim().length > 0 ? draft.name : t('workflows.page.untitled')}
            alwaysShowTitle
            leading={(
                <PageHeaderMarkTile appearance="glyph">
                    <Icon name="tree-structure" size={22} color={theme.colors.text.secondary} />
                </PageHeaderMarkTile>
            )}
            {...(props.showNameField === false ? {} : {
                titleEditor: {
                    value: draft.name,
                    placeholder: t('workflows.page.untitled'),
                    accessibilityLabel: t('workflows.page.nameLabel'),
                    onChangeText: (name: string) => onChange({ ...draft, name }),
                    testID: `${testIDPrefix}-name`,
                },
                ...(props.onChangeDescription === undefined && props.description === undefined ? {} : {
                    descriptionEditor: {
                        value: props.description ?? '',
                        placeholder: t('workflows.page.descriptionPlaceholder'),
                        accessibilityLabel: t('workflows.page.descriptionLabel'),
                        onChangeText: (description: string) => props.onChangeDescription?.(description),
                        editable: props.onChangeDescription !== undefined,
                        testID: `${testIDPrefix}-description`,
                    },
                }),
            })}
            actions={!hasPageCommands || compactLayout ? menu : (
                <View style={styles.headerActions}>
                    <View style={styles.headerActionRow}>
                        {menu}
                        <IconButton
                            testID={`${testIDPrefix}-flow-toggle`}
                            accessibilityLabel={t('workflows.page.flow')}
                            tooltip={t('workflows.page.flow')}
                            iconName="graph"
                            variant="plain"
                            selected={flowOpen}
                            onPress={() => (flowOpen ? pane.closeRight() : pane.openRight())}
                        />
                        <IconButton
                            testID={`${testIDPrefix}-settings-toggle`}
                            accessibilityLabel={t('workflows.page.settings')}
                            tooltip={t('workflows.page.settings')}
                            iconName="sidebar-right-open"
                            variant="plain"
                            selected={settingsOpen}
                            onPress={() => setSettingsOpen((open) => !open)}
                        />
                        {runNowButton}
                    </View>
                    {saveStatusNode}
                    {validityNode}
                </View>
            )}
        />
    );

    // A composition without page commands (the authored Automation wrapper,
    // retired with U-16) keeps its own single scroll owner and receives the
    // identity, the settings and the document without a page or panes.
    if (!hasPageCommands) {
        return (
            <View testID={testIDPrefix} style={{ gap: theme.margins.lg }}>
                {props.showNameField === false && props.onBackToRun === undefined ? null : identity}
                <ItemList presentation="page" scrollEnabled={false}>
                    <WorkflowInspector {...inspectorProps} />
                </ItemList>
                {blockList}
                {removalUndo}
                {stepOptionsPopoverNode}
            </View>
        );
    }

    const whereSummary = formatWorkflowWhereSummary({
        target: props.projectTarget,
        machineName: props.machineName,
        machineHomeDir: props.projectMachines?.find((machine) => machine.id === props.projectTarget?.machineId)
            ?.metadata?.homeDir ?? null,
    });

    if (compactLayout) {
        // Phone (lab `editor-P1`, corrected): the name stays in the page, the
        // chips recompose as stacked value rows, the save status sits under
        // them, Steps | Flow switches the document, and one bar above the safe
        // area holds Add, Save and the primary Run now.
        return (
            <View testID={testIDPrefix} style={styles.root}>
                <KeyboardAwareScrollView
                    testID={`${testIDPrefix}-scroll`}
                    style={styles.pageScroll}
                    contentContainerStyle={[styles.pageContent, maxWidthStyle]}
                    contentInsetAdjustmentBehavior="automatic"
                    automaticallyAdjustKeyboardInsets
                    keyboardShouldPersistTaps="handled"
                >
                    {identity}
                    {props.reviewNotice}
                    <ItemGroup>
                        <Item
                            testID={`${testIDPrefix}-where-row`}
                            title={t('workflows.page.where.label')}
                            subtitle={whereSummary ?? t('workflows.page.where.choose')}
                            showChevron
                            onPress={openSettings}
                        />
                        {props.triggersSummary === undefined ? null : (
                            <Item
                                testID={`${testIDPrefix}-triggers-row`}
                                title={t('workflows.triggers.section.title')}
                                subtitle={props.triggersSummary}
                                showChevron
                                onPress={openSettings}
                            />
                        )}
                        <Item
                            testID={`${testIDPrefix}-agent-row`}
                            title={t('workflows.page.sections.agentTitle')}
                            accessoryLayout="stacked"
                            mode="info"
                            rightElement={(
                                <SessionAuthoringControls
                                    fields={HEADER_ENGINE_FIELDS}
                                    values={draft.defaults}
                                    overriddenFields="all"
                                    onChangeField={(field, value) => onChange(setWorkflowDefaultField(draft, field, value))}
                                    {...(props.authoringFacts === undefined ? {} : { facts: props.authoringFacts })}
                                    testIDPrefix={`${testIDPrefix}-header-engine`}
                                />
                            )}
                        />
                    </ItemGroup>
                    <View style={styles.statusLine}>
                        {saveStatusNode}
                        {validityNode}
                    </View>
                    <View style={styles.phoneViewSwitch}>
                        <SegmentedTabBar<WorkflowEditorView>
                            testIDPrefix={`${testIDPrefix}-view`}
                            accessibilityLabel={t('workflows.tabsAccessibility.stepsFlow')}
                            tabs={[
                                { id: 'steps', label: t('workflows.tabs.steps') },
                                { id: 'flow', label: t('workflows.tabs.flow') },
                            ]}
                            activeTabId={props.view}
                            onSelectTab={props.onChangeView}
                        />
                    </View>
                    <View style={styles.document}>
                        {/*
                          * Steps stays mounted across the switch so every composer keeps its
                          * caret, selection and any live IME or dictation binding; Flow holds
                          * no editing state and mounts on demand.
                          */}
                        <View
                            testID={`${testIDPrefix}-steps-presentation`}
                            style={props.view === 'steps' ? undefined : { display: 'none' }}
                            {...(props.view === 'steps' ? {} : {
                                accessibilityElementsHidden: true,
                                importantForAccessibility: 'no-hide-descendants' as const,
                                pointerEvents: 'none' as const,
                            })}
                        >
                            {blockList}
                            {removalUndo}
                        </View>
                        {props.view === 'flow' ? flowContent : null}
                    </View>
                </KeyboardAwareScrollView>
                <View testID={`${testIDPrefix}-phone-bar`} style={styles.phoneBar}>
                    <HappierPressable
                        testID={`${testIDPrefix}-phone-settings`}
                        accessibilityRole="button"
                        accessibilityLabel={t('workflows.page.settings')}
                        onPress={openSettings}
                        style={(state) => [styles.action, workflowPressFeedbackStyle(state, theme.colors.border.focus)]}
                    >
                        <Icon name="sidebar-right-open" size={20} color={theme.colors.text.secondary} />
                    </HappierPressable>
                    <View style={styles.phoneBarSpacer} />
                    {onSave === undefined || props.saveStatus?.kind !== 'unsaved' ? null : (
                        <RoundButton
                            testID={`${testIDPrefix}-phone-save`}
                            size="small"
                            display="secondary"
                            title={t('workflows.page.save')}
                            onPress={submitSave}
                        />
                    )}
                    {runNowButton}
                </View>
            </View>
        );
    }

    const page = (
        <KeyboardAwareScrollView
            testID={`${testIDPrefix}-scroll`}
            style={styles.pageScroll}
            contentContainerStyle={[styles.pageContent, maxWidthStyle]}
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
        >
            {identity}
            {props.reviewNotice}
            <View testID={`${testIDPrefix}-chips`} style={styles.chipsLine}>
                <WorkflowProjectTargetControl
                    ref={whereRef}
                    presentation="chip"
                    target={props.projectTarget}
                    machineName={props.machineName}
                    {...(props.projectMachines === undefined ? {} : { machines: props.projectMachines })}
                    {...(props.onChangeProjectTarget === undefined ? {} : { onChange: props.onChangeProjectTarget })}
                    testIDPrefix={testIDPrefix}
                />
                <SessionAuthoringControls
                    fields={HEADER_ENGINE_FIELDS}
                    values={draft.defaults}
                    overriddenFields="all"
                    onChangeField={(field, value) => onChange(setWorkflowDefaultField(draft, field, value))}
                    {...(props.authoringFacts === undefined ? {} : { facts: props.authoringFacts })}
                    testIDPrefix={`${testIDPrefix}-header-engine`}
                />
                {props.triggersSummary === undefined ? null : (
                    <SelectionListFilterChip
                        filter={{
                            id: 'triggers',
                            testID: `${testIDPrefix}-triggers-chip`,
                            label: t('workflows.triggers.section.title'),
                            valueLabel: props.triggersSummary,
                            icon: <Icon name="lightning" size={16} />,
                            // The chip reveals Runs automatically in Workflow settings, never a popover of its own.
                            open: false,
                            onOpenChange: (next) => { if (next) openSettings(); },
                            renderPopoverContent: () => null,
                        }}
                    />
                )}
            </View>
            <View testID={`${testIDPrefix}-steps-presentation`} style={styles.document}>
                {blockList}
                {removalUndo}
            </View>
            {stepOptionsPopoverNode}
        </KeyboardAwareScrollView>
    );

    const flowAdapter: PaneBuiltinAdapter = {
        destinationIds: [WORKFLOW_FLOW_PANE_DESTINATION_ID],
        defaultDestinationId: WORKFLOW_FLOW_PANE_DESTINATION_ID,
        render: () => (
            <View testID={`${testIDPrefix}-flow-pane`} style={styles.paneBody}>
                <PaneHeader
                    testID={`${testIDPrefix}-flow-pane-header`}
                    title={t('workflows.page.flow')}
                    subtitle={t('workflows.page.flowSubtitle')}
                    onClose={pane.closeRight}
                />
                <ItemList presentation="page">
                    <View style={styles.flowBody}>{flowContent}</View>
                </ItemList>
            </View>
        ),
    };
    const settingsDetails: AppPaneDestinationDetails | null = !settingsOpen ? null : {
        pane: (
            <View testID={`${testIDPrefix}-settings-pane`} style={styles.paneBody}>
                <PaneHeader
                    testID={`${testIDPrefix}-settings-pane-header`}
                    title={t('workflows.page.settings')}
                    subtitle={t('workflows.page.settingsSubtitle')}
                    onClose={closeSettings}
                />
                <ItemList presentation="page">
                    <WorkflowInspector {...inspectorProps} />
                </ItemList>
            </View>
        ),
        onClose: closeSettings,
    };

    return (
        <View testID={testIDPrefix} style={styles.root}>
            <AppPaneScopeHost
                scopeId={WORKFLOW_EDITOR_PANE_SCOPE_ID}
                main={page}
                rightPaneBuiltinAdapter={flowAdapter}
                destinationDetails={settingsDetails}
                mainMinWidthPx={WORKFLOW_EDITOR_MAIN_MIN_WIDTH_PX}
            />
        </View>
    );
}
