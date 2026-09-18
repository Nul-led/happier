import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { buildBackendTargetKeyV2 } from '@happier-dev/protocol';
import { TeamCredentialProviderModelSelectionV1Schema, type TeamCredentialProviderModelSelectionV1 } from '@happier-dev/protocol/teams';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getEnabledAgentIds } from '@/agents/catalog/enabled';
import { useResumeCapabilityOptions } from '@/agents/hooks/useResumeCapabilityOptions';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useMachineCapabilitiesCache } from '@/hooks/server/useMachineCapabilitiesCache';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSessionExecutionRunLaunchability } from '@/hooks/session/useSessionExecutionRunLaunchability';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import {
    isSessionRouteHydrationAvailable,
    isSessionRouteHydrationMissing,
    type SessionRouteHydrationState,
} from '@/sync/domains/session/sessionRouteHydrationState';
import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { createDefaultActionExecutor } from '@/sync/ops/actions/defaultActionExecutor';
import { useSettings } from '@/sync/domains/state/storage';
import { loadAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import { settingsDefaults, settingsParse } from '@/sync/domains/settings/settings';
import { useAccountSettingsScope } from '@/sync/store/settingsWriters';
import { areAccountSettingsScopesEqual } from '@/sync/domains/settings/scope/accountSettingsScope';
import { useServerCredentialAccountScopeBindings } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { buildExecutionRunsGuidanceBlock, coerceExecutionRunsGuidanceEntries } from '@/sync/domains/settings/executionRunsGuidance';
import { resolveSessionMachineId } from '@/sync/domains/session/external/resolveSessionMachineId';
import { resolveActionExecutionFailureMessage } from '@/sync/ops/actions/resolveActionExecutionFailureMessage';
import { ensureExecutionRunHostSessionActive } from './ensureExecutionRunHostSessionActive';
import { t } from '@/text';
import { resolveActionInputValidationError } from '@/sync/domains/actions/resolveActionInputValidationError';
import { resolveExecutionRunLauncherContainerStyle } from './resolveExecutionRunLauncherContainerStyle';
import { buildExecutionRunActionDraftInputForUi } from '@/sync/domains/actions/buildExecutionRunActionDraftInputForUi';
import {
    resolveSessionActionDefaultBackend,
    resolveSessionActionDefaultTarget,
} from '@/sync/domains/session/resolveSessionActionDefaultBackend';
import { getValueAtPath } from '@/components/sessions/actions/ActionInputFields';
import { useDaemonMergedProjectionInputs } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { randomUUID } from '@/platform/randomUUID';
import { createUiExecutionRunActionDeps } from '@/sync/ops/actions/executionRunActionDeps';

import {
    EXECUTION_RUN_LAUNCH_INTENTS,
    resolveExecutionRunLauncherActionId,
    type ExecutionRunIntent,
} from './executionRunLauncherModel';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { useExecutionRunLauncherOptionsModel } from './useExecutionRunLauncherOptionsModel';
import { ExecutionRunLauncherOptions } from './ExecutionRunLauncherOptions';
import { useHomeTeamCredentialModelCatalog } from '@/hooks/teams/useHomeTeamCredentialModelCatalog';
import { SessionModelPicker } from '@/components/sessions/modelPicker/SessionModelPicker';
import { useTeamCredentialSelectionCoordinator } from '@/components/sessions/teamCredentials/useTeamCredentialSelectionCoordinator';
import { resourceHasAvailableTeamCredentialProviderModel } from '@/components/sessions/teamCredentials/teamCredentialProviderModelCurrentness';
import { Modal } from '@/modal';
import {
    ExecutionRunSecretReferenceOverlayField,
    resolveExecutionRunSessionLaunchProfile,
    type ExecutionRunSecretReferenceOverlayState,
} from './ExecutionRunSecretReferenceOverlayField';

export { resolveInitialExecutionRunBackendTargetKey } from './resolveExecutionRunLauncherBackendChoices';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
    },
    section: {
        gap: 8,
    },
    label: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        fontWeight: '600',
    },
    actionRow: {
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface.inset,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
    },
    primaryActionText: {
        color: theme.colors.text.primary,
        fontWeight: '600',
    },
    secondaryActionText: {
        color: theme.colors.text.secondary,
        fontWeight: '600',
    },
    errorText: {
        color: theme.colors.status?.error ?? theme.colors.state.danger.foreground ?? theme.colors.text.primary,
    },
    guidanceLabel: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        fontWeight: '600',
    },
    guidanceText: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        fontFamily: 'Menlo',
    },
}));

