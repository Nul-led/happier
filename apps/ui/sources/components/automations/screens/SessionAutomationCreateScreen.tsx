import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AutomationTriggerEditor } from '@/components/automations/editor/AutomationPluralEditorScreen';
import { PluginEventAutomationEditor } from '@/components/automations/editor/PluginEventAutomationEditor';
import { readExactActiveParentTurn } from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { ExistingSessionAutomationAuthoringSurface } from '@/components/automations/shared/ExistingSessionAutomationAuthoringSurface';
import { getExistingSessionAutomationUnavailableReason } from '@/components/automations/shared/existingSessionAutomationAvailabilityUi';
import { layout } from '@/components/ui/layout/layout';
import { ItemList } from '@/components/ui/lists/ItemList';
import { refreshExistingSessionAuthoringDraftFromSessionSnapshot } from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import { useSessionAuthoringDraftState } from '@/components/sessions/authoring/draft/useSessionAuthoringDraftState';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { Modal } from '@/modal';
import {
    createAutomationEditorAutomationId,
    createAutomationEditorLifetimeIdentity,
    isAutomationEditorLifetimeIdentityCurrent,
    type AutomationEditorDraft,
    type AutomationTriggerEditorValue,
} from '@/sync/domains/automations/automationEditorDraft';
import { buildAutomationRecipeFromSessionAuthoring } from '@/sync/domains/automations/automationRecipeAuthoring';
import { captureSessionAutomationAuthority } from '@/sync/domains/automations/sessionAutomationAuthority';
import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { resolveExistingSessionAutomationAvailability } from '@/sync/domains/automations/existingSessionAutomationAvailability';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { isSessionRouteHydrationAvailable } from '@/sync/domains/session/sessionRouteHydrationState';
import {
    storage,
    useActiveServerAccountScope,
    useSession,
    useSessions,
    useSettings,
} from '@/sync/domains/state/storage';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { sync } from '@/sync/sync';
import { isAutomationApiErrorCode } from '@/sync/api/automations/apiAutomations';
import { t } from '@/text';
import { navigateWithBlurOnWeb } from '@/utils/platform/deferOnWeb';
import {
    type ActiveUnsavedChangesGuard,
} from '@/utils/navigation/runGuardedNavigation';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { promptUnsavedChangesAlert } from '@/utils/ui/promptUnsavedChangesAlert';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { formatAutomationErrorMessage } from '@/components/automations/automationErrorFormatting';

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.background.canvas },
}));

type SessionAutomationTriggerDraft = AutomationTriggerEditorValue & Readonly<{
    /** Stable definition identity shared by plugin setup and response-loss rejoin. */
    pendingAutomationId: string;
}>;

function initialEditorDraft(): SessionAutomationTriggerDraft {
    return {
        pendingAutomationId: createAutomationEditorAutomationId(),
        removedTriggers: [],
        enabled: true,
        name: t('automations.create.defaultName'),
        description: null,
        triggers: [],
    };
}

function replaceWithCurrentExactTurns(
    draft: SessionAutomationTriggerDraft,
    targetSessionId: string,
): SessionAutomationTriggerDraft | null {
    let changed = false;
    let available = true;
    const triggers = draft.triggers.map((trigger) => {
        const definition = trigger.definition;
        if (definition?.kind !== 'sessionLifecycle' || definition.policy.kind !== 'currentTurn') return trigger;
        if (definition.sourceSessionId === targetSessionId) {
            available = false;
            return trigger;
        }
        const exact = readExactActiveParentTurn(storage.getState().sessions[definition.sourceSessionId]);
        if (!exact) {
            available = false;
            return trigger;
        }
        if (exact.sourceTurnId === definition.policy.sourceTurnId) return trigger;
        changed = true;
        return {
            ...trigger,
            definition: {
                ...definition,
                policy: { ...definition.policy, sourceTurnId: exact.sourceTurnId },
            },
        };
    });
    return available && changed ? { ...draft, triggers } : null;
}

