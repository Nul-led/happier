import { attachManagedSessionHumanPresenceSocket } from '@/sync/domains/session/humanPresence/attachManagedSessionHumanPresenceSocket';
import { publishHomeAccountChange } from './homeAccountChange';
import {
    TokenStorage,
    type AuthCredentials,
    isDataKeyAuthCredentials,
    isLegacyAuthCredentials,
    isTokenOnlyAuthCredentials,
    subscribeHomeCredentialMutations,
} from '@/auth/storage/tokenStorage';
import { Encryption } from '@/sync/encryption/encryption';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { fetchAndApplyMachines, type MachineDataKeyCacheEntry } from '@/sync/engine/machines/syncMachines';
import { fetchAndApplySessions } from '@/sync/engine/sessions/sessionSnapshot';
import { resolveUiClientEncryptionRequirement } from '@/sync/domains/settings/clientEncryptionRequirement';
import {
    getEffectiveServerSelectionFromRawSettings,
    type RawServerSelectionSettings,
} from '@/sync/domains/server/selection/serverSelectionResolution';
import type { ServerSelectionSettingsLike } from '@/sync/domains/server/selection/serverSelectionTypes';
import {
    areServerProfileIdentifiersEquivalent,
    listServerProfiles,
    resolveServerProfileScopeId,
    subscribeServerProfiles,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import {
    loadEffectiveHomeViewState,
    subscribeEffectiveHomeViewState,
} from '@/sync/domains/server/selection/homeViewSelectionState';
import {
    listServerProfileScopeIds,
    normalizeServerSelectionSettingsForProfileScopeIds,
} from '@/sync/domains/server/selection/serverSelectionProfileScopeIds';
import {
    getAppliedActiveServerId,
    subscribeAppliedActiveServer,
    subscribeApplyingActiveServer,
} from '@/sync/runtime/orchestration/connectionManager';
import { storage } from '@/sync/domains/state/storageStore';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import {
    invalidateCachedTransferRoutesForMachine,
    invalidateCachedTransferRoutesForServer,
} from '@/sync/domains/transfers/runtime/transferRouteCache';
import type { ConcurrentSessionListCacheEntry } from '@/sync/domains/session/listing/concurrentSessionListCache';
import {
    areSessionListHomeObservationsEqual,
    type SessionListHomeObservation,
} from '@/sync/domains/session/listing/sessionListHomeObservation';
import { buildMachineDisplayRenderableFromMachine } from '@/sync/domains/machines/machineDisplayRenderable';
import {
    buildSessionListRenderableFromSession,
    type SessionListRenderableSession,
} from '@/sync/domains/session/listing/sessionListRenderable';
import {
    buildMachineDisplaysByIdFromMachineList,
    buildSessionListIndexWithServerScope,
} from '@/sync/store/sessionListIndex/buildSessionListIndexWithServerScope';
import {
    type ManagedConnectionState,
    type ManagedConnectionTransport,
    type TransportDisconnectEvent,
} from '@happier-dev/connection-supervisor';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import {
    reportServerAuthFailed,
    reportServerUnreachable,
    acquireServerReachabilitySupervisor,
    subscribeServerReachabilityNetworkAllowed,
    subscribeServerReachabilityState,
} from '@/sync/runtime/connectivity/serverReachabilitySupervisorPool';
import { isAuthenticationResponseStatus } from '@/sync/runtime/connectivity/authErrors';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import {
    resolveServerScopedTransport,
    type ResolvedServerScopedTransport,
} from './serverScopedRpc/resolveServerScopedTransport';
import { startNativeSshTunnelRuntimeAppStateLifecycle } from '@/sync/runtime/nativeSshTunnels/runtime';
import { subscribeIrohHomeTunnelRecoveryRequired } from '@/sync/runtime/nativeIrohTunnels';
import {
    createConcurrentServerSocketTransport,
    type ConcurrentServerSocket,
} from './concurrentServerConnections/createConcurrentServerSocketTransport';
import {
    shouldRefreshConcurrentSessionCacheForUpdate,
    isAccountChangeUpdate,
} from './concurrentSessionCacheUpdateClassifier';
import { startRuntimeActiveGatedInterval } from '@/utils/runtime/isRuntimeActive';
import { areStoredMachinesEqual, hasMachineDaemonStateAdvanced } from '@/sync/store/domains/areStoredMachinesEqual';
import { registerExternalSessionStatusDemandTransport } from './externalSessions/externalSessionStatusDemandCoordinator';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import {
    schedulePushTokenReconciliation,
    startPushTokenReconciliation,
    stopPushTokenReconciliation,
} from '@/sync/engine/account/syncAccount';
import { refreshAuthenticatedServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import type { SessionListQueryPageRequest } from '@/sync/domains/session/listing/sessionListQueryController';
import { HappyError } from '@/utils/errors/errors';
import { parseToken } from '@/utils/auth/parseToken';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { normalizeActionOperationEphemeralIngress } from '@/sync/domains/actionOperations/actionOperationEphemeralIngress';
import { consumeActionOperationSnapshotPush } from '@/sync/domains/actionOperations/consumeActionOperationSnapshotPush';
import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';
import {
    advanceOrdinarySessionListFrontier,
    EMPTY_ORDINARY_SESSION_LIST_FRONTIER,
    isOrdinarySessionListFrontierComplete,
    resolveOrdinarySessionListContinuation,
    type OrdinarySessionListFrontier,
} from '@/sync/engine/sessions/ordinarySessionListFrontier';

type ConcurrentTarget = Readonly<{
    id: string;
    serverUrl: string;
    serverName: string;
    homeConnectionDescriptor?: HomeConnectionDescriptorV1;
    irohConfigKey?: string;
    canonicalServerUrl?: string;
}>;

type ConcurrentSelectionSettings = ServerSelectionSettingsLike;

function toRawConcurrentSelectionSettings(settings: ConcurrentSelectionSettings): RawServerSelectionSettings {
    return {
        serverSelectionGroups: settings.serverSelectionGroups ?? null,
        serverSelectionActiveTargetKind: settings.serverSelectionActiveTargetKind ?? null,
        serverSelectionActiveTargetId: settings.serverSelectionActiveTargetId ?? null,
    };
}

type ManagedConcurrentServer = {
    id: string;
    serverUrl: string;
    serverName: string;
    credentials: AuthCredentials;
    socket: ConcurrentServerSocket | null;
    socketTransport: ManagedConnectionTransport | null;
    reachabilityUnsubscribe: (() => void) | null;
    reachabilityRelease: (() => Promise<void>) | null;
    reachabilityAcquireGeneration: number;
    reachabilityState: ManagedConnectionState;
    detachSocketTransportListeners: Array<() => void>;
    encryption: Encryption | null;
    sessionDataKeys: Map<string, Uint8Array>;
    sessionDataKeyEnvelopes: Map<string, string>;
    machineDataKeys: Map<string, MachineDataKeyCacheEntry>;
    irohLease: ResolvedServerScopedTransport | null;
    irohConfigKey: string | null;
    refreshQueued: boolean;
    refreshInFlight: Promise<void> | null;
    refreshAbortController: AbortController | null;
    refreshTimer: ReturnType<typeof setTimeout> | null;
    sessionListFrontier: OrdinarySessionListFrontier;
    /**
     * Time of this Home's last successful ordinary Session-list observation. Kept in memory and
     * published to the store only on a phase transition, so a healthy Home refreshing every few
     * minutes never rewrites state for a timestamp nothing currently renders.
     */
    lastSessionListSuccessAt: number | null;
};

const REFRESH_DEBOUNCE_MS = 600;
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;

function readRefreshIntervalMs(): number {
    const raw = String(process.env.EXPO_PUBLIC_HAPPIER_CONCURRENT_CACHE_REFRESH_INTERVAL_MS ?? '').trim();
    if (!raw) return DEFAULT_REFRESH_INTERVAL_MS;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_INTERVAL_MS;
    return Math.max(10_000, Math.min(60 * 60_000, parsed));
}

const managedServers = new Map<string, ManagedConcurrentServer>();

function areAuthCredentialsEquivalent(a: AuthCredentials, b: AuthCredentials): boolean {
    if (a.token !== b.token) return false;
    const aLegacy = isLegacyAuthCredentials(a);
    const bLegacy = isLegacyAuthCredentials(b);
    if (aLegacy && bLegacy) return a.secret === b.secret;
    const aDataKey = isDataKeyAuthCredentials(a);
    const bDataKey = isDataKeyAuthCredentials(b);
    if (aDataKey && bDataKey) {
        return (
            a.encryption.publicKey === b.encryption.publicKey
            && a.encryption.machineKey === b.encryption.machineKey
        );
    }
    if (isTokenOnlyAuthCredentials(a) && isTokenOnlyAuthCredentials(b)) return true;
    return false;
}
let started = false;
let storageUnsubscribe: (() => void) | null = null;
let activeServerUnsubscribe: (() => void) | null = null;
let applyingActiveServerUnsubscribe: (() => void) | null = null;
let serverProfilesUnsubscribe: (() => void) | null = null;
let homeViewStateUnsubscribe: (() => void) | null = null;
let homeCredentialMutationsUnsubscribe: (() => void) | null = null;
let networkAllowedUnsubscribe: (() => void) | null = null;
let irohRecoveryUnsubscribe: (() => void) | null = null;
let periodicRefreshStop: (() => void) | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileRequestRevision = 0;
let applyingActiveServerId = '';

function normalizeServerUrl(url: string): string {
    return canonicalizeServerUrl(String(url ?? ''));
}

function normalizeServerId(value: unknown): string {
    return String(value ?? '').trim();
}

function readConcurrentSelectionSettings(): ConcurrentSelectionSettings {
    const homeViewState = loadEffectiveHomeViewState();
    if (homeViewState) {
        return {
            serverSelectionGroups: homeViewState.groups,
            serverSelectionActiveTargetKind: homeViewState.activeTargetKind,
            serverSelectionActiveTargetId: homeViewState.activeTargetId,
        };
    }
    const settings = storage.getState().settings;
    return {
        serverSelectionGroups: Array.isArray(settings.serverSelectionGroups)
            ? settings.serverSelectionGroups
            : [],
        serverSelectionActiveTargetKind:
            settings.serverSelectionActiveTargetKind === 'server'
            || settings.serverSelectionActiveTargetKind === 'group'
                ? settings.serverSelectionActiveTargetKind
                : null,
        serverSelectionActiveTargetId: typeof settings.serverSelectionActiveTargetId === 'string'
            ? settings.serverSelectionActiveTargetId
            : null,
    };
}

function createServerRequest(
    entry: ManagedConcurrentServer,
    observeResponse: (response: Response) => void,
    signal: AbortSignal,
): (path: string, init: RequestInit) => Promise<Response> {
    const request = createServerFetchAtEndpoint({
        endpointUrl: entry.serverUrl,
        ...(entry.irohLease ? { runtimeOrigin: entry.irohLease.runtimeOrigin } : {}),
        ...(entry.irohLease?.homeCarrier ? { homeCarrier: entry.irohLease.homeCarrier } : {}),
        credentials: entry.credentials,
        serverId: entry.id,
        signal,
    });
    return async (path: string, init: RequestInit) => {
        const requestPath = String(path ?? '').startsWith('/') ? String(path) : `/${String(path ?? '')}`;
        const response = await request(requestPath, init);
        observeResponse(response);
        return response;
    };
}

export function resolveConcurrentTargets(params: Readonly<{
    activeServerId: string;
    profiles: ReadonlyArray<Readonly<{
        id: string;
        serverUrl: string;
        name: string;
        serverIdentityId?: string | null;
        legacyServerIds?: readonly string[];
        homeConnectionDescriptor?: HomeConnectionDescriptorV1;
        canonicalServerUrl?: string | null;
    }>>;
    settings: ConcurrentSelectionSettings;
}>): ConcurrentTarget[] {
    const selection = getEffectiveServerSelectionFromRawSettings({
        activeServerId: params.activeServerId,
        availableServerIds: listServerProfileScopeIds(params.profiles),
        settings: normalizeServerSelectionSettingsForProfileScopeIds(
            toRawConcurrentSelectionSettings(params.settings),
            params.profiles,
        ),
    });
    if (!selection.enabled) {
        return [];
    }
    const selected = new Set(selection.serverIds);
    selected.delete(params.activeServerId);
    if (selected.size === 0) {
        return [];
    }
    const targets: ConcurrentTarget[] = [];
    for (const profile of params.profiles) {
        const scopeId = resolveServerProfileScopeId(profile);
        if (!selected.has(scopeId)) continue;
        const serverUrl = normalizeServerUrl(profile.canonicalServerUrl ?? profile.serverUrl);
        if (!serverUrl) continue;
        targets.push({
            id: scopeId,
            serverUrl,
            serverName: String(profile.name ?? scopeId).trim() || scopeId,
            ...(profile.canonicalServerUrl ? { canonicalServerUrl: serverUrl } : {}),
            ...(profile.homeConnectionDescriptor
                ? {
                    homeConnectionDescriptor: profile.homeConnectionDescriptor,
                    irohConfigKey: JSON.stringify(profile.homeConnectionDescriptor),
                    canonicalServerUrl: serverUrl,
                }
                : {}),
        });
    }
    return targets;
}

async function getOrCreateEncryption(entry: ManagedConcurrentServer): Promise<Encryption | null> {
    if (entry.encryption) return entry.encryption;
    if (isTokenOnlyAuthCredentials(entry.credentials)) return null;
    entry.encryption = await createEncryptionFromAuthCredentials(entry.credentials);
    return entry.encryption;
}

function compactSessionListRowsForViewData(
    input: Readonly<Record<string, SessionListRenderableSession | null | undefined>>,
): Record<string, SessionListRenderableSession> {
    const out: Record<string, SessionListRenderableSession> = {};
    for (const sessionId in input) {
        const row = input[sessionId];
        if (row) {
            out[sessionId] = row;
        }
    }
    return out;
}

function readOrdinarySessionListRowsForServer(
    state: ReturnType<typeof storage.getState>,
    serverId: string,
): Readonly<Record<string, SessionListRenderableSession>> {
    const rows = state.sessionListRowsByServerId?.[serverId] ?? {};
    const membership = state.ordinarySessionListMembershipByServerId?.[serverId] ?? [];
    if (membership.length === Object.keys(rows).length && membership.every((sessionId) => Boolean(rows[sessionId]))) {
        return rows;
    }
    return Object.fromEntries(membership.flatMap((sessionId) => {
        const row = rows[sessionId];
        return row ? [[sessionId, row] as const] : [];
    }));
}

function updateConcurrentSessionListCache(params: Readonly<{
    serverId: string;
    entry: ConcurrentSessionListCacheEntry | null;
}>): void {
    storage.setState((state) => {
        const serverId = normalizeServerId(params.serverId);
        if (!serverId) {
            return state;
        }

        const previous = state.concurrentSessionListCacheByServerId?.[serverId];
        const next = params.entry;

        if (previous === next) {
            return state;
        }

        if (previous && next) {
            const previousName = String(previous.serverName ?? '').trim() || null;
            const nextName = String(next.serverName ?? '').trim() || null;
            if (
                previousName === nextName
                && areSessionListHomeObservationsEqual(previous.listObservation, next.listObservation)
            ) {
                return state;
            }
        }

        return {
            ...state,
            concurrentSessionListCacheByServerId: {
                ...state.concurrentSessionListCacheByServerId,
                [serverId]: next,
            },
        };
    });
}

/**
 * Publishes the exact Home's raw list observation. This is the ordinary-Home half of Lane 07's one
 * currentness fact: `SessionListQueryHomeState` supplies it for query-backed Homes, and every
 * surface projects both through `buildSessionContextFacts` rather than timing its own staleness.
 */
function publishConcurrentSessionListObservation(params: Readonly<{
    entry: ManagedConcurrentServer;
    phase: SessionListHomeObservation['phase'];
}>): void {
    const serverId = normalizeServerId(params.entry.id);
    if (!serverId) return;
    updateConcurrentSessionListCache({
        serverId,
        entry: {
            serverName: String(params.entry.serverName ?? '').trim() || null,
            listObservation: {
                phase: params.phase,
                lastSuccessAt: params.entry.lastSessionListSuccessAt,
            },
        },
    });
}

/**
 * One successful Session-list observation for this exact Home. The timestamp always advances in
 * memory; the store is only rewritten when the published phase is not already `ready`, because a
 * current Home renders no last-updated words.
 */
function noteConcurrentSessionListObserved(entry: ManagedConcurrentServer): void {
    entry.lastSessionListSuccessAt = Date.now();
    const serverId = normalizeServerId(entry.id);
    if (!serverId) return;
    const published = storage.getState().concurrentSessionListCacheByServerId?.[serverId];
    if (
        published?.listObservation?.phase === 'ready'
        && (String(published.serverName ?? '').trim() || null) === (String(entry.serverName ?? '').trim() || null)
    ) {
        return;
    }
    publishConcurrentSessionListObservation({ entry, phase: 'ready' });
}

function areMachineListsEqual(previous: Machine[] | null | undefined, next: Machine[] | null | undefined): boolean {
    if (previous === next) return true;
    if (!Array.isArray(previous) || !Array.isArray(next)) return previous === next;
    if (previous.length !== next.length) return false;

    for (let index = 0; index < previous.length; index += 1) {
        if (!areStoredMachinesEqual(previous[index], next[index])) return false;
    }

    return true;
}

function updateConcurrentMachineListCache(input: {
    serverId: string;
    machines: Machine[] | null;
    status: 'idle' | 'loading' | 'signedOut' | 'error';
    authoritative?: boolean;
}): void {
    storage.setState((state) => {
        const serverId = normalizeServerId(input.serverId);
        if (!serverId) {
            return state;
        }

        const nextMachineListByServerId = (() => {
            const previous = state.machineListByServerId?.[serverId];
            let nextMachines = input.machines;

            if (Array.isArray(input.machines) && !input.authoritative) {
                if (!Array.isArray(previous) || previous.length === 0) {
                    nextMachines = input.machines;
                } else {
                    // SWR merge: keep older machines that are missing from this refresh response.
                    // This avoids confusing "disappear then reappear" flicker if a server returns a
                    // partial list transiently.
                    const nextIds = new Set(input.machines.map((m) => m.id));
                    if (nextIds.size === 0) {
                        nextMachines = previous;
                    } else {
                        const merged: Machine[] = [...input.machines];
                        for (const machine of previous) {
                            if (!nextIds.has(machine.id)) {
                                merged.push(machine);
                            }
                        }
                        nextMachines = merged;
                    }
                }
            }

            if (previous !== undefined && areMachineListsEqual(previous, nextMachines)) {
                return state.machineListByServerId;
            }

            if (Array.isArray(nextMachines)) {
                const previousMachinesById = new Map(
                    (Array.isArray(previous) ? previous : []).map((machine) => [machine.id, machine]),
                );
                for (const machine of nextMachines) {
                    if (!hasMachineDaemonStateAdvanced(previousMachinesById.get(machine.id), machine)) continue;
                    invalidateCachedTransferRoutesForMachine({
                        serverId,
                        remoteMachineId: machine.id,
                    });
                }
            }

            return {
                ...state.machineListByServerId,
                [serverId]: nextMachines,
            };
        })();
        const nextMachineListStatusByServerId = state.machineListStatusByServerId?.[serverId] === input.status
            ? state.machineListStatusByServerId
            : {
                ...state.machineListStatusByServerId,
                [serverId]: input.status,
            };

        const nextIndexByServerId = (() => {
            if (nextMachineListByServerId === state.machineListByServerId) {
                return state.sessionListIndexByServerId;
            }

            const rows = readOrdinarySessionListRowsForServer(state, serverId);
            if (Object.keys(rows).length === 0) {
                return state.sessionListIndexByServerId;
            }

            const serverName = state.concurrentSessionListCacheByServerId?.[serverId]?.serverName ?? undefined;
            const previousIndexByServerId = state.sessionListIndexByServerId ?? {};
            const index = buildSessionListIndexWithServerScope({
                sessions: compactSessionListRowsForViewData(rows),
                machines: buildMachineDisplaysByIdFromMachineList(nextMachineListByServerId?.[serverId]),
                activeGroupingV1: state.settings.sessionListActiveGroupingV1,
                inactiveGroupingV1: state.settings.sessionListInactiveGroupingV1,
                sectionModeV1: state.settings.sessionListSectionModeV1,
                serverScope: {
                    serverId,
                    serverName,
                },
                previousIndex: previousIndexByServerId[serverId] ?? null,
            });
            if (previousIndexByServerId[serverId] === index) {
                return previousIndexByServerId;
            }
            return {
                ...previousIndexByServerId,
                [serverId]: index,
            };
        })();

        if (
            nextMachineListByServerId === state.machineListByServerId
            && nextMachineListStatusByServerId === state.machineListStatusByServerId
            && nextIndexByServerId === state.sessionListIndexByServerId
        ) {
            return state;
        }

        return {
            ...state,
            machineListByServerId: nextMachineListByServerId,
            machineListStatusByServerId: nextMachineListStatusByServerId,
            sessionListIndexByServerId: nextIndexByServerId,
        };
    });
}

function clearConcurrentSessionListCache(serverIdRaw: string): void {
    const serverId = normalizeServerId(serverIdRaw);
    if (!serverId) return;
    const activeServerId = normalizeServerId(getAppliedActiveServerId());
    // The active ordinary Sync publishes its observation through this existing shared map. A
    // concurrent-runtime reconciliation stops managing that Home, but must not erase the active
    // owner's currentness fact while doing so.
    if (areServerProfileIdentifiersEquivalent(serverId, activeServerId)) return;
    storage.setState((state) => {
        const current = state.concurrentSessionListCacheByServerId ?? {};
        if (!(serverId in current)) return state;

        const next = { ...current };
        delete next[serverId];

        return {
            ...state,
            concurrentSessionListCacheByServerId: next,
        };
    });
    storage.getState().clearSessionListRowsForServerScope(serverId);
}

function clearConcurrentMachineListCache(serverIdRaw: string): void {
    const serverId = normalizeServerId(serverIdRaw);
    if (!serverId) return;
    storage.setState((state) => {
        if (!(serverId in state.machineListByServerId) && !(serverId in state.machineListStatusByServerId)) {
            return state;
        }

        const nextMachines = { ...state.machineListByServerId };
        const nextStatuses = { ...state.machineListStatusByServerId };
        delete nextMachines[serverId];
        delete nextStatuses[serverId];

        return {
            ...state,
            machineListByServerId: nextMachines,
            machineListStatusByServerId: nextStatuses,
        };
    });
}

async function refreshServerSnapshot(entry: ManagedConcurrentServer, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    let responseBytes = 0;
    const encryption = await getOrCreateEncryption(entry);
    const request = createServerRequest(entry, (response) => {
        if (isAuthenticationResponseStatus(response.status)) {
            reportServerAuthFailed(entry.serverUrl, response.status, undefined, entry.credentials.token);
        }
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > 0) {
            responseBytes += contentLength;
        }
    }, signal);
    let fallbackSessions: Session[] = [];
    let didApplySessionListRenderables = false;
    let machines: Machine[] = [];
    const shouldContinue = () => (
        !signal.aborted
        && managedServers.get(entry.id) === entry
        && entry.reachabilityState.phase === 'online'
    );
    const previousFrontier = entry.sessionListFrontier;
    const continuation = resolveOrdinarySessionListContinuation(previousFrontier);
    try {
        const result = await fetchAndApplySessions({
            clientEncryptionRequirement: resolveUiClientEncryptionRequirement({
                syncedSettings: storage.getState().settings,
                localSettings: storage.getState().settings,
            }),
            serverId: entry.id,
            sessionListCursor: continuation?.kind === 'ordinary' ? continuation.cursor : null,
            sessionListAttentionCursor: continuation?.kind === 'attention' ? continuation.cursor : null,
            includeActiveSessionRows: continuation === null,
            includeSessionListAttentionRows: continuation === null || continuation.kind === 'attention',
            credentials: entry.credentials,
            encryption,
            sessionDataKeys: entry.sessionDataKeys,
            sessionDataKeyEnvelopes: entry.sessionDataKeyEnvelopes,
            request,
            getExistingSession: () => null,
            getCurrentSessionListRenderable: (sessionId) => (
                storage.getState().sessionListRowsByServerId?.[entry.id]?.[sessionId]
                ?? null
            ),
            shouldContinue,
            applySessionListRenderables: (nextRenderables) => {
                if (!shouldContinue()) return;
                didApplySessionListRenderables = true;
                storage.getState().applyServerScopedSessionListRows(entry.id, nextRenderables, {
                    source: 'ordinary',
                    mode: continuation ? 'append' : 'replace',
                });
            },
            applySessionListRenderablePatches: (patches) => {
                if (!shouldContinue()) return;
                storage.getState().applyServerScopedSessionListRowPatches(entry.id, patches);
            },
            applySessions: (nextSessions) => {
                // Compatibility for focused test doubles and older adapters that
                // still exercise only the hydrated callback. Production applies
                // the lightweight renderable projection above.
                if (!didApplySessionListRenderables) fallbackSessions = nextSessions as Session[];
            },
            log: { log: () => {} },
        });
        if (!result.current || !shouldContinue()) return;
        entry.sessionListFrontier = advanceOrdinarySessionListFrontier({
            previous: continuation ? previousFrontier : EMPTY_ORDINARY_SESSION_LIST_FRONTIER,
            continuation,
            result,
        });
        if (isOrdinarySessionListFrontierComplete(entry.sessionListFrontier)) {
            noteConcurrentSessionListObserved(entry);
        } else {
            entry.refreshQueued = true;
        }

        await fetchAndApplyMachines({
            credentials: entry.credentials,
            encryption,
            machineDataKeys: entry.machineDataKeys,
            request,
            throwOnError: true,
            sourceServerId: entry.id,
            applyMachines: (nextMachines) => {
                machines = nextMachines;
            },
        });

        // Guard against late async writes: a refresh can finish after this server is removed.
        if (!shouldContinue()) {
            return;
        }

        updateConcurrentMachineListCache({
            serverId: entry.id,
            machines,
            status: 'idle',
            authoritative: true,
        });
        if (!didApplySessionListRenderables) {
            const previousRows = storage.getState().sessionListRowsByServerId?.[entry.id] ?? {};
            const nextRenderables = fallbackSessions.map((session) => (
                buildSessionListRenderableFromSession(session, previousRows[session.id])
            ));
            storage.getState().applyServerScopedSessionListRows(entry.id, nextRenderables, {
                source: 'ordinary',
                mode: continuation ? 'append' : 'replace',
            });
        }
    } finally {
        syncPerformanceTelemetry.recordDuration(
            'sync.concurrent.refresh',
            Date.now() - startedAt,
            { responseBytes },
        );
    }
}

export function isConcurrentSessionListQueryHomeOnline(serverIdRaw: string): boolean {
    const serverId = normalizeServerId(serverIdRaw);
    const entry = managedServers.get(serverId);
    return Boolean(entry && entry.reachabilityState.phase === 'online');
}

export async function fetchConcurrentSessionListQueryPage(
    serverIdRaw: string,
    page: SessionListQueryPageRequest,
) {
    const serverId = normalizeServerId(serverIdRaw);
    const entry = managedServers.get(serverId);
    if (!entry || entry.reachabilityState.phase !== 'online') {
        throw new HappyError('Selected Home query runtime is unavailable', true, {
            kind: 'network',
            code: 'home_unavailable',
        });
    }
    const encryption = await getOrCreateEncryption(entry);
    const request = createServerRequest(entry, (response) => {
        if (isAuthenticationResponseStatus(response.status)) {
            reportServerAuthFailed(entry.serverUrl, response.status, undefined, entry.credentials.token);
        }
    }, page.signal);
    const shouldContinue = () => (
        !page.signal.aborted
        && managedServers.get(serverId) === entry
        && entry.reachabilityState.phase === 'online'
    );
    return fetchAndApplySessions({
        clientEncryptionRequirement: resolveUiClientEncryptionRequirement({
            syncedSettings: storage.getState().settings,
            localSettings: storage.getState().settings,
        }),
        serverId,
        source: page.source,
        sessionListPageSize: page.limit ?? (page.source.kind === 'query' ? page.source.body.limit : undefined),
        sessionListCursor: page.cursor,
        sessionListAttentionCursor: page.attentionCursor,
        sessionListMaxPages: 1,
        sessionListAttentionMaxPages: 1,
        credentials: entry.credentials,
        encryption,
        sessionDataKeys: entry.sessionDataKeys,
        sessionDataKeyEnvelopes: entry.sessionDataKeyEnvelopes,
        request,
        getExistingSession: () => null,
        getCurrentSessionListRenderable: (sessionId) => (
            storage.getState().sessionListRowsByServerId?.[serverId]?.[sessionId]
            ?? null
        ),
        shouldContinue,
        applySessionListRenderables: (sessions) => {
            if (!shouldContinue()) return;
            storage.getState().applyServerScopedSessionListRows(serverId, sessions, {
                // Ordinary, archived and query pages share this pagination owner but
                // remain distinct canonical memberships in the store.
                source: page.membership,
                mode: page.cursor || page.attentionCursor ? 'append' : 'replace',
            });
        },
        applySessionListRenderablePatches: (patches) => {
            if (!shouldContinue()) return;
            storage.getState().applyServerScopedSessionListRowPatches(serverId, patches);
            // Row hydration from an ad-hoc Voice/Action read is not a list observation: it owns no
            // membership, so letting it advance this Home's currentness would make a one-off
            // command answer "how fresh is this Home's Session list" (Lane 07.2 §6, L07-I35).
            if (page.membership !== 'rowOnly') noteConcurrentSessionListObserved(entry);
        },
        applySessions: () => {},
        log: { log: () => {} },
    });
}

function isManagedServerActive(entry: ManagedConcurrentServer): boolean {
    return managedServers.get(entry.id) === entry;
}

function queueRefresh(entry: ManagedConcurrentServer, source: 'socket' | 'other' = 'other'): void {
    if (!isManagedServerActive(entry)) return;
    if (entry.reachabilityState.phase !== 'online') return;
    if (entry.refreshTimer) {
        if (source === 'socket') {
            syncPerformanceTelemetry.count('sync.concurrent.refresh.socket', { coalesced: 1 });
        }
        return;
    }
    if (source === 'socket') {
        syncPerformanceTelemetry.count('sync.concurrent.refresh.socket', { enqueued: 1 });
    }
    entry.refreshTimer = setTimeout(() => {
        entry.refreshTimer = null;
        void runRefresh(entry, source);
    }, REFRESH_DEBOUNCE_MS);
}

async function runRefresh(entry: ManagedConcurrentServer, source: 'socket' | 'other'): Promise<void> {
    if (!isManagedServerActive(entry)) return;
    if (entry.reachabilityState.phase !== 'online') return;
    if (entry.refreshInFlight) {
        entry.refreshQueued = true;
        if (source === 'socket') {
            syncPerformanceTelemetry.count('sync.concurrent.refresh.socket', { inFlightQueued: 1 });
        }
        return;
    }
    entry.refreshInFlight = (async () => {
        const abortController = new AbortController();
        entry.refreshAbortController = abortController;
        // One observation lifecycle per attempt: publish the attempt before the work so a Home
        // with retained rows reads as refreshing rather than current, and a Home that has never
        // been observed reads as loading rather than absent.
        const successAtBeforeRefresh = entry.lastSessionListSuccessAt;
        publishConcurrentSessionListObservation({
            entry,
            phase: successAtBeforeRefresh === null ? 'loading' : 'refreshing',
        });
        try {
            await refreshServerSnapshot(entry, abortController.signal);
        } catch (error) {
            if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
                return;
            }
            if (!isManagedServerActive(entry)) return;
            const cachedMachines = storage.getState().machineListByServerId?.[entry.id] ?? null;
            updateConcurrentMachineListCache({
                serverId: entry.id,
                machines: cachedMachines,
                status: 'error',
            });
            // Only this attempt's own failure is publishable. A Session-list success that landed
            // during it and the reachability owner's `offline` fact are both more current than a
            // stale error, so neither is overwritten. The last success time is preserved either
            // way, so retained rows stay truthfully labelled.
            if (
                entry.reachabilityState.phase === 'online'
                && entry.lastSessionListSuccessAt === successAtBeforeRefresh
            ) {
                publishConcurrentSessionListObservation({ entry, phase: 'error' });
            }
        } finally {
            if (entry.refreshAbortController === abortController) {
                entry.refreshAbortController = null;
            }
        }
    })();
    try {
        await entry.refreshInFlight;
    } finally {
        entry.refreshInFlight = null;
        if (entry.refreshQueued && isManagedServerActive(entry)) {
            entry.refreshQueued = false;
            queueRefresh(entry);
        }
    }
}

