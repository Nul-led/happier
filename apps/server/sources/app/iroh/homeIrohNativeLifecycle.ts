import type { NativeIrohModule } from '@happier-dev/iroh-native';
import type { IrohRelayPolicy } from '@happier-dev/iroh-native';
import { loadIrohNodeNative } from '@happier-dev/iroh-native/node';

/**
 * Server-side adapter over the exact `@happier-dev/iroh-native` Node/Bun
 * lifecycle binding. This is not a second FFI wrapper: it loads the binding's
 * exported optional native module and adapts its handle-based Home-acceptor
 * lifecycle (`createEndpoint`, `startHomeAcceptor`, `stopHomeAcceptor`,
 * `getEndpointStatus`, `shutdownEndpoint`) into the narrow lifecycle the
 * server composition consumes. Payload bytes never cross this boundary —
 * status and handles only.
 *
 * The native Home-acceptor ops are optional members of the native module; the
 * composition may only run when every required op is present, otherwise the
 * carrier is reported unavailable and the ordinary HTTPS Home stays running.
 */

export type HomeIrohNativeCreateEndpointRequest = Readonly<{
    keyPath: string;
    relayPolicy: IrohRelayPolicy;
    relayUrls: readonly string[];
    capProfile: 'homeInteractive';
}>;

export type HomeIrohNativeEndpointStatus = Readonly<{
    endpointId: string;
    directAddresses: readonly string[];
    active: boolean;
}>;

export type HomeIrohNativeLifecycle = Readonly<{
    createEndpoint(request: HomeIrohNativeCreateEndpointRequest): Promise<
        Readonly<{
            endpointHandle: string;
            endpointId: string;
            relayMode: string;
            capProfile: string;
            relayUrls: readonly string[];
        }>
    >;
    startHomeAcceptor(request: Readonly<{
        endpointHandle: string;
        targetHost: string;
        targetPort: number;
    }>): Promise<Readonly<{
        endpointHandle: string;
        reused: boolean;
        status: Readonly<{ running: boolean }>;
    }>>;
    stopHomeAcceptor(request: Readonly<{ endpointHandle: string }>): Promise<void>;
    getEndpointStatus(request: Readonly<{ endpointHandle: string }>): Promise<HomeIrohNativeEndpointStatus | null>;
    shutdownEndpoint(request: Readonly<{ endpointHandle: string }>): Promise<void>;
}>;

function readEndpointStatus(raw: Record<string, unknown> | null): HomeIrohNativeEndpointStatus | null {
    if (!raw) return null;
    const endpointId = raw.endpointId;
    const directAddresses = raw.directAddresses;
    if (typeof endpointId !== 'string' || endpointId.trim().length === 0) return null;
    if (!Array.isArray(directAddresses) || !directAddresses.every((entry) => typeof entry === 'string')) return null;
    return {
        endpointId,
        directAddresses: [...directAddresses],
        active: raw.active === true,
    };
}

function readAcceptorRunning(raw: Record<string, unknown> | undefined): boolean {
    return raw?.running === true;
}

/** Narrow the optional binding members into a required lifecycle, or null. */
export function loadHomeIrohNativeLifecycleFromModule(
    native: NativeIrohModule | null,
): HomeIrohNativeLifecycle | null {
    if (!native?.createEndpoint || !native.startHomeAcceptor || !native.stopHomeAcceptor
        || !native.getEndpointStatus || !native.shutdownEndpoint) {
        return null;
    }
    const createEndpoint = native.createEndpoint;
    const startHomeAcceptor = native.startHomeAcceptor;
    const stopHomeAcceptor = native.stopHomeAcceptor;
    const getEndpointStatus = native.getEndpointStatus;
    const shutdownEndpoint = native.shutdownEndpoint;
    return {
        createEndpoint: async (request) => {
            const result = await createEndpoint(request);
            return { ...result, relayUrls: [...result.relayUrls] };
        },
        startHomeAcceptor: async (request) => {
            const result = await startHomeAcceptor(request);
            return { ...result, status: { running: readAcceptorRunning(result.status) } };
        },
        stopHomeAcceptor: async (request) => {
            await stopHomeAcceptor(request);
        },
        getEndpointStatus: async (request) => readEndpointStatus(await getEndpointStatus(request.endpointHandle)),
        shutdownEndpoint: async (request) => {
            await shutdownEndpoint(request);
        },
    };
}

/**
 * Production loading path: resolves the exact @happier-dev/iroh-native
 * binding module and adapts it. Returns null when the native addon is not
 * available on this target.
 */
export function loadHomeIrohNativeLifecycle(): HomeIrohNativeLifecycle | null {
    const loaded = loadIrohNodeNative();
    return loaded.available ? loadHomeIrohNativeLifecycleFromModule(loaded.native) : null;
}
