import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import {
    AutomationSourceSelectorIdV1Schema,
    type AutomationDefinitionDetail,
    type AutomationTriggerDefinitionInput,
} from '@happier-dev/protocol';

import { AutomationPluralEditorScreen } from '@/components/automations/editor/AutomationPluralEditorScreen';
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
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { Modal } from '@/modal';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { isAutomationApiErrorCode } from '@/sync/api/automations/apiAutomations';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import {
    automationEditorDraftFromDetail,
    createAutomationEditorLifetimeIdentity,
    isAutomationEditorLifetimeIdentityCurrent,
    createAutomationEditorTriggerClientId,
    requireAutomationEditorDraftIdentity,
    shouldValidateAutomationEditorLifecycleTrigger,
    type AutomationEditorDraft,
    type AutomationEditorTriggerDefinitionSeed,
} from '@/sync/domains/automations/automationEditorDraft';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { captureSessionAutomationAuthority } from '@/sync/domains/automations/sessionAutomationAuthority';
import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage, useActiveServerAccountScope, useAutomation, useSessions, useSettings } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { navigateWithBlurOnWeb } from '@/utils/platform/deferOnWeb';
import {
    type ActiveUnsavedChangesGuard,
    runUnsavedChangesGuard,
} from '@/utils/navigation/runGuardedNavigation';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { promptUnsavedChangesAlert } from '@/utils/ui/promptUnsavedChangesAlert';
import { getSessionName } from '@/utils/sessions/sessionUtils';

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
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