async function disposeManagedServer(entry: ManagedConcurrentServer): Promise<void> {
    entry.reachabilityAcquireGeneration += 1;
    entry.refreshQueued = false;
    entry.refreshAbortController?.abort('secondary-runtime-disposed');
    entry.refreshAbortController = null;
    if (entry.refreshTimer) {
        clearTimeout(entry.refreshTimer);
        entry.refreshTimer = null;
    }
    entry.reachabilityUnsubscribe?.();
    entry.reachabilityUnsubscribe = null;
    const reachabilityRelease = entry.reachabilityRelease;
    entry.reachabilityRelease = null;
    entry.socket = null;
    for (const detach of entry.detachSocketTransportListeners.splice(0)) {
        detach();
    }
    const transport = entry.socketTransport;
    entry.socketTransport = null;
    const irohLease = entry.irohLease;
    entry.irohLease = null;
    if (managedServers.get(entry.id) === entry) {
        managedServers.delete(entry.id);
    }
    invalidateCachedTransferRoutesForServer({ serverId: entry.id });
    await Promise.allSettled([
        reachabilityRelease?.(),
        transport?.disconnect({ intentional: true }),
        transport?.destroy(),
        irohLease?.release(),
    ].filter((pending): pending is Promise<void> => Boolean(pending)));
}