export function SessionAutomationCreateScreen(props: Readonly<{
    sessionId: string;
    hydrationOptions?: Readonly<{ serverId?: string; forceRefresh?: boolean }>;
}>) {
    useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const routeHydrationState = useHydrateSessionForRoute(
        props.sessionId,
        'SessionAutomationCreateScreen.hydrateTargetSession',
        props.hydrationOptions,
    );
    const sessionHydrated = isSessionRouteHydrationAvailable(routeHydrationState);
    const session = useSession(props.sessionId);
    const sessions = useSessions() ?? [];
    const settings = useSettings();
    const activeAccountScope = useActiveServerAccountScope();
    const editorLifetimeIdentity = activeAccountScope
        && session?.serverId === activeAccountScope.serverId
        ? createAutomationEditorLifetimeIdentity(activeAccountScope, `${props.sessionId}:new`)
        : null;
    const support = useAutomationsSupport({ scopeKind: 'spawn', serverId: session?.serverId ?? null });
    const supportRef = React.useRef(support.enabled);
    supportRef.current = support.enabled;
    const { draft, setDraft, latestDraftRef } = useSessionAuthoringDraftState();
    const [editorDraft, setEditorDraft] = React.useState<SessionAutomationTriggerDraft>(initialEditorDraft);
    const [editorDraftLifetimeIdentity, setEditorDraftLifetimeIdentity] = React.useState<string | null>(
        () => editorLifetimeIdentity,
    );
    const latestEditorRef = React.useRef(editorDraft);
    latestEditorRef.current = editorDraft;
    const [submitting, setSubmitting] = React.useState(false);
    const submittingRef = React.useRef(false);

    // Unsaved-changes guard basis. Both route-local draft stores — the Session
    // authoring draft and the trigger/metadata editor draft — are compared with
    // their clean route baselines; no second draft store is introduced and the
    // incumbent beforeRemove owner consumes the derived dirty fact.
    const routeBaselineRef = React.useRef<SessionAutomationTriggerDraft | null>(null);
    if (routeBaselineRef.current === null) routeBaselineRef.current = initialEditorDraft();
    const [createCommitted, setCreateCommitted] = React.useState(false);
    const routeDraftDirty = React.useMemo(() => {
        if (createCommitted) return false;
        if (Boolean(draft?.prompt.trim())) return true;
        const baseline = routeBaselineRef.current;
        if (!baseline) return false;
        return editorDraft.name !== baseline.name
            || editorDraft.description !== baseline.description
            || editorDraft.enabled !== baseline.enabled
            || editorDraft.triggers.length > 0
            || editorDraft.removedTriggers.length > 0;
    }, [createCommitted, draft?.prompt, editorDraft]);
    const isDirtyRef = React.useRef(false);
    isDirtyRef.current = routeDraftDirty;

    React.useEffect(() => {
        if (editorDraftLifetimeIdentity === editorLifetimeIdentity) return;
        setEditorDraft(initialEditorDraft());
        setEditorDraftLifetimeIdentity(editorLifetimeIdentity);
    }, [editorDraftLifetimeIdentity, editorLifetimeIdentity, props.sessionId]);

    const sessionDekBase64 = sync.getSessionEncryptionKeyBase64ForResume(props.sessionId);
    const machineIdOverride = readMachineControlTargetForSession(props.sessionId)?.machineId ?? null;
    const availability = React.useMemo(() => resolveExistingSessionAutomationAvailability({
        sessionHydrated,
        session,
        machineIdOverride,
        sessionDekBase64,
        accountSettings: settings,
    }), [machineIdOverride, session, sessionDekBase64, sessionHydrated, settings]);
    const machineId = availability.kind === 'ready' ? availability.machineId : null;

    React.useEffect(() => {
        if (!session) return;
        setDraft((current) => refreshExistingSessionAuthoringDraftFromSessionSnapshot({
            session,
            currentDraft: current,
            sessionDekBase64,
            fallbackAutomationDraft: {
                enabled: latestEditorRef.current.enabled,
                name: latestEditorRef.current.name,
                description: latestEditorRef.current.description ?? '',
                triggers: latestEditorRef.current.triggers.flatMap((trigger) => (
                    trigger.definition
                        ? [{ clientId: trigger.clientId, definition: trigger.definition }]
                        : []
                )),
            },
        }));
    }, [session, sessionDekBase64, setDraft]);

    const sessionOptions = React.useMemo(() => sessions
        .filter((candidate) => (
            candidate.serverId === session?.serverId
            && candidate.id !== props.sessionId
            && isAutomationSessionCandidate(candidate, settings)
        ))
        .map((candidate) => ({
            sessionId: candidate.id,
            label: getSessionName(candidate),
            currentParentTurnId: readExactActiveParentTurn(candidate)?.sourceTurnId ?? null,
        })), [props.sessionId, session?.serverId, sessions, settings]);
    const isValid = support.enabled
        && availability.kind === 'ready'
        && editorDraftLifetimeIdentity === editorLifetimeIdentity
        && editorLifetimeIdentity !== null
        && Boolean(session && machineId && draft?.prompt.trim() && editorDraft.name.trim());

    const handleCreate = React.useCallback(async (): Promise<boolean> => {
        if (submittingRef.current) return false;
        const accountLifetime = captureActiveServerAccountScopeLifetime();
        const capturedEditorLifetimeIdentity = editorDraftLifetimeIdentity;
        const authority = captureSessionAutomationAuthority({
            session: storage.getState().sessions[props.sessionId] ?? null,
            routeSessionId: props.sessionId,
            routeServerId: props.hydrationOptions?.serverId ?? null,
            activeServerId: getActiveServerSnapshot().serverId,
            automationsEnabled: supportRef.current,
            accountSettings: storage.getState().settings,
            accountLifetime,
            readCurrent: () => ({
                session: storage.getState().sessions[props.sessionId] ?? null,
                routeSessionId: props.sessionId,
                routeServerId: props.hydrationOptions?.serverId ?? null,
                activeServerId: getActiveServerSnapshot().serverId,
                automationsEnabled: supportRef.current,
                accountSettings: storage.getState().settings,
            }),
        });
        const currentDraft = latestDraftRef.current;
        const currentEditor = latestEditorRef.current;
        if (
            !authority
            || !currentDraft
            || !machineId
            || !currentDraft.prompt.trim()
            || !currentEditor.name.trim()
            || !capturedEditorLifetimeIdentity
            || capturedEditorLifetimeIdentity !== editorLifetimeIdentity
            || !isAutomationEditorLifetimeIdentityCurrent(
                capturedEditorLifetimeIdentity,
                accountLifetime?.scope ?? null,
                `${props.sessionId}:new`,
            )
        ) return false;
        submittingRef.current = true;
        setSubmitting(true);
        const sourceDefinitions = currentEditor.triggers.flatMap((trigger) => (
            trigger.definition?.kind === 'sessionLifecycle' && trigger.definition.policy.kind === 'currentTurn'
                ? [{
                    definition: trigger.definition,
                    sourceTurnId: trigger.definition.policy.sourceTurnId,
                }]
                : []
        ));
        const sourceAuthorities = sourceDefinitions.flatMap(({ definition, sourceTurnId }) => {
            if (definition.sourceSessionId === props.sessionId) return [];
            const sourceSessionId = definition.sourceSessionId;
            const sourceAuthority = captureSessionAutomationAuthority({
                session: storage.getState().sessions[sourceSessionId] ?? null,
                routeSessionId: sourceSessionId,
                routeServerId: session?.serverId ?? null,
                activeServerId: getActiveServerSnapshot().serverId,
                automationsEnabled: supportRef.current,
                accountSettings: storage.getState().settings,
                accountLifetime,
                readCurrent: () => ({
                    session: storage.getState().sessions[sourceSessionId] ?? null,
                    routeSessionId: sourceSessionId,
                    routeServerId: session?.serverId ?? null,
                    activeServerId: getActiveServerSnapshot().serverId,
                    automationsEnabled: supportRef.current,
                    accountSettings: storage.getState().settings,
                }),
            });
            return sourceAuthority ? [{
                authority: sourceAuthority,
                sourceSessionId,
                sourceTurnId,
            }] : [];
        });
        const sourceTurnsMatchDraft = sourceAuthorities.length === sourceDefinitions.length
            && sourceAuthorities.every((entry) => (
                readExactActiveParentTurn(
                    storage.getState().sessions[entry.sourceSessionId],
                )?.sourceTurnId === entry.sourceTurnId
            ));
        if (!sourceTurnsMatchDraft) {
            const replacement = replaceWithCurrentExactTurns(currentEditor, props.sessionId);
            if (replacement && await Modal.confirm(
                t('automations.exactTurn.staleTitle'),
                t('automations.exactTurn.staleBody'),
                { cancelText: t('common.cancel'), confirmText: t('automations.exactTurn.useCurrentTurn') },
            )) setEditorDraft(replacement);
            else if (!replacement) await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
            submittingRef.current = false;
            setSubmitting(false);
            return false;
        }
        const isCurrent = () => authority.isCurrent()
            && capturedEditorLifetimeIdentity === editorLifetimeIdentity
            && latestDraftRef.current === currentDraft
            && latestEditorRef.current === currentEditor
            // Pre-request eligibility above already proved every lifecycle row
            // matched the live exact turn. The response lifetime must not
            // re-read the turn: a completion that reaches the transcript after
            // the server commit is authoritative settled truth, not a reason
            // to reject the committed save.
            && sourceAuthorities.every((entry) => entry.authority.isCurrent());
        try {
            const encryption = sync.encryption;
            const recipe = await buildAutomationRecipeFromSessionAuthoring({
                credentials: sync.getCredentials(),
                templateVersion: 1,
                prompt: currentDraft.prompt.trim(),
                target: { kind: 'existingSession', sessionId: props.sessionId },
                ...(encryption
                    ? { encryptRaw: (value: unknown) => encryption.encryptAutomationTemplateRaw(value) }
                    : {}),
                isCurrent,
            });
            const saveDraft: AutomationEditorDraft = {
                ...currentEditor,
                automationId: null,
                expectedTemplateVersion: null,
                recipeDirty: true,
                executionRecipe: recipe,
                assignments: [{ machineId, enabled: true, priority: 100 }],
            };
            const saved = await sync.saveAutomationEditorDraft(saveDraft, { isCurrent });
            if (isCurrent()) {
                // The committed create owns navigation to the detail route; the
                // guard must not treat this route as dirty on the way out.
                setCreateCommitted(true);
                navigateWithBlurOnWeb(() => router.replace(`/automations/${saved.id}` as any));
                return true;
            }
            return false;
        } catch (error) {
            const exactTurnStale = isAutomationApiErrorCode(error, 'sourceTurnNotCurrent')
                || isAutomationApiErrorCode(error, 'sourceTurnNotInProgress')
                || isAutomationApiErrorCode(error, 'sourceTurnUnavailable')
                || isAutomationApiErrorCode(error, 'sourceSessionUnavailable')
                || (error instanceof Error && error.message === 'Automation authoring authority changed');
            if (authority.isCurrent() && exactTurnStale && latestEditorRef.current === currentEditor) {
                const replacement = replaceWithCurrentExactTurns(currentEditor, props.sessionId);
                if (replacement && await Modal.confirm(
                    t('automations.exactTurn.staleTitle'),
                    t('automations.exactTurn.staleBody'),
                    { cancelText: t('common.cancel'), confirmText: t('automations.exactTurn.useCurrentTurn') },
                )) setEditorDraft(replacement);
                else if (!replacement) await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
            } else if (authority.isCurrent()) {
                await Modal.alert(t('common.error'), formatAutomationErrorMessage(error, t('automations.create.createFailed')));
            }
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
        return false;
    }, [
        editorDraftLifetimeIdentity,
        editorLifetimeIdentity,
        latestDraftRef,
        machineId,
        props.hydrationOptions?.serverId,
        props.sessionId,
        router,
        session?.serverId,
    ]);

    // The incumbent unsaved-changes-before-remove owner, exactly as the edit
    // route uses it: browser/edge/header route removal is prevented while any
    // route-local draft edit is unsaved, global navigation surfaces consult the
    // active guard, and the offered save IS the create action (continueOnSave:
    // false because a committed create navigates to the detail itself).
    const requestUnsavedChangesDecision = React.useCallback(() => promptUnsavedChangesAlert(
        (title, message, buttons) => Modal.alert(title, message, buttons),
        {
            title: t('common.discardChanges'),
            message: t('common.unsavedChangesWarning'),
            discardText: t('common.discard'),
            saveText: t('common.save'),
            keepEditingText: t('common.keepEditing'),
        },
    ), []);
    const discardDraft = React.useCallback(() => {
        // The incumbent guard has already cleared isDirtyRef before this runs;
        // the abandoned drafts die with the route that is being removed.
        isDirtyRef.current = false;
    }, []);
    const continueNavigation = React.useCallback((action: unknown) => {
        const dispatch = (navigation as { dispatch?: (nextAction: unknown) => void } | null)?.dispatch;
        if (action && typeof dispatch === 'function') {
            dispatch(action);
            return;
        }
        router.back();
    }, [navigation, router]);
    const unsavedChangesGuard = React.useMemo<ActiveUnsavedChangesGuard>(() => ({
        isDirtyRef,
        requestDecision: requestUnsavedChangesDecision,
        onDiscard: discardDraft,
        onSave: handleCreate,
        continueOnSave: false,
        tag: 'SessionAutomationCreateScreen.beforeRemove',
    }), [discardDraft, handleCreate, requestUnsavedChangesDecision]);
    useUnsavedChangesBeforeRemoveGuard({
        isDirty: routeDraftDirty,
        isDirtyRef,
        requestDecision: requestUnsavedChangesDecision,
        onDiscard: discardDraft,
        onSave: handleCreate,
        continueOnSave: false,
        onContinue: continueNavigation,
        tag: unsavedChangesGuard.tag,
    });
    useActiveUnsavedChangesGuard({
        navigation,
        guard: unsavedChangesGuard,
        enabled: routeDraftDirty,
    });

    const missingReason = React.useMemo(() => getExistingSessionAutomationUnavailableReason(availability), [availability]);
    return (
        <View style={stylesheet.container}>
            {/* The authoring surface is a form with focusable name, description,
                prompt, and trigger fields, so it uses the list's shared native
                keyboard owner instead of letting the keyboard cover them. */}
            <ItemList style={{ paddingTop: 0 }} keyboardAware>
                <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                    <ExistingSessionAutomationAuthoringSurface
                        formVariant="create"
                        session={session}
                        draft={draft}
                        onChangeDraft={setDraft}
                        availability={availability}
                        isWaiting={availability.kind === 'hydrating'}
                        unavailableReason={missingReason}
                        onSubmit={() => { void handleCreate(); }}
                        submitAccessibilityLabel={t('automations.create.createButtonTitle')}
                        isSubmitDisabled={!isValid || submitting}
                        editable={!submitting}
                        automationEditor={editorDraftLifetimeIdentity === editorLifetimeIdentity && editorLifetimeIdentity !== null ? (
                            <AutomationTriggerEditor
                                value={editorDraft}
                                onChange={(next) => setEditorDraft((current) => ({
                                    ...(current.pendingAutomationId === editorDraft.pendingAutomationId
                                        ? next
                                        : current),
                                    pendingAutomationId: current.pendingAutomationId,
                                }))}
                                sessionOptions={sessionOptions}
                                resolveCurrentSessionTurn={(sessionId) => {
                                    const candidate = storage.getState().sessions[sessionId];
                                    if (!candidate || !isAutomationSessionCandidate(candidate, storage.getState().settings)) return null;
                                    const exact = readExactActiveParentTurn(candidate);
                                    return exact ? { sourceSessionId: exact.sourceSessionId, sourceTurnId: exact.sourceTurnId } : null;
                                }}
                                onSessionSelectionStale={() => { void sync.refreshSessions(); }}
                                renderPluginEventEditor={(editorProps) => (
                                    <PluginEventAutomationEditor
                                        key={editorProps.clientId}
                                        automationId={editorDraft.pendingAutomationId}
                                        clientId={editorProps.clientId}
                                        value={editorProps.value}
                                        seed={null}
                                        authoringMachineId={machineId}
                                        serverId={session?.serverId ?? null}
                                        onComplete={editorProps.onComplete}
                                        onCancel={editorProps.onCancel}
                                    />
                                )}
                                submitting={submitting}
                            />
                        ) : null}
                    />
                </View>
            </ItemList>
        </View>
    );
}
