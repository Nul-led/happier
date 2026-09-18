import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';

import { formatAutomationErrorMessage } from '@/components/automations/automationErrorFormatting';
import { AutomationTriggerEditor } from '@/components/automations/editor/AutomationPluralEditorScreen';
import { PluginEventAutomationEditor } from '@/components/automations/editor/PluginEventAutomationEditor';
import { readExactActiveParentTurn } from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { layout } from '@/components/ui/layout/layout';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { useWorkflowsAvailability } from '@/components/workflows/gating/workflowsAvailability';
import { Modal } from '@/modal';
import {
    createAutomationEditorAutomationId,
    createAutomationEditorTriggerClientId,
    type AutomationEditorDraft,
    type AutomationTriggerEditorValue,
} from '@/sync/domains/automations/automationEditorDraft';
import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { storage, useActiveServerAccountScope, useAllMachines, useSessions, useSettings } from '@/sync/domains/state/storage';
import { buildAutomationWorkflowRecipe } from '@/sync/domains/workflows/automationWorkflowRecipe';
import {
    buildWorkflowScheduleSeed,
    type WorkflowScheduleSeed,
} from '@/sync/domains/workflows/workflowScheduleSeed';
import { projectEditorDraftToNewSessionAutomationRecipe } from '@/sync/domains/workflows/automationRecipeWorkflowDraft';
import { buildAutomationRecipeFromSessionAuthoring } from '@/sync/domains/automations/automationRecipeAuthoring';
import {
    buildWorkflowEditorDraftFromDefinition,
    firstBlockingWorkflowIssue,
    validateWorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowAuthoring';
import { describeWorkflowCommandBlockedReason } from '../presentation/workflowBlockedReasonText';
import {
    createWorkflowEditorDraft,
    EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    selectWorkflowBlock,
    type WorkflowEditorDraft,
    type WorkflowEditorViewState,
} from '@/sync/domains/workflows/workflowEditorDraft';
import type { NewSessionAutomationHandoffSeed } from '@/sync/domains/workflows/newSessionAutomationHandoffSeed';
import { pluginJsonValuesEqual, type AutomationTriggerDefinitionInput } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { navigateWithBlurOnWeb } from '@/utils/platform/deferOnWeb';
import { useUnsavedDraftNavigationGuard } from '@/utils/navigation/useUnsavedDraftNavigationGuard';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

import { WorkflowEditorBody, type WorkflowEditorView } from './WorkflowEditorBody';
import { useWorkflowAuthoringHost } from './useWorkflowAuthoringHost';

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    content: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        gap: theme.margins.xl,
    },
}));

const DEFAULT_SCHEDULE_TRIGGER: AutomationTriggerDefinitionInput = {
    kind: 'schedule',
    enabled: true,
    schedule: {
        kind: 'interval',
        scheduleExpr: null,
        everyMs: 60 * 60_000,
        timezone: null,
    },
};

function initialTriggerDraft(params: Readonly<{
    name: string;
    description: string | null;
    enabled: boolean;
    triggers: ReadonlyArray<AutomationTriggerDefinitionInput>;
}>): AutomationTriggerEditorValue {
    return {
        removedTriggers: [],
        name: params.name,
        description: params.description,
        enabled: params.enabled,
        triggers: (params.triggers.length > 0 ? params.triggers : [DEFAULT_SCHEDULE_TRIGGER]).map((definition) => ({
            clientId: createAutomationEditorTriggerClientId(),
            persisted: null,
            definition,
        })),
    };
}

/**
 * The one Automation create wrapper.
 *
 * Ordinary creation, the New Session Automation handoff, exact-turn creation
 * and a reviewed Schedule copy all compose the same controlled Workflow editor
 * body with the incumbent trigger editor; this screen owns only Automation
 * metadata/triggers and delegates the frozen recipe envelope plus the durable
 * write to their existing canonical owners.
 */
