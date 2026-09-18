import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { readExecutionRunStartRunCreation, type SessionDiscussionSelectionSourceV1 } from '@happier-dev/protocol';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { getEnabledAgentIds } from '@/agents/catalog/enabled';
import { useResumeCapabilityOptions } from '@/agents/hooks/useResumeCapabilityOptions';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useMachineCapabilitiesCache } from '@/hooks/server/useMachineCapabilitiesCache';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSessionExecutionRunLaunchability } from '@/hooks/session/useSessionExecutionRunLaunchability';
import { useDaemonMergedProjectionInputs } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import { createRepositoryComposerDocumentOwner } from '@/components/sessions/composer/repositoryComposerDocumentOwner';
import {
    SessionParticipantComposer,
    type ParticipantComposerPreparedSubmission,
} from '@/components/sessions/participants/composer/SessionParticipantComposer';
import { useSessionBrowserContextRuntimeContext } from '@/components/sessions/browser/sessionBrowserContextRuntime';
import {
    createSessionInputFailureError,
    getSessionInputFailureLabelKey,
} from '@/components/sessions/pending/pendingMessageVisualState';
import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { randomUUID } from '@/platform/randomUUID';
import { useServerCredentialAccountScopeBindings } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    resolveSessionActionDefaultBackend,
    resolveSessionActionDefaultTarget,
} from '@/sync/domains/session/resolveSessionActionDefaultBackend';
import { useSettings } from '@/sync/domains/state/storage';
import { loadAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import { settingsDefaults, settingsParse } from '@/sync/domains/settings/settings';
import { useAccountSettingsScope } from '@/sync/store/settingsWriters';
import { areAccountSettingsScopesEqual } from '@/sync/domains/settings/scope/accountSettingsScope';
import {
    sessionExecutionRunList,
    sessionExecutionRunStart,
} from '@/sync/ops/sessionExecutionRuns';
import { createUiExecutionRunActionDeps } from '@/sync/ops/actions/executionRunActionDeps';
import { writeExistingSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { ensureExecutionRunHostSessionActive } from './ensureExecutionRunHostSessionActive';
import { buildExecutionRunActionDraftInputForUi } from '@/sync/domains/actions/buildExecutionRunActionDraftInputForUi';
import { ExecutionRunLauncherOptions } from './ExecutionRunLauncherOptions';
import { useExecutionRunLauncherOptionsModel } from './useExecutionRunLauncherOptionsModel';
import { resolveRowlessExecutionRunStartOptions } from './resolveRowlessExecutionRunStartOptions';
import {
    ExecutionRunSecretReferenceOverlayField,
    resolveExecutionRunSessionLaunchProfile,
    type ExecutionRunSecretReferenceOverlayState,
} from './ExecutionRunSecretReferenceOverlayField';

type DraftIdentity = Readonly<{ correlationId: string; inputLocalId: string }>;

function createDraftIdentity(): DraftIdentity {
    return { correlationId: randomUUID(), inputLocalId: randomUUID() };
}

export const SessionInteractiveExecutionRunDraftView = React.memo((props: Readonly<{
    sessionId: string;
    serverId?: string | null;
    onRunStarted: (runId: string, recovery?: Readonly<{ retryInputLocalId: string }>) => void;
    initialText?: string;
    launchOrigin?: SessionDiscussionSelectionSourceV1 & Readonly<{ draftCorrelationId: string }>;
}>) => {
    const { theme } = useUnistyles();
    const interactiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const explicitServerId = props.serverId?.trim() || null;
    const preferredServerId = usePreferredServerIdForSession({
        serverId: explicitServerId,
        sessionId: props.sessionId,
    });
    const serverId = preferredServerId;
    const session = useSessionViewShellSession(props.sessionId, serverId);
    const activeSettings = useSettings();
    const activeSettingsScope = useAccountSettingsScope();
    const requestedServerIds = React.useMemo(() => [serverId], [serverId]);
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
    const sharedSavedSecretsEnabled = useFeatureEnabled('teams', {
        scopeKind: 'spawn',
        serverId,
    });
    const sessionLaunchProfile = React.useMemo(
        () => resolveExecutionRunSessionLaunchProfile(settings, session?.metadata),
        [session?.metadata, settings],
    );
    const enabledAgentIds = React.useMemo(() => getEnabledAgentIds({
        backendEnabledByTargetKey: settings.backendEnabledByTargetKey,
    }), [settings.backendEnabledByTargetKey]);
    const defaultBackend = React.useMemo(() => resolveSessionActionDefaultBackend({
        session,
        enabledAgentIds,
        fallbackAgentId: resolveAgentIdFromSessionMetadata(session?.metadata) ?? undefined,
    }), [enabledAgentIds, session]);
    const backendTarget = React.useMemo(
        () => resolveSessionActionDefaultTarget(defaultBackend),
        [defaultBackend],
    );
    const machineTarget = useSessionMachineTarget(props.sessionId, serverId);
    const machineId = machineTarget?.machineId ?? null;
    const { canLaunchExecutionRuns, executionRunsBackends } = useSessionExecutionRunLaunchability(
        props.sessionId,
        session,
        serverId,
    );
    const { state: machineCapabilitiesState } = useMachineCapabilitiesCache({
        machineId,
        enabled: Boolean(machineId),
        ...(serverId ? { serverId } : {}),
        request: { requests: [{ id: 'tool.executionRuns', params: { sessionId: props.sessionId } }] },
    });
    const daemonMergedProjection = useDaemonMergedProjectionInputs({
        machineId,
        serverId: serverId ?? null,
        enabled: Boolean(machineId),
        staleMs: 60_000,
    });
    const { resumeCapabilityOptions } = useResumeCapabilityOptions({
        agentId: defaultBackend?.defaultAgentId ?? null,
        machineId: machineTarget?.machineId ?? null,
        serverId,
        settings,
        enabled: session?.active === false,
    });
    const { machineReachable } = useSessionMachineReachability(props.sessionId, serverId);
    const browserContextRuntime = useSessionBrowserContextRuntimeContext();
    const accountLifetime = React.useMemo(() => {
        if (!accountBinding) return null;
        const scope = createServerAccountScope(accountBinding.serverId, accountBinding.accountId);
        return scope ? { scope, isCurrent: accountBinding.isCurrent } : null;
    }, [accountBinding]);
    const [identity, setIdentity] = React.useState<DraftIdentity>(() => ({
        correlationId: props.launchOrigin?.draftCorrelationId ?? randomUUID(),
        inputLocalId: randomUUID(),
    }));
    const [phase, setPhase] = React.useState<'idle' | 'starting' | 'reconciling' | 'unresolved'>('idle');
    const [error, setError] = React.useState<string | null>(null);
    const [secretOverlayState, setSecretOverlayState] = React.useState<ExecutionRunSecretReferenceOverlayState>({
        readiness: { ok: true },
    });
    const executionRunActionDeps = React.useMemo(() => createUiExecutionRunActionDeps(), []);
    const [actionInput, setActionInput] = React.useState<Record<string, unknown>>(() => buildExecutionRunActionDraftInputForUi({
        actionId: 'subagents.delegate.start',
        sessionId: props.sessionId,
        defaultBackendTarget: backendTarget,
        defaultBackendId: defaultBackend?.defaultBackendId ?? null,
        instructions: '',
    }));
    const options = useExecutionRunLauncherOptionsModel({
        sessionId: props.sessionId,
        intent: 'delegate',
        actionInput,
        setActionInput,
        singleTarget: true,
        enabledAgentIds,
        executionRunsBackends,
        acpCatalogSettingsV1: settings.acpCatalogSettingsV1,
        initialBackendTarget: backendTarget,
        fallbackAgentId: defaultBackend?.defaultAgentId ?? null,
        machineCapabilitiesState,
        mergedBackendProjectionById: daemonMergedProjection.inputs?.mergedBackendProjectionById ?? null,
        mergedProviderProjectionById: daemonMergedProjection.inputs?.mergedProviderProjectionById ?? null,
    });
    const runIdRef = React.useRef<string | null>(null);
    const notifiedRunIdRef = React.useRef<string | null>(null);
    const submitInFlightRef = React.useRef(false);
    const notifyRunStarted = React.useCallback((runId: string, recovery?: Readonly<{ retryInputLocalId: string }>) => {
        if (notifiedRunIdRef.current === runId) return;
        notifiedRunIdRef.current = runId;
        if (recovery) props.onRunStarted(runId, recovery);
        else props.onRunStarted(runId);
    }, [props.onRunStarted]);

    const findCorrelatedRun = React.useCallback(async (): Promise<string | null> => {
        setPhase('reconciling');
        const listed = await sessionExecutionRunList(
            props.sessionId,
            {},
            serverId ? { serverId } : undefined,
        );
        if (!('runs' in listed)) return null;
        const matches = listed.runs.filter((run) => {
            const launchOrigin = run.launchOrigin;
            if (
                !launchOrigin
                || launchOrigin.kind === 'external'
                || launchOrigin.draftCorrelationId !== identity.correlationId
            ) {
                return false;
            }
            return props.launchOrigin
                ? launchOrigin.kind === 'session_discussion'
                    && launchOrigin.sessionId === props.launchOrigin.sessionId
                    && launchOrigin.discussionId === props.launchOrigin.discussionId
                    && launchOrigin.messageIds.length === props.launchOrigin.messageIds.length
                    && launchOrigin.messageIds.every((messageId, index) => messageId === props.launchOrigin?.messageIds[index])
                : launchOrigin.kind === 'session'
                    && launchOrigin.sessionId === props.sessionId;
        });
        return matches.length === 1 ? matches[0]!.runId : null;
    }, [identity.correlationId, props.launchOrigin, props.sessionId, serverId]);

    const submitPreparedMessage = React.useCallback(async (submission: ParticipantComposerPreparedSubmission) => {
        if (submitInFlightRef.current) {
            throw new Error(t('common.loading'));
        }
        const startOptions = options.selectedBackendChoice
            ? resolveRowlessExecutionRunStartOptions({
                choice: options.selectedBackendChoice,
                input: {
                    ...actionInput,
                    ...(secretOverlayState.overlay
                        ? { secretReferenceOverlay: secretOverlayState.overlay }
                        : {}),
                },
            })
            : { ok: false as const };
        if (!startOptions.ok || !accountLifetime?.isCurrent() || !secretOverlayState.readiness.ok) {
            throw new Error(t('common.unavailable'));
        }
        submitInFlightRef.current = true;
        setError(null);
        setPhase('starting');
        let handedOff = false;
        try {
            if (!session) throw new Error(t('common.unavailable'));
            const requiresSecretOverlay = startOptions.options.secretReferenceOverlay !== undefined;
            const requiresTeamCredentialModel = startOptions.options.teamCredentialModel !== undefined;
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
                        ...(serverId ? { serverId } : {}),
                        ...(machineId ? { targetMachineId: machineId } : {}),
                    },
                );
                if (!capability) {
                    throw createSessionInputFailureError('execution_run_target_changed');
                }
                if (capability.ok === false) {
                    if (requiresSecretOverlay && capability.errorCode === 'execution_run_protocol_unsupported') {
                        throw createSessionInputFailureError('execution_run_secret_reference_overlay_update_required');
                    }
                    throw new Error(capability.error);
                }
                if (capability.exactMachineId !== machineId) {
                    throw createSessionInputFailureError('execution_run_target_changed');
                }
                admittedMachineId = capability.exactMachineId;
            }
            const active = await ensureExecutionRunHostSessionActive({
                sessionId: props.sessionId,
                session,
                machineReachable,
                resumeCapabilityOptions,
                sessionActionDefaultBackend: defaultBackend,
                agentId: defaultBackend?.defaultAgentId ?? null,
                settings,
                serverId,
                readinessOperationId: identity.correlationId,
                ...(admittedMachineId ? { expectedMachineId: admittedMachineId } : {}),
            });
            if (!active.ok) {
                throw new Error(active.reason === 'machine_offline'
                    ? t('session.machineOfflineCannotResume')
                    : active.error ?? t('session.resumeFailed'));
            }
            let runId = runIdRef.current;
            if (!runId) {
                const started = await sessionExecutionRunStart(props.sessionId, {
                    intent: 'delegate',
                    ...startOptions.options,
                    retentionPolicy: 'resumable',
                    runClass: 'long_lived',
                    ioMode: 'streaming',
                    launchOrigin: props.launchOrigin ?? {
                        kind: 'session',
                        sessionId: props.sessionId,
                        draftCorrelationId: identity.correlationId,
                    },
                }, {
                    ...(serverId ? { serverId } : {}),
                    ...(machineId ? { expectedMachineId: machineId } : {}),
                });
                if ('runId' in started) {
                    runId = started.runId;
                } else if (readExecutionRunStartRunCreation(started.details) !== 'noRunCreated') {
                    runId = await findCorrelatedRun();
                }
                if (!runId) {
                    const knownNoRun = !('runId' in started)
                        && readExecutionRunStartRunCreation(started.details) === 'noRunCreated';
                    setPhase(knownNoRun ? 'idle' : 'unresolved');
                    // An unknown outcome is not a failure: the Run may already exist, so the copy
                    // says so and warns that another Start may create a second conversation.
                    const message = knownNoRun ? started.error : t('sessionDrafts.executionRunStart.unresolved');
                    setError(message);
                    throw new Error(message);
                }
                runIdRef.current = runId;
            }

            writeExistingSessionDraft({
                scope: accountLifetime.scope,
                sessionId: props.sessionId,
                runId,
                patch: {
                    text: submission.draft.text,
                    mentions: [...submission.draft.mentions],
                    attachments: [...submission.draft.attachments],
                },
            });
            const runDraftOwner = createRepositoryComposerDocumentOwner({
                scope: accountLifetime.scope,
                ref: { kind: 'participantMessage', sessionId: props.sessionId, instanceId: identity.inputLocalId },
                address: { kind: 'run', sessionId: props.sessionId, runId },
                isCurrent: accountLifetime.isCurrent,
            });
            const acceptedCurrentness = runDraftOwner.captureCurrentness();

            await sync.submitMessage(
                props.sessionId,
                submission.text,
                submission.displayText,
                submission.metaOverrides,
                {
                    ...(serverId ? { serverId } : {}),
                    recipient: { kind: 'execution_run', runId },
                    ...(submission.requestedAction ? { requestedAction: submission.requestedAction } : {}),
                    localId: identity.inputLocalId,
                    callerSurface: 'participant_composer',
                    onOutboundHandoff: () => {
                        handedOff = true;
                        submission.onOutboundHandoff();
                        runDraftOwner.clearAccepted(acceptedCurrentness);
                    },
                },
            );
            notifyRunStarted(runId);
            setPhase('idle');
        } catch (cause) {
            if (runIdRef.current) {
                notifyRunStarted(runIdRef.current, handedOff ? undefined : { retryInputLocalId: identity.inputLocalId });
                setPhase('idle');
            }
            const failureLabelKey = getSessionInputFailureLabelKey(cause);
            const message = failureLabelKey
                ? t(failureLabelKey)
                : cause instanceof Error ? cause.message : t('errors.failedToSendMessage');
            setError(message);
            throw cause;
        } finally {
            submitInFlightRef.current = false;
        }
    }, [accountLifetime, actionInput, defaultBackend, executionRunActionDeps.executionRunCheckProtocolV2, findCorrelatedRun, identity, machineId, machineReachable, notifyRunStarted, options.selectedBackendChoice, props.launchOrigin, props.sessionId, resumeCapabilityOptions, secretOverlayState.overlay, secretOverlayState.readiness.ok, serverId, session, settings]);

    const unavailable = exactSettings === null
        || !session
        || canLaunchExecutionRuns !== true
        || !options.selectedBackendChoice
        || !secretOverlayState.readiness.ok;
    return (
        <View style={{ flex: 1, gap: 12 }}>
            <SessionParticipantComposer
                key={JSON.stringify([serverId, props.sessionId, identity.inputLocalId])}
                sessionId={props.sessionId}
                serverId={serverId}
                canSendMessages={!unavailable && phase === 'idle'}
                recipient={null}
                browserContextState={browserContextRuntime?.composerContext.state ?? null}
                initialText={props.initialText}
                initialLocalId={identity.inputLocalId}
                draftOccurrenceId={identity.inputLocalId}
                submitPreparedMessage={submitPreparedMessage}
            />
            <ExecutionRunLauncherOptions
                backendChoices={options.backendChoices}
                selectedBackendTargetKeys={options.selectedBackendTargetKeys}
                profileChoices={options.profileChoices}
                selectedProfileId={options.selectedProfileId}
                selectedProfileGenerationId={options.selectedProfileGenerationId}
                selectedPermissionMode={options.selectedPermissionMode}
                permissionModeOptions={options.visiblePermissionModeOptions}
                fields={options.fields}
                input={actionInput}
                editable={phase === 'idle'}
                resolveFieldOptions={options.resolveFieldOptions}
                onSelectBackend={options.onSelectBackend}
                onSelectProfile={options.onSelectProfile}
                onPatch={options.onPatch}
            />
            <ExecutionRunSecretReferenceOverlayField
                profile={sessionLaunchProfile}
                machineId={machineId}
                serverId={serverId}
                accountScope={accountBinding?.scope ?? null}
                defaultBindings={sessionLaunchProfile
                    ? settings.currentSecretBindingsByProfileId[sessionLaunchProfile.id] ?? null
                    : null}
                personalSecrets={settings.secrets}
                sharedEnabled={sharedSavedSecretsEnabled}
                editable={phase === 'idle'}
                onChange={setSecretOverlayState}
            />
            {phase === 'starting' || phase === 'reconciling' ? (
                <Text testID="execution-run-conversation-phase" style={{ color: theme.colors.text.secondary }}>
                    {phase === 'starting'
                        ? t('sessionDrafts.executionRunStart.starting')
                        : t('sessionDrafts.executionRunStart.reconciling')}
                </Text>
            ) : null}
            {error ? (
                <Text testID="execution-run-conversation-error" style={{ color: theme.colors.status?.error ?? theme.colors.text.primary }}>
                    {error}
                </Text>
            ) : null}
            {phase === 'unresolved' ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionDrafts.startAnother')}
                    testID="execution-run-conversation-start-another"
                    onPress={() => {
                        runIdRef.current = null;
                        notifiedRunIdRef.current = null;
                        setIdentity(createDraftIdentity());
                        setError(null);
                        setPhase('idle');
                    }}
                    style={({ pressed }) => ({
                        alignSelf: 'flex-start',
                        minWidth: interactiveTargetSize,
                        minHeight: interactiveTargetSize,
                        justifyContent: 'center',
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 10,
                        backgroundColor: theme.colors.surface.inset,
                        opacity: pressed ? 0.7 : 1,
                    })}
                >
                    <Text style={{ color: theme.colors.text.primary }}>{t('sessionDrafts.startAnother')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
});
