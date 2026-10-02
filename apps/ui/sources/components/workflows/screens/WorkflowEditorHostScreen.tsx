import { useAuthoringMemoryField } from '@/sync/domains/state/storage';
import * as React from 'react';
import { showDocumentShareSheet } from '@/components/sharing/documents/showDocumentShareSheet';
import { createWorkflowDefinitionRoute } from '@/sync/domains/workflows/workflowRunRoute';
import { View } from 'react-native';
import { useNavigation, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native-unistyles';

import { Modal } from '@/modal';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { captureActiveServerAccountScopeLifetime, type ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { useActiveServerAccountScope, useAllMachines, useSetting } from '@/sync/domains/state/storage';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { useMountedRef } from '@/hooks/ui/useMountedRef';

import { pluginJsonValuesEqual, type JsonValue } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import { isWorkflowProjectTarget } from '@/sync/domains/workflows/workflowProjectTarget';
import type { WorkflowArtifactRevisionV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';

import {
    createWorkflowDefinition,
    deleteWorkflowDefinition,
    getWorkflowDefinition,
    isWorkflowDefinitionConflictError,
    updateWorkflowDefinition,
} from '@/sync/domains/workflows/workflowDefinitionActions';
import {
    buildWorkflowEditorDraftFromDefinition,
    validateWorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowAuthoring';
import {
    createWorkflowEditorDraft,
    selectWorkflowBlock,
    setWorkflowInspectorGroupExpanded,
    EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    type WorkflowEditorDraft,
    type WorkflowEditorViewState,
} from '@/sync/domains/workflows/workflowEditorDraft';
import { setWorkflowDefaultField, setWorkflowStepExecutionField } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';
import { useWorkflowRunNowController } from '../run/useWorkflowRunNowController';
import { workflowBlockReferenceLabel } from '@/sync/domains/workflows/workflowBlockLabel';
import {
    resolveAdmittedWorkflowExecutionTarget,
    resolveWorkflowRunAsTargets,
    type WorkflowRunAsTargetKind,
} from '../run/workflowRunAsTargets';
import { useWorkflowDetachedRunSupport } from '../run/useWorkflowDetachedRunSupport';
import { resolveContextualWorkflowProjectTarget } from './resolveContextualWorkflowTarget';
import { readWorkflowReviewedRunSeed } from '@/sync/domains/workflows/workflowReviewedRunSeed';
import { readNewSessionAutomationHandoffSeed } from '@/sync/domains/workflows/newSessionAutomationHandoffSeed';
import { readTriggerWorkflowSeed, retargetTriggerToWorkflow } from '../triggers/triggerWorkflowSeed';
import {
    useWorkflowRunComposerModal,
    type WorkflowRunComposerModalProps,
} from '../run/useWorkflowRunComposerModal';
import { WorkflowEditorBody, type WorkflowEditorCommands, type WorkflowEditorView } from './WorkflowEditorBody';
import { useWorkflowAuthoringHost } from './useWorkflowAuthoringHost';
import type { WorkflowSaveConflict, WorkflowSaveStatusState } from '../editor/WorkflowSaveStatus';
import type { PageHeaderMenuAction } from '@/components/ui/layout/PageHeaderEntityParts';
import { WorkflowMissingDefinitionState } from './WorkflowMissingDefinitionState';
import { WorkflowTriggerSection } from '../triggers/WorkflowTriggerSection';
import { useWorkflowTriggerEditing } from '../triggers/useWorkflowTriggerEditing';
import { formatWorkflowWhereSummary, WorkflowProjectTargetControl } from '../editor/WorkflowProjectTargetControl';
import { createExecutionRunStartContentChip } from '@/components/sessions/runs/launcher/executionRunStartChips';
import { useActionFieldOptionsForMachine } from '@/components/sessions/actions/useSessionActionFieldOptions';
import { walkWorkflowBlocks } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';
import { formatWorkflowProblemMessage } from '@/components/workflows/presentation/workflowProblemPresentation';
import { exportWorkflowDocument, importWorkflowDocument } from '@/sync/domains/workflows/workflowInterchange';
import {
    pickWorkflowDocumentText,
} from '@/sync/domains/workflows/workflowDocumentFile';
import { confirmWorkflowDocumentExport } from '../actions/confirmWorkflowDocumentExport';
import { WorkflowImportReview } from '../editor/WorkflowImportReview';
import { useUnsavedDraftNavigationGuard } from '@/utils/navigation/useUnsavedDraftNavigationGuard';

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
}));

/**
 * Route host for the neutral workflow editor.
 *
 * It owns draft identity, hydration, Account currentness and the two explicit
 * effects — Run now and Save workflow. Save writes the Account Artifact, then
 * this Account's trigger delta through `workflow.trigger.*` (04 §5.4); Run now
 * freezes the displayed draft through run admission without saving it. Neither
 * is a mode of the other.
 */

/**
 * What a saved-row entry asked for besides opening the definition.
 *
 * Edit, Run now and Schedule are three intents over one editor, not one route:
 * a saved definition carries no reviewed Machine or page-level **Run as**
 * choice, so the collection cannot admit a Run by itself; Schedule reveals the
 * editor's Runs automatically section.
 * It opens the exact Artifact revision here and names the intent; this host
 * then presses its own canonical action once that revision is hydrated.
 */
export type WorkflowSavedEntryIntent = 'run' | 'schedule';

export type WorkflowEditorSource =
    | Readonly<{
        kind: 'new';
        requestImport?: boolean;
        /**
         * Opaque handle to an accepted definition a person chose to review as a
         * new Run after in-place recovery proved impossible. It seeds the draft
         * and its placement; nothing is admitted until Run now is pressed.
         */
        reviewedRunSeedId?: string;
        /**
         * Opaque handle to New Session's composed prompt ("Make this prompt a workflow…", 04 §5.5):
         * it seeds the draft, its placement and the first step's exact composer document. Nothing is
         * written until Save; the editor opens on Runs automatically.
         */
        newSessionDraftSeedId?: string;
        /**
         * Opaque handle to a trigger's own steps opened through Save as workflow (F1): the draft, and
         * the trigger its first Save points at the new workflow.
         */
        triggerWorkflowSeedId?: string;
    }>
    | Readonly<{
        kind: 'saved';
        definitionId: string;
        /**
         * What the opening surface asked for once this revision is reviewed.
         * Omitted means Edit: open the definition and change nothing.
         */
        intent?: WorkflowSavedEntryIntent;
    }>;

type SavedRevision = Readonly<{ definitionId: string; revision: WorkflowArtifactRevisionV1 }>;

/**
 * The stable semantic identity of an editor source.
 *
 * Route hosts build `source` inline, so its object identity changes on every
 * render and can never decide whether this is the same logical draft. Keying on
 * kind plus the ids that actually select content is what lets a rerender keep
 * the prompt text, caret, steps, scroll position and dirty state, while a
 * genuinely different source still initializes from scratch.
 *
 * New-entry intents are distinct sources when they select different reviewed
 * bytes or ask to replace the draft through Import. The current reviewed seed
 * is retained as source-local state after its one allowed temp-store read.
 */
function workflowEditorSourceKey(source: WorkflowEditorSource): string {
    switch (source.kind) {
        case 'new':
            return [
                'new',
                source.reviewedRunSeedId ?? '',
                source.newSessionDraftSeedId ?? '',
                source.triggerWorkflowSeedId ?? '',
                source.requestImport === true ? 'import' : 'author',
            ].join('\u0000');
        case 'saved':
            return `saved\u0000${source.definitionId}`;
    }
}

type ReviewedRunSeedState = Readonly<{
    id: string | null;
    seed: ReturnType<typeof readWorkflowReviewedRunSeed>;
    lifetime: ActiveServerAccountScopeLifetime | null;
    retired: boolean;
}>;

function readReviewedRunSeedState(id: string | null): ReviewedRunSeedState {
    const seed = id === null ? null : readWorkflowReviewedRunSeed(id);
    return { id, seed, lifetime: seed === null ? null : captureActiveServerAccountScopeLifetime(), retired: false };
}

export function WorkflowEditorHostScreen(props: Readonly<{
    source: WorkflowEditorSource;
}>): React.ReactElement {
    const mountedRef = useMountedRef();
    const router = useRouter();
    const navigation = useNavigation();
    const machines = useAllMachines();
    const activeAccountScope = useActiveServerAccountScope();
    const accountScopeKey = activeAccountScope === null
        ? null
        : serverAccountScopeKeySuffix(activeAccountScope);
    const runNow = useWorkflowRunNowController();

    const reviewedRunSeedId = props.source.kind === 'new'
        ? props.source.reviewedRunSeedId ?? null
        : null;
    // The temp-store handle is destructive. Keep only the seed for the current
    // logical source so a same-mounted A -> B transition consumes B once while
    // ordinary rerenders never try to consume A again.
    const [reviewedRunSeedState, setReviewedRunSeedState] = React.useState(() => readReviewedRunSeedState(reviewedRunSeedId));
    const reviewedRunSeed = reviewedRunSeedState.id === reviewedRunSeedId && !reviewedRunSeedState.retired
        && reviewedRunSeedState.lifetime?.isCurrent()
        ? reviewedRunSeedState.seed
        : null;

    React.useEffect(() => {
        const lifetime = reviewedRunSeedState.lifetime;
        if (lifetime === null) return;
        const subscription = lifetime.onRetire(() => {
            setReviewedRunSeedState((current) => current.lifetime === lifetime
                ? { ...current, seed: null, retired: true }
                : current);
        });
        return () => subscription.dispose();
    }, [reviewedRunSeedState.lifetime]);

    /**
     * A private seed belongs to the exact server and Account that opened it.
     *
     * A reviewed Run copy and a captured Session both arrive as already-decrypted
     * Account-private bytes held in memory, not as an id another Account could
     * re-open. Re-initialization is keyed on the Account, so without this the
     * Account-only change re-adopted those same bytes and stamped them with the
     * new scope — presenting, and offering to save, one Account's private
     * workflow as another's. There is nothing to re-read, so the honest outcome
     * is to withdraw the seed and say so.
     */
    const carriesPrivateSeed = props.source.kind === 'new'
        && (props.source.reviewedRunSeedId !== undefined || props.source.newSessionDraftSeedId !== undefined
            || props.source.triggerWorkflowSeedId !== undefined);
    // New Session's composed draft: read once (the handle is destructive) and kept only for the
    // Account that composed it, so an Account change never re-adopts those private bytes.
    const newSessionDraftSeedId = props.source.kind === 'new' ? props.source.newSessionDraftSeedId ?? null : null;
    const [newSessionSeedState] = React.useState(() => ({
        scopeKey: accountScopeKey,
        seed: newSessionDraftSeedId === null ? null : readNewSessionAutomationHandoffSeed(newSessionDraftSeedId),
    }));
    const newSessionSeed = newSessionSeedState.scopeKey === accountScopeKey ? newSessionSeedState.seed : null;
    // Save as workflow from a trigger: read once, kept only for the Account that opened it.
    const triggerWorkflowSeedId = props.source.kind === 'new' ? props.source.triggerWorkflowSeedId ?? null : null;
    const [triggerSeedState] = React.useState(() => ({
        scopeKey: accountScopeKey,
        seed: triggerWorkflowSeedId === null ? null : readTriggerWorkflowSeed(triggerWorkflowSeedId),
    }));
    const triggerSeed = triggerSeedState.scopeKey === accountScopeKey ? triggerSeedState.seed : null;
    // The trigger still to point at this workflow once it is saved; cleared when that write lands.
    const pendingRetargetRef = React.useRef(triggerSeed?.retarget ?? null);
    const [retargetFailed, setRetargetFailed] = React.useState(false);
    const createDraftForSource = (
        seed: typeof reviewedRunSeed,
    ): WorkflowEditorDraft => (
        seed !== null
            ? buildWorkflowEditorDraftFromDefinition({
                draftId: randomUUID(),
                name: seed.name,
                definition: seed.definition,
            })
            : newSessionSeed !== null
                ? newSessionSeed.draft
                : triggerSeed !== null
                    ? buildWorkflowEditorDraftFromDefinition({ draftId: randomUUID(), name: '', definition: triggerSeed.definition })
                    : createWorkflowEditorDraft({ draftId: randomUUID() })
    );

    const [draft, setDraft] = React.useState<WorkflowEditorDraft | null>(
        props.source.kind === 'saved' ? null : createDraftForSource(reviewedRunSeed),
    );
    // The pristine baseline is the exact draft this editor started from, not a
    // second construction of it: comparing against a different object with a
    // different draft id would report an untouched editor as dirty.
    const initialDraftBaselineRef = React.useRef<WorkflowEditorDraft | null>(draft);
    const [contentScopeKey, setContentScopeKey] = React.useState<string | null>(
        props.source.kind === 'saved' ? null : accountScopeKey,
    );
    const [saved, setSaved] = React.useState<SavedRevision | null>(null);
    const [hydrationFailed, setHydrationFailed] = React.useState(false);
    const [hydrationAttempt, setHydrationAttempt] = React.useState(0);
    const [view, setView] = React.useState<WorkflowEditorView>('steps');
    const [selection, setSelection] = React.useState<WorkflowEditorViewState>(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
    const [inputValues, setInputValues] = React.useState<Readonly<Record<string, JsonValue | undefined>>>(reviewedRunSeed?.inputs ?? {});
    const [inputRawTextValues, setInputRawTextValues] = React.useState<Readonly<Record<string, string>>>({});
    const [inputSheetOpen, setInputSheetOpen] = React.useState(false);
    const [savePending, setSavePending] = React.useState(false);
    const [saveConflict, setSaveConflict] = React.useState<WorkflowSaveConflict | null>(null);
    /**
     * The description is Artifact metadata beside the name, outside the portable
     * definition: hydrated from the opened revision (or a reviewed copy's seed)
     * and written with the title on Save.
     */
    const [description, setDescription] = React.useState<string>(reviewedRunSeed?.description ?? newSessionSeed?.description ?? '');
    const savedDescriptionRef = React.useRef<string>(reviewedRunSeed?.description ?? '');
    /** When this editor last saved (for "Saved just now"); `null` after opening a revision. */
    const [savedAtMs, setSavedAtMs] = React.useState<number | null>(null);
    /** The last explicit Save's failure, stated in the save status until the next Save. */
    const [saveFailure, setSaveFailure] = React.useState<string | null | undefined>(undefined);
    // Every host-carried intent goes through the page's own command gate, so
    // it can never bypass the reason the page shows beside the visible action.
    const editorCommandsRef = React.useRef<WorkflowEditorCommands | null>(null);
    const runNowAnchorRef = React.useRef<View | null>(null);
    // The contextual default comes from the canonical New Session resolver, and
    // only when it produces a genuinely valid choice (UX §2.3). A reviewed copy
    // keeps its predecessor's accepted target instead.
    const recentMachinePaths = useAuthoringMemoryField('recentMachinePaths') as
        | ReadonlyArray<Readonly<{ machineId?: string | null; path?: string | null }>>
        | undefined;
    const newSessionProject = newSessionSeed?.project && isWorkflowProjectTarget(newSessionSeed.project) ? newSessionSeed.project : null;
    const [projectTarget, setProjectTarget] = React.useState<WorkflowProjectTargetV1 | null>(
        reviewedRunSeed?.project ?? newSessionProject,
    );
    const seededContextualTargetRef = React.useRef(reviewedRunSeed?.project !== undefined || newSessionProject !== null);
    /** Whether this logical source has already been offered the contextual Agent. */
    const seededContextualAgentRef = React.useRef(false);
    React.useEffect(() => {
        if (seededContextualTargetRef.current) return;
        const contextual = resolveContextualWorkflowProjectTarget({
            machines,
            recentMachinePaths: recentMachinePaths ?? [],
        });
        // Nothing valid yet is not a reason to fabricate one; the control stays
        // visibly unresolved and Run now states that as its blocking reason.
        if (contextual === null) return;
        seededContextualTargetRef.current = true;
        setProjectTarget((current) => current ?? contextual);
    }, [machines, recentMachinePaths]);
    // Run as is one page-level, Run-scoped choice. A reviewed copy keeps the
    // runtime its predecessor actually accepted rather than silently reverting
    // to the protocol default. Which runtimes are offered is projected from the
    // canonical Execution Run capability owner for the exact selected machine,
    // never from a standing policy constant.
    const detachedRunSupport = useWorkflowDetachedRunSupport(
        projectTarget?.machineId ?? null,
        activeAccountScope?.serverId ?? null,
    );
    const runAsTargets = React.useMemo(
        () => resolveWorkflowRunAsTargets({ detachedExecutionRun: detachedRunSupport }),
        [detachedRunSupport],
    );
    const [executionTarget, setExecutionTarget] = React.useState<WorkflowRunAsTargetKind>(
        reviewedRunSeed?.executionTarget.kind ?? 'session',
    );

    // One Run UUID per explicit admission attempt. A response-loss retry reuses
    // it; a deliberate "Run again" allocates a new one at its own call site.
    const pendingRunIdRef = React.useRef<string | null>(null);
    /** The draft exactly as loaded at `saved.revision`, for edited-since-save detection. */
    const savedDraftRef = React.useRef<WorkflowEditorDraft | null>(null);
    /** Bumped whenever a different logical source takes over this editor. */
    const sourceGenerationRef = React.useRef(0);
    /** Whether this source already consumed its one-shot "open in import" request. */
    const importRequestedRef = React.useRef(false);
    /** Which saved-row entry intent this source already pressed. */
    const consumedEntryIntentKeyRef = React.useRef<string | null>(null);

    const sourceKind = props.source.kind;
    const sourceDefinitionId = props.source.kind === 'saved' ? props.source.definitionId : null;

    /**
     * One logical source initializes exactly once.
     *
     * Route hosts rebuild `source` on every render, so an effect keyed on it
     * re-created the draft continuously: every keystroke was followed by a fresh
     * draft id, which discarded the prompt text and caret and made an untouched
     * editor read as dirty against a baseline it no longer matched. The key
     * below is semantic, and re-initialization happens during render so the
     * next paint already shows the new source — Account-private Artifact content
     * is retired before another Account's same opaque id can resolve.
     */
    const privateSeedWithdrawn = carriesPrivateSeed && reviewedRunSeedState.id === reviewedRunSeedId
        && (reviewedRunSeedState.retired || (reviewedRunSeedState.lifetime !== null && !reviewedRunSeedState.lifetime.isCurrent()));
    const initializationKey = `${workflowEditorSourceKey(props.source)}\u0000${accountScopeKey ?? ''}\u0000${privateSeedWithdrawn ? 'withdrawn' : ''}`;
    const [initializedKey, setInitializedKey] = React.useState(initializationKey);
    if (initializedKey !== initializationKey) {
        // A withdrawn private seed has no bytes to re-adopt; it must not fall
        // back to an empty draft that looks like the reviewed copy opened fine.
        const withdrawn = privateSeedWithdrawn;
        const nextReviewedRunSeedState = reviewedRunSeedId === null
            ? readReviewedRunSeedState(null)
            : reviewedRunSeedState.id === reviewedRunSeedId
                ? withdrawn ? { ...reviewedRunSeedState, seed: null, retired: true } : reviewedRunSeedState
                : readReviewedRunSeedState(reviewedRunSeedId);
        const nextReviewedRunSeed = nextReviewedRunSeedState.seed;
        const next = sourceKind === 'saved' || withdrawn
            ? null
            : createDraftForSource(nextReviewedRunSeed);
        // Everything source-local is reset in this one place, and the generation
        // it stamps is what a slower publication is checked against. Collected
        // Run inputs, an open input sheet, a pending Run id, a save in flight or
        // the page-level Run as choice left behind are how a source-A save or
        // import used to land in source B's editor.
        sourceGenerationRef.current += 1;
        setInitializedKey(initializationKey);
        setReviewedRunSeedState(nextReviewedRunSeedState);
        setDraft(next);
        initialDraftBaselineRef.current = next;
        savedDraftRef.current = null;
        setSaved(null);
        setSaveConflict(null);
        setSavedAtMs(null);
        setSaveFailure(undefined);
        setDescription(withdrawn ? '' : nextReviewedRunSeed?.description ?? '');
        savedDescriptionRef.current = withdrawn ? '' : nextReviewedRunSeed?.description ?? '';
        setSavePending(false);
        setHydrationFailed(false);
        setSelection(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
        setView('steps');
        setInputValues(withdrawn ? {} : nextReviewedRunSeed?.inputs ?? {});
        setInputRawTextValues({});
        setInputSheetOpen(false);
        setExecutionTarget(nextReviewedRunSeed?.executionTarget.kind ?? 'session');
        pendingRunIdRef.current = null;
        importRequestedRef.current = false;
        consumedEntryIntentKeyRef.current = null;
        setContentScopeKey(sourceKind === 'saved' ? null : accountScopeKey);
        // A different logical source is a different pristine draft, so the
        // contextual Agent is offered to it again rather than being consumed
        // for the whole mount.
        seededContextualAgentRef.current = false;
        const nextProjectTarget = withdrawn ? null : nextReviewedRunSeed?.project ?? null;
        setProjectTarget(nextProjectTarget);
        seededContextualTargetRef.current = nextProjectTarget !== null;
    }

    /**
     * Whether the source this work started under is still the one on screen.
     *
     * The Account lifetime answers "is this still the same Account"; it cannot
     * answer "is this still the same workflow", which is the question a save, an
     * import or a Run admission that outlives a navigation actually needs.
     */
    const captureSourceGeneration = React.useCallback(() => {
        const generation = sourceGenerationRef.current;
        return () => mountedRef.current && sourceGenerationRef.current === generation;
    }, [mountedRef]);

    React.useEffect(() => {
        if (sourceKind !== 'saved' || sourceDefinitionId === null) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        let cancelled = false;
        void (async () => {
            try {
                const result = await getWorkflowDefinition({ definitionId: sourceDefinitionId });
                if (cancelled || !lifetime.isCurrent()) return;
                const hydrated = buildWorkflowEditorDraftFromDefinition({
                    draftId: randomUUID(),
                    name: result.metadata.title,
                    definition: result.definition,
                });
                savedDescriptionRef.current = result.metadata.description ?? '';
                setDescription(result.metadata.description ?? '');
                savedDraftRef.current = hydrated;
                initialDraftBaselineRef.current = hydrated;
                setDraft(hydrated);
                setSaved({ definitionId: result.definitionId, revision: result.revision });
                setContentScopeKey(requestScopeKey);
            } catch {
                if (cancelled || !lifetime.isCurrent()) return;
                setHydrationFailed(true);
            }
        })();
        return () => { cancelled = true; };
    }, [accountScopeKey, hydrationAttempt, sourceDefinitionId, sourceKind]);

    const retryHydration = React.useCallback(() => {
        setHydrationFailed(false);
        setHydrationAttempt((attempt) => attempt + 1);
    }, []);

    const machineName = React.useMemo(() => {
        const machineId = projectTarget?.machineId ?? null;
        if (machineId === null) return null;
        const machine = machines.find((candidate) => candidate.id === machineId);
        return machine === undefined ? machineId : getMachineDisplayName(machine);
    }, [machines, projectTarget?.machineId]);
    // Trigger edits are part of the draft (04 §5.4): written after the definition on Save.
    const triggers = useWorkflowTriggerEditing({ definitionId: saved?.definitionId ?? null, projectTarget });
    const triggerSetMachineId = triggers.set?.project?.machineId ?? null;
    const triggersRunOn = React.useMemo(() => {
        const project = triggers.set?.project;
        if (!project) return null;
        const machine = machines.find((candidate) => candidate.id === triggerSetMachineId) ?? null;
        return formatWorkflowWhereSummary({
            target: project,
            machineName: getMachineDisplayName(machine) ?? t('machine.unnamedMachine'),
        });
    }, [machines, triggerSetMachineId, triggers.set?.project]);

    // The controlled editor resolves no catalog of its own, so the Agent options
    // and every step prompt's reference scope come from this one host adapter —
    // the same one the Automation wrappers consume.
    const authoringHost = useWorkflowAuthoringHost({
        projectTarget,
        serverId: activeAccountScope?.serverId ?? null,
    });

    /**
     * A pristine neutral draft adopts the contextual Agent, once.
     *
     * UX §2.3/J1: a new workflow starts from the same Agent New Session would
     * start from — but only when that resolver produces a genuinely available
     * choice for this exact Machine, which is why this waits for the host
     * adapter's projected default instead of picking the bundled fallback.
     *
     * "Pristine" is the strict reading: only a neutral `new` source with no
     * reviewed copy, and only while the draft is still byte-identical to the
     * one this editor started from. A captured Session, a hydrated Artifact, a
     * reviewed Run copy, an imported document and anything the person has
     * already touched all name their own Agent, and none of them is re-seeded.
     * Because this is initialization rather than an edit, the pristine baseline
     * moves with it and the editor does not report itself dirty.
     */
    const contextualAgentTarget = authoringHost.authoringFacts.contextualDefaultAgentTarget ?? null;
    React.useEffect(() => {
        if (seededContextualAgentRef.current) return;
        if (sourceKind !== 'new' || reviewedRunSeed !== null) return;
        if (contextualAgentTarget === null || draft === null) return;
        if (draft !== initialDraftBaselineRef.current) return;
        if (draft.defaults.agentTarget) return;
        seededContextualAgentRef.current = true;
        const seeded = setWorkflowDefaultField(draft, 'agentTarget', contextualAgentTarget);
        initialDraftBaselineRef.current = seeded;
        setDraft(seeded);
    }, [contextualAgentTarget, draft, reviewedRunSeed, sourceKind]);

    const startRun = React.useCallback(async (
        inputs: Readonly<Record<string, JsonValue>> | undefined,
        roleOverrides?: WorkflowRunComposerModalProps['roleOverrides'],
    ): Promise<void> => {
        if (draft === null || projectTarget === null || projectTarget.directory.trim().length === 0) return;
        const validation = validateWorkflowEditorDraft(draft);
        if (!validation.valid || validation.normalizedDefinition === undefined) return;
        // An unavailable runtime is refused rather than downgraded: quietly
        // running effectful work under different execution semantics is exactly
        // what the page-level choice exists to prevent.
        const admittedTarget = resolveAdmittedWorkflowExecutionTarget({
            selected: executionTarget,
            targets: runAsTargets,
        });
        if (admittedTarget === null) return;
        const runId = pendingRunIdRef.current ?? randomUUID();
        pendingRunIdRef.current = runId;
        const sourceIsCurrent = captureSourceGeneration();
        // One prompt is a workflow and Run now needs no name (UX §2.2 J1). The
        // admitted title is `min(1)` at its Protocol owner, so an unnamed draft
        // admits with no metadata rather than an empty title the schema refuses.
        const title = draft.name.trim();
        const admitted = await runNow.runNow({
            runId,
            ...(title.length === 0 ? {} : { metadata: { title } }),
            executionTarget: admittedTarget,
            source: {
                kind: 'inline',
                // The canonical definition is deeply readonly; the ingress request
                // type is mutable, so hand it a shallow mutable copy instead of
                // casting the contract away. The Action re-parses it regardless.
                definition: {
                    ...validation.normalizedDefinition,
                    inputs: [...validation.normalizedDefinition.inputs],
                    blocks: [...validation.normalizedDefinition.blocks],
                },
            },
            ...(inputs === undefined ? {} : { inputs }),
            ...(roleOverrides === undefined ? {} : { roleOverrides: [...roleOverrides] }),
            project: projectTarget,
        });
        // `null` means nothing was admitted by this call, so the caller-allocated
        // id stays pending and a retry reuses it rather than starting a second Run.
        if (admitted === null) return;
        // The Run really was admitted, so it is never discarded; but if this
        // editor has since moved to another workflow, taking over that page with
        // the previous source's navigation is not this call's decision.
        if (!sourceIsCurrent()) return;
        pendingRunIdRef.current = null;
        setInputSheetOpen(false);
        router.push({ pathname: '/workflows/runs/[runId]', params: { runId: admitted.run.id } } as never);
    }, [captureSourceGeneration, draft, executionTarget, projectTarget, router, runAsTargets, runNow]);

    const handleRunNow = React.useCallback(() => {
        if (draft === null) return;
        // Every Run is reviewed in the composer, including a no-input recipe.
        setInputSheetOpen(true);
    }, [draft]);

    const dismissInputSheet = React.useCallback(() => {
        setInputSheetOpen(false);
    }, []);

    const inputModalProps = React.useMemo<WorkflowRunComposerModalProps | null>(() => draft === null ? null : ({
        definition: validateWorkflowEditorDraft(draft).normalizedDefinition,
        sourceArtifactId: saved?.definitionId ?? null,
        inputs: draft.inputs,
        values: inputValues,
        onChangeValues: setInputValues,
        rawTextValues: inputRawTextValues,
        onChangeRawTextValues: setInputRawTextValues,
        workflowName: draft.name,
        preview: description || draft.blocks.map(workflowBlockReferenceLabel).join('\n'),
        includesUnsavedEdits: !pluginJsonValuesEqual(draft, savedDraftRef.current ?? initialDraftBaselineRef.current)
            || description !== savedDescriptionRef.current,
        machineId: projectTarget?.machineId ?? null,
        serverId: activeAccountScope?.serverId ?? null,
        extraActionChips: [{
            ...createExecutionRunStartContentChip({
                key: 'workflow-start-where', icon: 'folder', title: t('workflows.page.where.label'),
                label: formatWorkflowWhereSummary({ target: projectTarget, machineName }) ?? t('workflows.page.where.choose'),
                testID: 'workflow-start-where-chip',
                renderContent: <WorkflowProjectTargetControl target={projectTarget} machineName={machineName}
                    machines={machines} onChange={(target) => { if (isWorkflowProjectTarget(target)) setProjectTarget(target); }}
                    testIDPrefix="workflow-start-where" />,
            }), controlId: 'machine',
        }],
        onRun: (inputs, roleOverrides) => { void startRun(inputs, roleOverrides); },
        onCancel: dismissInputSheet,
        pending: runNow.stateFor(pendingRunIdRef.current ?? '') === 'submitting',
    }), [activeAccountScope?.serverId, description, dismissInputSheet, draft, inputRawTextValues, inputValues, machineName, machines, projectTarget, runNow, saved?.definitionId, startRun]);

    const runComposer = useWorkflowRunComposerModal({ open: inputSheetOpen, props: inputModalProps, anchorRef: runNowAnchorRef });

    const handleSave = React.useCallback(() => {
        if (draft === null || savePending) return;
        const validation = validateWorkflowEditorDraft(draft);
        if (!validation.valid || validation.normalizedDefinition === undefined) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        // Same Account is not the same workflow: a save that resolves after this
        // editor moved to another source must not stamp that source's revision.
        const sourceIsCurrent = captureSourceGeneration();
        const isCurrent = () => lifetime.isCurrent() && sourceIsCurrent();
        setSavePending(true);
        setSaveFailure(undefined);
        void (async () => {
            try {
                const savedDescription = description.trim();
                const metadata = {
                    title: draft.name.trim(),
                    ...(savedDescription.length === 0 ? {} : { description: savedDescription }),
                };
                const result = saved === null
                    ? await createWorkflowDefinition({
                        definitionId: randomUUID(),
                        definition: validation.normalizedDefinition,
                        metadata,
                    })
                    : await updateWorkflowDefinition({
                        definitionId: saved.definitionId,
                        expectedRevision: saved.revision,
                        definition: validation.normalizedDefinition,
                        metadata,
                    });
                if (!isCurrent()) return;
                savedDraftRef.current = draft;
                savedDescriptionRef.current = description;
                setSaved({ definitionId: result.definitionId, revision: result.revision });
                setSavedAtMs(Date.now());
                setSaveConflict(null);
                // Then the trigger delta; a failure here reads "Workflow saved · Triggers not
                // updated" and keeps the pending trigger edits for Try again (07 S4).
                const triggerOutcome = await triggers.save(result.definitionId, isCurrent);
                if (triggerOutcome === 'failed') setSaveFailure(t('workflows.triggers.editor.partialSave'));
                // Save as workflow: point the originating trigger at this workflow (04 §5.4). Until
                // that write lands the trigger keeps its own steps and the status says so.
                const retarget = pendingRetargetRef.current;
                if (retarget !== null && isCurrent()) {
                    try {
                        await retargetTriggerToWorkflow(retarget, result.definitionId);
                        if (!isCurrent()) return;
                        pendingRetargetRef.current = null;
                        setRetargetFailed(false);
                    } catch {
                        if (!isCurrent()) return;
                        setRetargetFailed(true);
                        setSaveFailure(t('workflows.triggers.editor.retargetFailed'));
                    }
                }
            } catch (error) {
                if (!isCurrent()) return;
                // A concurrent save keeps the local document and says so; it is
                // never resolved by last-writer-wins or a silent merge.
                if (isWorkflowDefinitionConflictError(error) && saved !== null) {
                    try {
                        const current = await getWorkflowDefinition({ definitionId: saved.definitionId });
                        if (!isCurrent()) return;
                        setSaveConflict({
                            currentDraft: buildWorkflowEditorDraftFromDefinition({
                                draftId: randomUUID(),
                                name: current.metadata.title,
                                definition: current.definition,
                            }),
                            currentRevision: current.revision,
                        });
                    } catch {
                        if (isCurrent()) setSaveConflict({ currentDraft: null, currentRevision: null });
                    }
                    return;
                }
                // The closed code says which save failed and why — no access, a
                // definition that needs repair, private content this device
                // cannot open. It stays in the save status (no alert, no toast),
                // with the edits kept and Try again beside it.
                setSaveFailure(`${formatWorkflowProblemMessage(error)} ${t('workflows.save.failedBody')}`);
            } finally {
                if (isCurrent()) setSavePending(false);
            }
        })();
    }, [captureSourceGeneration, description, draft, saved, savePending, triggers]);

    const handleSaveAsCopy = React.useCallback(() => {
        if (draft === null || savePending) return;
        const validation = validateWorkflowEditorDraft(draft);
        if (!validation.valid || validation.normalizedDefinition === undefined) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const sourceIsCurrent = captureSourceGeneration();
        const isCurrent = () => lifetime.isCurrent() && sourceIsCurrent();
        setSavePending(true);
        void (async () => {
            try {
                const result = await createWorkflowDefinition({
                    definitionId: randomUUID(),
                    definition: validation.normalizedDefinition,
                    metadata: {
                        title: draft.name.trim(),
                        ...(description.trim().length === 0 ? {} : { description: description.trim() }),
                    },
                });
                if (!isCurrent()) return;
                savedDraftRef.current = draft;
                savedDescriptionRef.current = description;
                setSaved({ definitionId: result.definitionId, revision: result.revision });
                setSavedAtMs(Date.now());
                setSaveConflict(null);
            } catch (error) {
                if (isCurrent()) {
                    await Modal.alert(
                        t('workflows.save.failedTitle'),
                        `${formatWorkflowProblemMessage(error)} ${t('workflows.save.failedBody')}`,
                    );
                }
            } finally {
                if (isCurrent()) setSavePending(false);
            }
        })();
    }, [captureSourceGeneration, description, draft, savePending]);


    /**
     * A saved-row Run now or Schedule presses this page's own action.
     *
     * The intent is consumed exactly once, after the exact Artifact revision is
     * hydrated under the current Account, and it calls the same handler as the
     * visible button — so Run now still freezes the reviewed draft through the
     * run-admission owner (collecting declared inputs first) and Schedule
     * reveals Runs automatically, where triggers are added. It never replaces the
     * hydrated draft, and when the action cannot proceed the person lands on the
     * reviewed definition with that action's blocking reason already visible.
     */
    const savedEntryIntent = props.source.kind === 'saved' ? props.source.intent : undefined;
    const savedEntryIntentKey = props.source.kind === 'saved' && savedEntryIntent !== undefined
        ? `${props.source.definitionId}\u0000${savedEntryIntent}`
        : null;
    React.useEffect(() => {
        if (
            savedEntryIntent === undefined
            || savedEntryIntentKey === null
            || consumedEntryIntentKeyRef.current === savedEntryIntentKey
        ) return;
        if (draft === null || saved === null || contentScopeKey !== accountScopeKey) return;
        const commands = editorCommandsRef.current;
        if (commands === null) return;
        consumedEntryIntentKeyRef.current = savedEntryIntentKey;
        if (savedEntryIntent === 'run') commands.runNow();
        else commands.schedule();
    }, [
        accountScopeKey,
        contentScopeKey,
        draft,
        saved,
        savedEntryIntent,
        savedEntryIntentKey,
    ]);

    /**
     * A neutral new workflow starts with its first prompt focused (UX §2.2
     * J1). The intent belongs to this source: it is consumed once through the
     * page's one focus owner, which waits for that prompt to mount, and it is
     * never replayed by a rerender, a hydrated saved definition, an imported or
     * reviewed document, or an Account change.
     */
    const initialPromptFocusConsumedRef = React.useRef(false);
    React.useEffect(() => {
        if (initialPromptFocusConsumedRef.current) return;
        if (props.source.kind !== 'new' || reviewedRunSeed !== null || props.source.requestImport === true) return;
        if (draft === null) return;
        const first = draft.blocks[0];
        if (first?.kind !== 'step') return;
        const commands = editorCommandsRef.current;
        if (commands === null) return;
        initialPromptFocusConsumedRef.current = true;
        commands.focusPrompt(first.id);
    }, [draft, props.source, reviewedRunSeed]);

    const handleImportJson = React.useCallback(() => {
        if (draft === null) return;
        // Picking a document is a platform round trip the person can leave. The
        // imported document replaces the draft it was opened against, never
        // whichever workflow happens to be on screen when the picker returns.
        const sourceIsCurrent = captureSourceGeneration();
        void (async () => {
            let importedSource: string | null;
            try {
                importedSource = await pickWorkflowDocumentText();
            } catch {
                if (!sourceIsCurrent()) return;
                await Modal.alert(
                    t('workflows.interchange.importFailedTitle'),
                    t('workflows.interchange.importFailedInvalidDocument'),
                );
                return;
            }
            if (importedSource === null || !sourceIsCurrent()) return;
            const imported = importWorkflowDocument({ source: importedSource, currentDraft: draft, draftId: randomUUID() });
            if (!imported.ok) {
                if (imported.messageKey !== null || imported.issues.length === 0) {
                    await Modal.alert(
                        t('workflows.interchange.importFailedTitle'),
                        t(imported.messageKey ?? 'workflows.interchange.importFailedInvalidDocument'),
                    );
                    return;
                }
                Modal.show({
                    component: WorkflowImportReview,
                    props: {
                        issues: imported.issues,
                        ...(imported.repairDraft === undefined ? {} : { repairDraft: imported.repairDraft }),
                        onOpenRepair: (repairDraft) => {
                            if (!sourceIsCurrent()) return;
                            savedDraftRef.current = null;
                            setSaved(null);
                            setSelection(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
                            setDraft(repairDraft);
                        },
                    },
                    closeOnBackdrop: true,
                    chrome: {
                        kind: 'card',
                        title: t('workflows.interchange.importIssuesTitle'),
                        testID: 'workflow-import-review-modal',
                        bodyScroll: 'auto',
                        dimensions: { width: 620, maxHeightRatio: 0.92, size: 'md' },
                    },
                });
                return;
            }
            savedDraftRef.current = null;
            setSaved(null);
            setSelection(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
            setDraft(imported.draft);
        })();
    }, [captureSourceGeneration, draft]);

    const handleExportJson = React.useCallback(() => {
        if (draft === null) return;
        const exported = exportWorkflowDocument({ draft });
        if (!exported.ok) return;
        void (async () => {
            await confirmWorkflowDocumentExport({ name: draft.name, json: exported.json });
        })();
    }, [draft]);

    // Action-step field options are read for the Where Machine only while an
    // Action step exists, so an editor without one issues no capabilities read.
    const draftHasActionBlocks = React.useMemo(
        () => draft !== null && walkWorkflowBlocks(draft.blocks).some((block) => block.kind === 'action'),
        [draft],
    );
    const resolveActionFieldOptions = useActionFieldOptionsForMachine({
        machineId: projectTarget?.machineId ?? null,
        serverId: activeAccountScope?.serverId ?? null,
        enabled: draftHasActionBlocks,
    });

    const routeDraftDirty = draft !== null && (!pluginJsonValuesEqual(
        draft,
        savedDraftRef.current ?? initialDraftBaselineRef.current,
    ) || description !== savedDescriptionRef.current || triggers.dirty || retargetFailed);
    /**
     * The one save status (B1): the host's save owner is the only thing that
     * knows whether this draft is kept. A pristine new draft is "Not saved yet";
     * any change is "Unsaved changes" with Save; the receipt reflects the
     * accepted snapshot, so an edit made while saving is not marked saved.
     */
    const saveStatus = React.useMemo((): WorkflowSaveStatusState => {
        if (savePending) return { kind: 'saving' };
        if (saveFailure !== undefined && routeDraftDirty) return { kind: 'failed', reason: saveFailure };
        if (routeDraftDirty) return { kind: 'unsaved' };
        if (saved === null) return { kind: 'notSaved' };
        return { kind: 'saved', savedAtMs };
    }, [routeDraftDirty, saveFailure, savePending, saved, savedAtMs]);

    const handleDelete = React.useCallback(async () => {
        if (saved === null) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const sourceIsCurrent = captureSourceGeneration();
        const confirmed = await Modal.confirm(
            t('workflows.save.deleteTitle'),
            t('workflows.page.deleteBody'),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed || !lifetime.isCurrent() || !sourceIsCurrent()) return;
        try {
            // The delete Action owns the order (this workflow's triggers first, 03 §5.5).
            await deleteWorkflowDefinition({ definitionId: saved.definitionId });
            if (!lifetime.isCurrent() || !sourceIsCurrent()) return;
            // Nothing is left to keep: leave without the unsaved-draft prompt.
            savedDraftRef.current = null;
            initialDraftBaselineRef.current = null;
            setDraft(null);
            router.replace('/workflows' as never);
        } catch (error) {
            if (lifetime.isCurrent()) {
                await Modal.alert(t('workflows.page.deleteFailedTitle'), formatWorkflowProblemMessage(error));
            }
        }
    }, [captureSourceGeneration, router, saved]);

    const shareName = draft?.name.trim() ?? '';
    const menuActions = React.useMemo((): readonly PageHeaderMenuAction[] => {
        const actions: PageHeaderMenuAction[] = [];
        // A saved workflow is an Artifact; Share opens the one document share sheet (07 S7/S8, INT I2).
        if (saved !== null) {
            actions.push({
                id: 'share',
                title: t('workflows.destination.rowMenu.share'),
                testID: 'workflow-editor-menu-share',
                onSelect: () => showDocumentShareSheet({
                    kind: 'workflow-definition.v1',
                    artifactId: saved.definitionId,
                    name: shareName || t('workflows.page.untitled'),
                    linkPath: createWorkflowDefinitionRoute(saved.definitionId),
                    // "Send a copy instead" is the existing JSON export (INT I2).
                    onSendCopy: () => editorCommandsRef.current?.exportJson(),
                }),
            });
        }
        actions.push({
            id: 'export',
            title: t('workflows.exportJson'),
            testID: 'workflow-editor-menu-export',
            onSelect: () => editorCommandsRef.current?.exportJson(),
        });
        if (saved !== null) {
            actions.push({
                id: 'delete',
                title: t('workflows.page.deleteWorkflow'),
                testID: 'workflow-editor-menu-delete',
                destructive: true,
                onSelect: () => handleDelete(),
            });
        }
        return actions;
    }, [handleDelete, saved, shareName]);
    const requestPageSave = React.useCallback(async (): Promise<boolean> => {
        // The page gate decides; a Save it refuses states its reason instead
        // of leaving with an unsaved draft and no explanation.
        editorCommandsRef.current?.save();
        return false;
    }, []);
    const leaveEditor = React.useCallback(() => { router.back(); }, [router]);
    // One departure contract for native Back, the shell and browser unload.
    useUnsavedDraftNavigationGuard({
        navigation,
        isDirty: routeDraftDirty,
        onSave: requestPageSave,
        onLeave: leaveEditor,
        tag: 'WorkflowEditorHostScreen.beforeRemove',
    });

    React.useEffect(() => {
        if (props.source.kind !== 'new' || props.source.requestImport !== true || importRequestedRef.current) return;
        importRequestedRef.current = true;
        handleImportJson();
    }, [handleImportJson, props.source]);

    // The private seed this editor opened belongs to another Account now. There
    // is no id to re-open it under this one and no honest way to keep showing
    // it, so the editor states that rather than presenting the previous
    // Account's prompts with this Account's Save.
    if (privateSeedWithdrawn) {
        return (
            <SurfaceStateCard
                testID="workflow-editor-account-changed"
                kind="unavailable"
                title={t('workflows.editor.accountChangedTitle')}
                reason={t('workflows.editor.accountChangedBody')}
                accessibilitySemantics="status"
            />
        );
    }
    // Failing to read the Artifact is not proof it was deleted, so this offers
    // the read again instead of announcing a removal the owner never reported.
    if (hydrationFailed) {
        return (
            <SurfaceStateCard
                testID="workflow-editor-error"
                kind="error"
                title={t('workflows.editor.loadFailedTitle')}
                reason={t('workflows.editor.loadFailedBody')}
                action={{ label: t('common.retry'), onPress: retryHydration }}
                accessibilitySemantics="alert"
            />
        );
    }
    // A reviewed copy is single-use. Returning here through history must say the
    // copy is gone rather than silently presenting an empty draft as if it were
    // the Run the person asked to review.
    if (props.source.kind === 'new'
        && props.source.reviewedRunSeedId !== undefined
        && reviewedRunSeed === null) {
        return <WorkflowMissingDefinitionState testID="workflow-editor-reviewed-run-missing" />;
    }
    if (draft === null || contentScopeKey !== accountScopeKey) {
        // Account-private content cannot be held over as last-known-good across
        // an Account change, so this states that the workflow is opening rather
        // than showing a blank page with no explanation.
        return (
            <SurfaceStateCard
                testID="workflow-editor-loading"
                kind="loading"
                title={t('workflows.editor.loadingTitle')}
                accessibilitySemantics="status"
            />
        );
    }

    return (
        <View style={styles.root}>
            {/* The editor body owns this page's one scroll, because it also owns
                the pinned command surface that must stay on screen while the
                authored document scrolls beneath it. */}
            <WorkflowEditorBody
                draft={draft}
                {...(reviewedRunSeed === null ? {} : {
                    reviewNotice: (
                        <ItemGroup>
                            <Item
                                testID="workflow-editor-reviewed-copy-notice"
                                title={t('workflows.page.reviewedCopyTitle')}
                                subtitle={t('workflows.page.reviewedCopyBody')}
                                subtitleLines={0}
                                showChevron={false}
                            />
                        </ItemGroup>
                    ),
                    onBackToRun: () => {
                        if (!reviewedRunSeedState.lifetime?.isCurrent()) return;
                        router.push({ pathname: '/workflows/runs/[runId]', params: { runId: reviewedRunSeed.sourceRunId } } as never);
                    },
                })}
                authoringFacts={authoringHost.authoringFacts}
                existingSessions={authoringHost.existingSessions}
                sessionDropCandidates={authoringHost.sessionDropCandidates}
                composerScope={authoringHost.composerScope}
                commandsRef={editorCommandsRef}
                onChange={setDraft}
                {...(newSessionSeed?.composer === undefined ? {} : { composerSeeds: [newSessionSeed.composer] })}
                machineName={machineName}
                projectTarget={projectTarget}
                projectMachines={machines}
                onChangeProjectTarget={(target) => { if (isWorkflowProjectTarget(target)) setProjectTarget(target); }}
                selectedBlockId={selection.selectedBlockId}
                onSelectBlock={(blockId) => setSelection((current) => selectWorkflowBlock(current, blockId))}
                onCustomizeBlock={(blockId) => setSelection((current) => selectWorkflowBlock(current, blockId))}
                inspectorGroupDisclosure={selection.inspectorGroupDisclosure}
                onChangeInspectorGroup={(groupId, expanded) => setSelection((current) => (
                    setWorkflowInspectorGroupExpanded(current, groupId, expanded)
                ))}
                view={view}
                onChangeView={setView}
                executionTarget={executionTarget}
                runAsTargets={runAsTargets}
                onChangeExecutionTarget={setExecutionTarget}
                onRunNow={handleRunNow}
                runNowAnchorRef={runNowAnchorRef}
                runPending={runNow.stateFor(pendingRunIdRef.current ?? '') === 'submitting'}
                onSave={handleSave}
                triggersSummary={triggers.summary}
                triggersSection={(
                    <WorkflowTriggerSection
                        testIDPrefix="workflow-editor"
                        set={triggers.set}
                        draft={triggers.draft}
                        onChangeDraft={triggers.setDraft}
                        runsOn={triggersRunOn}
                        whereTarget={projectTarget}
                        whereSummary={formatWorkflowWhereSummary({ target: projectTarget, machineName })}
                        inputs={draft?.inputs ?? []}
                        stepsUnsaved={draft !== null && !pluginJsonValuesEqual(draft, savedDraftRef.current ?? initialDraftBaselineRef.current)}
                    />
                )}
                savePending={savePending}
                saveStatus={saveStatus}
                resolveActionFieldOptions={resolveActionFieldOptions}
                currentWorkflowRef={saved?.definitionId ?? null}
                description={description}
                onChangeDescription={setDescription}
                saveConflict={saveConflict}
                menuActions={menuActions}
                onSaveAsCopy={handleSaveAsCopy}
                onImportJson={handleImportJson}
                onExportJson={handleExportJson}
            />
            {runComposer}
        </View>
    );
}

/** Re-exported so a host can clear an override without importing the draft owner. */
export { setWorkflowStepExecutionField };
