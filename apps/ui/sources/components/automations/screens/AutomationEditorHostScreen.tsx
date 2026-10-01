import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import {
    AutomationSourceSelectorIdV1Schema,
    parseWorkflowDefinitionRefV1,
    readTriggerTargetV1,
    pluginJsonValuesEqual,
    type AutomationDefinitionDetail,
    type AutomationTriggerDefinitionInput,
} from '@happier-dev/protocol';

import { AutomationPluralEditorScreen } from '@/components/automations/editor/AutomationPluralEditorScreen';
import { WorkflowEditorBody, type WorkflowEditorView } from '@/components/workflows/screens/WorkflowEditorBody';
import { useWorkflowsAvailability } from '@/components/workflows/gating/workflowsAvailability';
import { useWorkflowAuthoringHost } from '@/components/workflows/screens/useWorkflowAuthoringHost';
import {
    readPluginEventAutomationEditSeed,
    readPluginEventAutomationPrivateDetail,
    type PluginEventAutomationEditSeed,
    type PluginEventAutomationStoredContentAccess,
} from '@/components/automations/editor/pluginEventAutomationEditSeed';
import { PluginEventAutomationEditor } from '@/components/automations/editor/PluginEventAutomationEditor';
import {
    areExactTurnAutomationPrefillsEqual,
    buildExactTurnAutomationRouteParams,
    readExactActiveParentTurn,
    type ExactTurnAutomationPrefill,
} from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { layout } from '@/components/ui/layout/layout';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ListPresentationProvider } from '@/components/ui/lists/listPresentation';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { Modal } from '@/modal';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { isAutomationApiErrorCode } from '@/sync/api/automations/apiAutomations';
import { formatAutomationErrorMessage } from '@/components/automations/automationErrorFormatting';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import {
    automationEditorDraftFromDetail,
    createAutomationEditorLifetimeIdentity,
    isAutomationEditorLifetimeIdentityCurrent,
    createAutomationEditorTriggerClientId,
    isAutomationWorkflowRecipe,
    replaceAutomationEditorExecutionRecipe,
    requireAutomationEditorDraftIdentity,
    shouldValidateAutomationEditorLifecycleTrigger,
    type AutomationEditorDraft,
    type AutomationEditorExecutionRecipe,
    type AutomationEditorTriggerDefinitionSeed,
} from '@/sync/domains/automations/automationEditorDraft';
import { buildAutomationRecipeFromSessionAuthoring, openAutomationRecipeForAuthoring } from '@/sync/domains/automations/automationRecipeAuthoring';
import {
    openAutomationWorkflowRecipeForAuthoring,
} from '@/sync/domains/workflows/automationWorkflowRecipe';
import {
    projectAutomationWorkflowRecipeToEditorDraft,
    projectEditorDraftToLegacyAutomationRecipe,
    projectLegacyAutomationRecipeToEditorDraft,
    type AutomationWorkflowEditorOrigin,
    type AutomationWorkflowEditorProjection,
} from '@/sync/domains/workflows/automationRecipeWorkflowDraft';
import { getWorkflowDefinition } from '@/sync/domains/workflows/workflowDefinitionActions';
import { WorkflowActionError } from '@/sync/domains/workflows/workflowActionError';
import {
    firstBlockingWorkflowIssue,
    resolveWorkflowSaveBlockedReason,
    validateWorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowAuthoring';
import {
    describeWorkflowCommandBlockedReason,
} from '@/components/workflows/presentation/workflowBlockedReasonText';
import {
    EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    selectWorkflowBlock,
    setWorkflowInspectorGroupExpanded,
    type WorkflowEditorDraft,
    type WorkflowEditorViewState,
} from '@/sync/domains/workflows/workflowEditorDraft';
import { isWorkflowProjectTarget, type WorkflowAuthoringTarget } from '@/sync/domains/workflows/workflowProjectTarget';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { captureSessionAutomationAuthority } from '@/sync/domains/automations/sessionAutomationAuthority';
import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage, useActiveServerAccountScope, useAllMachines, useAutomation, useSessions, useSettings } from '@/sync/domains/state/storage';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { navigateWithBlurOnWeb } from '@/utils/platform/deferOnWeb';
import { useUnsavedDraftNavigationGuard } from '@/utils/navigation/useUnsavedDraftNavigationGuard';
import { getSessionName } from '@/utils/sessions/sessionUtils';

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.surface.base },
    centered: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
    content: { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
}));

function definitionSeedForNonEvent(
    trigger: Exclude<AutomationEditorHydrationTrigger, Readonly<{ kind: 'pluginEvent' }>>,
): AutomationEditorTriggerDefinitionSeed {
    const definition: AutomationTriggerDefinitionInput = trigger.kind === 'schedule'
        ? { kind: 'schedule', enabled: trigger.enabled, schedule: trigger.schedule }
        : {
            kind: 'sessionLifecycle',
            enabled: trigger.enabled,
            sourceSessionId: trigger.sourceSessionId,
            events: trigger.events,
            policy: trigger.policy,
        };
    return { definition };
}

type AutomationEditorHydrationTrigger = AutomationDefinitionDetail['triggers'][number];

type AutomationEditorHydrationState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'ready' }>
    | Readonly<{ kind: 'privateUnavailable' }>
    | Readonly<{ kind: 'notFound' }>
    | Readonly<{ kind: 'failed' }>;

function buildTriggerSeeds(params: Readonly<{
    definition: NonNullable<ReturnType<typeof useAutomation>>;
    access: PluginEventAutomationStoredContentAccess;
}>): ReadonlyMap<string, AutomationEditorTriggerDefinitionSeed> | null {
    if (params.definition.detail.kind !== 'available') return null;
    const seeds = new Map<string, AutomationEditorTriggerDefinitionSeed>();
    for (const trigger of params.definition.detail.value.triggers) {
        if (trigger.kind !== 'pluginEvent') {
            seeds.set(trigger.id, definitionSeedForNonEvent(trigger));
            continue;
        }
        const privateDetail = readPluginEventAutomationPrivateDetail(
            params.definition,
            trigger.id,
            params.access,
        );
        if (!privateDetail) return null;
        const sourceSelectorId = AutomationSourceSelectorIdV1Schema.safeParse(trigger.sourceSelectorId);
        if (!sourceSelectorId.success) return null;
        seeds.set(trigger.id, {
            // Durable endpoint setup is deliberately not reconstructed. The
            // Event composer replaces this row with a fresh strict input only
            // after the author explicitly edits its source.
            definition: null,
            retainedEvent: {
                kind: 'pluginEvent',
                enabled: trigger.enabled,
                displayLabel: privateDetail.storedDefinition.displayLabel,
                eventRef: trigger.eventRef,
            },
            eventSourceBinding: {
                sourceSelectorId: sourceSelectorId.data,
                sourceInstanceId: privateDetail.storedDefinition.sourceInstanceId,
            },
            retainedEventPrivateDefinition: privateDetail.storedDefinition,
        });
    }
    return seeds;
}

