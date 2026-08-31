import { join } from 'node:path';

/**
 * Electron main-process composition of the shared Iroh desktop Home-tunnel
 * lifecycle.
 *
 * The renderer reaches this service only through the existing command registry
 * under the exact command names the Tauri host registers
 * (`iroh_start_home_tunnel`, `iroh_stop_home_tunnel`), so both shells share one
 * command contract. Lifecycle/status only: no tunnel payload byte crosses the
 * bridge, and the endpoint identity is host-owned — the persistent key path is
 * canonical beneath the Electron `userData` directory and is never accepted
 * from, returned to, or logged for the renderer.
 */

/** Canonical persistent endpoint identity location beneath the userData dir. */
export const IROH_ENDPOINT_KEY_RELPATH = ['iroh', 'endpoint.key'] as const;

/** Renderer-visible rejections carry the exact native error code. */
const NATIVE_ERROR_PREFIX = 'iroh_native_error:';

/**
 * Structural surface of the shared `@happier-dev/iroh-native/node` typed
 * module that this service consumes. The package publishes an ESM distribution;
 * the loaded surface is still validated in {@link readNativeBoundary} before
 * use because addon availability remains a runtime platform boundary.
 */
export type IrohNodeLifecycleBoundary = Readonly<{
    startHomeTunnel: (request: {
        homeServerIdentityId: string;
        endpointId: string;
        relayPolicy: 'automatic' | 'disabled';
        directAddresses?: readonly string[];
        relayUrls?: readonly string[];
        descriptorRevision?: number;
        endpointKeyPath?: string;
        capProfile?: string;
    }) => Promise<{
        leaseId: string;
        homeServerIdentityId: string;
        homeEndpointId: string;
        runtimeOrigin: string;
        carrier: 'iroh';
        observedPath: 'direct' | 'relay' | 'unknown';
        startedAtMs: number;
        endpointHandle?: string;
    }>;
    stopHomeTunnel: (leaseId: string) => Promise<void>;
    getTunnelStatus: (tunnelId: string) => Promise<Record<string, unknown> | null>;
    shutdownEndpoint?: (request: { endpointHandle: string }) => Promise<void>;
}>;

export type DesktopIrohTunnelLease = Readonly<{
    leaseId: string;
    homeServerIdentityId: string;
    homeEndpointId: string;
    runtimeOrigin: string;
    carrier: 'iroh';
    observedPath: 'direct' | 'relay' | 'unknown';
    startedAtMs: number;
}>;

export type ElectronIrohTunnelServiceDependencies = Readonly<{
    userDataPath: () => string;
    /** Defaults to the shared `@happier-dev/iroh-native/node` loader. */
    loadNative?: () => Promise<IrohNodeLifecycleBoundary | null>;
}>;

const NATIVE_MODULE_SPECIFIER = '@happier-dev/iroh-native/node';

/**
 * Loads the shared Node/Bun lifecycle module. The specifier is imported
 * dynamically because the workspace package publishes TypeScript sources that
 * only the runtime loader resolves; the result is `unknown` here and is
 * validated into the boundary shape immediately.
 */
async function loadSharedIrohNodeLifecycle(): Promise<IrohNodeLifecycleBoundary | null> {
    const imported: unknown = await import(NATIVE_MODULE_SPECIFIER);
    if (typeof imported !== 'object' || imported === null) return null;
    const loader = (imported as Record<string, unknown>).loadIrohNodeNative;
    if (typeof loader !== 'function') return null;
    const loaded: unknown = await loader();
    if (typeof loaded !== 'object' || loaded === null) return null;
    const record = loaded as Record<string, unknown>;
    if (record.available !== true) return null;
    return readNativeBoundary(record.native);
}

function readNativeBoundary(candidate: unknown): IrohNodeLifecycleBoundary | null {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const record = candidate as Record<string, unknown>;
    if (
        typeof record.startHomeTunnel !== 'function'
        || typeof record.stopHomeTunnel !== 'function'
        || typeof record.getTunnelStatus !== 'function'
    ) {
        return null;
    }
    return candidate as IrohNodeLifecycleBoundary;
}

