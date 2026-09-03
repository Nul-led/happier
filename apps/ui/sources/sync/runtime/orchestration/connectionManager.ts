import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { resolveIndependentHttpsServerOrigin } from '@/sync/domains/server/url/serverUrlCanonical';
import {
    captureActiveServerRuntimeTarget,
    publishActiveServerRuntimeOrigin,
    releaseActiveServerRuntimeOrigin,
} from '@/sync/domains/server/serverRuntime';
import { ServerScopedTransportUnavailableError } from './serverScopedRpc/resolveServerScopedTransport';
import { sync, syncRestore, syncSwitchServer } from '@/sync/sync';
import { abortServerFetches } from '@/sync/http/client';
import { getIrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/runtime';
import { classifyIrohHomeTunnelSwitchFailure } from '@/sync/runtime/nativeIrohTunnels/fallback';
import {
    acquireBrowserIrohHomeCarrier,
    resolveBrowserIrohHomeCarrierEligibility,
    type BrowserIrohHomeCarrier,
} from '@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier';
import { resolveBrowserIrohHostDecision } from '@/sync/runtime/browserIroh/hostEligibility';
import { IrohError } from '@happier-dev/iroh-native';
import type { IrohEndpointDescriptorV1 } from '@happier-dev/protocol';
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
const activeBrowserHomeCarriers = new Map<string, Readonly<{
    carrier: BrowserIrohHomeCarrier;
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
            await published.carrier.release();
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
    const endpoint = profile?.irohEndpoint;
    const homeServerIdentityId = profile?.serverIdentityId?.trim() ?? '';
    const canonicalServerUrl = snapshot.serverUrl.trim();
    // A prior focused-Home carrier never survives a switch or a credential loss:
    // the publication below is the only thing that may reinstate one.
    await releaseActiveBrowserHomeCarriers();
    if (!isPublicationTargetCurrent(publicationTarget)) {
        throw new ServerScopedTransportUnavailableError();
    }
    if (!token || !credentials || !profile || !endpoint || !homeServerIdentityId || !canonicalServerUrl) {
        if (!token) await getIrohHomeTunnelRuntime().releaseActiveHomeTunnels();
        await getIrohHomeTunnelRuntime().releaseLeasesForStaleTargets();
        return;
    }

    const browserHost = resolveBrowserIrohHostDecision();
    if (browserHost.eligible) {
        await ensureBrowserIrohHomeCarrierForActiveSwitch({
            homeServerIdentityId,
            endpoint,
            canonicalServerUrl,
            credentials,
            publicServerUrl: profile.publicServerUrl ?? null,
            hostDecision: browserHost,
            publicationTarget,
        });
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
        publishIndependentHttpsFallbackOrThrow(error, profile.publicServerUrl ?? null, publicationTarget);
    }
}

/**
 * The one approved pre-boundary fallback for both carriers. A carrier
 * availability or bounded health-reachability failure publishes no Iroh
 * transport and lets an independently trusted HTTPS ingress serve the switch.
 * Identity, auth, descriptor/integrity, protocol, endpoint config, and
 * stale-target failures fail closed so the stale or unsafe target never reaches
 * `syncSwitchServer`; an ingress-less Home returns the typed unavailable result.
 */
function publishIndependentHttpsFallbackOrThrow(
    error: unknown,
    publicServerUrl: string | null,
    publicationTarget: ReturnType<typeof captureActiveServerRuntimeTarget>,
): void {
    if (!classifyIrohHomeTunnelSwitchFailure(error).fallbackAllowed) throw error;
    const independentHttpsOrigin = resolveIndependentHttpsServerOrigin(publicServerUrl ?? '');
    if (!independentHttpsOrigin) throw new ServerScopedTransportUnavailableError();
    if (!publishActiveServerRuntimeOrigin({
        target: publicationTarget,
        leaseId: `https-fallback:${publicationTarget.serverId}:${publicationTarget.generation}`,
        runtimeOrigin: independentHttpsOrigin,
        carrier: 'https',
    })) {
        throw new ServerScopedTransportUnavailableError();
    }
}

/**
 * The browser half of the same switch: acquire the relay-only carrier and
 * publish it for this exact active generation. There is no runtime origin to
 * publish and none is invented — the canonical Home URL keeps describing
 * identity, audience, and reachability scope.
 */
async function ensureBrowserIrohHomeCarrierForActiveSwitch(params: Readonly<{
    homeServerIdentityId: string;
    endpoint: IrohEndpointDescriptorV1;
    canonicalServerUrl: string;
    credentials: AuthCredentials;
    publicServerUrl: string | null;
    hostDecision: ReturnType<typeof resolveBrowserIrohHostDecision>;
    publicationTarget: ReturnType<typeof captureActiveServerRuntimeTarget>;
}>): Promise<void> {
    const carrierRequest = {
        homeServerIdentityId: params.homeServerIdentityId,
        endpoint: params.endpoint,
        canonicalServerUrl: params.canonicalServerUrl,
        credentials: params.credentials,
    };
    try {
        const eligibility = resolveBrowserIrohHomeCarrierEligibility(carrierRequest, params.hostDecision);
        if (!eligibility.eligible) {
            // A descriptor a browser cannot use is an unavailable carrier here,
            // not a descriptor-integrity failure: a native host would still use
            // the very same descriptor.
            throw new IrohError('unavailable', `Browser Iroh Home carrier unavailable: ${eligibility.reason}`);
        }
        const carrier = await acquireBrowserIrohHomeCarrier(carrierRequest);
        activeBrowserHomeCarriers.set(carrier.leaseId, { carrier, target: params.publicationTarget });
        if (!publishActiveServerRuntimeOrigin({
            target: params.publicationTarget,
            leaseId: carrier.leaseId,
            homeCarrier: carrier,
            carrier: 'iroh',
        })) {
            // Focus moved while the carrier was being acquired. Fail closed: the
            // stale target must never reach `syncSwitchServer`, and a release
            // that fails stays retained above for the next attempt.
            await releaseActiveBrowserHomeCarriers();
            throw new ServerScopedTransportUnavailableError();
        }
    } catch (error) {
        if (error instanceof ServerScopedTransportUnavailableError) throw error;
        publishIndependentHttpsFallbackOrThrow(error, params.publicServerUrl, params.publicationTarget);
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
    const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
    if (!publicationTarget) return;
    requestedGeneration = Math.max(requestedGeneration, snapshot.generation);
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, null, publicationTarget);
    await syncSwitchServer(null);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}

/** Cold-restore entrypoint: prepare the verified carrier before Sync reads its origin. */
export async function restoreConnectionToActiveServer(credentials: AuthCredentials): Promise<void> {
    const snapshot = getActiveServerSnapshot();
    const publicationTarget = capturePublicationTargetForSnapshot(snapshot);
    if (!publicationTarget) throw new ServerScopedTransportUnavailableError();
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials, publicationTarget);
    await syncRestore(credentials);
    lastAppliedGeneration = Math.max(lastAppliedGeneration, snapshot.generation);
    publishAppliedActiveServerId(snapshot.serverId, snapshot.generation);
}
