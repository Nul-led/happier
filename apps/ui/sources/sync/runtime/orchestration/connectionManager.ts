import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import {
    captureActiveServerRuntimeTarget,
    publishActiveServerRuntimeOrigin,
} from '@/sync/domains/server/serverRuntime';
import { ServerScopedTransportUnavailableError } from './serverScopedRpc/resolveServerScopedTransport';
import { syncRestore, syncSwitchServer } from '@/sync/sync';
import { abortServerFetches } from '@/sync/http/client';
import { getIrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/runtime';
import { classifyIrohHomeTunnelSwitchFailure } from '@/sync/runtime/nativeIrohTunnels/fallback';
import { startNativeSshTunnelRuntimeAppStateLifecycle } from '@/sync/runtime/nativeSshTunnels/runtime';

let activeSwitchPromise: Promise<AuthCredentials | null> | null = null;
let lastAppliedGeneration = -1;
let requestedGeneration = -1;

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
    try {
        await getIrohHomeTunnelRuntime().ensureHomeTunnel({
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
        const publicServerUrl = profile.publicServerUrl?.trim() ?? '';
        let independentHttpsOrigin = '';
        try {
            const parsed = new URL(publicServerUrl);
            if (parsed.protocol === 'https:') independentHttpsOrigin = parsed.toString().replace(/\/+$/, '');
        } catch {
            // Invalid public ingress cannot become a carrier.
        }
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

async function applyPendingServerSwitches(): Promise<AuthCredentials | null> {
    while (true) {
        const snapshot = getActiveServerSnapshot();
        const targetGeneration = Math.max(requestedGeneration, snapshot.generation);

        if (targetGeneration <= lastAppliedGeneration) {
            return await resolveCredentialsForActiveServer(snapshot);
        }

        requestedGeneration = targetGeneration;
        abortServerFetches();
        const credentials = await resolveCredentialsForActiveServer(snapshot);
        await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials);
        await syncSwitchServer(credentials);
        lastAppliedGeneration = targetGeneration;
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
}

/** Cold-restore entrypoint: prepare the verified carrier before Sync reads its origin. */
export async function restoreConnectionToActiveServer(credentials: AuthCredentials): Promise<void> {
    const snapshot = getActiveServerSnapshot();
    abortServerFetches();
    await ensureIrohHomeTunnelForActiveSwitch(snapshot, credentials);
    await syncRestore(credentials);
}
