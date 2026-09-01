import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { resolveIndependentHttpsServerOrigin } from '@/sync/domains/server/url/serverUrlCanonical';
import {
    captureActiveServerRuntimeTarget,
    publishActiveServerRuntimeOrigin,
} from '@/sync/domains/server/serverRuntime';
import { ServerScopedTransportUnavailableError } from './serverScopedRpc/resolveServerScopedTransport';
import { sync, syncRestore, syncSwitchServer } from '@/sync/sync';
import { abortServerFetches } from '@/sync/http/client';
import { getIrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/runtime';
import { classifyIrohHomeTunnelSwitchFailure } from '@/sync/runtime/nativeIrohTunnels/fallback';
import { startNativeSshTunnelRuntimeAppStateLifecycle } from '@/sync/runtime/nativeSshTunnels/runtime';
import type { IrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/types';
import { fireAndForget } from '@/utils/system/fireAndForget';

let activeSwitchPromise: Promise<AuthCredentials | null> | null = null;
let lastAppliedGeneration = -1;
let requestedGeneration = -1;
let activeRecoveryPromise: Promise<void> | null = null;
let recoveryRuntime: IrohHomeTunnelRuntime | null = null;
let recoveryUnsubscribe: (() => void) | null = null;

function startActiveIrohRecoveryLifecycle(runtime: IrohHomeTunnelRuntime): void {
    if (recoveryRuntime === runtime && recoveryUnsubscribe) return;
    recoveryUnsubscribe?.();
    recoveryRuntime = runtime;
    recoveryUnsubscribe = runtime.subscribeRecoveryRequired((event) => {
        if (!event.activePublication) return;
        const snapshot = getActiveServerSnapshot();
        const profile = getServerProfileById(snapshot.serverId);
        if (profile?.serverIdentityId?.trim() !== event.homeServerIdentityId) return;
        fireAndForget(retryActiveServerConnection(), {
            tag: 'connectionManager.retryActiveServerConnection.nativeIrohRecovery',
        });
    });
}
const initialActiveServerSnapshot = getActiveServerSnapshot();
let appliedActiveServerId = String(initialActiveServerSnapshot.serverId ?? '').trim();
let appliedActiveServerGeneration = initialActiveServerSnapshot.generation;
const appliedActiveServerListeners = new Set<(serverId: string, generation: number) => void>();
const applyingActiveServerListeners = new Set<(serverId: string, generation: number) => void>();

function publishApplyingActiveServerId(serverIdRaw: string, generation: number): void {
    const serverId = String(serverIdRaw ?? '').trim();
    for (const listener of applyingActiveServerListeners) listener(serverId, generation);
}

function publishAppliedActiveServerId(serverIdRaw: string, generation: number): void {
    const serverId = String(serverIdRaw ?? '').trim();
    if (serverId === appliedActiveServerId && generation === appliedActiveServerGeneration) return;
    appliedActiveServerId = serverId;
    appliedActiveServerGeneration = generation;
    for (const listener of appliedActiveServerListeners) listener(serverId, generation);
}

function republishAppliedActiveServer(): void {
    for (const listener of appliedActiveServerListeners) {
        listener(appliedActiveServerId, appliedActiveServerGeneration);
    }
}

export function getAppliedActiveServerId(): string {
    return appliedActiveServerId;
}

export function subscribeAppliedActiveServer(
    listener: (serverId: string, generation: number) => void,
): () => void {
    appliedActiveServerListeners.add(listener);
    return () => {
        appliedActiveServerListeners.delete(listener);
    };
}

export function subscribeApplyingActiveServer(
    listener: (serverId: string, generation: number) => void,
): () => void {
    applyingActiveServerListeners.add(listener);
    return () => {
        applyingActiveServerListeners.delete(listener);
    };
}

async function resolveCredentialsForActiveServer(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
): Promise<AuthCredentials | null> {
    if (!snapshot.serverUrl) {
        return await TokenStorage.getCredentials();
    }
    return await TokenStorage.getCredentialsForServerUrl(snapshot.serverUrl, {
        serverId: snapshot.serverId,
    });
}

function isActiveSwitchTargetCurrent(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
    targetGeneration: number,
): boolean {
    const currentSnapshot = getActiveServerSnapshot();
    return currentSnapshot.generation === snapshot.generation
        && currentSnapshot.serverId === snapshot.serverId
        && currentSnapshot.serverUrl === snapshot.serverUrl
        && Math.max(requestedGeneration, currentSnapshot.generation) <= targetGeneration;
}

/**
 * Acquires and verifies the native Iroh Home lease for the active switch target
 * before `syncSwitchServer`, so the existing `serverFetch` and Socket.IO readers
 * resolve the published runtime origin for this same active generation. A Home
 * without an adopted Iroh endpoint (or without an endpoint-scoped credential to
 * verify with) keeps the established canonical HTTPS/SSH behavior unchanged, and
 * any Iroh lease from a prior Home/generation is released during the switch.
 */
async function ensureIrohHomeTunnelForActiveSwitch(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
    credentials: AuthCredentials | null,
): Promise<void> {
    const token = credentials?.token?.trim() ?? '';
    const profile = getServerProfileById(snapshot.serverId);
    const endpoint = profile?.irohEndpoint;
    const homeServerIdentityId = profile?.serverIdentityId?.trim() ?? '';
    const canonicalServerUrl = snapshot.serverUrl.trim();
    if (!token || !profile || !endpoint || !homeServerIdentityId || !canonicalServerUrl) {
        if (!token) await getIrohHomeTunnelRuntime().releaseActiveHomeTunnels();
        await getIrohHomeTunnelRuntime().releaseLeasesForStaleTargets();
        return;
    }

    // The shared native tunnel app-state mount owns suspend/foreground recovery
    // for Iroh leases as well; there is no second AppState lifecycle owner.
    startNativeSshTunnelRuntimeAppStateLifecycle();
    const irohRuntime = getIrohHomeTunnelRuntime();
    startActiveIrohRecoveryLifecycle(irohRuntime);
    try {
        await irohRuntime.ensureHomeTunnel({
            homeServerIdentityId,
            endpoint,
            ...(profile.connectionDescriptorRevision === undefined ? {} : { descriptorRevision: profile.connectionDescriptorRevision }),
            canonicalServerUrl,
            verification: { kind: 'authenticated', token },
        });
    } catch (error) {
        // Iroh is optional, but only within the approved fallback matrix: a
        // carrier-availability or bounded health-reachability failure publishes
        // no runtime origin and the established canonical carrier serves the
        // switch. Identity, auth, descriptor/integrity, protocol, endpoint
        // config, and stale-target failures fail closed so the stale/unsafe
        // target never reaches `syncSwitchServer` (a later explicit switch
        // request re-runs through the normal owner path).
        if (!classifyIrohHomeTunnelSwitchFailure(error).fallbackAllowed) {
            throw error;
        }
        const independentHttpsOrigin = resolveIndependentHttpsServerOrigin(profile.publicServerUrl ?? '');
        if (!independentHttpsOrigin) throw new ServerScopedTransportUnavailableError();
        const target = captureActiveServerRuntimeTarget();
        if (!publishActiveServerRuntimeOrigin({
            target,
            leaseId: `https-fallback:${target.serverId}:${target.generation}`,
            runtimeOrigin: independentHttpsOrigin,
            carrier: 'https',
        })) {
            throw new ServerScopedTransportUnavailableError();
        }
    }
}

/**
 * Single-shot recovery owner for the focused Home. Native terminal events,
 * foreground reprobes, and the visible Retry action all reacquire the verified
 * runtime origin here before asking the existing Sync lifecycle to reconnect.
 */
export async function retryActiveServerConnection(): Promise<void> {
    if (activeRecoveryPromise) return await activeRecoveryPromise;
    activeRecoveryPromise = (async () => {
        const snapshot = getActiveServerSnapshot();
        abortServerFetches();
        const credentials = await resolveCredentialsForActiveServer(snapshot);
        await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials);
        sync.retryNow();
    })();
    try {
        await activeRecoveryPromise;
    } finally {
        activeRecoveryPromise = null;
    }
}

async function applyPendingServerSwitches(): Promise<AuthCredentials | null> {
    while (true) {
        const snapshot = getActiveServerSnapshot();
        const targetGeneration = Math.max(requestedGeneration, snapshot.generation);

        if (targetGeneration <= lastAppliedGeneration) {
            const credentials = await resolveCredentialsForActiveServer(snapshot);
            if (!isActiveSwitchTargetCurrent(snapshot, targetGeneration)) continue;
            return credentials;
        }

        requestedGeneration = targetGeneration;
        abortServerFetches();
        const credentials = await resolveCredentialsForActiveServer(snapshot);
        if (!isActiveSwitchTargetCurrent(snapshot, targetGeneration)) continue;
        await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials);
        if (!isActiveSwitchTargetCurrent(snapshot, targetGeneration)) continue;
        publishApplyingActiveServerId(snapshot.serverId, targetGeneration);
        try {
            await syncSwitchServer(credentials);
        } catch (error) {
            republishAppliedActiveServer();
            throw error;
        }
        lastAppliedGeneration = targetGeneration;
        publishAppliedActiveServerId(snapshot.serverId, targetGeneration);
    }
}

export async function switchConnectionToActiveServer(): Promise<AuthCredentials | null> {
    const snapshot = getActiveServerSnapshot();
    requestedGeneration = Math.max(requestedGeneration, snapshot.generation);
    if (!activeSwitchPromise) {
        activeSwitchPromise = applyPendingServerSwitches();
    }

    try {
        return await activeSwitchPromise;
    } finally {
        activeSwitchPromise = null;
    }
}

/**
 * Disconnects the focused server without consulting persisted credentials.
 * First-key recovery deliberately keeps rejected credentials as recovery
 * custody, so the ordinary switch operation must not be used for retirement.
 */
export async function disconnectActiveServerConnection(): Promise<void> {
    if (activeSwitchPromise) {
        await activeSwitchPromise.catch(() => null);
    }
    const snapshot = getActiveServerSnapshot();
    requestedGeneration = Math.max(requestedGeneration, snapshot.generation);
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, null);
    await syncSwitchServer(null);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}

/** Cold-restore entrypoint: prepare the verified carrier before Sync reads its origin. */
export async function restoreConnectionToActiveServer(credentials: AuthCredentials): Promise<void> {
    const snapshot = getActiveServerSnapshot();
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials);
    await syncRestore(credentials);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}
