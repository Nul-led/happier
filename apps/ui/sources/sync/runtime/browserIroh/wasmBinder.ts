/**
 * Adapts the packaged `happier-iroh-wasm` boundary to the endpoint handle the
 * shared owner consumes (A7.2).
 *
 * The wasm module is a genuinely untyped external artifact: it is a generated
 * static asset loaded by URL, not a resolvable module specifier, so its shape is
 * validated here once and narrowed to a real type. Nothing else in the app talks
 * to it directly, and no transport rule is restated on this side of the
 * boundary — relay validation and normalization, ALPNs, endpoint identity, and
 * cancellation all stay in `happier-iroh-core`.
 */

import { isBrowserIrohObservedPath, type BrowserIrohObservedPath, type BrowserIrohStreamKind } from './protocol';
import type {
    BrowserIrohEndpointBinder,
    BrowserIrohEndpointHandle,
    BrowserIrohEndpointStreamHandle,
} from './sharedEndpointOwner';

/** The subset of the generated probe this slice consumes. */
type BrowserIrohProbe = Readonly<{
    endpointId: () => string;
    appliedRelayUrls: () => string[];
    applyRelayUrls: (relayUrls: string[]) => Promise<void>;
    openIncrementalHomeTunnelStream: (
        endpointId: string,
        relayUrls: string[],
        cancellation: BrowserIrohOpenCancellation,
    ) => Promise<number>;
    openIncrementalMachineStream: (
        endpointId: string,
        relayUrls: string[],
        cancellation: BrowserIrohOpenCancellation,
    ) => Promise<number>;
    streamRemoteEndpointId: (streamHandle: number) => string;
    streamObservedPath: (streamHandle: number) => string;
    readStream: (streamHandle: number, maxBytes: number) => Promise<Uint8Array | null>;
    writeStream: (streamHandle: number, bytes: Uint8Array) => Promise<void>;
    finishStreamWrite: (streamHandle: number) => Promise<void>;
    cancelStream: (streamHandle: number) => void;
    closeStream: (streamHandle: number) => Promise<void>;
    closeHomeTunnelConnection: (endpointId: string) => void;
    closeMachineConnection: (endpointId: string) => void;
    close: () => Promise<void>;
}>;

type BrowserIrohOpenCancellation = Readonly<{ cancel: () => void }>;

type BrowserIrohWasmModule = Readonly<{
    default: (input?: unknown) => Promise<unknown>;
    HappierBrowserIrohProbe: Readonly<{
        create: (secretKey: Uint8Array, relayUrls: string[]) => Promise<BrowserIrohProbe>;
    }>;
    HappierBrowserIrohOpenCancellation: new () => BrowserIrohOpenCancellation;
}>;

export class BrowserIrohWasmBoundaryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrowserIrohWasmBoundaryError';
    }
}

function requireFunction(value: unknown, name: string): void {
    if (typeof value !== 'function') {
        throw new BrowserIrohWasmBoundaryError(
            `Packaged browser Iroh module does not expose ${name}()`,
        );
    }
}

/**
 * Validates the loaded module rather than trusting it. A stale or partially
 * copied asset is a packaging failure, and it must surface as one instead of a
 * `TypeError` deep inside a lease.
 */
export function narrowBrowserIrohWasmModule(loaded: unknown): BrowserIrohWasmModule {
    if (loaded === null || typeof loaded !== 'object') {
        throw new BrowserIrohWasmBoundaryError('Packaged browser Iroh module did not load');
    }
    const record = loaded as Record<string, unknown>;
    requireFunction(record.default, 'default');

    const probeClass = record.HappierBrowserIrohProbe;
    if (probeClass === null || typeof probeClass !== 'function') {
        throw new BrowserIrohWasmBoundaryError(
            'Packaged browser Iroh module does not export HappierBrowserIrohProbe',
        );
    }
    requireFunction(
        (probeClass as unknown as Record<string, unknown>).create,
        'HappierBrowserIrohProbe.create',
    );
    requireFunction(record.HappierBrowserIrohOpenCancellation, 'HappierBrowserIrohOpenCancellation');

    return loaded as BrowserIrohWasmModule;
}

/**
 * The generated boundary reports the path the transport observed. A relay-only
 * browser endpoint normalizes it in Rust already; anything else arriving here
 * would mean the packaged artifact does not match this app, so it is refused
 * rather than downgraded into a plausible-looking claim.
 */
function narrowEndpointId(value: unknown, owner: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
        throw new BrowserIrohWasmBoundaryError(
            `Packaged browser Iroh module reported an invalid ${owner} EndpointId`,
        );
    }
    return value;
}

function narrowObservedPath(value: unknown): BrowserIrohObservedPath {
    if (!isBrowserIrohObservedPath(value)) {
        throw new BrowserIrohWasmBoundaryError(
            `Packaged browser Iroh module reported an unsupported observed path: ${String(value)}`,
        );
    }
    return value;
}

function narrowProbe(probe: unknown): BrowserIrohProbe {
    if (probe === null || typeof probe !== 'object') {
        throw new BrowserIrohWasmBoundaryError('Browser Iroh probe was not created');
    }
    const record = probe as Record<string, unknown>;
    for (const name of [
        'endpointId',
        'appliedRelayUrls',
        'applyRelayUrls',
        'openIncrementalHomeTunnelStream',
        'openIncrementalMachineStream',
        'streamRemoteEndpointId',
        'streamObservedPath',
        'readStream',
        'writeStream',
        'finishStreamWrite',
        'cancelStream',
        'closeStream',
        'closeHomeTunnelConnection',
        'closeMachineConnection',
        'close',
    ] as const) {
        requireFunction(record[name], `HappierBrowserIrohProbe#${name}`);
    }
    return probe as BrowserIrohProbe;
}