function stopManagedServer(serverId: string): void {
    const entry = managedServers.get(serverId);
    if (!entry) return;
    void disposeManagedServer(entry);
}

async function createManagedServer(
    target: ConcurrentTarget,
    credentials: AuthCredentials,
    irohLease: ResolvedServerScopedTransport | null,
): Promise<ManagedConcurrentServer> {
    const normalizedServerUrl = normalizeServerUrl(target.serverUrl) || target.serverUrl;
    const entry: ManagedConcurrentServer = {
        id: target.id,
        serverUrl: normalizedServerUrl,
        serverName: target.serverName,
        credentials,
        socket: null,
        socketTransport: null,
        reachabilityUnsubscribe: null,
        reachabilityRelease: null,
        reachabilityAcquireGeneration: 0,
        reachabilityState: {
            phase: 'idle',
            reason: null,
            attempt: 0,
            nextRetryAt: null,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            lastErrorMessage: null,
        },
        detachSocketTransportListeners: [],
        encryption: null,
        sessionDataKeys: new Map<string, Uint8Array>(),
        sessionDataKeyEnvelopes: new Map<string, string>(),
        machineDataKeys: new Map<string, MachineDataKeyCacheEntry>(),
        irohLease,
        irohConfigKey: target.irohConfigKey ?? null,
        refreshQueued: false,
        refreshInFlight: null,
        refreshAbortController: null,
        refreshTimer: null,
        sessionListFrontier: EMPTY_ORDINARY_SESSION_LIST_FRONTIER,
        // Recreating the managed entry (credential rotation, carrier change) does not un-observe
        // this Home: its retained rows keep the success time already published for that exact
        // serverId, so the first attempt of the new entry cannot report "never observed".
        lastSessionListSuccessAt: storage.getState()
            .concurrentSessionListCacheByServerId?.[normalizeServerId(target.id)]
            ?.listObservation?.lastSuccessAt ?? null,
    };

    // The reachability subscription emits synchronously. Publish the exact
    // entry first so an already-online shared supervisor can initialize it.
    managedServers.set(entry.id, entry);
    try {
    entry.reachabilityUnsubscribe = subscribeServerReachabilityState(normalizedServerUrl, (state) => {
        if (!isManagedServerActive(entry)) return;
        const previousPhase = entry.reachabilityState.phase;
        entry.reachabilityState = state;

        if (state.phase === 'auth_failed') {
            updateConcurrentSessionListCache({ serverId: entry.id, entry: null });
            updateConcurrentMachineListCache({
                serverId: entry.id,
                machines: null,
                status: 'signedOut',
            });
            void entry.socketTransport?.disconnect({ intentional: true });
            return;
        }

        if (state.phase !== 'online') {
            const cachedMachines = storage.getState().machineListByServerId?.[entry.id] ?? null;
            updateConcurrentMachineListCache({
                serverId: entry.id,
                machines: cachedMachines,
                status: 'error',
            });
            // Retained rows stay visible; the shared context owner labels them as this Home's
            // last known truth rather than letting a surface guess or drop them.
            publishConcurrentSessionListObservation({ entry, phase: 'offline' });
            void entry.socketTransport?.disconnect({ intentional: true });
            return;
        }

        // Reachability returning does not make this Home's rows current: the observation stays at
        // its last published phase until a real list observation lands and flips it to `ready`.
        if (previousPhase !== 'online') {
            schedulePushTokenReconciliation();
        }

        if (!entry.socketTransport) {
            const { socket, transport } = createConcurrentServerSocketTransport({
                serverUrl: normalizedServerUrl,
                token: credentials.token,
                ...(entry.irohLease
                    ? { runtimeOrigin: entry.irohLease.runtimeOrigin, carrier: entry.irohLease.carrier }
                    : {}),
                ...(entry.irohLease?.homeCarrier ? { homeCarrier: entry.irohLease.homeCarrier } : {}),
            });
            entry.socket = socket;
            entry.socketTransport = transport;
            const statusDemandTransport = registerExternalSessionStatusDemandTransport(
                entry.id,
                (event, payload) => {
                    if (socket.connected) {
                        socket.emit(event, payload);
                    }
                },
            );
            let ingressAccountId: string | null = null;
            let hasConnectedOnce = false;
            try {
                ingressAccountId = parseToken(credentials.token);
            } catch {
                // Authentication/reachability owns invalid credentials. Action ingress fails closed.
            }
            socket.on('update', (raw: unknown) => {
                if (isAccountChangeUpdate(raw)) {
                    schedulePushTokenReconciliation();
                    publishHomeAccountChange(entry.id);
                }
                if (!shouldRefreshConcurrentSessionCacheForUpdate(raw)) {
                    return;
                }
                queueRefresh(entry, 'socket');
            });
            socket.on('ephemeral', (raw: unknown) => {
                statusDemandTransport.observeEphemeral(raw);
                const update = normalizeActionOperationEphemeralIngress(raw);
                const encryption = entry.encryption;
                if (!update || !ingressAccountId || !encryption) return;
                const accountId = ingressAccountId;
                fireAndForget(consumeActionOperationSnapshotPush({
                    update,
                    accountId,
                    sourceServerId: entry.id,
                    openSnapshot: (ciphertext) => encryption.openActionOperationSnapshotRaw(ciphertext),
                    shouldContinue: () => isManagedServerActive(entry),
                    onSnapshot: (operation) => actionOperationPresentationCoordinator.observe(operation),
                }), { tag: 'concurrentSessionCache.actionOperationEphemeral' });
            });

            entry.detachSocketTransportListeners = [
                attachManagedSessionHumanPresenceSocket({
                    serverId: entry.id, token: credentials.token, socket, transport,
                }),
                transport.onConnected(() => {
                    statusDemandTransport.resend();
                    // This content-free secondary transport has no changes
                    // cursor. A reconnect may have missed governance or Team
                    // wakes, so conservatively invalidate only this captured
                    // Home's reconstructible Account projections.
                    if (hasConnectedOnce) publishHomeAccountChange(entry.id);
                    hasConnectedOnce = true;
                    queueRefresh(entry);
                }),
                transport.onDisconnected((event: TransportDisconnectEvent) => {
                    if (event.intentional) return;
                    reportServerUnreachable(normalizedServerUrl, event.error ?? new Error(event.reason ?? 'socket disconnect'), credentials.token);
                }),
                transport.onError((error: unknown) => {
                    reportServerUnreachable(normalizedServerUrl, error, credentials.token);
                }),
                () => statusDemandTransport.dispose(),
            ];
        }

        if (entry.socketTransport.isConnected() !== true) {
            void entry.socketTransport.connect();
        }
    }, credentials.token);

    await acquireManagedServerReachability(entry);
    return entry;
    } catch (error) {
        await disposeManagedServer(entry);
        throw error;
    }
}