/**
 * Opens the saved recipe as the shared Workflow definition draft.
 *
 * Both recipe epochs reach one editor body: the released one-shot recipe is
 * adapted into the canonical one-step definition, and a managed workflow recipe
 * already is one. Decryption stays with the Account envelope owners; this
 * function only chooses which of them to ask.
 */
async function openAutomationRecipeAsWorkflowDraft(params: Readonly<{
    recipe: AutomationEditorExecutionRecipe;
    draftId: string;
    name: string;
    machineId: string | null;
    workflowDefinitionId?: string | null;
    scopeSessionId?: string | null;
    isCurrent: () => boolean;
}>): Promise<AutomationWorkflowEditorProjection> {
    const encryption = sync.encryption;
    const recipe = params.recipe;
    if (isAutomationWorkflowRecipe(recipe)) {
        const stored = await openAutomationWorkflowRecipeForAuthoring({
            recipe,
            ...(encryption
                ? { decryptRaw: (ciphertext: string) => encryption.decryptAutomationTemplateRaw(ciphertext) }
                : {}),
            isCurrent: params.isCurrent,
        });
        const target = readTriggerTargetV1(params, stored);
        if (target.kind !== 'available' || !params.machineId) {
            throw new WorkflowActionError({ message: 'Workflow source unavailable', rawCode: 'source_unavailable' });
        }
        let resolvedDefinition;
        if (target.target.kind === 'workflow') {
            const ref = parseWorkflowDefinitionRefV1(target.target.ref);
            if (ref?.kind === 'artifact') {
                resolvedDefinition = (await getWorkflowDefinition({ definitionId: ref.artifactId })).definition;
            }
            if (!resolvedDefinition || !params.isCurrent()) {
                throw new WorkflowActionError({ message: 'Workflow source unavailable', rawCode: 'source_unavailable' });
            }
        }
        return projectAutomationWorkflowRecipeToEditorDraft({
            draftId: params.draftId,
            name: params.name,
            stored,
            machineId: params.machineId,
            workflowDefinitionId: params.workflowDefinitionId ?? null,
            ...(resolvedDefinition ? { resolvedDefinition } : {}),
        });
    }
    const program = await openAutomationRecipeForAuthoring({
        recipe,
        ...(encryption
            ? { decryptRaw: (ciphertext: string) => encryption.decryptAutomationTemplateRaw(ciphertext) }
            : {}),
        isCurrent: params.isCurrent,
    });
    return projectLegacyAutomationRecipeToEditorDraft({
        draftId: params.draftId,
        name: params.name,
        program,
        target: recipe.target,
        machineId: params.machineId,
    });
}

/**
 * The Session an Automation's recipe already targets, if any.
 *
 * A managed workflow recipe has no one-shot target at all, so every reader goes
 * through this guard rather than reaching for `recipe.target` on the union.
 */
function automationRecipeExistingSessionId(recipe: AutomationEditorExecutionRecipe): string | null {
    if (isAutomationWorkflowRecipe(recipe)) return null;
    return recipe.target.kind === 'existingSession' ? recipe.target.sessionId : null;
}

function resolveAutomationAssignmentMachineId(draft: AutomationEditorDraft): string | null {
    return draft.assignments.find((assignment) => assignment.enabled)?.machineId
        ?? draft.assignments[0]?.machineId
        ?? null;
}

function appendExactTurnPrefill(
    draft: AutomationEditorDraft,
    prefill: ExactTurnAutomationPrefill | null,
): AutomationEditorDraft {
    if (!prefill) return draft;
    const existing = draft.triggers.find((trigger) => (
        trigger.definition?.kind === 'sessionLifecycle'
        && trigger.definition.sourceSessionId === prefill.sourceSessionId
        && trigger.definition.policy.kind === 'currentTurn'
        && trigger.definition.policy.sourceTurnId === prefill.sourceTurnId
    ));
    if (existing) {
        // One current-turn trigger per (Session, exact turn): join the
        // prefill's missing Events into the stable row instead of dropping
        // them or appending an overlapping duplicate trigger. A changed
        // persisted row is marked dirty so the save reconciles the merge.
        const definition = existing.definition;
        if (definition?.kind !== 'sessionLifecycle') return draft;
        const events = [...definition.events];
        let added = false;
        for (const event of prefill.events) {
            if (!events.includes(event)) {
                events.push(event);
                added = true;
            }
        }
        if (!added) return draft;
        return {
            ...draft,
            triggers: draft.triggers.map((trigger) => (
                trigger === existing
                    ? {
                        ...trigger,
                        isDirty: trigger.persisted !== null || trigger.isDirty === true,
                        definition: { ...definition, events },
                    }
                    : trigger
            )),
        };
    }
    return {
        ...draft,
        triggers: [...draft.triggers, {
            clientId: createAutomationEditorTriggerClientId(),
            persisted: null,
            definition: {
                kind: 'sessionLifecycle',
                enabled: true,
                sourceSessionId: prefill.sourceSessionId,
                events: [...prefill.events],
                policy: {
                    kind: 'currentTurn',
                    sourceTurnId: prefill.sourceTurnId,
                },
            },
        }],
    };
}