type SessionExecutionRunLauncherViewProps = Readonly<{
    sessionId: string;
    /** Exact Home owning this Session when mounted from a qualified route/pane. */
    serverId?: string | null;
    scopeId?: string;
    initialIntent?: ExecutionRunIntent;
    presentation?: 'screen' | 'panel';
    onRequestClose?: () => void;
    routeHydrationState?: SessionRouteHydrationState;
}>;

type SessionExecutionRunLauncherContentProps = Omit<SessionExecutionRunLauncherViewProps, 'routeHydrationState'> & Readonly<{
    routeHydrationState: SessionRouteHydrationState;
}>;

const SessionExecutionRunLauncherContent = React.memo((props: SessionExecutionRunLauncherContentProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const interactiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const interactiveTargetStyle = React.useMemo(() => ({
        minWidth: interactiveTargetSize,
        minHeight: interactiveTargetSize,
    }), [interactiveTargetSize]);
    const hydrateReady = isSessionRouteHydrationAvailable(props.routeHydrationState);
    const hydrateMissing = isSessionRouteHydrationMissing(props.routeHydrationState);
    const explicitServerId = typeof props.serverId === 'string' && props.serverId.trim().length > 0
        ? props.serverId.trim()
        : null;
    const preferredServerId = usePreferredServerIdForSession({
        serverId: explicitServerId,
        sessionId: props.sessionId,
    });
    const expectedServerId = preferredServerId;
    const session = useSessionViewShellSession(props.sessionId, expectedServerId);
    const { canLaunchExecutionRuns, canShowExecutionRunLauncher, executionRunsBackends, sessionServerId } =
        useSessionExecutionRunLaunchability(props.sessionId, session, expectedServerId);
    const activeSettings = useSettings();
    const activeSettingsScope = useAccountSettingsScope();
    const requestedServerIds = React.useMemo(() => [sessionServerId], [sessionServerId]);
    const accountBindings = useServerCredentialAccountScopeBindings(requestedServerIds);
    const accountBinding = React.useMemo(() => [...accountBindings.values()][0] ?? null, [accountBindings]);
    const exactSettings = React.useMemo(() => {
        if (!accountBinding?.isCurrent()) return null;
        if (activeSettingsScope && areAccountSettingsScopesEqual(activeSettingsScope, accountBinding.scope)) {
            return activeSettings;
        }
        const persisted = loadAccountSettings(accountBinding.scope);
        return persisted.version === null ? null : settingsParse(persisted.settings);
    }, [accountBinding, activeSettings, activeSettingsScope]);
    const settings = exactSettings ?? settingsDefaults;
    const credentialResourcesEnabled = useFeatureEnabled('teams.credentialResources', {
        scopeKind: 'spawn',
        serverId: sessionServerId,
    });
    const sharedSavedSecretsEnabled = useFeatureEnabled('teams', {
        scopeKind: 'spawn',
        serverId: sessionServerId,
    });
    const enabledAgentIds = React.useMemo(() => getEnabledAgentIds({
        backendEnabledByTargetKey: settings.backendEnabledByTargetKey,
    }), [settings.backendEnabledByTargetKey]);
    const { machineReachable } = useSessionMachineReachability(props.sessionId, sessionServerId);
    const machineTarget = useSessionMachineTarget(props.sessionId, sessionServerId);
    const machineId = React.useMemo(
        () => machineTarget?.machineId ?? resolveSessionMachineId((session as any)?.metadata),
        [machineTarget?.machineId, (session as any)?.metadata],
    );
    const agentId = React.useMemo(
        () => {
            const fromMetadata = resolveAgentIdFromSessionMetadata((session as any)?.metadata);
            if (fromMetadata) return fromMetadata;
            const agent = typeof (session as any)?.metadata?.agent === 'string'
                ? (session as any).metadata.agent.trim()
                : '';
            return agent || null;
        },
        [session],
    );
    const { resumeCapabilityOptions } = useResumeCapabilityOptions({
        agentId,
        machineId,
        serverId: sessionServerId,
        settings,
        enabled: session?.active === false,
    });
    const { state: machineCapabilitiesState } = useMachineCapabilitiesCache({
        machineId,
        enabled: Boolean(machineId),
        ...(sessionServerId ? { serverId: sessionServerId } : {}),
        request: { requests: [{ id: 'tool.executionRuns', params: { sessionId: props.sessionId } }] } as any,
    });

    const initialIntent = props.initialIntent ?? 'review';
    const sessionActionDefaultBackend = React.useMemo(
        () => resolveSessionActionDefaultBackend({
            session,
            enabledAgentIds,
            fallbackAgentId: agentId ?? undefined,
        }),
        [agentId, enabledAgentIds, session],
    );
    const [intent, setIntent] = React.useState<ExecutionRunIntent>(initialIntent);
    const initialBackendTarget = React.useMemo(
        () => resolveSessionActionDefaultTarget(sessionActionDefaultBackend),
        [sessionActionDefaultBackend],
    );
    const initialDefaultBackendId = sessionActionDefaultBackend?.defaultBackendId ?? null;
    const [isStarting, setIsStarting] = React.useState(false);
    const [startError, setStartError] = React.useState<string | null>(null);
    const [secretOverlayState, setSecretOverlayState] = React.useState<ExecutionRunSecretReferenceOverlayState>({
        readiness: { ok: true },
    });
    const sessionLaunchProfile = React.useMemo(
        () => resolveExecutionRunSessionLaunchProfile(settings, (session as any)?.metadata),
        [session, settings],
    );

    const daemonMergedProjection = useDaemonMergedProjectionInputs({
        machineId,
        serverId: sessionServerId ?? null,
        enabled: Boolean(machineId),
        staleMs: 60_000,
    });

    const buildSeedInput = React.useCallback((nextIntent: ExecutionRunIntent, previousInput?: Record<string, unknown> | null) => {
        const actionId = resolveExecutionRunLauncherActionId(nextIntent);
        const previousInstructions = typeof getValueAtPath(previousInput ?? {}, 'instructions') === 'string'
            ? String(getValueAtPath(previousInput ?? {}, 'instructions'))
            : '';
        return buildExecutionRunActionDraftInputForUi({
            actionId: actionId as any,
            sessionId: props.sessionId,
            defaultBackendTarget: nextIntent === 'review' ? null : initialBackendTarget,
            defaultBackendId: initialDefaultBackendId,
            instructions: previousInstructions,
        });
    }, [initialBackendTarget, initialDefaultBackendId, props.sessionId]);

    const [actionInput, setActionInput] = React.useState<Record<string, unknown>>(() => buildSeedInput(initialIntent));
    const launcherOptions = useExecutionRunLauncherOptionsModel({
        sessionId: props.sessionId,
        intent,
        actionInput,
        setActionInput,
        singleTarget: intent !== 'review',
        enabledAgentIds,
        executionRunsBackends,
        acpCatalogSettingsV1: settings.acpCatalogSettingsV1,
        initialBackendTarget,
        fallbackAgentId: sessionActionDefaultBackend?.defaultAgentId ?? agentId,
        machineCapabilitiesState,
        mergedBackendProjectionById: daemonMergedProjection.inputs?.mergedBackendProjectionById ?? null,
        mergedProviderProjectionById: daemonMergedProjection.inputs?.mergedProviderProjectionById ?? null,
    });
    const {
        actionId,
        actionSpec,
        fields,
        profileChoices,
        selectedProfileId,
        selectedProfileChoice,
        selectedProfileMatchesSelectedBackend,
    } = launcherOptions;
    const selectedTeamCredentialModel = React.useMemo(() => {
        const parsed = TeamCredentialProviderModelSelectionV1Schema.safeParse(actionInput.teamCredentialModel);
        return parsed.success ? parsed.data : null;
    }, [actionInput.teamCredentialModel]);
    const selectedAgentTargetKey = launcherOptions.selectedBackendChoice
        ? buildBackendTargetKeyV2(launcherOptions.selectedBackendChoice.backendTarget)
        : null;
    const teamCredentialCatalog = useHomeTeamCredentialModelCatalog({
        serverId: sessionServerId,
        enabled: credentialResourcesEnabled && Boolean(sessionServerId && selectedAgentTargetKey),
    });
    const teamCredentialCatalogRef = React.useRef(teamCredentialCatalog);
    teamCredentialCatalogRef.current = teamCredentialCatalog;
    const coordinateTeamCredentialSelection = useTeamCredentialSelectionCoordinator(sessionServerId);
    const selectedTeamCredentialModelAvailable = React.useMemo(() => {
        if (!selectedTeamCredentialModel) return true;
        if (!teamCredentialCatalog.current) return false;
        if (!teamCredentialCatalog.currentResourceKeys.has(
            `${selectedTeamCredentialModel.teamId}:${selectedTeamCredentialModel.resourceId}`,
        )) return false;
        const resource = teamCredentialCatalog.resources.find((candidate) => (
            candidate.id === selectedTeamCredentialModel.resourceId
            && candidate.teamId === selectedTeamCredentialModel.teamId
        ));
        return resource
            ? resourceHasAvailableTeamCredentialProviderModel(resource, selectedTeamCredentialModel)
            : false;
    }, [selectedTeamCredentialModel, teamCredentialCatalog.current, teamCredentialCatalog.currentResourceKeys, teamCredentialCatalog.resources]);
    const visibleFields = React.useMemo(() => fields.filter((field) => (
        field.path !== 'teamCredentialModel'
        && field.path !== 'teamCredentialSessionBindingConsent'
        && field.path !== 'secretReferenceOverlay'
        && (!selectedTeamCredentialModel || field.path !== 'modelId')
    )), [fields, selectedTeamCredentialModel]);

    React.useEffect(() => {
        if (!selectedTeamCredentialModel || launcherOptions.backendChoices.length === 0) return;
        if (selectedAgentTargetKey === selectedTeamCredentialModel.agentTargetKey) return;
        setActionInput((previous) => {
            const next = { ...previous };
            delete next.teamCredentialModel;
            delete next.teamCredentialSessionBindingConsent;
            if (next.modelId === selectedTeamCredentialModel.modelId) delete next.modelId;
            return next;
        });
    }, [launcherOptions.backendChoices.length, selectedAgentTargetKey, selectedTeamCredentialModel]);

    const onSelectTeamCredentialModel = React.useCallback(async (selection: TeamCredentialProviderModelSelectionV1) => {
        const resourceKey = `${selection.teamId}:${selection.resourceId}`;
        const selectedResource = teamCredentialCatalog.resources.find((resource) => (
            resource.teamId === selection.teamId
            && resource.id === selection.resourceId
            && resource.resourceRevision === selection.expectedResourceRevision
        ));
        if (!selectedResource
            || !teamCredentialCatalog.current
            || !teamCredentialCatalog.currentResourceKeys.has(resourceKey)
            || !resourceHasAvailableTeamCredentialProviderModel(selectedResource, selection)) return;
        const outcome = await coordinateTeamCredentialSelection({
            resource: selectedResource,
            deliveryMode: selection.deliveryMode,
            selection,
            isCurrent: () => teamCredentialCatalogRef.current.current
                && teamCredentialCatalogRef.current.currentResourceKeys.has(resourceKey)
                && teamCredentialCatalogRef.current.resources.some((resource) => (
                    resource.teamId === selection.teamId
                    && resource.id === selection.resourceId
                    && resourceHasAvailableTeamCredentialProviderModel(resource, selection)
                )),
        });
        if (outcome.kind !== 'continue') return;
        if (outcome.consequence.visibilityRequirement === 'team_visibility_required') {
            const confirmed = await Modal.confirm(
                t('teams.credentials.usePolicy.label'),
                t('teams.credentials.usePolicy.visibilityNote'),
                { confirmText: t('common.continue'), cancelText: t('common.cancel') },
            );
            if (!confirmed) return;
        }
        const stillCurrent = teamCredentialCatalogRef.current.current
            && teamCredentialCatalogRef.current.currentResourceKeys.has(resourceKey)
            && teamCredentialCatalogRef.current.resources.some((resource) => (
                resource.teamId === selection.teamId
                && resource.id === selection.resourceId
                && resourceHasAvailableTeamCredentialProviderModel(resource, selection)
            ));
        if (!stillCurrent) return;
        setStartError(null);
        setActionInput((previous) => {
            const next: Record<string, unknown> = {
                ...previous,
                teamCredentialModel: outcome.selection,
                modelId: outcome.selection.modelId,
                ...(outcome.consequence.visibilityRequirement === 'team_visibility_required'
                    ? {
                        teamCredentialSessionBindingConsent: {
                            v: 1,
                            sessionId: props.sessionId,
                            teamId: outcome.selection.teamId,
                            resourceId: outcome.selection.resourceId,
                            expectedResourceRevision: outcome.selection.expectedResourceRevision,
                        },
                    }
                    : {}),
            };
            if (outcome.consequence.visibilityRequirement !== 'team_visibility_required') {
                delete next.teamCredentialSessionBindingConsent;
            }
            delete next.modelSelection;
            return next;
        });
    }, [coordinateTeamCredentialSelection, props.sessionId, teamCredentialCatalog.current, teamCredentialCatalog.currentResourceKeys, teamCredentialCatalog.resources]);
    const onSelectNonTeamModel = React.useCallback((selection: unknown) => {
        if (selection !== null) return;
        setStartError(null);
        setActionInput((previous) => {
            const next = { ...previous };
            delete next.teamCredentialModel;
            delete next.teamCredentialSessionBindingConsent;
            delete next.modelId;
            return next;
        });
    }, []);

    const guidancePreview = React.useMemo(() => {
        if ((settings as any).executionRunsGuidanceEnabled !== true) return '';
        const maxCharsRaw = (settings as any).executionRunsGuidanceMaxChars;
        const maxChars = typeof maxCharsRaw === 'number' && Number.isFinite(maxCharsRaw) ? Math.floor(maxCharsRaw) : 4_000;
        const entries = coerceExecutionRunsGuidanceEntries((settings as any).executionRunsGuidanceEntries);
        return buildExecutionRunsGuidanceBlock({ entries, maxChars: Math.min(maxChars, 2_000) }).text;
    }, [settings]);

    const actionExecutor = React.useMemo(
        () => createDefaultActionExecutor({
            resolveServerIdForSessionId: () => sessionServerId,
        }),
        [sessionServerId],
    );
    const executionRunActionDeps = React.useMemo(() => createUiExecutionRunActionDeps(), []);
    const [launchSubmissionIdentity] = React.useState(() => randomUUID());
    const waitingForExecutionRunCapabilities = React.useMemo(() => {
        if (canShowExecutionRunLauncher !== true) return false;
        if (canLaunchExecutionRuns === true) return false;
        if (executionRunsBackends && Object.keys(executionRunsBackends).length > 0) return false;
        return machineCapabilitiesState.status === 'idle' || machineCapabilitiesState.status === 'loading';
    }, [
        canLaunchExecutionRuns,
        canShowExecutionRunLauncher,
        executionRunsBackends,
        machineCapabilitiesState.status,
    ]);
    const validationError = React.useMemo(
        () => resolveActionInputValidationError({
            sessionId: props.sessionId,
            input: actionInput,
            spec: actionSpec as any,
            fields: fields as any,
        }),
        [actionInput, actionSpec, fields, props.sessionId],
    );
    const canStart = exactSettings !== null
        && validationError === null
        && selectedTeamCredentialModelAvailable
        && secretOverlayState.readiness.ok
        && !isStarting
        && (!selectedProfileId || (
            selectedProfileChoice?.disabled === false && selectedProfileMatchesSelectedBackend
        ));

    const onSelectProfile = React.useCallback((choice: (typeof profileChoices)[number]) => {
        setStartError(null);
        launcherOptions.onSelectProfile(choice);
    }, [launcherOptions]);

    const onSelectIntent = React.useCallback((nextIntent: ExecutionRunIntent) => {
        setStartError(null);
        setIntent(nextIntent);
        setActionInput(buildSeedInput(nextIntent, actionInput));
    }, [actionInput, buildSeedInput]);

    const closeSurface = React.useCallback(() => {
        props.onRequestClose?.();
    }, [props]);

    const onStart = React.useCallback(async () => {
        if (!canStart) {
            if (validationError) setStartError(validationError);
            return;
        }
        setStartError(null);
        setIsStarting(true);
        try {
            const requiresSecretOverlay = secretOverlayState.overlay !== undefined;
            const requiresTeamCredentialModel = selectedTeamCredentialModel !== null;
            let admittedMachineId: string | undefined;
            if (requiresSecretOverlay || requiresTeamCredentialModel) {
                const capability = await executionRunActionDeps.executionRunCheckProtocolV2?.(
                    props.sessionId,
                    {
                        detachedScope: false,
                        startAndWait: false,
                        exactInputResults: false,
                        runScopedAgentBindings: requiresTeamCredentialModel,
                        secretReferenceOverlay: requiresSecretOverlay,
                    },
                    {
                        ...(sessionServerId ? { serverId: sessionServerId } : {}),
                        ...(machineId ? { targetMachineId: machineId } : {}),
                    },
                );
                if (!capability) {
                    setStartError('execution_run_target_unavailable');
                    return;
                }
                if (capability.ok === false) {
                    setStartError(requiresSecretOverlay
                        && capability.errorCode === 'execution_run_protocol_unsupported'
                        ? 'execution_run_secret_reference_overlay_update_required'
                        : capability.error);
                    return;
                }
                if (capability.exactMachineId !== machineId) {
                    setStartError('execution_run_target_unavailable');
                    return;
                }
                admittedMachineId = capability.exactMachineId;
            }
            if (session?.active === false) {
                const resumeResult = await ensureExecutionRunHostSessionActive({
                    sessionId: props.sessionId,
                    session,
                    machineReachable,
                    resumeCapabilityOptions,
                    sessionActionDefaultBackend,
                    agentId,
                    settings,
                    serverId: sessionServerId,
                    readinessOperationId: launchSubmissionIdentity,
                    ...(admittedMachineId ? { expectedMachineId: admittedMachineId } : {}),
                });
                if (!resumeResult.ok) {
                    setStartError(resumeResult.reason === 'machine_offline'
                        ? t('session.machineOfflineCannotResume')
                        : resumeResult.error ?? t('session.resumeFailed'));
                    return;
                }
            }

            const result = await actionExecutor.execute(
                actionId as any,
                {
                    sessionId: props.sessionId,
                    ...actionInput,
                    ...(secretOverlayState.overlay
                        ? { secretReferenceOverlay: secretOverlayState.overlay }
                        : {}),
                },
                {
                    defaultSessionId: props.sessionId,
                    ...(sessionServerId ? { serverId: sessionServerId } : {}),
                },
            );

            const errorMessage = resolveActionExecutionFailureMessage(result, t('common.requestFailed'));
            if (errorMessage) {
                setStartError(errorMessage);
                return;
            }

            if (props.presentation === 'panel') {
                closeSurface();
                return;
            }

            router.push(buildScopedSessionRouteHref({
                sessionId: props.sessionId,
                serverId: sessionServerId,
                suffix: '/runs',
            }) as any);
        } catch (error) {
            setStartError(error instanceof Error && error.message.trim().length > 0 ? error.message : t('common.requestFailed'));
        } finally {
            setIsStarting(false);
        }
    }, [
        actionExecutor,
        agentId,
        canStart,
        closeSurface,
        intent,
        machineReachable,
        machineId,
        launchSubmissionIdentity,
        sessionServerId,
        props.presentation,
        props.sessionId,
        resumeCapabilityOptions,
        router,
        actionId,
        actionInput,
        session,
        settings,
        secretOverlayState.overlay,
        selectedTeamCredentialModel,
        executionRunActionDeps.executionRunCheckProtocolV2,
        validationError,
    ]);

    if (hydrateMissing) {
        return <Text style={styles.label}>{t('common.unavailable')}</Text>;
    }

    if (!hydrateReady) {
        return <ActivitySpinner size="small" color={theme.colors.text.secondary} />;
    }

    if (waitingForExecutionRunCapabilities) {
        return <ActivitySpinner size="small" color={theme.colors.text.secondary} />;
    }

    if (!canLaunchExecutionRuns) {
        return <Text style={styles.label}>{t('common.unavailable')}</Text>;
    }

    return (
        <View style={[styles.container, resolveExecutionRunLauncherContainerStyle(props.presentation)]}>
            <View style={styles.section}>
                <Text style={styles.label}>{t('executionRuns.newRun.sections.intent')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {EXECUTION_RUN_LAUNCH_INTENTS.map((nextIntent) => {
                        const intentLabel = t(`executionRuns.newRun.intents.${nextIntent}` as const);
                        const selected = intent === nextIntent;
                        return (
                            <Pressable
                                key={nextIntent}
                                testID={`execution-run-launcher-intent:${nextIntent}`}
                                accessibilityRole="button"
                                accessibilityLabel={t('executionRuns.newRun.a11y.selectIntent', { intent: intentLabel })}
                                accessibilityState={{ selected, disabled: isStarting }}
                                disabled={isStarting}
                                onPress={() => onSelectIntent(nextIntent)}
                                style={({ pressed }) => ({
                                    ...interactiveTargetStyle,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingVertical: 8,
                                    paddingHorizontal: 10,
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border.default,
                                    backgroundColor: theme.colors.surface.inset,
                                    opacity: pressed ? 0.7 : 1,
                                })}
                            >
                                <Text style={{ color: selected ? theme.colors.text.primary : theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                                    {intentLabel}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <View style={styles.section}>
                <ExecutionRunLauncherOptions
                    backendChoices={launcherOptions.backendChoices}
                    selectedBackendTargetKeys={launcherOptions.selectedBackendTargetKeys}
                    profileChoices={launcherOptions.profileChoices}
                    selectedProfileId={launcherOptions.selectedProfileId}
                    selectedProfileGenerationId={launcherOptions.selectedProfileGenerationId}
                    selectedPermissionMode={launcherOptions.selectedPermissionMode}
                    permissionModeOptions={launcherOptions.visiblePermissionModeOptions}
                    fields={visibleFields}
                    input={actionInput}
                    editable={!isStarting}
                    resolveFieldOptions={launcherOptions.resolveFieldOptions}
                    includeInstructions
                    onSelectBackend={(targetKey) => {
                        setStartError(null);
                        launcherOptions.onSelectBackend(targetKey);
                    }}
                    onSelectProfile={onSelectProfile}
                    onPatch={(patch) => {
                        setStartError(null);
                        launcherOptions.onPatch(patch);
                    }}
                />
                <ExecutionRunSecretReferenceOverlayField
                    profile={sessionLaunchProfile}
                    machineId={machineId}
                    serverId={sessionServerId}
                    accountScope={accountBinding?.scope ?? null}
                    defaultBindings={sessionLaunchProfile
                        ? settings.currentSecretBindingsByProfileId[sessionLaunchProfile.id] ?? null
                        : null}
                    personalSecrets={settings.secrets}
                    sharedEnabled={sharedSavedSecretsEnabled}
                    editable={!isStarting}
                    onChange={setSecretOverlayState}
                />
            </View>

            {selectedAgentTargetKey && (
                teamCredentialCatalog.resources.length > 0 || selectedTeamCredentialModel
            ) ? (
                <View style={styles.section}>
                    <SessionModelPicker
                        agentTargetKey={selectedAgentTargetKey}
                        nativeModels={[{
                            value: 'default',
                            label: t('settingsAgents.defaultModelTitle'),
                        }]}
                        providerGroups={[]}
                        teamCredentialResources={teamCredentialCatalog.resources}
                        teamNameById={teamCredentialCatalog.teamNameById}
                        homeNameByTeamId={teamCredentialCatalog.homeNameByTeamId}
                        currentTeamCredentialResourceKeys={teamCredentialCatalog.currentResourceKeys}
                        selectedTeamCredentialModel={selectedTeamCredentialModel}
                        providerProjectionAuthoritative
                        selected={null}
                        effectiveLabel=""
                        showTitle={false}
                        onSelect={onSelectNonTeamModel}
                        onSelectTeamCredentialModel={onSelectTeamCredentialModel}
                    />
                </View>
            ) : null}

            <View style={styles.actionRow}>
                <Pressable
                    testID="execution-run-new-start-button"
                    accessibilityRole="button"
                    accessibilityLabel={t('executionRuns.newRun.a11y.startRun')}
                    accessibilityState={{ disabled: !canStart, busy: isStarting }}
                    onPress={() => void onStart()}
                    disabled={!canStart}
                    style={({ pressed }) => [styles.actionButton, interactiveTargetStyle, { opacity: !canStart ? 0.5 : pressed ? 0.7 : 1 }]}
                >
                    <Text style={styles.primaryActionText}>
                        {isStarting ? `${t('executionRuns.newRun.actions.start')}…` : t('executionRuns.newRun.actions.start')}
                    </Text>
                </Pressable>
                <Pressable
                    testID="execution-run-new-cancel-button"
                    accessibilityRole="button"
                    accessibilityLabel={t('executionRuns.newRun.a11y.cancel')}
                    accessibilityState={{ disabled: false, busy: false }}
                    onPress={closeSurface}
                    style={({ pressed }) => [styles.actionButton, interactiveTargetStyle, { opacity: pressed ? 0.7 : 1 }]}
                >
                    <Text style={styles.secondaryActionText}>
                        {props.presentation === 'panel' ? t('common.close') : t('common.cancel')}
                    </Text>
                </Pressable>
            </View>

            {startError ?? validationError ? <Text style={styles.errorText}>{startError ?? validationError}</Text> : null}

            {guidancePreview ? (
                <View style={styles.section}>
                    <Text style={styles.guidanceLabel}>{t('executionRuns.newRun.guidancePreview')}</Text>
                    <Text style={styles.guidanceText}>{guidancePreview}</Text>
                </View>
            ) : null}
        </View>
    );
});

const SessionExecutionRunLauncherOwnHydration = React.memo((props: Omit<SessionExecutionRunLauncherViewProps, 'routeHydrationState'>) => {
    const routeHydrationState = useHydrateSessionForRoute(
        props.sessionId,
        'SessionExecutionRunLauncherView.hydrate',
        props.serverId ? { serverId: props.serverId } : undefined,
    );
    return <SessionExecutionRunLauncherContent {...props} routeHydrationState={routeHydrationState} />;
});

export const SessionExecutionRunLauncherView = React.memo((props: SessionExecutionRunLauncherViewProps) => {
    const { routeHydrationState, ...launcherProps } = props;
    if (routeHydrationState) {
        return <SessionExecutionRunLauncherContent {...launcherProps} routeHydrationState={routeHydrationState} />;
    }
    return <SessionExecutionRunLauncherOwnHydration {...launcherProps} />;
});