async function acquireManagedServerReachability(entry: ManagedConcurrentServer): Promise<void> {
    const acquireGeneration = entry.reachabilityAcquireGeneration + 1;
    entry.reachabilityAcquireGeneration = acquireGeneration;
    const lease = await acquireServerReachabilitySupervisor({
        serverUrl: entry.serverUrl,
        token: entry.credentials.token,
        ...(entry.irohLease && normalizeServerUrl(entry.irohLease.runtimeOrigin) !== entry.serverUrl
            ? { runtimeOrigin: entry.irohLease.runtimeOrigin }
            : {}),
        // An ingress-less secondary Home has no URL a platform fetch can probe,
        // so readiness is proven over the same carrier its requests will use.
        homeCarrier: entry.irohLease?.homeCarrier ?? null,
    });

    if (
        !started
        || managedServers.get(entry.id) !== entry
        || entry.reachabilityAcquireGeneration !== acquireGeneration
    ) {
        await lease.release().catch(() => undefined);
        return;
    }

    const previousRelease = entry.reachabilityRelease;
    entry.reachabilityRelease = lease.release;
    await previousRelease?.().catch(() => undefined);
}

async function acquireConcurrentHomeTransport(
    target: ConcurrentTarget,
    credentials: AuthCredentials,
): Promise<ResolvedServerScopedTransport> {
    // Reuse the existing single AppState owner for every native loopback
    // carrier; concurrent Homes do not create a second lifecycle mount.
    if (target.homeConnectionDescriptor?.endpoints.some((endpoint) => endpoint.kind === 'iroh')) {
        startNativeSshTunnelRuntimeAppStateLifecycle();
    }
    return await resolveServerScopedTransport({
        profile: {
            serverUrl: target.serverUrl,
            canonicalServerUrl: target.canonicalServerUrl ?? target.serverUrl,
            homeConnectionDescriptor: target.homeConnectionDescriptor,
        },
        credentials,
    });
}