function nativeError(nativeCode: string, message: string): Error {
    return new Error(`${NATIVE_ERROR_PREFIX}${nativeCode}:${message}`);
}

function readLoopbackRuntimeOrigin(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw nativeError('transport-unavailable', 'malformed native lease field runtimeOrigin');
    }
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (
        parsed.protocol !== 'http:'
        || !isLoopback
        || parsed.port.length === 0
        || parsed.username.length > 0
        || parsed.password.length > 0
        || parsed.pathname !== '/'
        || parsed.search.length > 0
        || parsed.hash.length > 0
    ) {
        throw nativeError('transport-unavailable', 'malformed native lease field runtimeOrigin');
    }
    return parsed.origin;
}

function toBridgeError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(NATIVE_ERROR_PREFIX)) {
        return error instanceof Error ? error : new Error(message);
    }
    const nativeCode =
        typeof error === 'object' && error !== null && 'nativeCode' in error
            ? (error as { nativeCode?: unknown }).nativeCode
            : undefined;
    return nativeError(typeof nativeCode === 'string' && nativeCode.length > 0 ? nativeCode : 'transport-unavailable', message);
}

/**
 * Projects the renderer request onto the exact descriptor-derived facts. The
 * typed projection is the guarantee that renderer-supplied key paths or seeds
 * can never reach the native request.
 */
function readStartRequestFacts(request: unknown): {
    homeServerIdentityId: string;
    endpointId: string;
    relayPolicy: 'automatic' | 'disabled';
    directAddresses?: readonly string[];
    relayUrls?: readonly string[];
    descriptorRevision?: number;
} {
    if (typeof request !== 'object' || request === null) {
        throw nativeError('invalid-request', 'request is required');
    }
    const record = request as Record<string, unknown>;
    const homeServerIdentityId = record.homeServerIdentityId;
    const endpointId = record.endpointId;
    if (typeof homeServerIdentityId !== 'string' || homeServerIdentityId.trim().length === 0) {
        throw nativeError('invalid-request', 'homeServerIdentityId is required');
    }
    if (typeof endpointId !== 'string' || endpointId.trim().length === 0) {
        throw nativeError('invalid-request', 'endpointId is required');
    }
    const policy = record.policy;
    if (policy !== 'automatic' && policy !== 'disabled') {
        throw nativeError('invalid-request', 'policy must be automatic or disabled');
    }
    const stringArray = (value: unknown): readonly string[] | undefined => {
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
            throw nativeError('invalid-request', 'relay/direct address hints must be string arrays');
        }
        return value as readonly string[];
    };
    const descriptorRevision = record.descriptorRevision;
    if (descriptorRevision !== undefined && (typeof descriptorRevision !== 'number' || !Number.isInteger(descriptorRevision) || descriptorRevision <= 0)) {
        throw nativeError('invalid-request', 'descriptorRevision must be a positive integer');
    }
    return {
        homeServerIdentityId,
        endpointId,
        relayPolicy: policy,
        ...(record.relayUrls === undefined ? {} : { relayUrls: stringArray(record.relayUrls) }),
        ...(record.directAddresses === undefined ? {} : { directAddresses: stringArray(record.directAddresses) }),
        ...(descriptorRevision === undefined ? {} : { descriptorRevision }),
    };
}

/** Validates the native result and strips every host-owned fact. */
function projectLeaseForRenderer(started: {
    leaseId: string;
    homeServerIdentityId: string;
    homeEndpointId: string;
    runtimeOrigin: string;
    carrier: 'iroh';
    observedPath: 'direct' | 'relay' | 'unknown';
    startedAtMs: number;
}): DesktopIrohTunnelLease {
    for (const field of ['leaseId', 'homeServerIdentityId', 'homeEndpointId', 'runtimeOrigin'] as const) {
        const value = started[field];
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw nativeError('transport-unavailable', `malformed native lease field ${field}`);
        }
    }
    if (started.carrier !== 'iroh') {
        throw nativeError('transport-unavailable', 'malformed native lease field carrier');
    }
    if (started.observedPath !== 'direct' && started.observedPath !== 'relay' && started.observedPath !== 'unknown') {
        throw nativeError('transport-unavailable', 'malformed native lease field observedPath');
    }
    if (typeof started.startedAtMs !== 'number' || !Number.isFinite(started.startedAtMs)) {
        throw nativeError('transport-unavailable', 'malformed native lease field startedAtMs');
    }
    return {
        leaseId: started.leaseId,
        homeServerIdentityId: started.homeServerIdentityId,
        homeEndpointId: started.homeEndpointId,
        runtimeOrigin: readLoopbackRuntimeOrigin(started.runtimeOrigin),
        carrier: 'iroh',
        observedPath: started.observedPath,
        startedAtMs: started.startedAtMs,
    };
}

