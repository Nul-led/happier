import type {
    LiveActivityRemoteTransportMode,
    LiveActivityRemoteUpdateCapabilityReason,
    LiveActivityRemoteUpdateMode,
} from '@happier-dev/protocol';

import type {
    LiveActivityTargetRegistrationInput,
    LiveActivityTargetRegistrationResult,
} from '@/sync/api/session/apiLiveActivityTargets';

import type { LiveActivitySnapshot } from './buildLiveActivitySnapshots';
import type { LiveActivityPushSupport, LiveActivityPushSupportReason } from './resolveLiveActivityPushSupport';

export type LiveActivityRemoteRegistrationPlan = Readonly<{
    mode: LiveActivityRemoteUpdateMode;
    status: 'remote_available' | 'blocked' | 'local_only' | 'disabled';
    reasons: readonly (LiveActivityRemoteUpdateCapabilityReason | LiveActivityPushSupportReason)[];
}>;

export type LiveActivityRemoteClientMetadata = Readonly<{
    deviceId: string | null;
    bundleId: string | null;
    environment: 'sandbox' | 'production' | null;
    clientServerUrl?: string | null;
}>;

export type LiveActivityPushTokenEvent = Readonly<{
    activityId: string;
    pushToken: string;
}>;

export type LiveActivityRemoteRegistrationSkipReason =
    | LiveActivityPushSupportReason
    | LiveActivityRemoteUpdateCapabilityReason
    | 'remote_updates_disabled'
    | 'remote_updates_local_only'
    | 'activitykit_client_metadata_missing'
    | 'direct_apns_client_metadata_missing'
    | 'background_wake_client_metadata_missing'
    | 'background_wake_expo_push_token_missing'
    | 'background_wake_runtime_task_blocked'
    /** The Activity names a Session with no Home binding, so no Home can own a remote target. */
    | 'home_binding_missing';

export type LiveActivityRemoteRegistrationResult =
    | Readonly<{ status: 'registered'; targetId: string; activityInstanceKey: string; mode: LiveActivityRemoteTransportMode }>
    | Readonly<{ status: 'skipped'; reason: LiveActivityRemoteRegistrationSkipReason; mode: LiveActivityRemoteUpdateMode }>;

type RegisterLiveActivityTarget = (
    input: LiveActivityTargetRegistrationInput,
) => Promise<LiveActivityTargetRegistrationResult>;

function firstReason(
    reasons: readonly (LiveActivityRemoteUpdateCapabilityReason | LiveActivityPushSupportReason)[],
    fallback: LiveActivityRemoteRegistrationSkipReason,
): LiveActivityRemoteRegistrationSkipReason {
    return (reasons[0] ?? fallback) as LiveActivityRemoteRegistrationSkipReason;
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}

function resolvePushSupportBlocker(pushSupport: LiveActivityPushSupport): LiveActivityPushSupportReason | null {
    return pushSupport.reasons[0] ?? null;
}

export async function registerLiveActivityRemoteTargetFromTokenEvent(params: Readonly<{
    snapshot: LiveActivitySnapshot;
    event: LiveActivityPushTokenEvent;
    registrationPlan: LiveActivityRemoteRegistrationPlan;
    pushSupport: LiveActivityPushSupport;
    clientMetadata: LiveActivityRemoteClientMetadata;
    registerTarget: RegisterLiveActivityTarget;
}>): Promise<LiveActivityRemoteRegistrationResult> {
    const mode = params.registrationPlan.mode;

    if (params.registrationPlan.status === 'disabled' || mode === 'disabled') {
        return { status: 'skipped', reason: 'remote_updates_disabled', mode };
    }
    if (params.registrationPlan.status === 'local_only' || mode === 'local_only') {
        return { status: 'skipped', reason: 'remote_updates_local_only', mode };
    }
    if (params.registrationPlan.status === 'blocked') {
        return {
            status: 'skipped',
            reason: firstReason(params.registrationPlan.reasons, 'remote_updates_local_only'),
            mode,
        };
    }
    if (!params.pushSupport.canRegisterRemoteTargets) {
        return {
            status: 'skipped',
            reason: resolvePushSupportBlocker(params.pushSupport) ?? 'expo_widgets_token_api_missing',
            mode,
        };
    }
    if (mode === 'background_wake_best_effort') {
        return {
            status: 'skipped',
            reason: 'background_wake_runtime_task_blocked',
            mode,
        };
    }
    if (mode !== 'direct_apns' && mode !== 'hosted_happier_relay') {
        return {
            status: 'skipped',
            reason: firstReason(params.registrationPlan.reasons, 'remote_updates_local_only'),
            mode,
        };
    }

    const serverId = normalizeNonEmpty(params.snapshot.serverId);
    if (!serverId) {
        return { status: 'skipped', reason: 'home_binding_missing', mode };
    }

    const deviceId = normalizeNonEmpty(params.clientMetadata.deviceId);
    const bundleId = normalizeNonEmpty(params.clientMetadata.bundleId);
    const environment = params.clientMetadata.environment;
    const activityId = normalizeNonEmpty(params.event.activityId);
    const rawToken = normalizeNonEmpty(params.event.pushToken);

    if (!deviceId || !bundleId || !environment || !activityId || !rawToken) {
        return {
            status: 'skipped',
            reason: mode === 'direct_apns'
                ? 'direct_apns_client_metadata_missing'
                : 'activitykit_client_metadata_missing',
            mode,
        };
    }

    const result = await params.registerTarget({
        deviceId,
        serverId,
        sessionId: params.snapshot.sessionId,
        activityInstanceKey: params.snapshot.activityInstanceKey,
        activityId,
        activityName: params.snapshot.activityName,
        transportMode: mode,
        tokenKind: 'activitykit_update_token',
        rawToken,
        bundleId,
        environment,
        clientServerUrl: normalizeNonEmpty(params.clientMetadata.clientServerUrl) ?? undefined,
    });

    return {
        status: 'registered',
        targetId: result.targetId,
        activityInstanceKey: params.snapshot.activityInstanceKey,
        mode,
    };
}