async function reconcileConcurrentServers(requestRevision: number): Promise<void> {
    if (!started || requestRevision !== reconcileRequestRevision) return;
    const profiles = listServerProfiles();
    const activeServerId = getAppliedActiveServerId();
    const stagedActiveServerId = normalizeServerId(getActiveServerSnapshot().serverId);
    const hasUnappliedStagedTarget = stagedActiveServerId
        && !areServerProfileIdentifiersEquivalent(stagedActiveServerId, activeServerId);
    const selectionSettings = readConcurrentSelectionSettings();
    const targets = resolveConcurrentTargets({
        activeServerId,
        profiles: profiles.map((profile) => ({
            id: profile.id,
            serverUrl: profile.serverUrl,
            name: profile.name,
            serverIdentityId: profile.serverIdentityId,
            legacyServerIds: profile.legacyServerIds,
            homeConnectionDescriptor: profile.homeConnectionDescriptor,
            canonicalServerUrl: profile.canonicalServerUrl,
        })),
        settings: selectionSettings,
    }).filter((target) => (
        !areServerProfileIdentifiersEquivalent(target.id, applyingActiveServerId)
        && (!hasUnappliedStagedTarget || !areServerProfileIdentifiersEquivalent(target.id, stagedActiveServerId))
    ));

    const desiredById = new Map(targets.map((target) => [target.id, target]));

    for (const existingId of Array.from(managedServers.keys())) {
        if (!desiredById.has(existingId)) {
            stopManagedServer(existingId);
            clearConcurrentSessionListCache(existingId);
            clearConcurrentMachineListCache(existingId);
        }
    }

    // Each target has independent credential, carrier, reachability, socket and
    // feature owners. Starting them serially lets one slow/offline Home delay
    // every later Home, so reconcile the target-local lifecycles concurrently.
    await Promise.allSettled(targets.map(async (target) => {
        const credentials = await TokenStorage.getCredentialsForServerUrl(target.serverUrl, { serverId: target.id });
        if (!started || requestRevision !== reconcileRequestRevision) {
            return;
        }
        if (!credentials) {
            stopManagedServer(target.id);
            updateConcurrentSessionListCache({ serverId: target.id, entry: null });
            updateConcurrentMachineListCache({
                serverId: target.id,
                machines: null,
                status: 'signedOut',
            });
            return;
        }

        const existing = managedServers.get(target.id);
        if (
            existing
            && existing.serverUrl === target.serverUrl
            && areAuthCredentialsEquivalent(existing.credentials, credentials)
            && existing.irohConfigKey === (target.irohConfigKey ?? null)
            && (target.irohConfigKey === undefined || existing.irohLease !== null)
        ) {
            if (existing.serverName !== target.serverName) {
                existing.serverName = target.serverName;
                const cached = storage.getState().concurrentSessionListCacheByServerId?.[target.id] ?? null;
                if (cached) {
                    updateConcurrentSessionListCache({
                        serverId: target.id,
                        entry: {
                            ...cached,
                            serverName: target.serverName,
                        },
                    });
                }
            }
            return;
        }

        if (existing) {
            stopManagedServer(target.id);
        }
        let irohLease: ResolvedServerScopedTransport | null;
        try {
            irohLease = await acquireConcurrentHomeTransport(target, credentials);
        } catch {
            if (!started || requestRevision !== reconcileRequestRevision) {
                return;
            }
            // Unsafe Iroh verification failures fail this Home closed. Do not
            // create the ordinary HTTPS reachability/socket/refresh bypass.
            // Publish the failure as this Home's own status so consumers can
            // tell an unreachable Home from one that was never selected, and
            // keep its last known rows instead of blanking a hydrated list.
            updateConcurrentMachineListCache({
                serverId: target.id,
                machines: storage.getState().machineListByServerId?.[target.id] ?? null,
                status: 'error',
            });
            return;
        }
        if (!started || requestRevision !== reconcileRequestRevision) {
            await irohLease?.release().catch(() => undefined);
            return;
        }
        let next: ManagedConcurrentServer;
        try {
            next = await createManagedServer(target, credentials, irohLease);
        } catch {
            // Construction rollback is exact and local; a later reconciliation
            // retries this Home without poisoning other secondary runtimes.
            return;
        }
        // Reconcile the complete descriptor through this secondary Home's
        // already-authenticated scoped carrier. Public capability discovery is
        // privacy-reduced and cannot establish a new canonical generation.
        await refreshAuthenticatedServerFeaturesSnapshot({
            credentials,
            force: true,
            serverId: target.id,
            scopedTransport: irohLease,
        });
        if (!started || requestRevision !== reconcileRequestRevision) {
            // The entry was published before feature acquisition so the
            // synchronous reachability owner can initialize it. A newer
            // reconcile may retain this same entry or replace it; stale work
            // therefore has no disposal authority by server id.
            return;
        }
        queueRefresh(next);
    }));
}

