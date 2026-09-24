import type { ExecutionRunPublicState } from '@happier-dev/protocol';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import {
    isExecutionRunNotRunningMutationError,
    sessionExecutionRunCancelTurn,
    sessionExecutionRunGet,
    sessionExecutionRunResume,
    sessionExecutionRunStop,
} from '@/sync/ops/sessionExecutionRuns';
import {
    useMessage,
    useResolvedSessionMessageRouteId,
    useSessionMessages,
    useSessionPendingMessages,
    useSessionSidechainMessages,
} from '@/sync/domains/state/storage';
import { t } from '@/text';
import { renderExecutionRunStructuredMeta } from '@/components/sessions/runs/renderExecutionRunStructuredMeta';
import { SessionExecutionRunInfoCard } from '@/components/sessions/runs/details/SessionExecutionRunInfoCard';
import {
    resolveDaemonExecutionRunFallback,
    type ExecutionRunTranscriptFallback,
} from '@/components/sessions/runs/details/resolveDaemonExecutionRunFallback';
import { resolveExecutionRunGetFailureLoadedState } from '@/components/sessions/runs/details/resolveExecutionRunGetFailureLoadedState';
import { SessionMessageDetailsView } from '@/components/sessions/transcript/details/SessionMessageDetailsView';
import { StructuredResultView } from '@/components/tools/renderers/system/StructuredResultView';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import {
    NO_EXECUTION_RUN_INTERACTION,
    resolveExecutionRunInteractionAffordances,
} from '@/sync/domains/executionRuns/executionRunInteractionAffordances';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { buildToolCallMessageRouteId } from '@/sync/domains/messages/messageRouteIds';
import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';
import { navigateWithBlurOnWeb } from '@/utils/platform/navigateWithBlurOnWeb';
import { findTranscriptExecutionRunState } from '@/sync/domains/session/subagents/executionRuns/deriveTranscriptExecutionRunStateIndex';
import { buildExecutionRunPublicStateFromTranscriptState } from '@/sync/domains/session/subagents/executionRuns/executionRunPublicStateFromTranscript';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    isSidechainHydrationPendingStatus,
    useEnsureSidechainsLoaded,
} from '@/hooks/session/useEnsureSidechainsLoaded';
import { ChainTranscriptList } from '@/components/sessions/transcript/ChainTranscriptList';
import { normalizeSessionAddress, sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { subscribeExecutionRunActivity } from '@/sync/runtime/executionRuns/executionRunActivityBus';
import { PendingMessagesTranscriptBlock } from '@/components/sessions/pending/PendingMessagesTranscriptBlock';
import { SessionParticipantComposer } from '@/components/sessions/participants/composer/SessionParticipantComposer';
import { useSessionRecipientState } from '@/components/sessions/agentInput/routing/useSessionRecipientState';
import { useSessionAgentInputRoutingControls } from '@/components/sessions/agentInput/routing/useSessionAgentInputRoutingControls';
import type { SessionParticipantTarget } from '@/sync/domains/session/participants/participantTargets';
import { useSessionBrowserContextRuntimeContext } from '@/components/sessions/browser/sessionBrowserContextRuntime';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import {
    deriveTranscriptInteraction,
    deriveTranscriptInteractionFromSession,
} from '@/utils/sessions/deriveTranscriptInteraction';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import { motionTokens } from '@/components/ui/motion/motionTokens';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | {
        status: 'loaded';
        run: ExecutionRunPublicState;
        latestToolResult?: unknown;
        structuredMeta?: unknown;
        source: 'session_rpc' | 'transcript_fallback' | 'daemon_fallback';
    };

const FAIL_CLOSED_TRANSCRIPT_INTERACTION = deriveTranscriptInteraction({ kind: 'public' });

/** The Run result projection is read standalone; it carries no transcript around it. */
const NO_TRANSCRIPT_MESSAGES: Message[] = [];

function isSessionEncryptionNotFoundError(input: unknown): boolean {
    if (!input || typeof input !== 'object') return false;
    const code = typeof (input as { errorCode?: unknown }).errorCode === 'string' ? String((input as { errorCode?: string }).errorCode) : '';
    if (code === 'session_encryption_not_found') return true;
    const message = typeof (input as { error?: unknown }).error === 'string' ? String((input as { error?: string }).error) : '';
    return /session encryption not found/i.test(message);
}

function readNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveExecutionRunTranscriptToolId(params: Readonly<{
    run?: ExecutionRunPublicState | null;
    latestToolResult?: unknown;
}>): string | null {
    return (
        readNonEmptyString((params.run as { sidechainId?: unknown } | null)?.sidechainId)
        ?? readNonEmptyString((params.run as { callId?: unknown } | null)?.callId)
        ?? readNonEmptyString((params.latestToolResult as { sidechainId?: unknown } | null)?.sidechainId)
        ?? readNonEmptyString((params.latestToolResult as { callId?: unknown } | null)?.callId)
    );
}

export type SessionExecutionRunDetailsViewHandle = Readonly<{
    reload: () => Promise<void>;
}>;

export const SessionExecutionRunDetailsView = React.memo(React.forwardRef<SessionExecutionRunDetailsViewHandle, Readonly<{
    sessionId: string;
    runId: string;
    serverId?: string | null;
    presentation?: 'screen' | 'panel';
    showInfoCard?: boolean;
    showSendComposer?: boolean;
    retryInputLocalId?: string;
}>>((props, ref) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const interactiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const interactiveTargetStyle = React.useMemo(() => ({
        minWidth: interactiveTargetSize,
        minHeight: interactiveTargetSize,
        justifyContent: 'center' as const,
    }), [interactiveTargetSize]);
    const explicitServerId = props.serverId?.trim() || null;
    const session = useSessionViewShellSession(props.sessionId, explicitServerId);
    const hasQualifiedSession = explicitServerId === null || session !== null;
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });
    const [daemonProcessLine, setDaemonProcessLine] = React.useState<string | null>(null);
    const [stopError, setStopError] = React.useState<string | null>(null);
    const [isStopping, setIsStopping] = React.useState(false);
    const [interactionError, setInteractionError] = React.useState<string | null>(null);
    const [pendingInteraction, setPendingInteraction] = React.useState<'cancel_turn' | 'resume' | null>(null);
    const [rawToolResultExpanded, setRawToolResultExpanded] = React.useState(false);
    const { messages: sessionMessages, isLoaded: sessionMessagesLoaded } = useSessionMessages(
        props.sessionId,
        { enabled: hasQualifiedSession },
    );
    const transcriptFallback = React.useMemo<ExecutionRunTranscriptFallback | null>(() => {
        const transcriptState = findTranscriptExecutionRunState(sessionMessages, props.runId);
        if (!transcriptState) return null;
        const run = buildExecutionRunPublicStateFromTranscriptState(transcriptState);
        if (!run) return null;
        const matchingMessage = sessionMessages.find((message) => message.id === transcriptState.toolMessageRouteId) ?? null;
        return {
            run,
            latestToolResult: matchingMessage && matchingMessage.kind === 'tool-call' ? matchingMessage.tool?.result : undefined,
            message: matchingMessage,
        };
    }, [props.runId, sessionMessages]);

    // One Run address owns the loaded tree. A load for the address already on
    // screen is a background refresh: it must not replace the loaded surface
    // (and the mounted composer with its text and selection) with a spinner.
    // Only an address that is not loaded yet, or an error, enters `loading`.
    const runAddressKey = `${explicitServerId ?? ''}\u0000${props.sessionId}\u0000${props.runId}`;
    const loadedRunAddressRef = React.useRef<string | null>(null);
    // Request currentness: concurrent loads (route effect, bus notification,
    // interaction, header Refresh) settle in arbitrary order, so only the newest
    // request may write state. Without this an older response overwrites a newer
    // one and the surface silently shows a superseded Run.
    const loadGenerationRef = React.useRef(0);

    const load = React.useCallback(async () => {
        const generation = loadGenerationRef.current + 1;
        loadGenerationRef.current = generation;
        const isCurrentRequest = () => loadGenerationRef.current === generation;
        if (!props.sessionId || !props.runId) {
            setState({ status: 'error', error: t('runs.runDetails.failedToLoad') });
            return;
        }
        // A qualified Run route may only use the Session materialized for that
        // exact Home. A same-id Session from the active Home cannot authorize an
        // RPC or seed transcript/daemon fallback state for this address.
        if (!hasQualifiedSession) {
            setState({ status: 'error', error: t('common.unavailable') });
            return;
        }
        const rpcOptions = explicitServerId ? { serverId: explicitServerId } : undefined;
        const getRun = (request: Readonly<{ runId: string; includeStructured: true }>) => (
            rpcOptions
                ? sessionExecutionRunGet(props.sessionId, request, rpcOptions)
                : sessionExecutionRunGet(props.sessionId, request)
        );
        if (loadedRunAddressRef.current !== runAddressKey) {
            setState({ status: 'loading' });
            setDaemonProcessLine(null);
        }
        const first = await getRun({ runId: props.runId, includeStructured: true });
        if (!isCurrentRequest()) return;
        const result =
            first.ok === false && isSessionEncryptionNotFoundError(first)
                ? await getRun({ runId: props.runId, includeStructured: true })
                : first;
        if (!isCurrentRequest()) return;
        if (result.ok === false) {
            if (result.errorCode === 'execution_run_not_found' && !sessionMessagesLoaded) {
                await sync.loadOlderMessages(props.sessionId).catch(() => null);
                return;
            }
            const daemonFallback = await resolveDaemonExecutionRunFallback({
                sessionId: props.sessionId,
                serverId: explicitServerId,
                runId: props.runId,
                transcriptFallback,
            }).catch(() => null);
            if (!isCurrentRequest()) return;
            const fallbackState = resolveExecutionRunGetFailureLoadedState({
                result,
                transcriptFallback,
                daemonFallback,
            });
            if (fallbackState) {
                loadedRunAddressRef.current = runAddressKey;
                setState(fallbackState);
                if (fallbackState.source === 'daemon_fallback') {
                    setDaemonProcessLine(daemonFallback?.daemonProcessLine ?? null);
                }
                return;
            }
            loadedRunAddressRef.current = null;
            setState({ status: 'error', error: String(result.error ?? t('runs.runDetails.failedToLoad')) });
            return;
        }
        if (!('run' in result)) {
            loadedRunAddressRef.current = null;
            setState({ status: 'error', error: t('runs.runDetails.failedToLoad') });
            return;
        }
        const run = result.run;
        if (!run || typeof run.runId !== 'string') {
            loadedRunAddressRef.current = null;
            setState({ status: 'error', error: t('runs.runDetails.failedToLoad') });
            return;
        }
        loadedRunAddressRef.current = runAddressKey;
        setState({
            status: 'loaded',
            run,
            latestToolResult: result.latestToolResult,
            structuredMeta: result.structuredMeta,
            source: 'session_rpc',
        });
        const daemonFallback = await resolveDaemonExecutionRunFallback({
            sessionId: props.sessionId,
            serverId: explicitServerId,
            runId: props.runId,
            transcriptFallback: transcriptFallback ?? {
                run,
                latestToolResult: result.latestToolResult,
            },
        }).catch(() => null);
        if (!isCurrentRequest()) return;
        if (daemonFallback?.daemonProcessLine) {
            setDaemonProcessLine(daemonFallback.daemonProcessLine);
        }
    }, [explicitServerId, hasQualifiedSession, props.runId, props.sessionId, runAddressKey, sessionMessagesLoaded, transcriptFallback]);

    React.useEffect(() => {
        void load();
    }, [load]);

    React.useImperativeHandle(ref, () => ({
        reload: load,
    }), [load]);

    // Live Run state comes from the canonical execution-Run activity signal the
    // rest of the app already consumes (`execution-run-updated` → socket →
    // `executionRunActivityBus`), not from a Details-local timer or a second Run
    // store. A notification naming another Run of this Session is not this
    // surface, so it does not refetch; an unknown Run (`runId: null`) does.
    const runActivityServerId = explicitServerId ?? session?.serverId ?? null;
    React.useEffect(() => {
        if (!hasQualifiedSession || !runActivityServerId) return;
        return subscribeExecutionRunActivity(
            { serverId: runActivityServerId, sessionId: props.sessionId },
            (notification) => {
                if (notification.runId !== null && notification.runId !== props.runId) return;
                void load();
            },
        );
    }, [hasQualifiedSession, load, props.runId, props.sessionId, runActivityServerId]);

    const transcriptToolId = React.useMemo(() => {
        if (state.status !== 'loaded') return null;
        return resolveExecutionRunTranscriptToolId({
            run: state.run,
            latestToolResult: state.latestToolResult,
        });
    }, [state]);
    const transcriptToolRouteId = React.useMemo(() => buildToolCallMessageRouteId({ toolId: transcriptToolId }), [transcriptToolId]);
    const pendingScopeServerId = explicitServerId ?? session?.serverId;
    const pendingScopeResolution = useServerCredentialAccountScopeResolution(pendingScopeServerId);
    const pendingOutboxScope = pendingScopeResolution.kind === 'bound'
        ? pendingScopeResolution.scope
        : null;
    const interaction = React.useMemo(() => session
        ? deriveTranscriptInteractionFromSession({
            access: session.access,
            active: session.active,
            presence: session.presence,
        })
        : FAIL_CLOSED_TRANSCRIPT_INTERACTION, [session]);
    const resolvedTranscriptMessageId = useResolvedSessionMessageRouteId(props.sessionId, transcriptToolRouteId ?? '');
    const transcriptMessageFromStore = useMessage(props.sessionId, resolvedTranscriptMessageId ?? transcriptToolRouteId ?? '');
    const transcriptMessage = transcriptMessageFromStore ?? transcriptFallback?.message ?? null;
    const executionRunRecipient = React.useMemo(() => ({
        kind: 'execution_run' as const,
        runId: props.runId,
    }), [props.runId]);
    const targetPending = useSessionPendingMessages(props.sessionId, executionRunRecipient);
    // The direct Run composer mounts before any transcript tool marker exists, so it composes the
    // same recipient/routing controls the tool-marker branch reaches through
    // `SessionMessageDetailsView`: one canonical send-mode control, no silent default.
    const executionRunParticipantTargets = React.useMemo<readonly SessionParticipantTarget[]>(() => {
        const displayLabel = t('session.participants.executionRun', { runId: executionRunRecipient.runId });
        return [{
            key: `execution_run:${executionRunRecipient.runId}`,
            displayLabel,
            recipient: { ...executionRunRecipient, label: displayLabel },
        }];
    }, [executionRunRecipient]);
    const executionRunRecipientState = useSessionRecipientState({
        targets: executionRunParticipantTargets,
        autoRecipient: executionRunRecipient,
    });
    const executionRunRoutingControls = useSessionAgentInputRoutingControls({
        isReadOnly: !interaction.canSendMessages,
        participantTargets: executionRunParticipantTargets,
        recipientState: executionRunRecipientState,
    });
    const browserContextRuntime = useSessionBrowserContextRuntimeContext();
    const transcriptSidechainIds = React.useMemo(
        () => transcriptToolId === null ? [] : [transcriptToolId],
        [transcriptToolId],
    );

    const sidechainHydration = useEnsureSidechainsLoaded({
        enabled: transcriptToolId !== null,
        sessionId: props.sessionId,
        sidechainIds: transcriptSidechainIds,
    });
    // A Run whose profile materializes nothing in the parent transcript never
    // gets a tool marker, so `SessionMessageDetailsView` — which is keyed on that
    // marker — can never host its transcript. The committed rows still exist under
    // the Run's own sidechain, so this branch reads the same sync-owned sidechain
    // projection and renders them through the same shared list, including the
    // pending-to-committed crossover for this exact target.
    const runSidechainMessages = useSessionSidechainMessages(props.sessionId, transcriptToolId);
    const runTranscriptMessages = React.useMemo(() => [...runSidechainMessages], [runSidechainMessages]);
    const runTranscriptDatasetKey = React.useMemo(() => {
        const address = normalizeSessionAddress(pendingScopeServerId ?? null, props.sessionId);
        return JSON.stringify([
            address ? sessionAddressKey(address) : props.sessionId,
            transcriptToolId ?? props.runId,
        ]);
    }, [pendingScopeServerId, props.runId, props.sessionId, transcriptToolId]);
    const loadOlderRunSidechain = React.useCallback(async () => {
        if (!transcriptToolId) return { loaded: 0, hasMore: false, status: 'not_ready' as const };
        return sync.loadOlderSidechainMessages(props.sessionId, transcriptToolId);
    }, [props.sessionId, transcriptToolId]);
    const isRunSidechainHydrating = runTranscriptMessages.length === 0
        && isSidechainHydrationPendingStatus(
            transcriptToolId ? sidechainHydration.bySidechainId[transcriptToolId]?.status : undefined,
        );

    React.useEffect(() => {
        if (!hasQualifiedSession) return;
        if (pendingScopeServerId && !pendingOutboxScope) return;
        fireAndForget(
            sync.fetchPendingMessages(props.sessionId, pendingOutboxScope ?? undefined, executionRunRecipient),
            { tag: 'SessionExecutionRunDetailsView.fetchTargetPending' },
        );
    }, [executionRunRecipient, hasQualifiedSession, pendingOutboxScope, pendingScopeServerId, props.sessionId]);

    /**
     * Presentation-only envelope so the Run's own result reaches the transcript's
     * structured projection owner, which reads `state` and `result` and nothing
     * else. It is not a transcript row and is never published anywhere.
     */
    const latestToolResultProjection = React.useMemo<ToolCall | null>(() => {
        if (state.status !== 'loaded' || state.latestToolResult === undefined) return null;
        return {
            name: 'execution_run_result',
            state: 'completed',
            input: null,
            createdAt: 0,
            startedAt: null,
            completedAt: null,
            description: null,
            result: state.latestToolResult,
        };
    }, [state]);

    const structuredCard = React.useMemo(() => {
        if (state.status !== 'loaded') return null;
        const meta = state.structuredMeta;
        if (!meta || typeof meta !== 'object') return null;
        const kind = typeof (meta as { kind?: unknown }).kind === 'string' ? (meta as { kind: string }).kind : '';
        if (!kind) return null;
        return renderExecutionRunStructuredMeta({
            meta: { kind, payload: (meta as { payload?: unknown }).payload },
            sessionId: props.sessionId,
            interaction,
        });
    }, [interaction, props.sessionId, state]);
    const canMutateRunViaSessionRpc = state.status === 'loaded' && state.source === 'session_rpc';
    // The run's own interaction projection is the only authority here. A transcript or
    // daemon fallback has no live retained controller behind it, so it stays readable
    // and cannot paint a composer, and a bounded job never acquires one by looking
    // long-lived. Status/intent/run-class inference used to decide this locally.
    const interactionAffordances = state.status === 'loaded' && canMutateRunViaSessionRpc
        ? resolveExecutionRunInteractionAffordances(state.run)
        : NO_EXECUTION_RUN_INTERACTION;
    const cancellableInputTurn = state.status === 'loaded'
        && state.run.inputTurns?.current?.state === 'active'
        ? {
            occurrenceId: state.run.inputTurns.occurrenceId,
            turnId: state.run.inputTurns.current.turnId,
        }
        : null;
    const canShowSendComposer = props.showSendComposer !== false && interactionAffordances.canSend;
    const invokeInteraction = React.useCallback((kind: 'cancel_turn' | 'resume') => {
        if (pendingInteraction !== null) return;
        fireAndForget((async () => {
            setInteractionError(null);
            setPendingInteraction(kind);
            try {
                const options = props.serverId ? { serverId: props.serverId } : undefined;
                const result = kind === 'cancel_turn'
                    ? cancellableInputTurn
                        ? await sessionExecutionRunCancelTurn(props.sessionId, {
                            runId: props.runId,
                            occurrenceId: cancellableInputTurn.occurrenceId,
                            turnId: cancellableInputTurn.turnId,
                        }, options)
                        : { ok: false as const, error: t('runs.runDetails.controlFailed') }
                    : await sessionExecutionRunResume(props.sessionId, { runId: props.runId }, options);
                if (result.ok === false) {
                    setInteractionError(String(result.error ?? t('runs.runDetails.controlFailed')));
                    if (isExecutionRunNotRunningMutationError(result)) await load();
                    return;
                }
                await load();
            } catch (error) {
                setInteractionError(error instanceof Error ? error.message : t('runs.runDetails.controlFailed'));
            } finally {
                setPendingInteraction(null);
            }
        })(), { tag: `SessionExecutionRunDetailsView.${kind}` });
    }, [cancellableInputTurn, load, pendingInteraction, props.runId, props.serverId, props.sessionId]);

    const containerStyle = props.presentation === 'panel'
        ? { flex: 1, paddingHorizontal: 16, paddingVertical: 16, gap: 12 as const }
        : { flex: 1 };
    const content = state.status === 'loading' ? (
        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
    ) : state.status === 'error' ? (
        // The mobile route carries a header Refresh over this same view's `reload`
        // handle; the desktop workspace and the subagent panel have no header, so
        // without this the only recovery was leaving and reopening the Run. It calls
        // the one existing loader, which re-enters the loading state above — no
        // reconnect subscription, retry timer or second load owner.
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
            <Text style={{ color: theme.colors.text.secondary }}>{state.error}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="session-run-details-retry-load"
                onPress={() => { void load(); }}
                style={({ pressed }) => ({
                    ...interactiveTargetStyle,
                    alignSelf: 'flex-start',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: theme.colors.surface.inset,
                    borderWidth: 1,
                    borderColor: theme.colors.border.default,
                    opacity: pressed ? motionTokens.press.opacity : 1,
                })}
            >
                <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>{t('common.retry')}</Text>
            </Pressable>
        </View>
    ) : (
        <View style={{ gap: 10 }}>
            <View style={{ gap: 4 }}>
                {props.showInfoCard === false ? null : (
                    <SessionExecutionRunInfoCard
                        run={state.run}
                        hostSessionId={props.sessionId}
                        daemonProcessLine={daemonProcessLine}
                    />
                )}
                {!transcriptMessage && transcriptToolRouteId ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('toolView.open')}
                        testID="session-run-details-open-tool-message"
                        onPress={() => {
                            navigateWithBlurOnWeb(() => {
                                router.push(buildScopedSessionRouteHref({
                                    sessionId: props.sessionId,
                                    serverId: props.serverId ?? session?.serverId,
                                    suffix: `/message/${encodeURIComponent(transcriptToolRouteId)}`,
                                }));
                            });
                        }}
                        style={{
                            ...interactiveTargetStyle,
                            alignSelf: 'flex-start',
                            paddingVertical: 8,
                            paddingHorizontal: 10,
                            borderRadius: 10,
                            backgroundColor: theme.colors.surface.inset,
                            borderWidth: 1,
                            borderColor: theme.colors.border.default,
                        }}
                    >
                        <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>{t('toolView.open')}</Text>
                    </Pressable>
                ) : null}
            </View>

            {structuredCard ? (
                <View style={{ gap: 8 }}>
                    {structuredCard}
                </View>
            ) : null}

            {canMutateRunViaSessionRpc && (state.run.status === 'running' || interactionAffordances.canResume) ? (
                <View style={{ gap: 8 }}>
                    {stopError ? <Text style={{ color: theme.colors.text.secondary }}>{stopError}</Text> : null}
                    {interactionError ? <Text style={{ color: theme.colors.text.secondary }}>{interactionError}</Text> : null}
                    {interactionAffordances.canCancelTurn && cancellableInputTurn ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('runs.runDetails.cancelTurn')}
                            accessibilityState={{
                                disabled: pendingInteraction !== null,
                                busy: pendingInteraction === 'cancel_turn',
                            }}
                            testID="session-run-details-cancel-turn"
                            disabled={pendingInteraction !== null}
                            onPress={() => invokeInteraction('cancel_turn')}
                            style={{
                                ...interactiveTargetStyle,
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                borderRadius: 10,
                                backgroundColor: theme.colors.surface.inset,
                                borderWidth: 1,
                                borderColor: theme.colors.border.default,
                                opacity: pendingInteraction !== null ? 0.6 : 1,
                            }}
                        >
                            <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>
                                {t('runs.runDetails.cancelTurn')}
                            </Text>
                        </Pressable>
                    ) : null}
                    {interactionAffordances.canResume ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('runs.runDetails.resumeRun')}
                            accessibilityState={{
                                disabled: pendingInteraction !== null,
                                busy: pendingInteraction === 'resume',
                            }}
                            testID="session-run-details-resume"
                            disabled={pendingInteraction !== null}
                            onPress={() => invokeInteraction('resume')}
                            style={{
                                ...interactiveTargetStyle,
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                borderRadius: 10,
                                backgroundColor: theme.colors.surface.inset,
                                borderWidth: 1,
                                borderColor: theme.colors.border.default,
                                opacity: pendingInteraction !== null ? 0.6 : 1,
                            }}
                        >
                            <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>
                                {t('runs.runDetails.resumeRun')}
                            </Text>
                        </Pressable>
                    ) : null}
                    {state.run.status === 'running' ? <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('runs.stop.stopRunA11y')}
                        accessibilityState={{ disabled: isStopping, busy: isStopping }}
                        testID="session-run-details-stop"
                        onPress={() => {
                            fireAndForget((async () => {
                                setStopError(null);
                                setIsStopping(true);
                                try {
                                    const result = props.serverId
                                        ? await sessionExecutionRunStop(
                                            props.sessionId,
                                            { runId: props.runId },
                                            { serverId: props.serverId },
                                        )
                                        : await sessionExecutionRunStop(props.sessionId, { runId: props.runId });
                                    if (result.ok === false) {
                                        setStopError(String(result.error ?? t('runs.stop.failedToStopRun')));
                                        if (isExecutionRunNotRunningMutationError(result)) {
                                            await load();
                                        }
                                    } else {
                                        await load();
                                    }
                                } catch (error) {
                                    setStopError(error instanceof Error ? error.message : t('runs.stop.failedToStopRun'));
                                } finally {
                                    setIsStopping(false);
                                }
                            })(), { tag: 'SessionExecutionRunDetailsView.stopRun' });
                        }}
                        disabled={isStopping}
                        style={{
                            ...interactiveTargetStyle,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: 10,
                            backgroundColor: theme.colors.surface.inset,
                            borderWidth: 1,
                            borderColor: theme.colors.border.default,
                            opacity: isStopping ? 0.6 : 1,
                        }}
                    >
                        <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>
                            {isStopping ? t('runs.stop.stoppingLabel') : t('runs.stop.stopLabel')}
                        </Text>
                    </Pressable> : null}
                </View>
            ) : null}

            {/* Presence, not truthiness: a valid run result may be false, 0,
                empty string, or null; only absence (undefined) hides the card.
                The result is presented through the transcript's own structured
                projection; the exact payload a plugin returned stays reachable
                under its own disclosure rather than being the primary content. */}
            {state.latestToolResult !== undefined ? (
                <View
                    testID="session-run-details-latest-tool-result"
                    style={{
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: theme.colors.surface.inset,
                        borderWidth: 1,
                        borderColor: theme.colors.border.default,
                        gap: 6,
                    }}
                >
                    <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>{t('runs.runDetails.latestToolResultTitle')}</Text>
                    {latestToolResultProjection ? (
                        <StructuredResultView
                            tool={latestToolResultProjection}
                            metadata={null}
                            messages={NO_TRANSCRIPT_MESSAGES}
                        />
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: rawToolResultExpanded }}
                        testID="session-run-details-latest-tool-result-raw-toggle"
                        onPress={() => setRawToolResultExpanded((current) => !current)}
                        style={{ ...interactiveTargetStyle, alignSelf: 'flex-start' }}
                    >
                        <Text style={{ color: theme.colors.text.secondary }}>{t('runs.runDetails.latestToolResultRaw')}</Text>
                    </Pressable>
                    {rawToolResultExpanded ? (
                        <Text
                            testID="session-run-details-latest-tool-result-raw"
                            style={{ color: theme.colors.text.secondary, fontFamily: 'Menlo' }}
                        >
                            {JSON.stringify(state.latestToolResult, null, 2)}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {/* Exactly one composer on this surface. The canonical message details host
                owns the run's sidechain, its exact-target pending rows and the standard
                Agent composer; this view decides only whether the run's own interaction
                projection permits one. The plain `TextInput` that used to sit here was a
                second composer with its own send state and its own direct runtime call. */}
            {session && transcriptMessage?.kind === 'tool-call' ? (
                <SessionMessageDetailsView
                    sessionId={props.sessionId}
                    session={session}
                    message={transcriptMessage}
                    showComposer={canShowSendComposer}
                    recipientOverride={executionRunRecipient}
                    composerInitialLocalId={props.retryInputLocalId}
                    browserContextState={browserContextRuntime?.composerContext.state ?? null}
                />
            ) : null}
            {session && transcriptMessage?.kind !== 'tool-call' ? (
                <View style={{ gap: 10 }}>
                    {transcriptToolId !== null ? (
                        // Same container the marker branch gives its transcript
                        // (`SessionMessageDetailsView`'s `toolCallFullViewContainer`), so the
                        // shared list is measured identically on both paths.
                        <View style={{ flex: 1, minHeight: 0 }}>
                            <ChainTranscriptList
                                key={runTranscriptDatasetKey}
                                sessionId={props.sessionId}
                                serverId={pendingScopeServerId ?? null}
                                datasetKey={runTranscriptDatasetKey}
                                messages={runTranscriptMessages}
                                metadata={session.metadata ?? null}
                                interaction={interaction}
                                isInitialLoadInFlight={isRunSidechainHydrating}
                                loadOlder={loadOlderRunSidechain}
                                pendingMessages={targetPending.messages}
                                discardedMessages={targetPending.discarded}
                                pendingRecipient={executionRunRecipient}
                                messageWrapperTestIdPrefix="session-run-details-transcript-message"
                            />
                        </View>
                    ) : (targetPending.messages.length > 0 || targetPending.discarded.length > 0) ? (
                        // Only reachable before the Run resolves (no sidechain id yet): the queued
                        // rows still belong on screen, and the list above owns them from then on.
                        <PendingMessagesTranscriptBlock
                            sessionId={props.sessionId}
                            serverId={pendingScopeServerId ?? null}
                            recipient={executionRunRecipient}
                            pendingMessages={targetPending.messages}
                            discardedMessages={targetPending.discarded}
                        />
                    ) : null}
                    {canShowSendComposer ? (
                        <SessionParticipantComposer
                            key={JSON.stringify([
                                props.serverId ?? session.serverId ?? '',
                                props.sessionId,
                                executionRunRecipient.runId,
                                props.retryInputLocalId ?? '',
                            ])}
                            sessionId={props.sessionId}
                            serverId={props.serverId ?? session.serverId}
                            canSendMessages={interaction.canSendMessages}
                            recipient={executionRunRecipient}
                            executionRunRequestedAction={executionRunRecipientState.executionRunRequestedAction}
                            extraActionChips={executionRunRoutingControls.extraActionChips}
                            initialLocalId={props.retryInputLocalId}
                            browserContextState={browserContextRuntime?.composerContext.state ?? null}
                        />
                    ) : null}
                </View>
            ) : null}
        </View>
    );

    if (props.presentation === 'panel') {
        return <View style={containerStyle}>{content}</View>;
    }

    return (
        <ConstrainedScreenContent style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
            {content}
        </ConstrainedScreenContent>
    );
}));