function replaceLifecycleRowsWithCurrentTurns(draft: AutomationEditorDraft): AutomationEditorDraft | null {
    let changed = false;
    const triggers: AutomationEditorDraft['triggers'][number][] = [];
    for (const trigger of draft.triggers) {
        const definition = trigger.definition;
        if (definition?.kind !== 'sessionLifecycle' || !shouldValidateAutomationEditorLifecycleTrigger(trigger)) {
            triggers.push(trigger);
            continue;
        }
        if (definition.policy.kind !== 'currentTurn') {
            triggers.push(trigger);
            continue;
        }
        const current = readExactActiveParentTurn(
            storage.getState().sessions[definition.sourceSessionId],
        );
        if (!current) return null;
        if (
            automationRecipeExistingSessionId(draft.executionRecipe) === current.sourceSessionId
        ) return null;
        if (current.sourceTurnId === definition.policy.sourceTurnId) {
            triggers.push(trigger);
        } else {
            changed = true;
            triggers.push({
                ...trigger,
                isDirty: trigger.persisted !== null || trigger.isDirty === true,
                definition: {
                    ...definition,
                    sourceSessionId: current.sourceSessionId,
                    policy: {
                        ...definition.policy,
                        sourceTurnId: current.sourceTurnId,
                    },
                },
            });
        }
    }
    return changed ? { ...draft, triggers } : draft;
}