export function WorkflowAutomationCreateScreen(props: Readonly<{
    /** A reviewed Schedule copy; its definition and provenance are immutable. */
    seed?: WorkflowScheduleSeed | null;
    /** The composed New Session draft transferred by the Automation chip. */
    handoff?: NewSessionAutomationHandoffSeed | null;
    /** Trigger inputs the entry point already established, such as an exact turn. */
    initialTriggers?: ReadonlyArray<AutomationTriggerDefinitionInput>;
}>): React.ReactElement {
    const router = useRouter();
    const navigation = useNavigation();
    const sessions = useSessions() ?? [];
    const machines = useAllMachines();
    const settings = useSettings();
    // The seed contains already-open Account-private content. Bind it to the
    // Account lifetime that mounted the wrapper; a later Account switch must
    // not let those bytes be saved with the new Account's credentials.
    const [scopeLifetime] = React.useState(captureActiveServerAccountScopeLifetime);
    // …and the wrapper must say so. Holding the lifetime alone left the previous
    // Account's reviewed workflow and triggers on screen behind a Save that
    // silently did nothing, which reads as a broken button rather than as
    // content that no longer belongs to this Account.
    const activeAccountScope = useActiveServerAccountScope();
    const [mountedAccountScopeKey] = React.useState(
        () => (activeAccountScope === null ? null : serverAccountScopeKeySuffix(activeAccountScope)),
    );
    const activeAccountScopeKey = activeAccountScope === null
        ? null
        : serverAccountScopeKeySuffix(activeAccountScope);
    const seedRetired = activeAccountScopeKey !== mountedAccountScopeKey;
    const [pendingAutomationId] = React.useState(createAutomationEditorAutomationId);
    const [draft, setDraft] = React.useState(() => initialTriggerDraft({
        name: props.seed?.name ?? props.handoff?.name ?? '',
        description: props.handoff?.description ?? null,
        enabled: props.handoff?.enabled ?? true,
        triggers: props.initialTriggers
            ?? (props.handoff?.triggers ?? []).flatMap((trigger) => (
                trigger.definition ? [trigger.definition] : []
            )),
    }));
    // What this page opened with, so an untouched page never claims unsaved work.
    // A route-driven retarget below advances this baseline with the draft: URL
    // truth is not authored work and must not make Back prompt.
    const initialTriggerDraftRef = React.useRef(draft);
    const [isDirty, setIsDirty] = React.useState(false);
    const initialTriggerBindingsRef = React.useRef({
        definitions: props.initialTriggers ?? [],
        clientIds: draft.triggers.slice(0, props.initialTriggers?.length ?? 0).map((trigger) => trigger.clientId),
    });
    React.useEffect(() => {
        const nextDefinitions = props.initialTriggers ?? [];
        const previous = initialTriggerBindingsRef.current;
        if (pluginJsonValuesEqual(previous.definitions, nextDefinitions)) return;
        setDraft((current) => {
            const retargeted: AutomationTriggerEditorValue = {
                ...current,
                triggers: current.triggers.map((trigger) => {
                const bindingIndex = previous.clientIds.indexOf(trigger.clientId);
                if (bindingIndex < 0) return trigger;
                const prior = previous.definitions[bindingIndex];
                const next = nextDefinitions[bindingIndex];
                const authored = trigger.definition;
                // A retained Event row carries no authored definition yet; only
                // an exact-turn lifecycle row can be retargeted.
                if (authored === null || authored === undefined) return trigger;
                if (
                    prior?.kind !== 'sessionLifecycle'
                    || prior.policy.kind !== 'currentTurn'
                    || next?.kind !== 'sessionLifecycle'
                    || next.policy.kind !== 'currentTurn'
                    || authored.kind !== 'sessionLifecycle'
                    || authored.policy.kind !== 'currentTurn'
                    || prior.sourceSessionId !== next.sourceSessionId
                    || authored.sourceSessionId !== prior.sourceSessionId
                ) return trigger;
                return {
                    ...trigger,
                    definition: {
                        ...authored,
                        policy: { ...authored.policy, sourceTurnId: next.policy.sourceTurnId },
                    },
                };
                }),
            };
            // The retarget is route truth layered onto whatever is authored, so
            // the pristine baseline advances with it: an untouched page stays
            // clean, and real authored edits above it stay dirty.
            if (initialTriggerDraftRef.current === current) initialTriggerDraftRef.current = retargeted;
            return retargeted;
        });
        initialTriggerBindingsRef.current = {
            definitions: nextDefinitions,
            clientIds: previous.clientIds,
        };
    }, [props.initialTriggers]);
    const [workflowDraft, setWorkflowDraft] = React.useState<WorkflowEditorDraft>(() => {
        const draftId = `workflow-${pendingAutomationId}`;
        if (props.seed) {
            return buildWorkflowEditorDraftFromDefinition({
                draftId,
                name: props.seed.name,
                definition: props.seed.definition,
            });
        }
        // The handoff already carries the composed prompt and selections; an
        // ordinary create starts at the same empty one-step draft the neutral
        // editor uses.
        return props.handoff
            ? { ...props.handoff.draft, draftId }
            : createWorkflowEditorDraft({ draftId });
    });
    const initialWorkflowDraftRef = React.useRef(workflowDraft);
    const [projectTarget, setProjectTarget] = React.useState<WorkflowProjectTargetV1 | null>(
        () => props.seed?.project ?? props.handoff?.project ?? null,
    );
    const initialProjectTargetRef = React.useRef(projectTarget);
    const [workflowView, setWorkflowView] = React.useState<WorkflowEditorView>('steps');
    const [workflowSelection, setWorkflowSelection] = React.useState<WorkflowEditorViewState>(
        EMPTY_WORKFLOW_EDITOR_VIEW_STATE,
    );
    const workflows = useWorkflowsAvailability();
    const [submitting, setSubmitting] = React.useState(false);
    const submittingRef = React.useRef(false);
    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    const activeServerId = getActiveServerSnapshot().serverId;
    const machineName = React.useMemo(() => {
        const machineId = projectTarget?.machineId ?? null;
        if (machineId === null) return null;
        const machine = machines.find((candidate) => candidate.id === machineId);
        return machine === undefined ? machineId : getMachineDisplayName(machine);
    }, [machines, projectTarget?.machineId]);
    // The same host adapter the neutral editor uses, so a scheduled workflow
    // offers the same Agent options and prompt reference scope.
    const authoringHost = useWorkflowAuthoringHost({
        projectTarget,
        serverId: activeServerId ?? null,
    });
    const projectUnresolved = projectTarget === null || projectTarget.directory.trim().length === 0;
    const workflowValidation = React.useMemo(
        () => validateWorkflowEditorDraft(workflowDraft),
        [workflowDraft],
    );
    // Creation reaches the managed workflow recipe only for a draft the released
    // one-shot arm cannot express. Probing that here names the first change that
    // needs the workflow format, so the consequence is stated before Save.
    const oneShotWriteBackProbe = React.useMemo(() => (
        projectTarget === null || projectTarget.directory.trim().length === 0
            ? null
            : projectEditorDraftToNewSessionAutomationRecipe({
                draft: workflowDraft,
                project: projectTarget,
                serverId: activeServerId ?? '',
                // Representability only; the committed write stamps its own time.
                configurationUpdatedAtMs: 0,
            })
    ), [activeServerId, projectTarget, workflowDraft]);
    // An empty prompt is ordinary repairable authoring, not a workflow need.
    const workflowRecipeRequired = (props.seed !== null && props.seed !== undefined)
        || (
            oneShotWriteBackProbe?.kind === 'unavailable'
            && oneShotWriteBackProbe.reason !== 'prompt_required'
        );
    // The canonical Workflows decision is the sole authority for structured
    // Workflow authoring. Automations alone never authorizes it, so the
    // Workflow-only expansion states its reason and stays unsaved instead of
    // writing a v2 recipe Workflow Run admission would reject.
    const workflowRecipeUnavailable = workflowRecipeRequired && !workflows.available;
    /**
     * The exact blocker Create is refused for, named once.
     *
     * Every term is a fact this screen already resolved; nothing is revalidated
     * here, and the boolean is derived from this so an inert Create and the
     * sentence beside it cannot disagree.
     */
    const submitBlockedReason = React.useMemo<string | null>(() => {
        if (!draft.name.trim()) return t('workflows.save.nameRequired');
        // The canonical key the shared trigger editor's own add row uses; the
        // former `automations.addTrigger` is not a defined string.
        if (draft.triggers.length === 0) return t('automations.pluralEditor.addTrigger');
        if (workflowRecipeUnavailable) return t('workflows.unavailable.conversion');
        if (projectUnresolved) return t('workflows.editor.targetRequired');
        return describeWorkflowCommandBlockedReason({
            reason: workflowValidation.valid ? null : 'definition_invalid',
            blockingIssue: firstBlockingWorkflowIssue(workflowValidation),
        });
    }, [
        draft.name,
        draft.triggers.length,
        projectUnresolved,
        workflowRecipeUnavailable,
        workflowValidation,
    ]);
    const sessionOptions = React.useMemo(() => sessions
        .filter((session) => (
            session.serverId === activeServerId
            && isAutomationSessionCandidate(session, settings)
        ))
        .map((session) => ({
            sessionId: session.id,
            label: getSessionName(session),
            currentParentTurnId: readExactActiveParentTurn(session)?.sourceTurnId ?? null,
        })), [activeServerId, sessions, settings]);

    const handleCreate = React.useCallback(async (
        submitted: AutomationTriggerEditorValue,
    ): Promise<boolean> => {
        if (submittingRef.current) return false;
        if (!scopeLifetime?.isCurrent()) return false;
        const credentials = sync.getCredentials();
        if (!credentials) return false;
        submittingRef.current = true;
        setSubmitting(true);
        const isCurrent = () => mountedRef.current && scopeLifetime.isCurrent();
        try {
            if (projectTarget === null || projectTarget.directory.trim().length === 0) {
                await Modal.alert(t('workflows.conversion.title'), t('workflows.conversion.machineRequired'));
                return false;
            }
            // A one-prompt Automation stays a released one-shot recipe: only a
            // draft the one-shot arm cannot express — or an explicitly
            // scheduled workflow copy — becomes a managed workflow recipe.
            if (props.seed === null || props.seed === undefined) {
                const oneShot = projectEditorDraftToNewSessionAutomationRecipe({
                    draft: workflowDraft,
                    project: projectTarget,
                    serverId: activeServerId ?? '',
                    configurationUpdatedAtMs: Date.now(),
                });
                if (oneShot.kind === 'available') {
                    const oneShotRecipe = await buildAutomationRecipeFromSessionAuthoring({
                        credentials,
                        templateVersion: 1,
                        prompt: oneShot.prompt,
                        mentions: oneShot.mentions,
                        target: oneShot.target,
                        ...(sync.encryption ? {
                            encryptRaw: (value: unknown) => sync.encryption!.encryptAutomationTemplateRaw(value),
                        } : {}),
                        isCurrent,
                    });
                    const saved = await sync.saveAutomationEditorDraft({
                        ...submitted,
                        automationId: null,
                        pendingAutomationId,
                        expectedTemplateVersion: null,
                        executionRecipe: oneShotRecipe,
                        assignments: [{ machineId: projectTarget.machineId, enabled: true, priority: 100 }],
                    }, { isCurrent });
                    if (isCurrent()) {
                        setIsDirty(false);
                        navigateWithBlurOnWeb(() => router.replace(`/automations/${saved.id}` as never));
                    }
                    return true;
                }
            }
            // Everything below writes the managed workflow recipe. Refuse it
            // when the canonical Workflows decision does not authorize it: the
            // authored draft is neither saved as a v2 recipe Run admission
            // would reject nor silently downgraded to fit the one-shot arm.
            if (!workflows.available) {
                await Modal.alert(t('workflows.unavailable.title'), t('workflows.unavailable.conversion'));
                return false;
            }
            const origin = props.seed?.origin ?? null;
            const reviewed = buildWorkflowScheduleSeed({
                draft: { ...workflowDraft, name: submitted.name.trim() || workflowDraft.name },
                project: projectTarget,
                saved: origin?.matchesSavedRevision === true
                    ? {
                        definitionId: origin.definitionId,
                        revision: origin.revision,
                        definition: initialWorkflowDraftRef.current,
                    }
                    : null,
            });
            if (reviewed.kind !== 'available') return false;
            const recipe = await buildAutomationWorkflowRecipe({
                credentials,
                automationId: pendingAutomationId,
                templateVersion: 1,
                seed: reviewed.seed,
                ...(sync.encryption ? {
                    encryptRaw: (value: unknown) => sync.encryption!.encryptAutomationTemplateRaw(value),
                } : {}),
                isCurrent,
            });
            const saveDraft: AutomationEditorDraft = {
                ...submitted,
                automationId: null,
                pendingAutomationId,
                expectedTemplateVersion: null,
                executionRecipe: recipe,
                assignments: [{ machineId: projectTarget.machineId, enabled: true, priority: 100 }],
            };
            const saved = await sync.saveAutomationEditorDraft(saveDraft, { isCurrent });
            if (isCurrent()) {
                setIsDirty(false);
                navigateWithBlurOnWeb(() => router.replace(`/automations/${saved.id}` as never));
            }
            return true;
        } catch (error) {
            if (isCurrent()) {
                await Modal.alert(
                    t('common.error'),
                    formatAutomationErrorMessage(error, t('automations.create.createFailed')),
                );
            }
        } finally {
            submittingRef.current = false;
            if (mountedRef.current) setSubmitting(false);
        }
        return false;
    }, [activeServerId, pendingAutomationId, projectTarget, props.seed, router, scopeLifetime, workflowDraft, workflows.available]);

    // Cancel, native Back and every other departure answer one guard, so a
    // reviewed recipe, the Automation name, authored triggers and the chosen
    // project are never discarded without an explicit decision. Save goes
    // through the same eligibility the visible Create uses.
    const guard = useUnsavedDraftNavigationGuard({
        navigation,
        isDirty,
        onDiscard: () => setIsDirty(false),
        onSave: async () => (submitBlockedReason !== null ? false : handleCreate(draft)),
        onLeave: () => router.back(),
        tag: 'WorkflowAutomationCreateScreen.beforeRemove',
    });

    const recipeEditor = (
        <>
            {workflowRecipeUnavailable ? (
                <SurfaceStateCard
                    testID="workflow-automation-create-workflows-unavailable"
                    kind="warning"
                    title={t('workflows.conversion.title')}
                    reason={t('workflows.unavailable.conversion')}
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
                    if (next !== initialWorkflowDraftRef.current) setIsDirty(true);
                }}
                machineName={machineName}
                projectTarget={projectTarget}
                projectMachines={machines}
                onChangeProjectTarget={(next) => {
                    setProjectTarget(next);
                    if (next !== initialProjectTargetRef.current) setIsDirty(true);
                }}
                selectedBlockId={workflowSelection.selectedBlockId}
                onSelectBlock={(blockId) => setWorkflowSelection((current) => (
                    selectWorkflowBlock(current, blockId)
                ))}
                onCustomizeBlock={(blockId) => setWorkflowSelection((current) => (
                    selectWorkflowBlock(current, blockId)
                ))}
                view={workflowView}
                onChangeView={setWorkflowView}
                primaryAction="save"
                showNameField={false}
                testIDPrefix="workflow-schedule-definition"
            />
        </>
    );

    const composed = (
        <View style={stylesheet.root}>
            {/* Create composes the one shared metadata/trigger editor, so its
                recipe sits in the same slot edit uses and both pages read in
                the same order on every viewport. The shared editor owns the
                page scroll and the pinned Create; a host scroll around it
                would nest two owners. */}
            <AutomationTriggerEditor
                value={draft}
                onChange={(next) => {
                    setDraft(next);
                    if (next !== initialTriggerDraftRef.current) setIsDirty(true);
                }}
                onSubmit={(submitted) => { void handleCreate(submitted); }}
                onCancel={guard.requestLeave}
                recipeEditor={recipeEditor}
                sessionOptions={sessionOptions}
                resolveCurrentSessionTurn={(sessionId) => {
                    const session = storage.getState().sessions[sessionId];
                    if (!session || !isAutomationSessionCandidate(session, storage.getState().settings)) return null;
                    return readExactActiveParentTurn(session);
                }}
                onSessionSelectionStale={() => { void sync.refreshSessions(); }}
                renderPluginEventEditor={(editorProps) => (
                    <PluginEventAutomationEditor
                        key={editorProps.clientId}
                        automationId={pendingAutomationId}
                        clientId={editorProps.clientId}
                        value={editorProps.value}
                        seed={null}
                        authoringMachineId={projectTarget?.machineId ?? null}
                        serverId={activeServerId}
                        onComplete={editorProps.onComplete}
                        onCancel={editorProps.onCancel}
                    />
                )}
                submitting={submitting}
                submitDisabled={submitBlockedReason !== null}
                submitDisabledReason={submitBlockedReason}
            />
        </View>
    );

    // The Account that opened this wrapper is gone, and its already-decrypted
    // seed cannot be re-opened under the new one. Retire it outright rather than
    // keeping the previous Account's workflow and triggers visible.
    const body = seedRetired
        ? (
            <View style={stylesheet.root}>
                <ItemList style={{ paddingTop: 0 }} keyboardAware>
                    <View style={stylesheet.content}>
                        <SurfaceStateCard
                            testID="workflow-automation-create-account-changed"
                            kind="unavailable"
                            title={t('workflows.editor.accountChangedTitle')}
                            reason={t('workflows.editor.accountChangedBody')}
                            accessibilitySemantics="status"
                        />
                    </View>
                </ItemList>
            </View>
        )
        : composed;

    // A reviewed Schedule copy is a Workflow definition by construction, so that
    // entry point answers the same canonical gate the Workflow routes use — a
    // resolving decision waits rather than claiming the feature is off. Ordinary
    // and handoff creation stay ungated: their representable one-shot recipe
    // needs only Automations.
    return props.seed ? <WorkflowsGate>{body}</WorkflowsGate> : body;
}