function scheduleReconcile(): void {
    if (!started) return;
    reconcileRequestRevision += 1;
    if (reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        void reconcileConcurrentServers(reconcileRequestRevision);
    }, 0);
}

function pauseManagedServersForNetworkDisallowed(): void {
    for (const entry of managedServers.values()) {
        if (entry.refreshTimer) {
            clearTimeout(entry.refreshTimer);
            entry.refreshTimer = null;
        }
        void entry.socketTransport?.disconnect({ intentional: true });
    }
}

function resumeManagedServersForNetworkAllowed(): void {
    for (const entry of managedServers.values()) {
        void acquireManagedServerReachability(entry).catch(() => undefined);
        if (entry.reachabilityState.phase === 'online' && entry.socketTransport?.isConnected() !== true) {
            void entry.socketTransport?.connect();
        }
        queueRefresh(entry);
    }
    scheduleReconcile();
    schedulePushTokenReconciliation();
}

export function startConcurrentSessionCacheSync(): void {
    if (started) return;
    started = true;
    applyingActiveServerId = '';
    startPushTokenReconciliation();
    irohRecoveryUnsubscribe = subscribeIrohHomeTunnelRecoveryRequired((event) => {
        const entry = [...managedServers.values()].find((candidate) => candidate.irohLease?.leaseId === event.leaseId);
        if (!entry) return;
        stopManagedServer(entry.id);
        scheduleReconcile();
    });
    let lastAppliedActiveServerId = normalizeServerId(getAppliedActiveServerId());

    const releaseFocusedSecondaryOwnership = (serverIdRaw: string, clearProjection: boolean) => {
        const serverId = normalizeServerId(serverIdRaw);
        for (const managedServerId of Array.from(managedServers.keys())) {
            if (!areServerProfileIdentifiersEquivalent(managedServerId, serverId)) continue;
            stopManagedServer(managedServerId);
            if (clearProjection) {
                clearConcurrentSessionListCache(managedServerId);
                clearConcurrentMachineListCache(managedServerId);
            }
        }
    };

    let lastConfigKey = '';
    storageUnsubscribe = storage.subscribe((state) => {
        if (loadEffectiveHomeViewState()) return;
        const key = JSON.stringify({
            serverSelectionGroups: Array.isArray(state.settings.serverSelectionGroups)
                ? state.settings.serverSelectionGroups
                : [],
            serverSelectionActiveTargetKind: state.settings.serverSelectionActiveTargetKind ?? null,
            serverSelectionActiveTargetId: state.settings.serverSelectionActiveTargetId ?? null,
        });
        if (key === lastConfigKey) return;
        lastConfigKey = key;
        scheduleReconcile();
    });

    applyingActiveServerUnsubscribe = subscribeApplyingActiveServer((nextServerId, _generation = -1) => {
        applyingActiveServerId = normalizeServerId(nextServerId);
        releaseFocusedSecondaryOwnership(nextServerId, false);
        scheduleReconcile();
    });
    activeServerUnsubscribe = subscribeAppliedActiveServer((nextServerIdRaw, _generation = -1) => {
        const previousServerId = lastAppliedActiveServerId;
        const nextServerId = normalizeServerId(nextServerIdRaw);
        applyingActiveServerId = '';
        releaseFocusedSecondaryOwnership(nextServerId, true);
        if (previousServerId) {
            invalidateCachedTransferRoutesForServer({ serverId: previousServerId });
        }
        if (nextServerId && nextServerId !== previousServerId) {
            invalidateCachedTransferRoutesForServer({ serverId: nextServerId });
        }
        lastAppliedActiveServerId = nextServerId;
        scheduleReconcile();
    });

    serverProfilesUnsubscribe = subscribeServerProfiles(() => {
        scheduleReconcile();
        schedulePushTokenReconciliation();
    });
    homeViewStateUnsubscribe = subscribeEffectiveHomeViewState(() => {
        scheduleReconcile();
    });
    homeCredentialMutationsUnsubscribe = subscribeHomeCredentialMutations(() => {
        scheduleReconcile();
        schedulePushTokenReconciliation();
    });

    networkAllowedUnsubscribe = subscribeServerReachabilityNetworkAllowed((allowed) => {
        if (allowed) {
            resumeManagedServersForNetworkAllowed();
            return;
        }
        pauseManagedServersForNetworkDisallowed();
    });

    periodicRefreshStop = startRuntimeActiveGatedInterval(() => {
        for (const entry of managedServers.values()) {
            queueRefresh(entry);
        }
        scheduleReconcile();
    }, readRefreshIntervalMs());

    scheduleReconcile();
    schedulePushTokenReconciliation();
}

