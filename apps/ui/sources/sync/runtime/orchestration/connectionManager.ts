import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import {
    captureActiveServerRuntimeTarget,
    getActiveServerHomeCarrier,
    publishActiveServerRuntimeOrigin,
    releaseActiveServerRuntimeOrigin,
} from '@/sync/domains/server/serverRuntime';
import { ServerScopedTransportUnavailableError } from './serverScopedRpc/resolveServerScopedTransport';
import { sync, syncRestore, syncSwitchServer } from '@/sync/sync';
import { abortServerFetches } from '@/sync/http/client';
import { getIrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/runtime';
import {
    acquireEligibleHomeCarrier,
    type AcquiredHomeCarrier,
} from '@/sync/runtime/homeCarrierPolicy';
import { startNativeSshTunnelRuntimeAppStateLifecycle } from '@/sync/runtime/nativeSshTunnels/runtime';
import type { IrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/types';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';

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

function capturePublicationTargetForSnapshot(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
): ReturnType<typeof captureActiveServerRuntimeTarget> | null {
    const current = getActiveServerSnapshot();
    if (
        current.serverId !== snapshot.serverId
        || current.serverUrl !== snapshot.serverUrl
        || current.generation !== snapshot.generation
    ) return null;
    return captureActiveServerRuntimeTarget();
}

function capturePreparedSyncTarget(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
): import('@/sync/sync').SyncServerTarget | null {
    const current = getActiveServerSnapshot();
    if (
        current.serverId !== snapshot.serverId
        || current.serverUrl !== snapshot.serverUrl
        || current.generation !== snapshot.generation
    ) return null;
    return {
        serverId: current.serverId,
        serverUrl: current.serverUrl,
        generation: current.generation,
        ...(current.runtimeOrigin ? { runtimeOrigin: current.runtimeOrigin } : {}),
        ...(current.carrier ? { carrier: current.carrier } : {}),
        homeCarrier: getActiveServerHomeCarrier(),
    };
}

function isPublicationTargetCurrent(
    target: ReturnType<typeof captureActiveServerRuntimeTarget>,
): boolean {
    const current = captureActiveServerRuntimeTarget();
    return current.serverId === target.serverId && current.generation === target.generation;
}

/**
 * Focused-Home browser Iroh carriers this switch owner holds, keyed by lease.
 * A browser has no loopback listener to lease, so these handles — not a runtime
 * origin — are what the switch owns and must release when the Home, credential,
 * or generation changes.
 *
 * It is a keyed collection rather than one slot for the same reason the native
 * runtime keeps `publicationsByLeaseId`: a lease whose release failed stays
 * owned here so a later switch, retry, or logout retries exactly that lease,
 * and acquiring the next carrier can never overwrite that custody. Secondary
 * Homes are owned by the concurrent-server cache and are never released here.
 */
type AcquiredBrowserHomeCarrier = Extract<AcquiredHomeCarrier, { kind: 'browser_iroh' }>['carrier'];

const activeBrowserHomeCarriers = new Map<string, Readonly<{
    carrier: AcquiredBrowserHomeCarrier;
    release: () => Promise<void>;
    target: ReturnType<typeof captureActiveServerRuntimeTarget>;
}>>();

/**
 * Unpublishes and releases every retained focused-Home carrier. It runs before
 * any acquisition, so a superseded lease is always released exactly once per
 * attempt. Unpublishing first means a failed release still leaves no transport
 * published for this Home.
 */
async function releaseActiveBrowserHomeCarriers(): Promise<void> {
    for (const [leaseId, published] of [...activeBrowserHomeCarriers]) {
        releaseActiveServerRuntimeOrigin({ target: published.target, leaseId });
        try {
            await published.release();
            if (activeBrowserHomeCarriers.get(leaseId) === published) {
                activeBrowserHomeCarriers.delete(leaseId);
            }
        } catch {
            // Retain custody so the next switch, retry, or logout releases this
            // exact lease again. A failed release must not block the switch.
        }
    }
}

/**
 * Acquires and publishes the focused Home's Iroh carrier before
 * `syncSwitchServer`, so the existing `serverFetch` and Socket.IO readers
 * resolve the same transport for this same active generation. A browser uses
 * the relay-only semantic carrier (it cannot bind the native loopback listener);
 * every other host keeps the native lease and its verified runtime origin. A
 * Home without an adopted Iroh endpoint (or without an endpoint-scoped
 * credential) keeps the established canonical HTTPS/SSH behavior unchanged, and
 * any carrier from a prior Home/generation is released during the switch.
 */
async function ensureIrohHomeTunnelForActiveSwitch(
    snapshot: Readonly<ReturnType<typeof getActiveServerSnapshot>>,
    credentials: AuthCredentials | null,
    publicationTarget: ReturnType<typeof captureActiveServerRuntimeTarget>,
): Promise<void> {
    const token = credentials?.token?.trim() ?? '';
    const profile = getServerProfileById(snapshot.serverId);
    const descriptor = profile?.homeConnectionDescriptor;
    // A prior focused-Home carrier never survives a switch or a credential loss:
    // the publication below is the only thing that may reinstate one.
    await releaseActiveBrowserHomeCarriers();
    if (!isPublicationTargetCurrent(publicationTarget)) {
        throw new ServerScopedTransportUnavailableError();
    }
    if (!token || !credentials || !profile || !descriptor) {
        if (!token) await getIrohHomeTunnelRuntime().releaseActiveHomeTunnels();
        await getIrohHomeTunnelRuntime().releaseLeasesForStaleTargets();
        return;
    }

    const acquired = await acquireEligibleHomeCarrier({
        descriptor,
        verification: { kind: 'authenticated', token },
        credentials,
        acquireNative: async (input) => {
            // The focused lifecycle retains its established publication and
            // recovery duties; the shared primitive decides only which carrier
            // is eligible and whether HTTPS fallback is allowed.
            startNativeSshTunnelRuntimeAppStateLifecycle();
            const irohRuntime = getIrohHomeTunnelRuntime();
            startActiveIrohRecoveryLifecycle(irohRuntime);
            return await irohRuntime.ensureHomeTunnel(input);
        },
    });
    if (acquired.kind === 'fail_closed' || acquired.kind === 'unavailable') {
        if (acquired.kind === 'unavailable') throw new ServerScopedTransportUnavailableError();
        if (acquired.fallbackAllowed) throw new ServerScopedTransportUnavailableError();
        throw acquired.error;
    }
    if (acquired.kind === 'native_iroh') return;
    if (acquired.kind === 'https') {
        if (!publishActiveServerRuntimeOrigin({
            target: publicationTarget,
            leaseId: `https-fallback:${publicationTarget.serverId}:${publicationTarget.generation}`,
            runtimeOrigin: acquired.runtimeOrigin,
            carrier: 'https',
        })) {
            throw new ServerScopedTransportUnavailableError();
        }
        return;
    }

    const carrier = acquired.carrier;
    activeBrowserHomeCarriers.set(carrier.leaseId, {
        carrier,
        release: acquired.release,
        target: publicationTarget,
    });
    if (!publishActiveServerRuntimeOrigin({
        target: publicationTarget,
        leaseId: carrier.leaseId,
        homeCarrier: carrier,
        carrier: 'iroh',
    })) {
        // Focus moved while the carrier was being acquired. The caller keeps
        // exact release custody and fails closed before Sync sees the target.
        await releaseActiveBrowserHomeCarriers();
        throw new ServerScopedTransportUnavailableError();
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
        if (
            getAppliedActiveServerId() !== snapshot.serverId
            || appliedActiveServerGeneration !== snapshot.generation
        ) {
            // A failed staged switch has no applied socket for this target to
            // retry. Re-enter the serialized switch owner so credentials,
            // carrier and Sync are prepared as one exact target transaction.
            await switchConnectionToActiveServer();
            return;
        }
        abortServerFetches();
        const credentials = await resolveCredentialsForActiveServer(snapshot);
        const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
        if (!publicationTarget) return;
        await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials, publicationTarget);
        if (!isPublicationTargetCurrent(publicationTarget)) return;
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
        const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
        if (!publicationTarget) continue;
        await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials, publicationTarget);
        if (!isActiveSwitchTargetCurrent(snapshot, targetGeneration)) continue;
        const syncTarget = capturePreparedSyncTarget(snapshot);
        if (!syncTarget) continue;
        publishApplyingActiveServerId(snapshot.serverId, targetGeneration);
        try {
            await syncSwitchServer(credentials, syncTarget);
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
    const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
    if (!publicationTarget) return;
    requestedGeneration = Math.max(requestedGeneration, snapshot.generation);
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, null, publicationTarget);
    await syncSwitchServer(null);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}

/**
 * Retire the focused connection only while it still belongs to the Home that
 * emitted an asynchronous credential-invalidity fact. The invalidation bus is
 * intentionally asynchronous, so consulting whichever Home is focused after
 * waiting would let an old Home disconnect its successor.
 */
export async function disconnectActiveServerConnectionIfCurrent(target: Readonly<{
    serverId: string;
    serverUrl: string;
    generation?: number;
}>): Promise<boolean> {
    if (activeSwitchPromise) {
        await activeSwitchPromise.catch(() => null);
    }
    const snapshot = getActiveServerSnapshot();
    if (
        snapshot.serverId !== target.serverId
        || createServerUrlComparableKey(snapshot.serverUrl) !== createServerUrlComparableKey(target.serverUrl)
        || (target.generation !== undefined && snapshot.generation !== target.generation)
    ) {
        return false;
    }
    await disconnectActiveServerConnection();
    return true;
}

/** Cold-restore entrypoint: prepare the verified carrier before Sync reads its origin. */
export async function restoreConnectionToActiveServer(credentials: AuthCredentials): Promise<void> {
    const snapshot = getActiveServerSnapshot();
    const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
    if (!publicationTarget) throw new ServerScopedTransportUnavailableError();
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials, publicationTarget);
    const syncTarget = capturePreparedSyncTarget(snapshot);
    if (!syncTarget) throw new ServerScopedTransportUnavailableError();
    await syncRestore(credentials, syncTarget);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}
