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

function readLease(value: unknown, release: (leaseId: string) => Promise<void>): IrohMachineHttpNativeLease {
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const leaseId = record.leaseId;
    const localOrigin = record.localOrigin;
    const localCapability = record.localCapability;
    if (
        typeof leaseId !== 'string'
        || typeof localOrigin !== 'string'
        || typeof localCapability !== 'string'
        || !/^[0-9a-f]{64}$/u.test(localCapability)
    ) {
        throw new Error('Iroh machine HTTP lease is unavailable');
    }
    const parsed = new URL(localOrigin);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/') {
        throw new Error('Iroh machine HTTP lease returned an invalid local origin');
    }
    return {
        leaseId,
        localOrigin: parsed.origin,
        requestHeaders: { [IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER]: localCapability },
        release: async () => await release(leaseId),
    };
}

let desktopAvailability: boolean | null = null;

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
    try {
        const value = await invokeDesktopHost<unknown>('iroh_get_availability');
        desktopAvailability = typeof value === 'object'
            && value !== null
            && (value as Record<string, unknown>).available === true;
    } catch {
        desktopAvailability = false;
    }
    return desktopAvailability;
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