function appendExactTurnPrefill(
    draft: AutomationEditorDraft,
    prefill: ExactTurnAutomationPrefill | null,
): AutomationEditorDraft {
    if (!prefill) return draft;
    if (draft.triggers.some((trigger) => (
        trigger.definition?.kind === 'sessionLifecycle'
        && trigger.definition.sourceSessionId === prefill.sourceSessionId
        && trigger.definition.policy.kind === 'currentTurn'
        && trigger.definition.policy.sourceTurnId === prefill.sourceTurnId
    ))) return draft;
    return {
        ...draft,
        triggers: [...draft.triggers, {
            clientId: createAutomationEditorTriggerClientId(),
            persisted: null,
            definition: {
                kind: 'sessionLifecycle',
                enabled: true,
                sourceSessionId: prefill.sourceSessionId,
                events: ['parentTurnCompleted'],
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
            draft.executionRecipe.target.kind === 'existingSession'
            && draft.executionRecipe.target.sessionId === current.sourceSessionId
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
    const [draft, setDraft] = React.useState<AutomationEditorDraft | null>(null);
    const hydratedDraftRef = React.useRef<AutomationEditorDraft | null>(null);
    const [isDirty, setIsDirty] = React.useState(false);
    const isDirtyRef = React.useRef(false);
    const [draftLifetimeIdentity, setDraftLifetimeIdentity] = React.useState<string | null>(null);
    const latestDraftRef = React.useRef(draft);
    latestDraftRef.current = draft;
    const [loadError, setLoadError] = React.useState(false);
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
        setLoadError(false);
        setDraft(null);
        hydratedDraftRef.current = null;
        isDirtyRef.current = false;
        setIsDirty(false);
        setDraftLifetimeIdentity(null);
        setEventEditSeeds(new Map());
        setStalePrefill(null);
        void (async () => {
            const credentials = sync.getCredentials();
            if (!credentials || !accountLifetime) throw new Error('Automation Account is unavailable');
            const capturedIdentity = createAutomationEditorLifetimeIdentity(
                accountLifetime.scope,
                props.automationId,
            );
            if (capturedIdentity !== editorLifetimeIdentity) return;
            const refreshed = await sync.refreshAutomationDefinitionDetail(props.automationId);
            const mode = await fetchAccountEncryptionMode(credentials);
            if (!alive || !accountLifetime.isCurrent() || !refreshed || refreshed.detail.kind !== 'available') return;
            const access: PluginEventAutomationStoredContentAccess = mode.mode === 'plain'
                ? { mode: 'plain' }
                : { mode: 'e2ee', material: resolveAccountScopedCryptoMaterialFromCredentials(credentials) };
            const seeds = buildTriggerSeeds({ definition: refreshed, access });
            const hydrated = seeds
                ? automationEditorDraftFromDetail(refreshed.detail.value, seeds)
                : null;
            if (!hydrated) throw new Error('Automation definition is unavailable');
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
                hydratedDraftRef.current = withPrefill;
                isDirtyRef.current = false;
                setIsDirty(false);
                setDraft(withPrefill);
            }
        })().catch(() => {
            if (alive && accountLifetime?.isCurrent()) setLoadError(true);
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
        selectable: draft?.executionRecipe.target.kind !== 'existingSession'
            || draft.executionRecipe.target.sessionId !== session.id,
    })), [activeServer.serverId, draft?.executionRecipe.target, sessions, settings]);
    const eventAuthoringMachineId = React.useMemo(() => (
        draft?.assignments.find((assignment) => assignment.enabled)?.machineId
        ?? draft?.assignments[0]?.machineId
        ?? null
    ), [draft?.assignments]);

    const handleSave = React.useCallback(async (): Promise<boolean> => {
        const capturedDraft = latestDraftRef.current;
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
        const isCurrent = () => mountedRef.current
            && accountLifetime.isCurrent()
            && capturedDraftLifetimeIdentity === editorLifetimeIdentity
            && exactTurnAuthorityIsCurrent()
            && lifecycleAuthoritiesAreCurrent()
            && latestDraftRef.current === capturedDraft;
        setSubmitting(true);
        try {
            const saved = await sync.saveAutomationEditorDraft(capturedDraft, { isCurrent });
            if (isCurrent()) {
                isDirtyRef.current = false;
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
                await Modal.alert(t('common.error'), error instanceof Error ? error.message : t('automations.edit.updateFailed'));
            }
        } finally {
            if (mountedRef.current) setSubmitting(false);
        }
        return false;
    }, [draftLifetimeIdentity, editorLifetimeIdentity, exactTurnAuthority, exactTurnBinding, props.automationId, router, submitting]);

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
        isDirtyRef.current = false;
        setIsDirty(false);
    }, []);
    const unsavedChangesGuard = React.useMemo<ActiveUnsavedChangesGuard>(() => ({
        isDirtyRef,
        requestDecision: requestUnsavedChangesDecision,
        onDiscard: discardDraft,
        onSave: handleSave,
        continueOnSave: false,
        tag: 'AutomationEditorHostScreen.beforeRemove',
    }), [discardDraft, handleSave, requestUnsavedChangesDecision]);
    const continueNavigation = React.useCallback((action: unknown) => {
        const dispatch = (navigation as { dispatch?: (nextAction: unknown) => void } | null)?.dispatch;
        if (action && typeof dispatch === 'function') {
            dispatch(action);
            return;
        }
        router.back();
    }, [navigation, router]);
    useUnsavedChangesBeforeRemoveGuard({
        isDirty,
        isDirtyRef,
        requestDecision: requestUnsavedChangesDecision,
        onDiscard: discardDraft,
        onSave: handleSave,
        continueOnSave: false,
        onContinue: continueNavigation,
        tag: unsavedChangesGuard.tag,
    });
    useActiveUnsavedChangesGuard({
        navigation,
        guard: unsavedChangesGuard,
        enabled: isDirty,
    });
    const handleCancel = React.useCallback(() => {
        void runUnsavedChangesGuard(unsavedChangesGuard, () => router.back());
    }, [router, unsavedChangesGuard]);

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
        const captured = latestDraftRef.current;
        if (!captured) return;
        const appended = appendExactTurnPrefill(captured, current);
        const replacement = replaceLifecycleRowsWithCurrentTurns(appended);
        if (!replacement) {
            await Modal.alert(t('automations.exactTurn.staleTitle'), t('automations.exactTurn.staleBody'));
            return;
        }
        setDraft(replacement);
        isDirtyRef.current = replacement !== hydratedDraftRef.current;
        setIsDirty(isDirtyRef.current);
        setStalePrefill(null);
        setExactTurnBinding(current);
        // Route params remain URL truth only; the mounted draft above was the
        // mutation owner, so no hydration may re-run from this change.
        router.setParams(buildExactTurnAutomationRouteParams(current));
    }, [router, stalePrefill]);

    if (!draft || draftLifetimeIdentity !== editorLifetimeIdentity) {
        return (
            <View style={stylesheet.root}>
                <View style={stylesheet.content}>
                    {loadError ? (
                        <SurfaceStateCard
                            kind="error"
                            title={t('common.error')}
                            reason={t('automations.edit.loadTemplateFailed')}
                            action={{ label: t('common.retry'), onPress: () => setReloadGeneration((value) => value + 1) }}
                            accessibilitySemantics="alert"
                        />
                    ) : (
                        <View style={stylesheet.centered}><ActivitySpinner size="small" /></View>
                    )}
                </View>
            </View>
        );
    }

    return (
        <View style={stylesheet.root}>
            <ItemList style={{ paddingTop: 0 }}>
                <View style={stylesheet.content}>
                    {stalePrefill ? (
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
                    <AutomationPluralEditorScreen
                        variant="edit"
                        value={draft}
                        onChange={(next) => {
                            setDraft(next);
                            if (next !== hydratedDraftRef.current) {
                                isDirtyRef.current = true;
                                setIsDirty(true);
                            }
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
                        onSubmit={() => { void handleSave(); }}
                        onCancel={handleCancel}
                        submitting={submitting}
                        submitDisabled={!draft.name.trim()}
                    />
                </View>
            </ItemList>
        </View>
    );
}