export function AutomationEditorHostScreen(props: Readonly<{
    automationId: string;
    exactTurnPrefill?: ExactTurnAutomationPrefill | null;
}>) {
    const router = useRouter();
    const navigation = useNavigation();
    const definition = useAutomation(props.automationId);
    const sessions = useSessions() ?? [];
    const settings = useSettings();
    const activeServer = useActiveServerSnapshot();
    const activeAccountScope = useActiveServerAccountScope();
    const editorLifetimeIdentity = activeAccountScope?.serverId === activeServer.serverId
        ? createAutomationEditorLifetimeIdentity(activeAccountScope, props.automationId)
        : null;
    // The mounted exact-turn binding is established once at mount and changes
    // only through the explicit adopt-current-turn action below. Route params
    // stay URL truth; they are never the mutation owner for the mounted draft.
    const [exactTurnBinding, setExactTurnBinding] = React.useState<ExactTurnAutomationPrefill | null>(
        () => props.exactTurnPrefill ?? null,
    );
    const exactTurnBindingRef = React.useRef(exactTurnBinding);
    exactTurnBindingRef.current = exactTurnBinding;
    const workflows = useWorkflowsAvailability();
    const exactTurnSupport = useAutomationsSupport({
        scopeKind: 'spawn',
        serverId: exactTurnBinding?.sourceServerId ?? activeServer.serverId,
    });
    const exactTurnSupportRef = React.useRef(exactTurnSupport.enabled);
    exactTurnSupportRef.current = exactTurnSupport.enabled;
    const accountScopeKey = activeAccountScope ? serverAccountScopeKeySuffix(activeAccountScope) : null;
    const exactTurnAuthority = React.useMemo(() => exactTurnBinding
        ? captureSessionAutomationAuthority({
            // Capture-time identity facts only; isCurrent() re-reads live store
            // truth, so the captured session must not be a render-phase object
            // whose identity churns on every transcript update.
            session: storage.getState().sessions[exactTurnBinding.sourceSessionId] ?? null,
            routeSessionId: exactTurnBinding.sourceSessionId,
            routeServerId: exactTurnBinding.sourceServerId,
            activeServerId: activeServer.serverId,
            automationsEnabled: exactTurnSupport.enabled,
            accountSettings: storage.getState().settings,
            accountLifetime: captureActiveServerAccountScopeLifetime(),
            readCurrent: () => ({
                session: storage.getState().sessions[exactTurnBinding.sourceSessionId] ?? null,
                routeSessionId: exactTurnBinding.sourceSessionId,
                routeServerId: exactTurnBinding.sourceServerId,
                activeServerId: getActiveServerSnapshot().serverId,
                automationsEnabled: exactTurnSupportRef.current,
                accountSettings: storage.getState().settings,
            }),
        })
        : null, [
        // The Account-scope key (serverId+accountId) is the semantic Account
        // identity owned by the Account scope domain: a same-server Account
        // switch rebinds the authority instead of holding the retired A-era
        // lifetime forever.
        accountScopeKey,
        activeServer.serverId,
        exactTurnSupport.enabled,
        exactTurnBinding?.sourceServerId,
        exactTurnBinding?.sourceSessionId,
    ]);
    const machines = useAllMachines();
    const [draft, setDraft] = React.useState<AutomationEditorDraft | null>(null);
    const hydratedDraftRef = React.useRef<AutomationEditorDraft | null>(null);
    // The shared Workflow definition draft this Automation edits, plus the
    // recipe epoch it came from. The recipe itself is resealed only on Save.
    const [workflowDraft, setWorkflowDraft] = React.useState<WorkflowEditorDraft | null>(null);
    const hydratedWorkflowDraftRef = React.useRef<WorkflowEditorDraft | null>(null);
    const latestWorkflowDraftRef = React.useRef<WorkflowEditorDraft | null>(null);
    latestWorkflowDraftRef.current = workflowDraft;
    const [recipeOrigin, setRecipeOrigin] = React.useState<AutomationWorkflowEditorOrigin | null>(null);
    const [projectTarget, setProjectTarget] = React.useState<WorkflowAuthoringTarget | null>(null);
    // The Machine and project folder are authored values: Save persists them,
    // so changing only one of them is unsaved work and must answer the same
    // departure guard the prompt does. Compare semantic values rather than
    // object identity so returning to the hydrated placement is clean again.
    const hydratedProjectTargetRef = React.useRef<WorkflowAuthoringTarget | null>(null);
    const changeProjectTarget = React.useCallback((next: WorkflowAuthoringTarget) => {
        setProjectTarget(next);
        const baseline = hydratedProjectTargetRef.current;
        if (baseline === null
            || baseline.machineId !== next.machineId
            || !pluginJsonValuesEqual(baseline.directory, next.directory)
            || baseline.workspaceRefId !== next.workspaceRefId) {
            setIsDirty(true);
        }
    }, []);
    const [convertToWorkflow, setConvertToWorkflow] = React.useState(false);
    const [workflowView, setWorkflowView] = React.useState<WorkflowEditorView>('steps');
    const [workflowSelection, setWorkflowSelection] = React.useState<WorkflowEditorViewState>(
        EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    );
    const [isDirty, setIsDirty] = React.useState(false);
    const [draftLifetimeIdentity, setDraftLifetimeIdentity] = React.useState<string | null>(null);
    const latestDraftRef = React.useRef(draft);
    latestDraftRef.current = draft;
    const [hydrationState, setHydrationState] = React.useState<AutomationEditorHydrationState>({ kind: 'loading' });
    const [submitting, setSubmitting] = React.useState(false);
    const [stalePrefill, setStalePrefill] = React.useState<ExactTurnAutomationPrefill | null>(null);
    const [eventEditSeeds, setEventEditSeeds] = React.useState<ReadonlyMap<string, PluginEventAutomationEditSeed>>(
        () => new Map(),
    );
    const [reloadGeneration, setReloadGeneration] = React.useState(0);
    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    React.useEffect(() => {
        let alive = true;
        const accountLifetime = captureActiveServerAccountScopeLifetime();
        setHydrationState({ kind: 'loading' });
        setDraft(null);
        hydratedDraftRef.current = null;
        setIsDirty(false);
        setDraftLifetimeIdentity(null);
        setEventEditSeeds(new Map());
        setStalePrefill(null);
        setWorkflowDraft(null);
        hydratedWorkflowDraftRef.current = null;
        setRecipeOrigin(null);
        hydratedProjectTargetRef.current = null;
        setProjectTarget(null);
        setConvertToWorkflow(false);
        setWorkflowSelection(EMPTY_WORKFLOW_EDITOR_VIEW_STATE);
        void (async () => {
            const credentials = sync.getCredentials();
            if (!credentials || !accountLifetime) throw new Error('Automation Account is unavailable');
            const capturedIdentity = createAutomationEditorLifetimeIdentity(
                accountLifetime.scope,
                props.automationId,
            );
            if (capturedIdentity !== editorLifetimeIdentity) return;
            const refreshed = await sync.refreshAutomationDefinitionDetail(props.automationId);
            if (!alive || !accountLifetime.isCurrent() || capturedIdentity !== editorLifetimeIdentity) return;
            if (!refreshed) {
                setHydrationState({ kind: 'notFound' });
                return;
            }
            if (refreshed.detail.kind === 'unavailable') {
                setHydrationState({ kind: 'privateUnavailable' });
                return;
            }
            if (refreshed.detail.kind !== 'available') {
                setHydrationState({ kind: 'failed' });
                return;
            }
            const mode = await fetchAccountEncryptionMode(credentials);
            if (!alive || !accountLifetime.isCurrent() || capturedIdentity !== editorLifetimeIdentity) return;
            const access: PluginEventAutomationStoredContentAccess = mode.mode === 'plain'
                ? { mode: 'plain' }
                : { mode: 'e2ee', material: resolveAccountScopedCryptoMaterialFromCredentials(credentials) };
            const seeds = buildTriggerSeeds({ definition: refreshed, access });
            const hydrated = seeds
                ? automationEditorDraftFromDetail(refreshed.detail.value, seeds)
                : null;
            if (!hydrated) {
                setHydrationState({ kind: 'privateUnavailable' });
                return;
            }
            // The stored recipe is private Account content: an unavailable
            // envelope fails closed instead of opening an empty editor that
            // would overwrite the saved program on Save.
            let recipeProjection: AutomationWorkflowEditorProjection;
            try {
                recipeProjection = await openAutomationRecipeAsWorkflowDraft({
                    recipe: hydrated.executionRecipe,
                    draftId: `automation-${props.automationId}`,
                    name: hydrated.name,
                    machineId: resolveAutomationAssignmentMachineId(hydrated),
                    workflowDefinitionId: hydrated.workflowDefinitionId,
                    scopeSessionId: hydrated.scopeSessionId,
                    isCurrent: () => alive
                        && accountLifetime.isCurrent()
                        && capturedIdentity === editorLifetimeIdentity,
                });
            } catch {
                if (alive && accountLifetime.isCurrent() && capturedIdentity === editorLifetimeIdentity) {
                    setHydrationState({ kind: 'privateUnavailable' });
                }
                return;
            }
            if (!alive || !accountLifetime.isCurrent() || capturedIdentity !== editorLifetimeIdentity) return;
            const observed = exactTurnBindingRef.current;
            const current = observed
                ? readExactActiveParentTurn(storage.getState().sessions[observed.sourceSessionId])
                : null;
            const observedIsAuthorized = !observed || (
                exactTurnAuthority?.isCurrent() === true
                && areExactTurnAutomationPrefillsEqual(observed, current)
            );
            const withPrefill = observed && observedIsAuthorized
                ? appendExactTurnPrefill(hydrated, observed)
                : hydrated;
            if (alive && accountLifetime.isCurrent() && capturedIdentity === editorLifetimeIdentity) {
                const nextEventSeeds = new Map<string, PluginEventAutomationEditSeed>();
                for (const trigger of refreshed.detail.value.triggers) {
                    if (trigger.kind !== 'pluginEvent') continue;
                    const seed = readPluginEventAutomationEditSeed(refreshed, trigger.id, access);
                    if (seed) nextEventSeeds.set(trigger.id, seed);
                }
                setEventEditSeeds(nextEventSeeds);
                setStalePrefill(observed && !observedIsAuthorized
                    ? observed
                    : null);
                setDraftLifetimeIdentity(capturedIdentity);
                // Only the authoritative stored definition is the clean
                // baseline. A route prefill is visible author intent layered
                // onto that baseline, so adding or merging its Event remains
                // unsaved and participates in Cancel/beforeRemove guards.
                hydratedDraftRef.current = hydrated;
                hydratedWorkflowDraftRef.current = recipeProjection.draft;
                setWorkflowDraft(recipeProjection.draft);
                setRecipeOrigin(recipeProjection.origin);
                hydratedProjectTargetRef.current = recipeProjection.project;
                setProjectTarget(recipeProjection.project);
                setIsDirty(withPrefill !== hydrated);
                setDraft(withPrefill);
                setHydrationState({ kind: 'ready' });
            }
        })().catch(() => {
            if (alive && (!accountLifetime || accountLifetime.isCurrent())) {
                setHydrationState({ kind: 'failed' });
            }
        });
        return () => { alive = false; };
        // Rehydration is keyed by the mounted definition/Account identity, the
        // authority binding, and the automation id — never by route params or
        // the prefill object. The mounted binding is read through a ref so an
        // explicit adopt-current-turn cannot rehydrate unsaved work away.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by semantic mounted identity, see exactTurnBinding above.
    }, [editorLifetimeIdentity, exactTurnAuthority, props.automationId, reloadGeneration]);

    const sessionOptions = React.useMemo(() => sessions
        .filter((session) => (
            session.serverId === activeServer.serverId
            && isAutomationSessionCandidate(session, settings)
        ))
        .map((session) => ({
        sessionId: session.id,
        label: getSessionName(session),
        currentParentTurnId: readExactActiveParentTurn(session)?.sourceTurnId ?? null,
        selectable: draft === null
            || automationRecipeExistingSessionId(draft.executionRecipe) !== session.id,
    })), [activeServer.serverId, draft, sessions, settings]);
    const workflowMachineName = React.useMemo(() => {
        const machineId = projectTarget?.machineId ?? null;
        if (machineId === null) return null;
        const machine = machines.find((candidate) => candidate.id === machineId);
        return machine === undefined ? machineId : getMachineDisplayName(machine);
    }, [machines, projectTarget?.machineId]);
    // The same host adapter the neutral editor uses, so editing an Automation's
    // recipe offers the same Agent options and prompt reference scope.
    const authoringHost = useWorkflowAuthoringHost({
        projectTarget,
        serverId: activeServer.serverId ?? null,
    });
    const eventAuthoringMachineId = React.useMemo(() => (
        draft?.assignments.find((assignment) => assignment.enabled)?.machineId
        ?? draft?.assignments[0]?.machineId
        ?? null
    ), [draft?.assignments]);

    // A one-shot Automation keeps its released recipe while the author only
    // edits what that recipe can express. This probe names the first change
    // that needs the workflow format, so the consequence is stated before Save
    // rather than discovered as a silently converted execution semantics.
    const legacyWriteBackProbe = React.useMemo(() => (
        recipeOrigin?.kind === 'legacy'
            && workflowDraft !== null
            && (workflowDraft !== hydratedWorkflowDraftRef.current || projectTarget !== hydratedProjectTargetRef.current)
            ? projectEditorDraftToLegacyAutomationRecipe({
                draft: workflowDraft,
                target: recipeOrigin.target,
                project: projectTarget,
                // Representability only; the committed write stamps its own time.
                configurationUpdatedAtMs: 0,
            })
            : null
    ), [projectTarget, recipeOrigin, workflowDraft]);
    // An empty prompt is ordinary repairable authoring, not a reason to change
    // how this Automation executes.
    const promptRequired = legacyWriteBackProbe?.kind === 'unavailable'
        && legacyWriteBackProbe.reason === 'prompt_required';
    const conversionRequired = legacyWriteBackProbe?.kind === 'unavailable'
        && !promptRequired
        && !convertToWorkflow;
    const projectUnresolved = projectTarget === null || !isWorkflowProjectTarget(projectTarget) || projectTarget.directory.trim().length === 0;
    const workflowRecipeSelected = recipeOrigin?.kind === 'workflow' || convertToWorkflow;
    // A managed workflow recipe answers to the same canonical draft validation
    // as the neutral editor and the create wrapper: Save is refused up front,
    // with the body naming the exact issue inline, rather than accepted and
    // then failed by the scheduling seed. The Automation's own name is the
    // definition's name here, so an unnamed workflow copy is not a reason.
    const workflowSaveEligibility = React.useMemo(() => {
        if (workflowDraft === null || !workflowRecipeSelected) return { reason: null, blockingIssue: null };
        const named = { ...workflowDraft, name: draft?.name.trim() || workflowDraft.name };
        const validation = validateWorkflowEditorDraft(named);
        return {
            reason: resolveWorkflowSaveBlockedReason({ draft: named, validation }),
            // The exact issue the reason refers to, so the refusal can name it
            // rather than repeating a generic "invalid".
            blockingIssue: firstBlockingWorkflowIssue(validation),
        };
    }, [draft?.name, workflowDraft, workflowRecipeSelected]);
    const workflowSaveBlockedReason = workflowSaveEligibility.reason;
    const workflowSaveBlockingIssue = workflowSaveEligibility.blockingIssue;
    // The canonical Workflows decision is the sole authority for structured
    // Workflow authoring, and `automations` is never a proxy for it. A one-shot
    // Automation therefore stays fully editable here, while adopting the
    // workflow contract — and editing an already-managed workflow definition —
    // needs the decision Workflow Run admission also answers to.
    /**
     * The exact blocker Save is refused for, named once.
     *
     * Nothing is revalidated here: each term is the same already-resolved fact
     * the boolean was built from, and the boolean is now derived from this so
     * an inert Save and its explanation cannot disagree.
     */
    const submitBlockedReason = React.useMemo<string | null>(() => {
        // The Automation's own name is the definition's name here, so the
        // canonical Save-eligibility owner already names this exact blocker.
        if (!draft?.name.trim()) return t('workflows.save.nameRequired');
        if (promptRequired) return describeWorkflowCommandBlockedReason({
            reason: 'definition_invalid',
            blockingIssue: { code: 'invalid_input' },
        });
        if (conversionRequired) return t('workflows.conversion.body');
        if (convertToWorkflow && projectUnresolved) return t('workflows.conversion.machineRequired');
        return describeWorkflowCommandBlockedReason({
            reason: workflowSaveBlockedReason,
            blockingIssue: workflowSaveBlockingIssue,
        });
    }, [
        conversionRequired,
        convertToWorkflow,
        draft?.name,
        promptRequired,
        projectUnresolved,
        workflowSaveBlockedReason,
        workflowSaveBlockingIssue,
    ]);

    const conversionUnavailable = conversionRequired && !workflows.available;
    const savedWorkflowRecipeUnavailable = recipeOrigin?.kind === 'workflow' && !workflows.available;

    const prepareDraftForSave = React.useCallback(async (params: Readonly<{
        draft: AutomationEditorDraft;
        workflowDraft: WorkflowEditorDraft | null;
        isCurrent: () => boolean;
    }>): Promise<AutomationEditorDraft | null> => {
        const origin = recipeOrigin;
        const workflow = params.workflowDraft;
        if (origin === null || workflow === null) return params.draft;
        if (workflow === hydratedWorkflowDraftRef.current && projectTarget === hydratedProjectTargetRef.current && !convertToWorkflow) return params.draft;
        // Only a recipe write reaches here. A managed workflow recipe — whether
        // already stored or newly adopted — is refused rather than resealed
        // when the canonical Workflows decision does not authorize it, and the
        // stored definition is never rewritten into the one-shot arm to fit.
        if ((origin.kind === 'workflow' || convertToWorkflow) && !workflows.available) {
            await Modal.alert(t('workflows.unavailable.title'), t('workflows.unavailable.body'));
            return null;
        }
        const credentials = sync.getCredentials();
        if (!credentials) return null;
        const encryption = sync.encryption;
        const templateVersion = (params.draft.expectedTemplateVersion === null
            ? params.draft.executionRecipe.templateVersion
            : params.draft.expectedTemplateVersion + 1);

        if (origin.kind === 'legacy' && !convertToWorkflow) {
            const writeBack = projectEditorDraftToLegacyAutomationRecipe({
                draft: workflow,
                target: origin.target,
                project: projectTarget,
                configurationUpdatedAtMs: Date.now(),
            });
            // The visible conversion card already owns this explanation.
            if (writeBack.kind !== 'available') return null;
            const recipe = await buildAutomationRecipeFromSessionAuthoring({
                credentials,
                templateVersion,
                prompt: writeBack.prompt,
                mentions: writeBack.mentions,
                target: writeBack.target,
                ...(encryption
                    ? { encryptRaw: (value: unknown) => encryption.encryptAutomationTemplateRaw(value) }
                    : {}),
                isCurrent: params.isCurrent,
            });
            return replaceAutomationEditorExecutionRecipe(params.draft, recipe);
        }

        // A managed workflow trigger, or a conversion into one, is written only through
        // `workflow.trigger.*` (03 §5.3, §5.6; 04 §5.4): this retained editor writes released
        // one-shot recipes and nothing else.
        await Modal.alert(t('workflows.triggers.editor.editInWorkflows'));
        return null;
    }, [convertToWorkflow, projectTarget, recipeOrigin, workflows.available]);

    const handleSave = React.useCallback(async (draftOverride?: AutomationEditorDraft): Promise<boolean> => {
        const capturedDraft = draftOverride ?? latestDraftRef.current;
        const capturedDraftLifetimeIdentity = draftLifetimeIdentity;
        const accountLifetime = captureActiveServerAccountScopeLifetime();
        const observed = exactTurnBinding;
        // Request/response lifetime facts. The source turn itself is NOT
        // re-read here: pre-request eligibility below decides from the live
        // turn once, and after the server has committed, the exact-turn state
        // the server validated is authoritative. Re-reading the turn after the
        // response would reject a committed save merely because the transcript
        // learned about the completion first.
        const exactTurnAuthorityIsCurrent = () => !observed || exactTurnAuthority?.isCurrent() === true;
        const exactTurnMatchesObservedTurn = () => !observed
            || areExactTurnAutomationPrefillsEqual(
                observed,
                readExactActiveParentTurn(storage.getState().sessions[observed.sourceSessionId]),
            );
        const lifecycleAuthorities = capturedDraft && accountLifetime
            ? capturedDraft.triggers.flatMap((trigger) => {
                if (!shouldValidateAutomationEditorLifecycleTrigger(trigger)) return [];
                const definition = trigger.definition;
                if (definition?.kind !== 'sessionLifecycle') return [];
                if (definition.policy.kind !== 'currentTurn') return [];
                const sourceSession = storage.getState().sessions[definition.sourceSessionId] ?? null;
                const authority = captureSessionAutomationAuthority({
                    session: sourceSession,
                    routeSessionId: definition.sourceSessionId,
                    routeServerId: sourceSession?.serverId ?? null,
                    activeServerId: getActiveServerSnapshot().serverId,
                    automationsEnabled: exactTurnSupportRef.current,
                    accountSettings: storage.getState().settings,
                    accountLifetime,
                    readCurrent: () => ({
                        session: storage.getState().sessions[definition.sourceSessionId] ?? null,
                        routeSessionId: definition.sourceSessionId,
                        routeServerId: sourceSession?.serverId ?? null,
                        activeServerId: getActiveServerSnapshot().serverId,
                        automationsEnabled: exactTurnSupportRef.current,
                        accountSettings: storage.getState().settings,
                    }),
                });
                return authority ? [{ authority, definition }] : [];
            })
            : [];
        const lifecycleRows = capturedDraft?.triggers.filter(
            shouldValidateAutomationEditorLifecycleTrigger,
        ).length ?? 0;
        const lifecycleAuthoritiesAreCurrent = () => lifecycleAuthorities.length === lifecycleRows
            && lifecycleAuthorities.every(({ authority }) => authority.isCurrent());
        const lifecycleTurnsMatchDraft = () => lifecycleAuthorities.length === lifecycleRows
            && lifecycleAuthorities.every(({ definition }) => (
                readExactActiveParentTurn(
                    storage.getState().sessions[definition.sourceSessionId],
                )?.sourceTurnId === (definition.policy.kind === 'currentTurn'
                    ? definition.policy.sourceTurnId
                    : null)
            ));
        // Pre-request eligibility: evaluated once, from live turn truth, before
        // anything is sent. A turn that completes only after this point is
        // settled by the server's own typed admission check, never locally.
        if (
            !capturedDraft
            || !accountLifetime
            || !capturedDraftLifetimeIdentity
            || capturedDraftLifetimeIdentity !== editorLifetimeIdentity
            || !isAutomationEditorLifetimeIdentityCurrent(
                capturedDraftLifetimeIdentity,
                accountLifetime.scope,
                props.automationId,
            )
            || submitting
            || !exactTurnAuthorityIsCurrent()
            || !exactTurnMatchesObservedTurn()
            || !lifecycleAuthoritiesAreCurrent()
            || !lifecycleTurnsMatchDraft()
        ) {
            if (observed) setStalePrefill(observed);
            if (capturedDraft && !observed && lifecycleRows > 0) {
                void sync.refreshSessions();
                const replacement = replaceLifecycleRowsWithCurrentTurns(capturedDraft);
                if (replacement && replacement !== capturedDraft && await Modal.confirm(
                    t('automations.exactTurn.staleTitle'),
                    t('automations.exactTurn.staleBody'),
                    { cancelText: t('common.cancel'), confirmText: t('automations.exactTurn.useCurrentTurn') },
                )) setDraft(replacement);
                else if (!replacement) {
                    await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
                }
            }
            return false;
        }
        const capturedWorkflowDraft = latestWorkflowDraftRef.current;
        const isCurrent = () => mountedRef.current
            && accountLifetime.isCurrent()
            && capturedDraftLifetimeIdentity === editorLifetimeIdentity
            && exactTurnAuthorityIsCurrent()
            && lifecycleAuthoritiesAreCurrent()
            && latestDraftRef.current === capturedDraft
            && latestWorkflowDraftRef.current === capturedWorkflowDraft;
        setSubmitting(true);
        try {
            const prepared = await prepareDraftForSave({
                draft: capturedDraft,
                workflowDraft: capturedWorkflowDraft,
                isCurrent,
            });
            if (prepared === null) return false;
            const saved = await sync.saveAutomationEditorDraft(prepared, { isCurrent });
            if (isCurrent()) {
                setIsDirty(false);
                navigateWithBlurOnWeb(() => router.replace(`/automations/${saved.id}` as never));
                return true;
            }
        } catch (error) {
            const exactTurnRejected = isAutomationApiErrorCode(error, 'sourceTurnNotCurrent')
                || isAutomationApiErrorCode(error, 'sourceTurnNotInProgress')
                || isAutomationApiErrorCode(error, 'sourceTurnUnavailable')
                || isAutomationApiErrorCode(error, 'sourceSessionUnavailable');
            if (observed && accountLifetime.isCurrent() && exactTurnRejected) {
                setStalePrefill(observed);
                void sync.refreshSessions();
            } else if (accountLifetime.isCurrent() && exactTurnRejected && lifecycleRows > 0) {
                void sync.refreshSessions();
                const replacement = replaceLifecycleRowsWithCurrentTurns(capturedDraft);
                if (replacement && replacement !== capturedDraft && await Modal.confirm(
                    t('automations.exactTurn.staleTitle'),
                    t('automations.exactTurn.staleBody'),
                    { cancelText: t('common.cancel'), confirmText: t('automations.exactTurn.useCurrentTurn') },
                )) setDraft(replacement);
                else if (!replacement) {
                    await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
                }
            } else if (accountLifetime.isCurrent()) {
                await Modal.alert(t('common.error'), formatAutomationErrorMessage(error, t('automations.edit.updateFailed')));
            }
        } finally {
            if (mountedRef.current) setSubmitting(false);
        }
        return false;
    }, [draftLifetimeIdentity, editorLifetimeIdentity, exactTurnAuthority, exactTurnBinding, prepareDraftForSave, props.automationId, router, submitting]);

    const discardDraft = React.useCallback(() => { setIsDirty(false); }, []);
    const leaveEditor = React.useCallback(() => { router.back(); }, [router]);
    // One departure contract for Cancel, native Back, the shell and unload.
    const unsavedChangesGuard = useUnsavedDraftNavigationGuard({
        navigation,
        isDirty,
        onDiscard: discardDraft,
        onSave: handleSave,
        onLeave: leaveEditor,
        tag: 'AutomationEditorHostScreen.beforeRemove',
    });
    const handleCancel = unsavedChangesGuard.requestLeave;

    // Explicit "Use current turn": the only path that mutates the mounted
    // binding. It advances just the exact lifecycle row(s) through the
    // incumbent draft owner (plus the binding row when hydration dropped it)
    // and preserves every other unsaved draft field, row, and dirty state.
    const adoptCurrentTurn = React.useCallback(async () => {
        if (!stalePrefill) return;
        const current = readExactActiveParentTurn(
            storage.getState().sessions[stalePrefill.sourceSessionId],
        );
        if (!current) {
            await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
            return;
        }
        // Recovery advances only the stale source identity. The lifecycle
        // Events are the author's explicit selection carried by the mounted
        // binding, so they are preserved verbatim instead of collapsing to the
        // observation default that `readExactActiveParentTurn` reports.
        const recovered: ExactTurnAutomationPrefill = { ...current, events: stalePrefill.events };
        const captured = latestDraftRef.current;
        if (!captured) return;
        // Retarget the stale exact-turn rows BEFORE appending the observed
        // current-turn prefill, so the retargeted binding row rejoins the
        // prefill through the same-turn merge instead of converging on the
        // current turn as two overlapping triggers.
        const retargeted = replaceLifecycleRowsWithCurrentTurns(captured);
        if (!retargeted) {
            await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
            return;
        }
        const appended = appendExactTurnPrefill(retargeted, recovered);
        setDraft(appended);
        setIsDirty(appended !== hydratedDraftRef.current);
        setStalePrefill(null);
        setExactTurnBinding(recovered);
        // Route params remain URL truth only; the mounted draft above was the
        // mutation owner, so no hydration may re-run from this change.
        router.setParams(buildExactTurnAutomationRouteParams(recovered));
    }, [router, stalePrefill]);

    if (hydrationState.kind !== 'ready' || !draft || draftLifetimeIdentity !== editorLifetimeIdentity) {
        return (
            <ListPresentationProvider value="page">
            <View style={stylesheet.root}>
                <PageHeader
                    title={t('automations.edit.title')}
                    description={t('automationPages.editor.description')}
                />
                <View style={stylesheet.content}>
                    {definition && hydrationState.kind !== 'notFound' ? (
                        <View testID="automation-editor-public-facts">
                            <ItemGroup>
                                <Item title={definition.name} showChevron={false} />
                                <Item
                                    title={t('automations.detail.overview.statusTitle')}
                                    detail={definition.enabled
                                        ? t('automations.detail.status.active')
                                        : t('automations.detail.status.paused')}
                                    showChevron={false}
                                />
                            </ItemGroup>
                        </View>
                    ) : null}
                    {hydrationState.kind === 'failed' ? (
                        <SurfaceStateCard
                            testID="automation-editor-load-failed"
                            kind="error"
                            title={t('common.error')}
                            reason={t('automations.edit.loadTemplateFailed')}
                            action={{ label: t('common.retry'), onPress: () => setReloadGeneration((value) => value + 1) }}
                            accessibilitySemantics="alert"
                        />
                    ) : hydrationState.kind === 'privateUnavailable' ? (
                        <SurfaceStateCard
                            testID="automation-editor-private-unavailable"
                            kind="unavailable"
                            title={t('automations.edit.loadTemplateFailed')}
                        />
                    ) : hydrationState.kind === 'notFound' ? (
                        <SurfaceStateCard
                            testID="automation-editor-not-found"
                            kind="unavailable"
                            title={t('automations.detail.notFound')}
                        />
                    ) : (
                        <View style={stylesheet.centered}><ActivitySpinner size="small" /></View>
                    )}
                </View>
            </View>
            </ListPresentationProvider>
        );
    }

    return (
        <View style={stylesheet.root}>
            {/* The shared editor owns the keyboard-aware page scroll and the
                pinned Save; a host scroll around it would nest two owners. */}
            <AutomationPluralEditorScreen
                variant="edit"
                leading={stalePrefill ? (
                    <SurfaceStateCard
                        testID="automation-edit-exact-turn-stale"
                        kind="warning"
                        title={t('automations.exactTurn.staleTitle')}
                        reason={t('automations.exactTurn.staleBody')}
                        action={{
                            label: t('automations.exactTurn.useCurrentTurn'),
                            onPress: () => { void adoptCurrentTurn(); },
                        }}
                        accessibilitySemantics="alert"
                    />
                ) : null}
                value={draft}
                onChange={(next) => {
                    setDraft(next);
                    if (next !== hydratedDraftRef.current) setIsDirty(true);
                }}
                sessionOptions={sessionOptions}
                resolveCurrentSessionTurn={(sessionId) => {
                    const candidate = storage.getState().sessions[sessionId];
                    if (!candidate || !isAutomationSessionCandidate(candidate, storage.getState().settings)) return null;
                    const current = readExactActiveParentTurn(candidate);
                    return current ? {
                        sourceSessionId: current.sourceSessionId,
                        sourceTurnId: current.sourceTurnId,
                    } : null;
                }}
                onSessionSelectionStale={() => { void sync.refreshSessions(); }}
                renderPluginEventEditor={(editorProps) => (
                    <PluginEventAutomationEditor
                        key={editorProps.clientId}
                        automationId={requireAutomationEditorDraftIdentity(draft)}
                        clientId={editorProps.clientId}
                        value={editorProps.value}
                        seed={eventEditSeeds.get(editorProps.clientId) ?? null}
                        authoringMachineId={eventAuthoringMachineId}
                        serverId={getActiveServerSnapshot().serverId ?? null}
                        onComplete={editorProps.onComplete}
                        onCancel={editorProps.onCancel}
                    />
                )}
                onSubmit={(submittedDraft) => { void handleSave(submittedDraft); }}
                onCancel={handleCancel}
                submitting={submitting}
                // Derived from the named reason so an inert Save and the
                // sentence beside it cannot disagree.
                submitDisabled={submitBlockedReason !== null}
                submitDisabledReason={submitBlockedReason}
                recipeEditor={workflowDraft === null ? null : savedWorkflowRecipeUnavailable ? (
                    /* The stored workflow definition stays exactly as
                       saved: it is not opened for editing here, and it
                       is never rewritten into a one-shot recipe to make
                       it representable. Automation metadata and
                       triggers remain editable above. */
                    <SurfaceStateCard
                        testID="automation-editor-workflow-recipe-unavailable"
                        kind="unavailable"
                        title={t('workflows.unavailable.title')}
                        reason={t('workflows.unavailable.savedAutomation')}
                    />
                ) : (
                    <>
                        {conversionUnavailable ? (
                            /* The reason is stated, but the conversion
                               offer is not: adopting the workflow
                               contract is exactly what the canonical
                               decision does not authorize. */
                            <SurfaceStateCard
                                testID="automation-editor-workflows-unavailable"
                                kind="warning"
                                title={t('workflows.conversion.title')}
                                reason={t('workflows.unavailable.conversion')}
                                accessibilitySemantics="alert"
                            />
                        ) : conversionRequired ? (
                            <SurfaceStateCard
                                testID="automation-editor-workflow-conversion-required"
                                kind="warning"
                                title={t('workflows.conversion.title')}
                                reason={t('workflows.conversion.body')}
                                action={{
                                    label: t('workflows.conversion.action'),
                                    onPress: () => setConvertToWorkflow(true),
                                }}
                                accessibilitySemantics="alert"
                            />
                        ) : null}
                        {convertToWorkflow && projectUnresolved ? (
                            <SurfaceStateCard
                                testID="automation-editor-workflow-machine-required"
                                kind="warning"
                                title={t('workflows.conversion.title')}
                                reason={t('workflows.conversion.machineRequired')}
                                accessibilitySemantics="alert"
                            />
                        ) : null}
                        <WorkflowEditorBody
                            draft={workflowDraft}
                            authoringFacts={authoringHost.authoringFacts}
                            existingSessions={authoringHost.existingSessions}
                            composerScope={authoringHost.composerScope}
                            onChange={(next) => {
                                setWorkflowDraft(next);
                                if (next !== hydratedWorkflowDraftRef.current) setIsDirty(true);
                            }}
                            machineName={workflowMachineName}
                            projectTarget={projectTarget}
                            {...(workflowRecipeSelected ? {
                                projectMachines: machines,
                                onChangeProjectTarget: changeProjectTarget,
                            } : {})}
                            selectedBlockId={workflowSelection.selectedBlockId}
                            onSelectBlock={(blockId) => setWorkflowSelection((current) => (
                                selectWorkflowBlock(current, blockId)
                            ))}
                            onCustomizeBlock={(blockId) => setWorkflowSelection((current) => (
                                selectWorkflowBlock(current, blockId)
                            ))}
                            inspectorGroupDisclosure={workflowSelection.inspectorGroupDisclosure}
                            onChangeInspectorGroup={(groupId, expanded) => setWorkflowSelection((current) => (
                                setWorkflowInspectorGroupExpanded(current, groupId, expanded)
                            ))}
                            view={workflowView}
                            onChangeView={setWorkflowView}
                            showNameField={false}
                            testIDPrefix="automation-workflow-definition"
                        />
                    </>
                )}
            />
        </View>
    );
}