/**
 * Builds the binder from an already-initialized module. `initialize` runs the
 * wasm-bindgen module initializer with the packaged `.wasm` URL; the module is
 * initialized once per worker global, not once per endpoint.
 */
export function createBrowserIrohWasmBinder(
    loadModule: () => Promise<{ module: unknown; wasmUrl: string }>,
): BrowserIrohEndpointBinder {
    let initialized: Promise<BrowserIrohWasmModule> | null = null;

    const initialize = async (): Promise<BrowserIrohWasmModule> => {
        if (initialized === null) {
            initialized = (async () => {
                const { module, wasmUrl } = await loadModule();
                const narrowed = narrowBrowserIrohWasmModule(module);
                await narrowed.default({ module_or_path: wasmUrl });
                return narrowed;
            })().catch((error: unknown) => {
                // A failed initialization must not poison every later attempt
                // with a settled rejected promise.
                initialized = null;
                throw error;
            });
        }
        return await initialized;
    };

    return async ({ secretKey, relayUrls }): Promise<BrowserIrohEndpointHandle> => {
        // Initialization is awaited first: the seed is the endpoint identity
        // and must be intact until the create boundary is actually invoked.
        const module = await initialize();
        // Invoking `create` copies the seed across the wasm boundary
        // synchronously (the Rust side takes its own zeroizing copy), so the
        // JS copy is wiped as soon as the call has been issued — whether the
        // returned promise later resolves or rejects, and whether the call
        // itself throws before returning one.
        let probePromise: Promise<BrowserIrohProbe>;
        try {
            probePromise = module.HappierBrowserIrohProbe.create(secretKey, [...relayUrls]);
        } finally {
            secretKey.fill(0);
        }
        const probe = narrowProbe(await probePromise);
        const openStream = async (
            streamKind: BrowserIrohStreamKind,
            endpointId: string,
            relayUrls: readonly string[],
            signal?: AbortSignal,
        ): Promise<BrowserIrohEndpointStreamHandle> => {
            const cancellation = new module.HappierBrowserIrohOpenCancellation();
            requireFunction(cancellation.cancel, 'HappierBrowserIrohOpenCancellation#cancel');
            const onAbort = () => cancellation.cancel();
            if (signal?.aborted) onAbort();
            else signal?.addEventListener('abort', onAbort, { once: true });
            // One exhaustive switch is the whole protocol decision: each kind
            // reaches its own generated operation, which is where the core's
            // ALPN constant lives. No ALPN string is ever passed across.
            let streamHandle: number;
            try {
                streamHandle = await (streamKind === 'machine'
                    ? probe.openIncrementalMachineStream(endpointId, [...relayUrls], cancellation)
                    : probe.openIncrementalHomeTunnelStream(endpointId, [...relayUrls], cancellation));
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
            let remoteEndpointId: string;
            let observedPath: BrowserIrohObservedPath;
            try {
                remoteEndpointId = narrowEndpointId(
                    probe.streamRemoteEndpointId(streamHandle),
                    'remote stream',
                );
                observedPath = narrowObservedPath(probe.streamObservedPath(streamHandle));
            } catch (error) {
                // The raw WASM handle exists, but custody cannot cross this
                // boundary when its metadata is malformed or traps. Close it
                // here because the SharedWorker owner never received a handle
                // it could release. Preserve the originating boundary failure.
                try {
                    await probe.closeStream(streamHandle);
                } catch {
                    // Best-effort cleanup cannot replace the metadata failure.
                }
                throw error;
            }
            return {
                remoteEndpointId,
                observedPath,
                read: async (maxBytes) => {
                    const bytes = await probe.readStream(streamHandle, maxBytes);
                    return bytes === null
                        ? { bytes: new Uint8Array(), done: true }
                        : { bytes, done: false };
                },
                write: async (bytes) => {
                    await probe.writeStream(streamHandle, bytes);
                },
                finishWrite: async () => {
                    await probe.finishStreamWrite(streamHandle);
                },
                cancel: () => probe.cancelStream(streamHandle),
                close: async () => {
                    await probe.closeStream(streamHandle);
                },
            };
        };
        let endpointId: string;
        try {
            endpointId = narrowEndpointId(probe.endpointId(), 'local probe');
        } catch (error) {
            // A created probe that cannot publish a valid identity never
            // reaches the SharedWorker owner's custody, so this boundary must
            // close it before propagating the original failure.
            try {
                await probe.close();
            } catch {
                // Best-effort cleanup cannot replace the identity failure.
            }
            throw error;
        }
        return {
            endpointId,
            appliedRelayUrls: () => probe.appliedRelayUrls(),
            applyRelayUrls: async (next) => {
                await probe.applyRelayUrls([...next]);
            },
            openStream: async ({ streamKind, endpointId, relayUrls, signal }) =>
                await openStream(streamKind, endpointId, relayUrls, signal),
            closeConnection: async ({ streamKind, endpointId }) => {
                if (streamKind === 'machine') {
                    probe.closeMachineConnection(endpointId);
                } else {
                    probe.closeHomeTunnelConnection(endpointId);
                }
            },
            close: async () => {
                await probe.close();
            },
        };
    };
}
