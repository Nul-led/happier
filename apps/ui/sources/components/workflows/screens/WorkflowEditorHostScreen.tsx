import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native-unistyles';

import { Modal } from '@/modal';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { useActiveServerAccountScope, useAllMachines, useSetting } from '@/sync/domains/state/storage';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { useMountedRef } from '@/hooks/ui/useMountedRef';

import { pluginJsonValuesEqual, type JsonValue } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import type { WorkflowArtifactRevisionV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';

import {
    createWorkflowDefinition,
    getWorkflowDefinition,
    isWorkflowDefinitionConflictError,
    updateWorkflowDefinition,
} from '@/sync/domains/workflows/workflowDefinitionActions';
import {
    buildWorkflowEditorDraftFromDefinition,
    validateWorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowAuthoring';
import {
    buildWorkflowScheduleSeed,
    storeWorkflowScheduleSeed,
} from '@/sync/domains/workflows/workflowScheduleSeed';
import {
    createWorkflowEditorDraft,
    selectWorkflowBlock,
    setWorkflowDefaultField,
    setWorkflowStepExecutionField,
    EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    type WorkflowEditorDraft,
    type WorkflowEditorViewState,
} from '@/sync/domains/workflows/workflowEditorDraft';
import { useWorkflowRunNowController } from '../run/useWorkflowRunNowController';
import {
    resolveAdmittedWorkflowExecutionTarget,
    resolveWorkflowRunAsTargets,
    type WorkflowRunAsTargetKind,
} from '../run/workflowRunAsTargets';
import { useWorkflowDetachedRunSupport } from '../run/useWorkflowDetachedRunSupport';
import { resolveContextualWorkflowProjectTarget } from './resolveContextualWorkflowTarget';
import { readWorkflowReviewedRunSeed } from '@/sync/domains/workflows/workflowReviewedRunSeed';
import {
    useWorkflowRunInputModal,
    type WorkflowRunInputModalProps,
} from '../run/useWorkflowRunInputModal';
import { WorkflowEditorBody, type WorkflowEditorCommands, type WorkflowEditorView } from './WorkflowEditorBody';
import { useWorkflowAuthoringHost } from './useWorkflowAuthoringHost';
import type { WorkflowSaveConflict } from '../editor/WorkflowSaveStatus';
import { WorkflowMissingDefinitionState } from './WorkflowMissingDefinitionState';
import { formatWorkflowProblemMessage } from '@/components/workflows/presentation/workflowProblemPresentation';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
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
 * It owns draft identity, hydration, Account currentness and the three explicit
 * effects — Run now, Save workflow and Schedule. Save writes only the Account
 * Artifact; Run now freezes the displayed draft through run admission without
 * saving it; Schedule hands a reviewed copy to the Automation wrapper. None of
 * them is a mode of another.
 */

/**
 * What a saved-row entry asked for besides opening the definition.
 *
 * Edit, Run now and Schedule are three intents over one editor, not one route:
 * a saved definition carries no reviewed Machine or page-level **Run as**
 * choice, so the collection cannot admit a Run or freeze a schedule by itself.
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
    }>
    | Readonly<{
        kind: 'capturedSession';
        sessionId: string;
        serverId?: string | null;
        draft: WorkflowEditorDraft;
        project: WorkflowProjectTargetV1;
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
                source.requestImport === true ? 'import' : 'author',
            ].join('\u0000');
        case 'saved':
            return `saved\u0000${source.definitionId}`;
        case 'capturedSession':
            return [
                'capturedSession',
                source.sessionId,
                source.serverId ?? '',
                source.draft.draftId,
            ].join('\u0000');
    }
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
    const [reviewedRunSeedState, setReviewedRunSeedState] = React.useState(() => ({
        id: reviewedRunSeedId,
        seed: reviewedRunSeedId === null ? null : readWorkflowReviewedRunSeed(reviewedRunSeedId),
    }));
    const reviewedRunSeed = reviewedRunSeedState.id === reviewedRunSeedId
        ? reviewedRunSeedState.seed
        : null;

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
    const [seedScopeKey, setSeedScopeKey] = React.useState(accountScopeKey);
    const carriesPrivateSeed = props.source.kind === 'capturedSession'
        || (props.source.kind === 'new' && props.source.reviewedRunSeedId !== undefined);
    const createDraftForSource = (
        source: WorkflowEditorSource,
        seed: typeof reviewedRunSeed,
    ): WorkflowEditorDraft => (
        source.kind === 'capturedSession'
            ? source.draft
            : seed === null
                ? createWorkflowEditorDraft({ draftId: randomUUID() })
                : buildWorkflowEditorDraftFromDefinition({
                    draftId: randomUUID(),
                    name: seed.name,
                    definition: seed.definition,
                })
    );

    const [draft, setDraft] = React.useState<WorkflowEditorDraft | null>(
        props.source.kind === 'saved' ? null : createDraftForSource(props.source, reviewedRunSeed),
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
    const [inputValues, setInputValues] = React.useState<Readonly<Record<string, JsonValue | undefined>>>({});
    const [inputSheetOpen, setInputSheetOpen] = React.useState(false);
    const [savePending, setSavePending] = React.useState(false);
    const [saveConflict, setSaveConflict] = React.useState<WorkflowSaveConflict | null>(null);
    // Every host-carried intent goes through the page's own command gate, so
    // it can never bypass the reason the page shows beside the visible action.
    const editorCommandsRef = React.useRef<WorkflowEditorCommands | null>(null);
    // The contextual default comes from the canonical New Session resolver, and
    // only when it produces a genuinely valid choice (UX §2.3). A reviewed copy
    // keeps its predecessor's accepted target instead.
    const recentMachinePaths = useSetting('recentMachinePaths') as
        | ReadonlyArray<Readonly<{ machineId?: string | null; path?: string | null }>>
        | undefined;
    const [projectTarget, setProjectTarget] = React.useState<WorkflowProjectTargetV1 | null>(
        props.source.kind === 'capturedSession' ? props.source.project : reviewedRunSeed?.project ?? null,
    );
    const seededContextualTargetRef = React.useRef(
        props.source.kind === 'capturedSession' || reviewedRunSeed?.project !== undefined,
    );
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
    const initializationKey = `${workflowEditorSourceKey(props.source)}\u0000${accountScopeKey ?? ''}`;
    const [initializedKey, setInitializedKey] = React.useState(initializationKey);
    const [initializedSourceKey, setInitializedSourceKey] = React.useState(
        workflowEditorSourceKey(props.source),
    );
    const currentSourceKey = workflowEditorSourceKey(props.source);
    const privateSeedWithdrawn = initializedSourceKey === currentSourceKey
        && carriesPrivateSeed
        && accountScopeKey !== seedScopeKey;
    if (initializedKey !== initializationKey) {
        const sourceChanged = initializedSourceKey !== currentSourceKey;
        // A withdrawn private seed has no bytes to re-adopt; it must not fall
        // back to an empty draft that looks like the reviewed copy opened fine.
        const withdrawn = !sourceChanged && carriesPrivateSeed && accountScopeKey !== seedScopeKey;
        const nextReviewedRunSeedState = reviewedRunSeedId === null
            ? { id: null, seed: null }
            : reviewedRunSeedState.id === reviewedRunSeedId
                ? reviewedRunSeedState
                : {
                    id: reviewedRunSeedId,
                    seed: readWorkflowReviewedRunSeed(reviewedRunSeedId),
                };
        const nextReviewedRunSeed = nextReviewedRunSeedState.seed;
        const next = sourceKind === 'saved' || withdrawn
            ? null
            : createDraftForSource(props.source, nextReviewedRunSeed);
        // Everything source-local is reset in this one place, and the generation
        // it stamps is what a slower publication is checked against. Collected
        // Run inputs, an open input sheet, a pending Run id, a save in flight or
        // the page-level Run as choice left behind are how a source-A save or
        // import used to land in source B's editor.
        sourceGenerationRef.current += 1;
        setInitializedKey(initializationKey);
        setInitializedSourceKey(currentSourceKey);
        setReviewedRunSeedState(nextReviewedRunSeedState);
        if (!withdrawn) setSeedScopeKey(accountScopeKey);
        setDraft(next);
        initialDraftBaselineRef.current = next;
        savedDraftRef.current = null;
        setSaved(null);
        setSaveConflict(null);
        setSavePending(false);
        setHydrationFailed(false);
        setSelection(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
        setView('steps');
        setInputValues({});
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
        const nextProjectTarget = withdrawn
            ? null
            : props.source.kind === 'capturedSession'
                ? props.source.project
                : nextReviewedRunSeed?.project ?? null;
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

    // The controlled editor resolves no catalog of its own, so the Agent options
    // and every step prompt's reference scope come from this one host adapter —
    // the same one the Automation wrappers consume.
    const capturedSessionId = props.source.kind === 'capturedSession' ? props.source.sessionId : null;
    const capturedSessionServerId = props.source.kind === 'capturedSession'
        ? props.source.serverId ?? null
        : null;
    const authoringHost = useWorkflowAuthoringHost({
        ...(capturedSessionId === null
            ? {}
            : { capturedSession: { sessionId: capturedSessionId, serverId: capturedSessionServerId } }),
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
        // Declared inputs are collected before admission, in declaration order.
        if (draft.inputs.length > 0) {
            setInputSheetOpen(true);
            return;
        }
        void startRun(undefined);
    }, [draft, startRun]);

    const dismissInputSheet = React.useCallback(() => {
        setInputSheetOpen(false);
    }, []);

    const inputModalProps = React.useMemo<WorkflowRunInputModalProps | null>(() => draft === null ? null : ({
        inputs: draft.inputs,
        values: inputValues,
        onChangeValues: setInputValues,
        onRun: (inputs) => { void startRun(inputs); },
        onCancel: dismissInputSheet,
        pending: runNow.stateFor(pendingRunIdRef.current ?? '') === 'submitting',
    }), [dismissInputSheet, draft, inputValues, runNow, startRun]);

    useWorkflowRunInputModal({ open: inputSheetOpen, props: inputModalProps });

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
        void (async () => {
            try {
                const metadata = { title: draft.name.trim() };
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
                setSaved({ definitionId: result.definitionId, revision: result.revision });
                setSaveConflict(null);
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
                // cannot open. Discarding it left every one of them reading as
                // the same sentence.
                await Modal.alert(
                    t('workflows.save.failedTitle'),
                    `${formatWorkflowProblemMessage(error)} ${t('workflows.save.failedBody')}`,
                );
            } finally {
                if (isCurrent()) setSavePending(false);
            }
        })();
    }, [captureSourceGeneration, draft, saved, savePending]);

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
                    metadata: { title: draft.name.trim() },
                });
                if (!isCurrent()) return;
                savedDraftRef.current = draft;
                setSaved({ definitionId: result.definitionId, revision: result.revision });
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
    }, [captureSourceGeneration, draft, savePending]);

    const handleSchedule = React.useCallback(() => {
        if (draft === null || projectTarget === null || projectTarget.directory.trim().length === 0) return;
        // Schedule copies the current reviewed draft into the Automation
        // wrapper; there is no live link back to the library revision, and an
        // invalid draft is refused rather than frozen into a schedule.
        const built = buildWorkflowScheduleSeed({
            draft,
            project: projectTarget,
            saved: saved === null || savedDraftRef.current === null
                ? null
                : {
                    definitionId: saved.definitionId,
                    revision: saved.revision,
                    definition: savedDraftRef.current,
                },
        });
        if (built.kind !== 'available') return;
        // Only the opaque seed id travels; no prompt or setting enters the URL.
        router.push({
            pathname: '/automations/new',
            params: { workflowSeedId: storeWorkflowScheduleSeed(built.seed) },
        } as never);
    }, [draft, projectTarget, router, saved]);

    /**
     * A saved-row Run now or Schedule presses this page's own action.
     *
     * The intent is consumed exactly once, after the exact Artifact revision is
     * hydrated under the current Account, and it calls the same handler as the
     * visible button — so Run now still freezes the reviewed draft through the
     * run-admission owner (collecting declared inputs first) and Schedule still
     * hands a reviewed copy to the Automation wrapper. It never replaces the
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

    const handleBrowseProject = React.useCallback(() => {
        if (projectTarget === null) return;
        const sourceIsCurrent = captureSourceGeneration();
        void (async () => {
            const directory = await openMachinePathBrowserModal({
                machineId: projectTarget.machineId,
                initialPath: projectTarget.directory,
                selectionMode: 'directory',
                title: t('workflows.workspace.projectCheckout'),
            });
            if (directory !== null && sourceIsCurrent()) setProjectTarget((current) => current === null
                ? current
                : { ...current, directory });
        })();
    }, [captureSourceGeneration, projectTarget]);

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

    const routeDraftDirty = draft !== null && !pluginJsonValuesEqual(
        draft,
        savedDraftRef.current ?? initialDraftBaselineRef.current,
    );
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
                authoringFacts={authoringHost.authoringFacts}
                existingSessions={authoringHost.existingSessions}
                composerScope={authoringHost.composerScope}
                commandsRef={editorCommandsRef}
                onChange={setDraft}
                machineName={machineName}
                projectTarget={projectTarget}
                projectMachines={machines}
                onChangeProjectTarget={setProjectTarget}
                onBrowseProjectDirectory={handleBrowseProject}
                selectedBlockId={selection.selectedBlockId}
                onSelectBlock={(blockId) => setSelection((current) => selectWorkflowBlock(current, blockId))}
                onCustomizeBlock={(blockId) => setSelection((current) => selectWorkflowBlock(current, blockId))}
                view={view}
                onChangeView={setView}
                executionTarget={executionTarget}
                runAsTargets={runAsTargets}
                onChangeExecutionTarget={setExecutionTarget}
                onRunNow={handleRunNow}
                runPending={runNow.stateFor(pendingRunIdRef.current ?? '') === 'submitting'}
                onSave={handleSave}
                onSchedule={handleSchedule}
                savePending={savePending}
                savedRevision={saved?.revision ?? null}
                saveConflict={saveConflict}
                onSaveAsCopy={handleSaveAsCopy}
                onImportJson={handleImportJson}
                onExportJson={handleExportJson}
            />
        </View>
    );
}

/** Re-exported so a host can clear an override without importing the draft owner. */
export { setWorkflowStepExecutionField };
