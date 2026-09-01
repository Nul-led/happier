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
import { buildMachineDisplayRenderableFromMachine } from '@/sync/domains/machines/machineDisplayRenderable';
import {
    areSessionListRenderablesEqual,
    buildSessionListRenderableFromSession,
    type SessionListRenderableSession,
} from '@/sync/domains/session/listing/sessionListRenderable';
import { shouldRebuildSessionListIndexForRowStateChange } from '@/sync/domains/session/listing/sessionListIndexRebuildImpact';
import {
    buildMachineDisplaysByIdFromMachineList,
    buildSessionListIndexWithServerScope,
} from '@/sync/store/sessionListIndex/buildSessionListIndexWithServerScope';
import {
    type ManagedConnectionState,
    type ManagedConnectionTransport,
    type TransportDisconnectEvent,
} from '@happier-dev/connection-supervisor';
import type { IrohEndpointDescriptorV1 } from '@happier-dev/protocol';
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
    shouldSchedulePushTokenReconciliationForUpdate,
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

type ConcurrentTarget = Readonly<{
    id: string;
    serverUrl: string;
    serverName: string;
    homeServerIdentityId?: string;
    irohEndpoint?: IrohEndpointDescriptorV1;
    irohDescriptorRevision?: number;
    irohConfigKey?: string;
    canonicalServerUrl?: string;
    publicServerUrl?: string | null;
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
        irohEndpoint?: IrohEndpointDescriptorV1;
        connectionDescriptorRevision?: number;
        canonicalServerUrl?: string | null;
        publicServerUrl?: string | null;
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
            ...(profile.serverIdentityId?.trim() && profile.irohEndpoint
                ? {
                    homeServerIdentityId: profile.serverIdentityId.trim(),
                    irohEndpoint: profile.irohEndpoint,
                    ...(profile.connectionDescriptorRevision === undefined
                        ? {}
                        : { irohDescriptorRevision: profile.connectionDescriptorRevision }),
                    irohConfigKey: JSON.stringify({
                    homeServerIdentityId: profile.serverIdentityId.trim(),
                    endpoint: profile.irohEndpoint,
                    descriptorRevision: profile.connectionDescriptorRevision ?? null,
                    }),
                    canonicalServerUrl: serverUrl,
                    publicServerUrl: profile.publicServerUrl ?? null,
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

function areConcurrentSessionListCacheSessionsEqual(
    previous: Readonly<Record<string, SessionListRenderableSession>> | null | undefined,
    next: Readonly<Record<string, SessionListRenderableSession>> | null | undefined,
): boolean {
    if (previous === next) return true;
    if (!previous || !next) return previous === next;

    const previousIds = Object.keys(previous);
    const nextIds = Object.keys(next);
    if (previousIds.length !== nextIds.length) return false;

    for (const sessionId of previousIds) {
        const previousSession = previous[sessionId];
        const nextSession = next[sessionId];
        if (!nextSession) return false;
        if (!areSessionListRenderablesEqual(previousSession, nextSession)) {
            return false;
        }
    }

    return true;
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
                && areConcurrentSessionListCacheSessionsEqual(previous.sessions, next.sessions)
            ) {
                return state;
            }
        }

        const nextRowStateByServerId = (() => {
            const previousRowStateByServerId = state.sessionListRowStateByServerId ?? {};
            const nextRows = next?.sessions ?? null;
            if (!nextRows) {
                if (!(serverId in previousRowStateByServerId)) {
                    return previousRowStateByServerId;
                }
                const { [serverId]: _, ...rest } = previousRowStateByServerId;
                return rest;
            }

            return previousRowStateByServerId[serverId] === nextRows
                ? previousRowStateByServerId
                : {
                    ...previousRowStateByServerId,
                    [serverId]: nextRows,
                };
        })();

        const nextIndexByServerId = (() => {
            const previousIndexByServerId = state.sessionListIndexByServerId ?? {};
            const nextRows = next?.sessions ?? null;
            if (!nextRows) {
                if (!(serverId in previousIndexByServerId)) {
                    return previousIndexByServerId;
                }
                const { [serverId]: _, ...rest } = previousIndexByServerId;
                return rest;
            }

            const previousRows = previous?.sessions ?? null;
            const previousName = String(previous?.serverName ?? '').trim() || null;
            const nextName = String(next?.serverName ?? '').trim() || null;
            const shouldRebuildIndex =
                previousIndexByServerId[serverId] == null
                || previousName !== nextName
                || shouldRebuildSessionListIndexForRowStateChange(previousRows, nextRows, {
                    groupInactiveSessionsByProject: state.settings.groupInactiveSessionsByProject === true,
                    activeGroupingV1: state.settings.sessionListActiveGroupingV1,
                    inactiveGroupingV1: state.settings.sessionListInactiveGroupingV1,
                    sectionModeV1: state.settings.sessionListSectionModeV1,
                });

            if (!shouldRebuildIndex) {
                return previousIndexByServerId;
            }

            const index = buildSessionListIndexWithServerScope({
                sessions: nextRows,
                machines: buildMachineDisplaysByIdFromMachineList(state.machineListByServerId?.[serverId]),
                groupInactiveSessionsByProject: state.settings.groupInactiveSessionsByProject === true,
                activeGroupingV1: state.settings.sessionListActiveGroupingV1,
                inactiveGroupingV1: state.settings.sessionListInactiveGroupingV1,
                sectionModeV1: state.settings.sessionListSectionModeV1,
                serverScope: {
                    serverId,
                    serverName: nextName ?? undefined,
                },
                previousIndex: previousIndexByServerId[serverId] ?? null,
            });

            return previousIndexByServerId[serverId] === index
                ? previousIndexByServerId
                : {
                    ...previousIndexByServerId,
                    [serverId]: index,
                };
        })();

        return {
            ...state,
            concurrentSessionListCacheByServerId: {
                ...state.concurrentSessionListCacheByServerId,
                [serverId]: next,
            },
            sessionListRowStateByServerId: nextRowStateByServerId,
            sessionListIndexByServerId: nextIndexByServerId,
        };
    });
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

            const rows = state.sessionListRowStateByServerId?.[serverId] ?? null;
            if (!rows || typeof rows !== 'object') {
                return state.sessionListIndexByServerId;
            }

            const serverName = state.concurrentSessionListCacheByServerId?.[serverId]?.serverName ?? undefined;
            const previousIndexByServerId = state.sessionListIndexByServerId ?? {};
            const index = buildSessionListIndexWithServerScope({
                sessions: compactSessionListRowsForViewData(rows),
                machines: buildMachineDisplaysByIdFromMachineList(nextMachineListByServerId?.[serverId]),
                groupInactiveSessionsByProject: state.settings.groupInactiveSessionsByProject === true,
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
    storage.setState((state) => {
        const current = state.concurrentSessionListCacheByServerId ?? {};
        if (!(serverId in current)) {
            return state;
        }

        const next = { ...current };
        delete next[serverId];

        const activeServerId = normalizeServerId(getAppliedActiveServerId());
        const shouldPruneCanonicalState = !areServerProfileIdentifiersEquivalent(serverId, activeServerId);

        const nextRowStateByServerId = shouldPruneCanonicalState && state.sessionListRowStateByServerId && (serverId in state.sessionListRowStateByServerId)
            ? (() => {
                const { [serverId]: _removed, ...rest } = state.sessionListRowStateByServerId;
                return rest;
            })()
            : state.sessionListRowStateByServerId;

        const nextIndexByServerId = shouldPruneCanonicalState && state.sessionListIndexByServerId && (serverId in state.sessionListIndexByServerId)
            ? (() => {
                const { [serverId]: _removed, ...rest } = state.sessionListIndexByServerId;
                return rest;
            })()
            : state.sessionListIndexByServerId;

        return {
            ...state,
            concurrentSessionListCacheByServerId: next,
            sessionListRowStateByServerId: nextRowStateByServerId,
            sessionListIndexByServerId: nextIndexByServerId,
        };
    });
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
    let sessions: Session[] = [];
    let machines: Machine[] = [];
    try {
        await fetchAndApplySessions({
            serverId: entry.id,
            credentials: entry.credentials,
            encryption,
            sessionDataKeys: entry.sessionDataKeys,
            sessionDataKeyEnvelopes: entry.sessionDataKeyEnvelopes,
            request,
            getExistingSession: () => null,
            applySessions: (nextSessions) => {
                sessions = nextSessions as Session[];
            },
            repairInvalidReadStateV1: async () => {},
            log: { log: () => {} },
        });

        await fetchAndApplyMachines({
            credentials: entry.credentials,
            encryption,
            machineDataKeys: entry.machineDataKeys,
            request,
            throwOnError: true,
            applyMachines: (nextMachines) => {
                machines = nextMachines;
            },
        });

        // Guard against late async writes: a refresh can finish after this server is removed.
        if (managedServers.get(entry.id) !== entry || entry.reachabilityState.phase !== 'online') {
            return;
        }

        const previousCacheEntry = storage.getState().concurrentSessionListCacheByServerId?.[entry.id] ?? null;
        const previousSessions = previousCacheEntry && typeof previousCacheEntry === 'object'
            ? previousCacheEntry.sessions
            : null;
        const nextSessions: Record<string, SessionListRenderableSession> = {};
        for (const session of sessions) {
            nextSessions[session.id] = buildSessionListRenderableFromSession(
                session,
                previousSessions && typeof previousSessions === 'object' ? previousSessions[session.id] : undefined,
            );
        }

        updateConcurrentMachineListCache({
            serverId: entry.id,
            machines,
            status: 'idle',
            authoritative: true,
        });
        updateConcurrentSessionListCache({
            serverId: entry.id,
            entry: {
                serverName: String(entry.serverName ?? '').trim() || null,
                sessions: nextSessions,
            },
        });
    } finally {
        syncPerformanceTelemetry.recordDuration(
            'sync.concurrent.refresh',
            Date.now() - startedAt,
            { responseBytes },
        );
    }
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
            void entry.socketTransport?.disconnect({ intentional: true });
            return;
        }

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
            socket.on('update', (raw: unknown) => {
                if (shouldSchedulePushTokenReconciliationForUpdate(raw)) {
                    schedulePushTokenReconciliation();
                }
                if (!shouldRefreshConcurrentSessionCacheForUpdate(raw)) {
                    return;
                }
                queueRefresh(entry, 'socket');
            });
            socket.on('ephemeral', (raw: unknown) => {
                statusDemandTransport.observeEphemeral(raw);
            });

            entry.detachSocketTransportListeners = [
                transport.onConnected(() => {
                    statusDemandTransport.resend();
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
    if (target.irohEndpoint) startNativeSshTunnelRuntimeAppStateLifecycle();
    return await resolveServerScopedTransport({
        profile: {
            serverUrl: target.serverUrl,
            canonicalServerUrl: target.canonicalServerUrl ?? target.serverUrl,
            publicServerUrl: target.publicServerUrl ?? null,
            serverIdentityId: target.homeServerIdentityId,
            irohEndpoint: target.irohEndpoint,
            connectionDescriptorRevision: target.irohDescriptorRevision,
        },
        credentials,
    });
}

async function reconcileConcurrentServers(requestRevision: number): Promise<void> {
    if (!started || requestRevision !== reconcileRequestRevision) return;
    const profiles = listServerProfiles();
    const activeServerId = getAppliedActiveServerId();
    const selectionSettings = readConcurrentSelectionSettings();
    const targets = resolveConcurrentTargets({
        activeServerId,
        profiles: profiles.map((profile) => ({
            id: profile.id,
            serverUrl: profile.serverUrl,
            name: profile.name,
            serverIdentityId: profile.serverIdentityId,
            legacyServerIds: profile.legacyServerIds,
            irohEndpoint: profile.irohEndpoint,
            connectionDescriptorRevision: profile.connectionDescriptorRevision,
            canonicalServerUrl: profile.canonicalServerUrl,
            publicServerUrl: profile.publicServerUrl,
        })),
        settings: selectionSettings,
    }).filter((target) => !areServerProfileIdentifiersEquivalent(target.id, applyingActiveServerId));

    const desiredById = new Map(targets.map((target) => [target.id, target]));

    for (const existingId of Array.from(managedServers.keys())) {
        if (!desiredById.has(existingId)) {
            stopManagedServer(existingId);
            clearConcurrentSessionListCache(existingId);
            clearConcurrentMachineListCache(existingId);
        }
    }

    for (const target of targets) {
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
            continue;
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
            continue;
        }

        if (existing) {
            stopManagedServer(target.id);
        }
        let irohLease: ResolvedServerScopedTransport | null;
        try {
            irohLease = await acquireConcurrentHomeTransport(target, credentials);
        } catch {
            // Unsafe Iroh verification failures fail this Home closed. Do not
            // create the ordinary HTTPS reachability/socket/refresh bypass.
            clearConcurrentSessionListCache(target.id);
            clearConcurrentMachineListCache(target.id);
            continue;
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
            continue;
        }
        queueRefresh(next);
    }
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