export async function registerLiveActivityBackgroundWakeTarget(params: Readonly<{
    snapshot: LiveActivitySnapshot;
    registrationPlan: LiveActivityRemoteRegistrationPlan;
    clientMetadata: LiveActivityRemoteClientMetadata;
    expoPushToken: string | null | undefined;
    registerTarget: RegisterLiveActivityTarget;
}>): Promise<LiveActivityRemoteRegistrationResult> {
    const mode = params.registrationPlan.mode;

    if (params.registrationPlan.status === 'disabled' || mode === 'disabled') {
        return { status: 'skipped', reason: 'remote_updates_disabled', mode };
    }
    if (params.registrationPlan.status === 'local_only' || mode === 'local_only') {
        return { status: 'skipped', reason: 'remote_updates_local_only', mode };
    }
    if (params.registrationPlan.status === 'blocked') {
        return {
            status: 'skipped',
            reason: firstReason(params.registrationPlan.reasons, 'remote_updates_local_only'),
            mode,
        };
    }
    if (mode !== 'background_wake_best_effort') {
        return {
            status: 'skipped',
            reason: firstReason(params.registrationPlan.reasons, 'remote_updates_local_only'),
            mode,
        };
    }

    const serverId = normalizeNonEmpty(params.snapshot.serverId);
    if (!serverId) {
        return { status: 'skipped', reason: 'home_binding_missing', mode };
    }

    const deviceId = normalizeNonEmpty(params.clientMetadata.deviceId);
    const expoPushToken = normalizeNonEmpty(params.expoPushToken);

    if (!deviceId) {
        return {
            status: 'skipped',
            reason: 'background_wake_client_metadata_missing',
            mode,
        };
    }
    if (!expoPushToken) {
        return {
            status: 'skipped',
            reason: 'background_wake_expo_push_token_missing',
            mode,
        };
    }

    const result = await params.registerTarget({
        deviceId,
        serverId,
        sessionId: params.snapshot.sessionId,
        activityInstanceKey: params.snapshot.activityInstanceKey,
        activityId: params.snapshot.activityInstanceKey,
        activityName: params.snapshot.activityName,
        transportMode: 'background_wake_best_effort',
        tokenKind: 'expo_push_token',
        expoPushToken,
        clientServerUrl: normalizeNonEmpty(params.clientMetadata.clientServerUrl) ?? undefined,
    });

    return {
        status: 'registered',
        targetId: result.targetId,
        activityInstanceKey: params.snapshot.activityInstanceKey,
        mode: 'background_wake_best_effort',
    };
}

export type LiveActivityRemoteTargetRegistry = Readonly<{
    remember: (target: Readonly<{
        activityInstanceKey: string;
        targetId: string;
        mode: LiveActivityRemoteTransportMode;
        serverId?: string | null;
    }>) => void;
    getTarget: (activityInstanceKey: string) => Readonly<{
        targetId: string;
        mode: LiveActivityRemoteTransportMode;
    }> | null;
    getTargetId: (activityInstanceKey: string) => string | null;
    /** Snapshot for the incumbent reconciler; this is the same in-memory registry, not an outbox. */
    listTargets: () => readonly Readonly<{
        activityInstanceKey: string;
        targetId: string;
        mode: LiveActivityRemoteTransportMode;
        serverId: string | null;
    }>[];
    /** Retries only superseded targets; the current target remains registered and discoverable. */
    retryPendingEnds: (params: Readonly<{
        activityInstanceKey: string;
        markTargetEnded: (targetId: string, serverId: string | null) => Promise<void>;
    }>) => Promise<void>;
    /**
     * Ends the remote target for this Activity instance. The mapping is forgotten only once the
     * end request has actually succeeded — or resolved as already gone. A transport or server
     * failure keeps the exact qualified target so the incumbent termination/reconnect lifecycle
     * can retry it; no outbox, retry worker or second registry is introduced (L07-I38).
     */
    markEnded: (params: Readonly<{
        activityInstanceKey: string;
        markTargetEnded: (targetId: string) => Promise<void>;
    }>) => Promise<void>;
    clear: () => void;
}>;

