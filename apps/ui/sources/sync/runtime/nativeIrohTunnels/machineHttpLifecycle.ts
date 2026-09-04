import {
    getOptionalHappierIrohNativeModule,
    ensureIrohApplicationEndpoint,
    IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER,
    type NativeIrohModule,
} from '@happier-dev/iroh-native';

import { desktopHostKind, invokeDesktopHost } from '@/utils/platform/desktopHost';

export type IrohApplicationEndpoint = Readonly<{ endpointId: string }>;
export type IrohApplicationEndpointConfiguration = Readonly<{
    policy?: 'automatic' | 'disabled';
    relayUrls?: readonly string[];
}>;
export type IrohMachineHttpNativeLease = Readonly<{
    leaseId: string;
    localOrigin: string;
    requestHeaders: Readonly<Record<string, string>>;
    release: () => Promise<void>;
}>;

function readEndpoint(value: unknown): IrohApplicationEndpoint {
    const endpointId = typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>).endpointId
        : null;
    if (typeof endpointId !== 'string' || !/^[0-9a-f]{64}$/u.test(endpointId)) {
        throw new Error('Iroh application endpoint is unavailable');
    }
    return { endpointId };
}

// Leases whose native stop rejected stay owned here until one succeeds, so a
// later release or dispose retries them instead of leaking a native handle.
// Transfer helpers hand custody back by calling `release` again; none of them
// implements its own retry.
const retainedMachineHttpLeaseReleases = new Map<string, () => Promise<void>>();

/** Lease ids retained because their native stop has not succeeded yet. */
export function readRetainedIrohMachineHttpLeaseIds(): readonly string[] {
    return [...retainedMachineHttpLeaseReleases.keys()];
}

/** Retries every retained release. Used by the next tunnel start and by disposal. */
export async function releaseRetainedIrohMachineHttpLeases(): Promise<void> {
    const errors: unknown[] = [];
    for (const retainedRelease of [...retainedMachineHttpLeaseReleases.values()]) {
        try {
            await retainedRelease();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
        throw new AggregateError(errors, 'Failed to release every retained Iroh machine HTTP lease.');
    }
}

function createOwnedMachineHttpLeaseRelease(
    leaseId: string,
    stop: (leaseId: string) => Promise<void>,
): () => Promise<void> {
    let releasePromise: Promise<void> | null = null;
    let released = false;
    const release = (): Promise<void> => {
        if (released) return Promise.resolve();
        releasePromise ??= stop(leaseId).then(() => {
            released = true;
            retainedMachineHttpLeaseReleases.delete(leaseId);
        }).catch((error: unknown) => {
            // Concurrent callers still share one attempt, but a failed native
            // stop stays owned and retryable through a later release/dispose.
            releasePromise = null;
            retainedMachineHttpLeaseReleases.set(leaseId, release);
            throw error;
        });
        return releasePromise;
    };
    return release;
}

async function readLease(
    value: unknown,
    stop: (leaseId: string) => Promise<void>,
): Promise<IrohMachineHttpNativeLease> {
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const leaseId = record.leaseId;
    if (typeof leaseId !== 'string' || leaseId.length === 0) {
        throw new Error('Iroh machine HTTP lease is unavailable');
    }
    // Native has transferred ownership as soon as it returns a usable lease
    // id. Validate the remaining response only after installing cleanup
    // custody so malformed connection facts cannot orphan that handle.
    const release = createOwnedMachineHttpLeaseRelease(leaseId, stop);
    const localOrigin = record.localOrigin;
    const localCapability = record.localCapability;
    try {
        if (typeof localOrigin !== 'string' || typeof localCapability !== 'string' || !/^[0-9a-f]{64}$/u.test(localCapability)) {
            throw new Error('Iroh machine HTTP lease is unavailable');
        }
        let parsed: URL;
        try {
            parsed = new URL(localOrigin);
        } catch {
            throw new Error('Iroh machine HTTP lease returned an invalid local origin');
        }
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/') {
            throw new Error('Iroh machine HTTP lease returned an invalid local origin');
        }
        return {
            leaseId,
            localOrigin: parsed.origin,
            requestHeaders: { [IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER]: localCapability },
            release,
        };
    } catch (error) {
        await release().catch(() => undefined);
        throw error;
    }
}

