import * as React from 'react';
import {
    supportsMachineSessionFollowWakeOnHumanChangeV1,
    type SessionFollowSourceModeV1,
    type SessionFollowSourceV1,
} from '@happier-dev/protocol';
import { Pressable } from 'react-native';
import { IconButton } from '@/components/ui/buttons/IconButton';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import {
    listSessionFollowSources,
    removeSessionFollowSource,
    setSessionFollowSource,
} from '@/sync/api/session/sessionFollowSourcesApi';
import { readSessionListRowsForServerId } from '@/sync/domains/session/listing/sessionListRowStateLookup';
import { useServerScopedMachine, useSessionListRowsByServerId } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import {
    isServerReachabilityNetworkAllowed,
    subscribeServerReachabilityNetworkAllowed,
} from '@/sync/runtime/connectivity/serverReachabilitySupervisorPool';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { subscribeHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import {
    resolveSessionFollowSourceRuntimeState,
} from './sessionFollowSourcePresentation';
import { openSessionFollowSourcePicker } from './openSessionFollowDestinationPicker';
import {
    prepareSessionFollowSourceKey,
    type SessionFollowSourceKeyPreparationResult,
} from './prepareSessionFollowSourceKey';

type SourceKeyWaitingReason = Extract<
    SessionFollowSourceKeyPreparationResult,
    Readonly<{ kind: 'waiting' }>
>['reason'];

function withPreparationWaitingReason(
    state: ReturnType<typeof resolveSessionFollowSourceRuntimeState>,
    reason: SourceKeyWaitingReason | undefined,
): ReturnType<typeof resolveSessionFollowSourceRuntimeState> {
    if (state !== 'waiting_for_source_key') return state;
    if (reason === 'runner_unreachable') return 'waiting_for_runtime';
    if (reason === 'unsupported') return 'runtime_unsupported';
    return state;
}

function statusLabel(state: ReturnType<typeof resolveSessionFollowSourceRuntimeState>): string {
    if (state === 'paused_archived') return t('session.follow.sources.pausedArchived');
    if (state === 'waiting_for_runtime') return t('session.follow.sources.waitingRuntime');
    if (state === 'runtime_unsupported') return t('session.follow.sources.unsupported');
    if (state === 'waiting_for_source_key') return t('session.follow.sources.sourceKeyWaiting');
    if (state === 'catch_up_pending') return t('session.follow.sources.catchUpPending');
    // `eligible` is the nominal state: the source is included with the
    // destination's next turn. The Account-Follow word "Following" describes a
    // different relationship and must not reach a screen reader here.
    return t('session.follow.sources.nextTurn');
}

function sourcePreparationKey(preparationTargetKey: string, sourceSessionId: string): string {
    return `${preparationTargetKey}\u0000${sourceSessionId}`;
}

type SessionFollowSourceMutationRequest = Readonly<{
    targetKey: string;
    sourceSessionId: string;
}>;

export function SessionFollowSourcesEditor(props: Readonly<{
    destination: Session;
    serverId: string | null;
    destinationMachineId: string | null;
}>) {
    const online = React.useSyncExternalStore(
        React.useCallback((listener) => subscribeServerReachabilityNetworkAllowed(() => listener()), []),
        isServerReachabilityNetworkAllowed,
        isServerReachabilityNetworkAllowed,
    );
    const enabled = useFeatureEnabled('sessions.following', { scopeKind: 'spawn', serverId: props.serverId });
    const rowsByServerId = useSessionListRowsByServerId();
    const [sources, setSources] = React.useState<readonly SessionFollowSourceV1[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [savingId, setSavingId] = React.useState<string | null>(null);
    const [failed, setFailed] = React.useState(false);
    const [preparedSourceKeys, setPreparedSourceKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const [preparingFlightKeys, setPreparingFlightKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const [preparationWaitingReasons, setPreparationWaitingReasons] = React.useState<ReadonlyMap<string, SourceKeyWaitingReason>>(() => new Map());
    const addSourceRef = React.useRef<React.ComponentRef<typeof Pressable>>(null);
    const requestVersionRef = React.useRef(0);
    const targetKey = `${props.serverId ?? ''}\u0000${props.destination.id}`;
    const preparationTargetKey = `${targetKey}\u0000${props.destinationMachineId ?? ''}`;
    const targetKeyRef = React.useRef(targetKey);
    const preparationTargetKeyRef = React.useRef(preparationTargetKey);
    const activeMutationRequestRef = React.useRef<SessionFollowSourceMutationRequest | null>(null);
    const preparationInFlightRef = React.useRef(new Set<string>());
    const committedSourceIdsRef = React.useRef<ReadonlySet<string>>(new Set());
    const edgeVersionBySourceIdRef = React.useRef(new Map<string, number>());

    const refresh = React.useCallback(async () => {
        if (!enabled || !props.serverId) return;
        const requestVersion = ++requestVersionRef.current;
        setLoading(true);
        const result = await listSessionFollowSources({ serverId: props.serverId, sessionId: props.destination.id });
        if (requestVersion !== requestVersionRef.current || targetKeyRef.current !== targetKey) return;
        if (result.kind === 'ok') {
            const committedSourceIds = new Set(result.value.sources.map((source) => source.sourceSessionId));
            const previousCommittedSourceIds = committedSourceIdsRef.current;
            for (const sourceSessionId of new Set([
                ...previousCommittedSourceIds,
                ...committedSourceIds,
            ])) {
                if (previousCommittedSourceIds.has(sourceSessionId) !== committedSourceIds.has(sourceSessionId)) {
                    edgeVersionBySourceIdRef.current.set(
                        sourceSessionId,
                        (edgeVersionBySourceIdRef.current.get(sourceSessionId) ?? 0) + 1,
                    );
                }
            }
            committedSourceIdsRef.current = committedSourceIds;
            const committedPreparationKeys = new Set([...committedSourceIds].map((sourceSessionId) => (
                sourcePreparationKey(preparationTargetKeyRef.current, sourceSessionId)
            )));
            setSources(result.value.sources);
            setPreparedSourceKeys((current) => {
                const next = new Set([...current].filter((key) => committedPreparationKeys.has(key)));
                return next.size === current.size ? current : next;
            });
            setPreparationWaitingReasons((current) => {
                const next = new Map([...current].filter(([key]) => committedPreparationKeys.has(key)));
                return next.size === current.size ? current : next;
            });
            setFailed(false);
        } else {
            setFailed(true);
        }
        setLoading(false);
    }, [enabled, props.destination.id, props.serverId, targetKey]);

    React.useEffect(() => {
        if (targetKeyRef.current !== targetKey) {
            targetKeyRef.current = targetKey;
            setSources([]);
            setFailed(false);
            setSavingId(null);
            activeMutationRequestRef.current = null;
            setPreparedSourceKeys(new Set());
            setPreparingFlightKeys(new Set());
            setPreparationWaitingReasons(new Map());
            committedSourceIdsRef.current = new Set();
            edgeVersionBySourceIdRef.current = new Map();
        }
        void refresh();
        return () => {
            requestVersionRef.current += 1;
        };
    }, [refresh, targetKey]);

    React.useEffect(() => () => {
        activeMutationRequestRef.current = null;
    }, []);

    React.useEffect(() => {
        if (preparationTargetKeyRef.current === preparationTargetKey) return;
        preparationTargetKeyRef.current = preparationTargetKey;
        activeMutationRequestRef.current = null;
        setSavingId(null);
        setPreparedSourceKeys(new Set());
        setPreparingFlightKeys(new Set());
        setPreparationWaitingReasons(new Map());
    }, [preparationTargetKey]);

    React.useEffect(() => {
        const serverId = props.serverId;
        if (!enabled || !serverId) return;
        return subscribeHomeAccountChange((event) => {
            if (!areServerProfileIdentifiersEquivalent(event.serverId, serverId)) return;
            if (
                event.entityIds
                && !event.entityIds.includes(props.destination.id)
                && !event.entityIds.some((sessionId) => committedSourceIdsRef.current.has(sessionId))
            ) return;
            void refresh();
        });
    }, [enabled, props.destination.id, props.serverId, refresh]);

    const remove = React.useCallback(async (sourceSessionId: string) => {
        if (!online || !props.serverId || savingId) return;
        const request: SessionFollowSourceMutationRequest = {
            targetKey: preparationTargetKey,
            sourceSessionId,
        };
        activeMutationRequestRef.current = request;
        setSavingId(sourceSessionId);
        const input = { serverId: props.serverId, destinationSessionId: props.destination.id, sourceSessionId };
        const result = await removeSessionFollowSource(input);
        if (
            preparationTargetKeyRef.current !== request.targetKey
            || activeMutationRequestRef.current !== request
        ) return;
        if (result.kind === 'ok') {
            await refresh();
            if (
                preparationTargetKeyRef.current !== request.targetKey
                || activeMutationRequestRef.current !== request
            ) return;
            addSourceRef.current?.focus();
        }
        else setFailed(true);
        activeMutationRequestRef.current = null;
        setSavingId(null);
    }, [online, preparationTargetKey, props.destination.id, props.serverId, refresh, savingId]);

    const updateMode = React.useCallback(async (sourceSessionId: string, mode: SessionFollowSourceModeV1) => {
        if (!online || !props.serverId || savingId) return;
        const request: SessionFollowSourceMutationRequest = {
            targetKey: preparationTargetKey,
            sourceSessionId,
        };
        activeMutationRequestRef.current = request;
        setSavingId(sourceSessionId);
        const result = await setSessionFollowSource({
            serverId: props.serverId,
            destinationSessionId: props.destination.id,
            sourceSessionId,
            mode,
        });
        if (
            preparationTargetKeyRef.current !== request.targetKey
            || activeMutationRequestRef.current !== request
        ) return;
        if (result.kind === 'ok') {
            await refresh();
            if (
                preparationTargetKeyRef.current !== request.targetKey
                || activeMutationRequestRef.current !== request
            ) return;
        }
        else setFailed(true);
        activeMutationRequestRef.current = null;
        setSavingId(null);
    }, [online, preparationTargetKey, props.destination.id, props.serverId, refresh, savingId]);

    const serverId = props.serverId;
    const homeSessions = Object.values(readSessionListRowsForServerId(rowsByServerId, serverId ?? '') ?? {});
    // Exact qualified Machine currentness belongs to the canonical scoped
    // selector. The picker-oriented Machine list intentionally filters records
    // and is not an authority for an already-bound destination Runner.
    const destinationMachine = useServerScopedMachine(serverId, props.destinationMachineId ?? '');

    const prepareSource = React.useCallback(async (sourceSessionId: string) => {
        if (!online || !props.serverId) return;
        const requestTargetKey = targetKey;
        const requestPreparationTargetKey = preparationTargetKey;
        const requestEdgeVersion = edgeVersionBySourceIdRef.current.get(sourceSessionId) ?? 0;
        const preparationSourceKey = sourcePreparationKey(requestPreparationTargetKey, sourceSessionId);
        const flightKey = `${preparationSourceKey}\u0000${requestEdgeVersion}`;
        if (preparationInFlightRef.current.has(flightKey)) return;
        preparationInFlightRef.current.add(flightKey);
        setPreparingFlightKeys((current) => new Set(current).add(flightKey));
        const result = await prepareSessionFollowSourceKey({
            serverId: props.serverId, sourceSessionId, destinationSessionId: props.destination.id,
        }).catch(() => ({ kind: 'waiting', reason: 'runner_unreachable' } as const));
        preparationInFlightRef.current.delete(flightKey);
        if (
            targetKeyRef.current !== requestTargetKey
            || preparationTargetKeyRef.current !== requestPreparationTargetKey
        ) return;
        setPreparingFlightKeys((current) => {
            const next = new Set(current);
            next.delete(flightKey);
            return next;
        });
        // A receiver result cannot establish readiness for an edge that was
        // removed while the request was in flight. The server remains the
        // pairwise authority; this prevents stale UI-lifetime state from
        // suppressing preparation if the same relation is later re-created.
        if (!committedSourceIdsRef.current.has(sourceSessionId)
            || edgeVersionBySourceIdRef.current.get(sourceSessionId) !== requestEdgeVersion) return;
        setPreparedSourceKeys((current) => {
            const next = new Set(current);
            if (result.kind === 'prepared' || result.kind === 'not_needed') next.add(preparationSourceKey);
            else next.delete(preparationSourceKey);
            return next;
        });
        setPreparationWaitingReasons((current) => {
            const next = new Map(current);
            if (result.kind === 'waiting') next.set(preparationSourceKey, result.reason);
            else next.delete(preparationSourceKey);
            return next;
        });
    }, [online, preparationTargetKey, props.destination.id, props.serverId, targetKey]);

    const preparationReadinessSignature = [
        targetKey,
        online ? 'online' : 'offline',
        props.destinationMachineId ?? '',
        destinationMachine?.active === true ? 'active' : 'inactive',
        String(destinationMachine?.activeAt ?? ''),
        String(destinationMachine?.operationProtocolCapabilitiesRevision ?? ''),
        ...sources.map((source) => {
            const session = homeSessions.find((candidate) => candidate.id === source.sourceSessionId);
            return `${source.sourceSessionId}:${source.deliveryState}:${session?.encryptionMode ?? 'unknown'}`;
        }),
    ].join('\u0000');
    const lastPreparationReadinessSignatureRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!online || lastPreparationReadinessSignatureRef.current === preparationReadinessSignature) return;
        lastPreparationReadinessSignatureRef.current = preparationReadinessSignature;
        for (const source of sources) {
            const sourceSession = homeSessions.find((candidate) => candidate.id === source.sourceSessionId);
            const runtimeState = resolveSessionFollowSourceRuntimeState({
                deliveryState: source.deliveryState,
                machine: destinationMachine,
                sourceEncryptionMode: sourceSession?.encryptionMode ?? null,
                preparedInUiLifetime: preparedSourceKeys.has(sourcePreparationKey(preparationTargetKey, source.sourceSessionId)),
                hasPendingUpdates: source.hasPendingUpdates,
                mode: source.mode,
            });
            const flightKey = `${sourcePreparationKey(preparationTargetKey, source.sourceSessionId)}\u0000${edgeVersionBySourceIdRef.current.get(source.sourceSessionId) ?? 0}`;
            if (runtimeState === 'waiting_for_source_key' && !preparingFlightKeys.has(flightKey)) {
                void prepareSource(source.sourceSessionId);
            }
        }
    }, [destinationMachine, homeSessions, online, preparationReadinessSignature, preparationTargetKey, prepareSource, preparedSourceKeys, preparingFlightKeys, sources]);

    if (!enabled || !serverId) return null;

    return <>
        <ItemGroup title={t('session.follow.sources.title')}>
            {!online ? <Item
                testID="session-follow-sources-offline"
                title={t('session.follow.offline')}
                accessibilityLiveRegion="polite"
                titleLines={0}
                showChevron={false}
                mode="info"
            /> : null}
            {loading && sources.length === 0 ? <Item title={t('common.loading')} loading showChevron={false} mode="info" /> : null}
            {!loading && sources.length === 0 && !failed ? <Item title={t('common.none')} showChevron={false} mode="info" /> : null}
            {sources.map((source) => {
                const session = homeSessions.find((candidate) => candidate.id === source.sourceSessionId);
                const runtimeState = resolveSessionFollowSourceRuntimeState({
                    deliveryState: source.deliveryState,
                    machine: destinationMachine,
                    sourceEncryptionMode: session?.encryptionMode ?? null,
                    preparedInUiLifetime: preparedSourceKeys.has(sourcePreparationKey(preparationTargetKey, source.sourceSessionId)),
                    hasPendingUpdates: source.hasPendingUpdates,
                    mode: source.mode,
                });
                const sourceTitle = session ? getSessionName(session) : source.sourceSessionId;
                const preparationSourceKey = sourcePreparationKey(preparationTargetKey, source.sourceSessionId);
                const currentFlightKey = `${preparationSourceKey}\u0000${edgeVersionBySourceIdRef.current.get(source.sourceSessionId) ?? 0}`;
                const preparing = preparingFlightKeys.has(currentFlightKey);
                const preparationWaitingReason = preparationWaitingReasons.get(preparationSourceKey);
                const presentedRuntimeState = withPreparationWaitingReason(runtimeState, preparationWaitingReason);
                const canRetryPreparation = presentedRuntimeState === 'waiting_for_source_key'
                    || preparationWaitingReason === 'runner_unreachable';
                const canChooseWake = supportsMachineSessionFollowWakeOnHumanChangeV1(
                    destinationMachine?.operationProtocolCapabilities,
                );
                const canChangeMode = canChooseWake || source.mode === 'wake_on_human_change';
                const modeLabel = source.mode === 'wake_on_human_change'
                    ? t('session.follow.sources.wakeOnHumanChange')
                    : t('session.follow.sources.nextTurn');
                const statusText = presentedRuntimeState === 'eligible' ? modeLabel : statusLabel(presentedRuntimeState);
                // The row press is never destructive: it retries preparation or
                // toggles the delivery mode, and is inert when neither applies.
                // Stopping updates always has its own labelled control, so one
                // gesture means the same thing on every destination, including
                // an older Runner without the wake capability.
                const rowAction = canRetryPreparation
                    ? {
                        detail: t('common.retry'),
                        run: () => { void prepareSource(source.sourceSessionId); },
                    }
                    : canChangeMode
                        ? {
                            detail: source.mode === 'wake_on_human_change'
                                ? t('session.follow.sources.nextTurn')
                                : t('session.follow.sources.wakeOnHumanChange'),
                            run: () => {
                                void updateMode(
                                    source.sourceSessionId,
                                    source.mode === 'wake_on_human_change' ? 'next_turn' : 'wake_on_human_change',
                                );
                            },
                        }
                        : null;
                return <Item
                    key={source.sourceSessionId}
                    testID={`session-follow-source-${source.sourceSessionId}`}
                    accessibilityLabel={[
                        t('session.follow.sources.row', { title: sourceTitle }),
                        statusText,
                        ...(rowAction ? [rowAction.detail] : []),
                    ].join('. ')}
                    title={t('session.follow.sources.row', { title: sourceTitle })}
                    subtitle={preparing ? t('session.follow.sources.sourceKeyPreparing') : statusText}
                    {...(rowAction ? { detail: rowAction.detail, onPress: rowAction.run } : {})}
                    disabled={!online || savingId !== null || preparing}
                    rightElementOutsidePressable
                    rightElement={<IconButton
                        testID={`session-follow-source-${source.sourceSessionId}-remove`}
                        iconName="trash"
                        accessibilityLabel={t('session.follow.sources.stopForSource', { title: sourceTitle })}
                        disabled={!online || savingId !== null}
                        onPress={() => { void remove(source.sourceSessionId); }}
                    />}
                />;
            })}
            {failed ? <Item
                testID="session-follow-sources-error"
                title={t('errors.unknownError')}
                detail={t('common.retry')}
                accessibilityLiveRegion="polite"
                onPress={() => { void refresh(); }}
            /> : null}
        </ItemGroup>
        <ItemGroup title={t('common.add')}>
            <Item
                pressableRef={addSourceRef}
                testID="session-follow-source-add"
                title={t('session.follow.sources.addSource')}
                subtitle={t('session.follow.sources.includeNextTurn')}
                disabled={!online || savingId !== null}
                onPress={() => openSessionFollowSourcePicker({
                    serverId,
                    sessionId: props.destination.id,
                }, addSourceRef, async (change) => {
                    if (change?.preparation === 'prepared') {
                        const preparationSourceKey = sourcePreparationKey(preparationTargetKey, change.sourceSessionId);
                        setPreparedSourceKeys((current) => new Set(current).add(preparationSourceKey));
                        setPreparationWaitingReasons((current) => {
                            const next = new Map(current);
                            next.delete(preparationSourceKey);
                            return next;
                        });
                    } else if (change?.preparation === 'waiting') {
                        const preparationSourceKey = sourcePreparationKey(preparationTargetKey, change.sourceSessionId);
                        setPreparedSourceKeys((current) => {
                            const next = new Set(current);
                            next.delete(preparationSourceKey);
                            return next;
                        });
                        setPreparationWaitingReasons((current) => new Map(current).set(preparationSourceKey, 'source_key_unavailable'));
                    }
                    await refresh();
                })}
            />
        </ItemGroup>
    </>;
}