export class ElectronIrohTunnelService {
    readonly #dependencies: ElectronIrohTunnelServiceDependencies;
    #nativePromise: Promise<IrohNodeLifecycleBoundary | null> | null = null;
    /** Retained only for process shutdown; never renderer-visible. */
    #endpointHandle: string | null = null;

    constructor(dependencies: ElectronIrohTunnelServiceDependencies) {
        this.#dependencies = dependencies;
    }

    async startHomeTunnel(request: unknown): Promise<DesktopIrohTunnelLease> {
        const native = await this.#requireNative();
        try {
            const started = await native.startHomeTunnel({
                ...readStartRequestFacts(request),
                // The host owns the persistent endpoint identity; missing keys
                // are provisioned once by the native key store with restrictive
                // permissions, corrupt keys fail closed without rotation.
                endpointKeyPath: this.#canonicalEndpointKeyPath(),
            });
            if (typeof started.endpointHandle === 'string' && started.endpointHandle.length > 0) {
                this.#endpointHandle = started.endpointHandle;
            }
            return projectLeaseForRenderer(started);
        } catch (error) {
            throw toBridgeError(error);
        }
    }

    async stopHomeTunnel(leaseId: string): Promise<void> {
        const native = await this.#requireNative();
        try {
            await native.stopHomeTunnel(leaseId);
        } catch (error) {
            throw toBridgeError(error);
        }
    }

    async getTunnelStatus(tunnelId: string): Promise<Record<string, unknown> | null> {
        const native = await this.#requireNative();
        try {
            const status = await native.getTunnelStatus(tunnelId);
            if (status === null) return null;
            const observedPath = status.observedPath;
            const connectionActive = status.connectionActive;
            if (
                (observedPath !== 'direct' && observedPath !== 'relay' && observedPath !== 'unknown')
                || typeof connectionActive !== 'boolean'
            ) {
                throw nativeError('transport-unavailable', 'malformed native tunnel status');
            }
            return { active: connectionActive, connectionActive, observedPath };
        } catch (error) {
            throw toBridgeError(error);
        }
    }

    /**
     * Best-effort final-application-shutdown teardown: closes the process
     * endpoint (its acceptors and leases stop with it) while the persistent
     * key file is retained. Identity is never rotated or deleted.
     */
    async shutdownForProcessExit(): Promise<void> {
        const endpointHandle = this.#endpointHandle;
        if (endpointHandle === null) return;
        const native = await this.#nativeOrNull();
        if (!native?.shutdownEndpoint) return;
        await native.shutdownEndpoint({ endpointHandle });
        this.#endpointHandle = null;
    }

    #canonicalEndpointKeyPath(): string {
        return join(this.#dependencies.userDataPath(), ...IROH_ENDPOINT_KEY_RELPATH);
    }

    #loadNative(): Promise<IrohNodeLifecycleBoundary | null> {
        this.#nativePromise ??= (this.#dependencies.loadNative ?? loadSharedIrohNodeLifecycle)().catch(() => null);
        return this.#nativePromise;
    }

    async #nativeOrNull(): Promise<IrohNodeLifecycleBoundary | null> {
        return await this.#loadNative();
    }

    async #requireNative(): Promise<IrohNodeLifecycleBoundary> {
        const native = await this.#loadNative();
        if (!native) throw nativeError('unavailable', 'Iroh native lifecycle is unavailable');
        return native;
    }
}