let desktopAvailability: boolean | null = null;
let desktopAvailabilityProbe: Promise<boolean> | null = null;
const desktopAvailabilityListeners = new Set<() => void>();

function publishDesktopAvailability(available: boolean): void {
    const changed = desktopAvailability !== available;
    desktopAvailability = available;
    if (!changed) return;
    for (const listener of desktopAvailabilityListeners) listener();
}

export function subscribeIrohMachineHttpLifecycleAvailability(listener: () => void): () => void {
    desktopAvailabilityListeners.add(listener);
    return () => desktopAvailabilityListeners.delete(listener);
}

export function isIrohMachineHttpLifecycleAvailable(): boolean {
    if (desktopHostKind() !== null) return desktopAvailability === true;
    const native = getOptionalHappierIrohNativeModule();
    return Boolean(
        native?.getAvailability?.().available === true
        && native.startMachineHttpTunnel
        && native.stopMachineTunnel,
    );
}

/** Probes the real loaded host/native boundary before route selection. */
export async function probeIrohMachineHttpLifecycleAvailability(): Promise<boolean> {
    if (desktopHostKind() === null) return isIrohMachineHttpLifecycleAvailable();
    desktopAvailabilityProbe ??= (async () => {
        let available = false;
        try {
            const value = await invokeDesktopHost<unknown>('iroh_get_availability');
            available = typeof value === 'object'
                && value !== null
                && (value as Record<string, unknown>).available === true;
        } catch {
            available = false;
        }
        publishDesktopAvailability(available);
        return available;
    })().finally(() => {
        desktopAvailabilityProbe = null;
    });
    return await desktopAvailabilityProbe;
}

async function requireMobileModule(): Promise<NativeIrohModule> {
    const native = getOptionalHappierIrohNativeModule();
    if (!native?.createEndpoint || !native.startMachineHttpTunnel || !native.stopMachineTunnel) {
        throw new Error('Iroh machine HTTP lifecycle is unavailable');
    }
    return native;
}

export async function getIrohApplicationEndpoint(
    configuration: IrohApplicationEndpointConfiguration = {},
): Promise<IrohApplicationEndpoint> {
    if (desktopHostKind() !== null) {
        return readEndpoint(await invokeDesktopHost('iroh_get_application_endpoint', { request: configuration }));
    }
    const native = await requireMobileModule();
    return readEndpoint(await ensureIrohApplicationEndpoint(native, configuration));
}

export async function startIrohMachineHttpTunnel(input: Readonly<{
    endpointId: string;
    directAddresses?: readonly string[];
    relayUrls?: readonly string[];
    policy?: 'automatic' | 'disabled';
    handshakeJson: string;
}>): Promise<IrohMachineHttpNativeLease> {
    // Retry cleanup a previous transfer could not complete before this owner
    // adds another native lease. Only already-failed releases are retained, so
    // this never disturbs a lease an in-flight transfer still uses.
    await releaseRetainedIrohMachineHttpLeases();
    if (desktopHostKind() !== null) {
        return readLease(await invokeDesktopHost('iroh_start_machine_http_tunnel', { request: input }), async (leaseId) => {
            await invokeDesktopHost('iroh_stop_machine_http_tunnel', { leaseId });
        });
    }
    const native = await requireMobileModule();
    const endpoint = await ensureIrohApplicationEndpoint(native, {
        ...(input.policy ? { policy: input.policy } : {}),
        ...(input.relayUrls ? { relayUrls: input.relayUrls } : {}),
    });
    const started = await native.startMachineHttpTunnel!({
        endpointHandle: endpoint.endpointHandle,
        endpointId: input.endpointId,
        directAddresses: input.directAddresses,
        relayUrls: input.relayUrls,
        handshakeJson: input.handshakeJson,
        capProfile: 'machineBulk',
    });
    return readLease({
        leaseId: started.machineTunnelId,
        localOrigin: `http://127.0.0.1:${started.localPort}`,
        localCapability: started.localCapability,
    }, async (leaseId) => await native.stopMachineTunnel!(leaseId));
}