export function stopConcurrentSessionCacheSync(): void {
    if (!started) return;
    started = false;
    applyingActiveServerId = '';
    stopPushTokenReconciliation();
    reconcileRequestRevision += 1;

    if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
    }
    if (periodicRefreshStop) {
        periodicRefreshStop();
        periodicRefreshStop = null;
    }
    if (storageUnsubscribe) {
        storageUnsubscribe();
        storageUnsubscribe = null;
    }
    if (activeServerUnsubscribe) {
        activeServerUnsubscribe();
        activeServerUnsubscribe = null;
    }
    if (applyingActiveServerUnsubscribe) {
        applyingActiveServerUnsubscribe();
        applyingActiveServerUnsubscribe = null;
    }
    if (serverProfilesUnsubscribe) {
        serverProfilesUnsubscribe();
        serverProfilesUnsubscribe = null;
    }
    if (homeViewStateUnsubscribe) {
        homeViewStateUnsubscribe();
        homeViewStateUnsubscribe = null;
    }
    if (homeCredentialMutationsUnsubscribe) {
        homeCredentialMutationsUnsubscribe();
        homeCredentialMutationsUnsubscribe = null;
    }
    if (networkAllowedUnsubscribe) {
        networkAllowedUnsubscribe();
        networkAllowedUnsubscribe = null;
    }
    if (irohRecoveryUnsubscribe) {
        irohRecoveryUnsubscribe();
        irohRecoveryUnsubscribe = null;
    }

    for (const serverId of Array.from(managedServers.keys())) {
        stopManagedServer(serverId);
    }
}