export function createLiveActivityRemoteTargetRegistry(): LiveActivityRemoteTargetRegistry {
    type RegisteredTarget = Readonly<{
        targetId: string;
        mode: LiveActivityRemoteTransportMode;
        serverId: string | null;
    }>;
    const targetsByActivityKey = new Map<string, RegisteredTarget>();
    const pendingEndsByActivityKey = new Map<string, Map<string, RegisteredTarget>>();

    async function endPendingTargets(params: Readonly<{
        activityInstanceKey: string;
        markTargetEnded: (targetId: string, serverId: string | null) => Promise<void>;
    }>): Promise<void> {
        const pending = pendingEndsByActivityKey.get(params.activityInstanceKey);
        if (!pending) return;
        for (const target of [...pending.values()]) {
            await params.markTargetEnded(target.targetId, target.serverId);
            if (pending.get(target.targetId) === target) pending.delete(target.targetId);
        }
        if (pending.size === 0) pendingEndsByActivityKey.delete(params.activityInstanceKey);
    }

    return {
        remember(target) {
            const activityInstanceKey = normalizeNonEmpty(target.activityInstanceKey);
            const targetId = normalizeNonEmpty(target.targetId);
            if (!activityInstanceKey || !targetId) return;
            const next = {
                targetId,
                mode: target.mode,
                serverId: normalizeNonEmpty(target.serverId),
            };
            const pendingForKey = pendingEndsByActivityKey.get(activityInstanceKey);
            pendingForKey?.delete(targetId);
            if (pendingForKey?.size === 0) pendingEndsByActivityKey.delete(activityInstanceKey);
            const previous = targetsByActivityKey.get(activityInstanceKey);
            if (previous && previous.targetId !== targetId) {
                let pending = pendingEndsByActivityKey.get(activityInstanceKey);
                if (!pending) {
                    pending = new Map();
                    pendingEndsByActivityKey.set(activityInstanceKey, pending);
                }
                pending.set(previous.targetId, previous);
            }
            targetsByActivityKey.set(activityInstanceKey, next);
        },
        getTarget(activityInstanceKey) {
            const target = targetsByActivityKey.get(activityInstanceKey);
            return target ? { targetId: target.targetId, mode: target.mode } : null;
        },
        getTargetId(activityInstanceKey) {
            return targetsByActivityKey.get(activityInstanceKey)?.targetId ?? null;
        },
        listTargets() {
            const targets = Array.from(targetsByActivityKey, ([activityInstanceKey, target]) => ({
                activityInstanceKey,
                targetId: target.targetId,
                mode: target.mode,
                serverId: target.serverId,
            }));
            for (const [activityInstanceKey, pending] of pendingEndsByActivityKey) {
                for (const target of pending.values()) {
                    targets.push({ activityInstanceKey, ...target });
                }
            }
            return targets;
        },
        retryPendingEnds(params) {
            return endPendingTargets(params);
        },
        async markEnded(params) {
            // Capture the current target before the first await. A replacement registered while
            // cleanup is in flight is a new current target and must not be ended by this request.
            const target = targetsByActivityKey.get(params.activityInstanceKey);
            await endPendingTargets({
                activityInstanceKey: params.activityInstanceKey,
                markTargetEnded: (targetId) => params.markTargetEnded(targetId),
            });
            if (!target) return;
            await params.markTargetEnded(target.targetId);
            // Only a settled end forgets the mapping. Re-read it first: a concurrent registration
            // may have replaced this target while the request was in flight.
            if (targetsByActivityKey.get(params.activityInstanceKey) === target) {
                targetsByActivityKey.delete(params.activityInstanceKey);
                return;
            }
            const pending = pendingEndsByActivityKey.get(params.activityInstanceKey);
            if (pending?.get(target.targetId) === target) {
                pending.delete(target.targetId);
                if (pending.size === 0) pendingEndsByActivityKey.delete(params.activityInstanceKey);
            }
        },
        clear() {
            targetsByActivityKey.clear();
            pendingEndsByActivityKey.clear();
        },
    };
}
