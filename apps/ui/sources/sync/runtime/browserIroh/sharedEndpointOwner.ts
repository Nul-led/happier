/**
 * The one browser Iroh endpoint and stream owner (Lane 06 amendment A7.2/A7.3).
 *
 * Exactly one live Iroh endpoint per SharedWorker instance, shared by every
 * connected client (tab). It is not
 * created per Home, tab, request, socket, or transfer, and adopting a second
 * Home adds that Home's relay facts to the same endpoint rather than rotating
 * the key or binding a second one.
 *
 * This module is transport-independent on purpose: the wasm probe is injected as
 * a {@link BrowserIrohEndpointBinder}, so the singleton, lease-custody, and
 * identity-continuity rules are provable without a browser. Every transport rule
 * the endpoint itself follows — relay validation and normalization, ALPNs,
 * endpoint identity, cancellation — stays owned by `happier-iroh-core` behind
 * that binder; nothing is restated here.
 *
 * Production Home HTTP, Socket.IO, and finite Machine transfers consume this
 * owner through the tab-side client and their existing semantic carrier owners.
 * QR and Account Service remain descriptor/enrollment callers rather than
 * transport owners and do not consume this module directly.
 */

import {
    BROWSER_IROH_STREAM_CHUNK_BYTES,
    type BrowserIrohEndpointStatus,
    type BrowserIrohErrorCode,
    type BrowserIrohObservedPath,
    type BrowserIrohStreamKind,
} from './protocol';

export type BrowserIrohEndpointStreamHandle = Readonly<{
    /** The EndpointId the transport cryptographically proved for this stream. */
    remoteEndpointId: string;
    observedPath: BrowserIrohObservedPath;
    read: (maxBytes: number) => Promise<Readonly<{ bytes: Uint8Array; done: boolean }>>;
    write: (bytes: Uint8Array) => Promise<void>;
    finishWrite: () => Promise<void>;
    cancel: () => void;
    close: () => Promise<void>;
}>;

/** The live endpoint, as the browser binding exposes it to this owner. */
export type BrowserIrohEndpointHandle = Readonly<{
    endpointId: string;
    /** Read back from the endpoint, which is the canonical owner of what applied. */
    appliedRelayUrls: () => readonly string[];
    applyRelayUrls: (relayUrls: readonly string[]) => Promise<void>;
    /**
     * Opens one stream for exactly one protocol. `streamKind` is a closed
     * value, not an ALPN: the binding routes it to the matching wasm
     * operation, which is where the core's ALPN constant is applied.
     */
    openStream: (input: Readonly<{
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
        relayUrls: readonly string[];
        signal?: AbortSignal;
    }>) => Promise<BrowserIrohEndpointStreamHandle>;
    /** Releases one authenticated target+protocol connection without closing the endpoint. */
    closeConnection: (input: Readonly<{
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
    }>) => Promise<void>;
    close: () => Promise<void>;
}>;

export type BrowserIrohEndpointBinder = (
    input: Readonly<{ secretKey: Uint8Array; relayUrls: readonly string[] }>,
) => Promise<BrowserIrohEndpointHandle>;

export type BrowserIrohEndpointLease = Readonly<{
    leaseId: string;
    endpointId: string;
    appliedRelayUrls: readonly string[];
}>;

export class BrowserIrohOwnerError extends Error {
    constructor(readonly code: BrowserIrohErrorCode, message?: string) {
        super(message ?? `Browser Iroh endpoint owner rejected the request (${code})`);
        this.name = 'BrowserIrohOwnerError';
    }
}

export type BrowserIrohSharedEndpointOwner = Readonly<{
    acquireLease: (
        input: Readonly<{ clientId: string; relayUrls: readonly string[] }>,
    ) => Promise<BrowserIrohEndpointLease>;
    /**
     * Drops one lease the calling client holds. The client id is the worker's,
     * never the wire's: a lease id alone is not a capability another port may
     * spend.
     */
    releaseLease: (input: Readonly<{ clientId: string; leaseId: string }>) => Promise<void>;
    /** Drops every lease one client holds. Sibling clients are untouched. */
    releaseClient: (clientId: string) => Promise<void>;
    openStream: (input: Readonly<{
        clientId: string;
        leaseId: string;
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
        relayUrls: readonly string[];
        signal?: AbortSignal;
    }>) => Promise<Readonly<{
        streamId: string;
        remoteEndpointId: string;
        observedPath: BrowserIrohObservedPath;
    }>>;
    readStream: (input: Readonly<{ clientId: string; streamId: string; maxBytes: number }>) => Promise<Readonly<{ bytes: Uint8Array; done: boolean }>>;
    writeStream: (input: Readonly<{ clientId: string; streamId: string; bytes: Uint8Array }>) => Promise<void>;
    finishStreamWrite: (input: Readonly<{ clientId: string; streamId: string }>) => Promise<void>;
    cancelStream: (input: Readonly<{ clientId: string; streamId: string }>) => Promise<void>;
    closeStream: (input: Readonly<{ clientId: string; streamId: string }>) => Promise<void>;
    status: () => BrowserIrohEndpointStatus;
}>;

type OwnerDependencies = Readonly<{
    randomBytes: (length: number) => Uint8Array;
    bindEndpoint: BrowserIrohEndpointBinder;
    newLeaseId?: () => string;
    newStreamId?: () => string;
}>;

const BROWSER_IROH_ENDPOINT_KEY_BYTES = 32;

type ConnectionIdentity = Readonly<{
    streamKind: BrowserIrohStreamKind;
    endpointId: string;
}>;
type LeaseRecord = {
    leaseId: string;
    clientId: string;
    connections: Map<string, ConnectionIdentity>;
};
type StreamRecord = {
    streamId: string;
    clientId: string;
    leaseId: string;
    connection: ConnectionIdentity;
    handle: BrowserIrohEndpointStreamHandle;
    cancelled: boolean;
    cancellation: Promise<never>;
    rejectCancellation: (error: BrowserIrohOwnerError) => void;
    closing: Promise<void> | null;
    streamClosed: boolean;
};

function connectionKey(connection: ConnectionIdentity): string {
    return `${connection.streamKind}\u0000${connection.endpointId}`;
}

function defaultLeaseId(): string {
    const cryptoRandomUUID = globalThis.crypto?.randomUUID;
    if (typeof cryptoRandomUUID === 'function') {
        return cryptoRandomUUID.call(globalThis.crypto);
    }
    return `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultStreamId(): string {
    return `stream-${defaultLeaseId()}`;
}

export function createBrowserIrohSharedEndpointOwner(
    dependencies: OwnerDependencies,
): BrowserIrohSharedEndpointOwner {
    const newLeaseId = dependencies.newLeaseId ?? defaultLeaseId;
    const newStreamId = dependencies.newStreamId ?? defaultStreamId;
    const leases = new Map<string, LeaseRecord>();
    const streams = new Map<string, StreamRecord>();
    const releaseGenerationByClientId = new Map<string, number>();

    let handle: BrowserIrohEndpointHandle | null = null;
    /** The one in-flight bind. Concurrent acquires join it instead of racing. */
    let binding: Promise<BrowserIrohEndpointHandle> | null = null;

    function requireLease(clientId: string, leaseId: string): LeaseRecord {
        const lease = leases.get(leaseId);
        if (lease === undefined || lease.clientId !== clientId) {
            throw new BrowserIrohOwnerError('unknown_lease');
        }
        return lease;
    }

    function requireStream(clientId: string, streamId: string): StreamRecord {
        const stream = streams.get(streamId);
        if (stream === undefined || stream.clientId !== clientId) {
            throw new BrowserIrohOwnerError('unknown_stream');
        }
        return stream;
    }

    function cancelRecord(stream: StreamRecord): void {
        if (stream.cancelled) return;
        stream.cancelled = true;
        stream.handle.cancel();
        stream.rejectCancellation(new BrowserIrohOwnerError('cancelled'));
    }

    async function closeRecord(stream: StreamRecord): Promise<void> {
        cancelRecord(stream);
        if (!stream.streamClosed) {
            if (stream.closing === null) {
                stream.closing = stream.handle.close();
            }
            try {
                await stream.closing;
                stream.streamClosed = true;
                stream.closing = null;
            } catch (error) {
                stream.closing = null;
                throw error;
            }
        }

        // A stream that settled after its lease disappeared is the only owner
        // left able to release the connection that its open may have created.
        // Keep this same record in custody until both releases succeed.
        if (!leases.has(stream.leaseId)) {
            await closeConnectionIfUnowned(stream.connection);
        }
        if (streams.get(stream.streamId) === stream) streams.delete(stream.streamId);
    }

    async function closeMatchingStreams(matches: (stream: StreamRecord) => boolean): Promise<void> {
        const matching = [...streams.values()].filter(matches);
        const results = await Promise.allSettled(matching.map(closeRecord));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed !== undefined) throw failed.reason;
    }

    function isConnectionOwned(connection: ConnectionIdentity): boolean {
        const key = connectionKey(connection);
        return [...leases.values()].some((lease) => lease.connections.has(key));
    }

    async function closeConnectionIfUnowned(connection: ConnectionIdentity): Promise<void> {
        if (isConnectionOwned(connection)) return;
        const bound = handle;
        if (bound === null) return;
        await bound.closeConnection(connection);
    }

    async function releaseLeaseRecord(record: LeaseRecord): Promise<void> {
        await closeMatchingStreams((stream) => stream.leaseId === record.leaseId);
        if (leases.get(record.leaseId) !== record) return;

        // Leave the ownership table before checking siblings. Two final
        // siblings may release concurrently; if each remained visible while
        // checking, both could defer to the other and strand the connection.
        leases.delete(record.leaseId);
        try {
            for (const [key, connection] of record.connections) {
                await closeConnectionIfUnowned(connection);
                record.connections.delete(key);
            }
        } catch (error) {
            // A failed connection release keeps this lease record as retry
            // custody for the caller's next explicit release.
            leases.set(record.leaseId, record);
            throw error;
        }
    }

    async function runStreamOperation<T>(stream: StreamRecord, operation: () => Promise<T>): Promise<T> {
        if (stream.cancelled) throw new BrowserIrohOwnerError('cancelled');
        const result = await Promise.race([operation(), stream.cancellation]);
        if (stream.cancelled || streams.get(stream.streamId) !== stream) {
            throw new BrowserIrohOwnerError('cancelled');
        }
        return result;
    }

    async function ensureEndpoint(relayUrls: readonly string[]): Promise<BrowserIrohEndpointHandle> {
        // Relay-only carrier: a contribution with no relay facts has no path at
        // all, and ambient infrastructure is never substituted for one. This is
        // the typed surface of the core's own relay-only rule; which relay URLs
        // are valid is decided only by the core, when the contribution reaches
        // the binding.
        if (relayUrls.length === 0) {
            throw new BrowserIrohOwnerError('relay_required');
        }

        if (handle !== null) {
            // Each caller's contribution is applied to the bound endpoint as it
            // arrives. The core validates it and unions it into the relay the
            // endpoint already has — monotonic growth without eviction — so the
            // owner keeps no relay set of its own, and an entry the core
            // rejects is never persisted to poison a later valid acquisition.
            await handle.applyRelayUrls(relayUrls);
            return handle;
        }

        if (binding === null) {
            binding = (async () => {
                const secretKey = dependencies.randomBytes(BROWSER_IROH_ENDPOINT_KEY_BYTES);
                if (!(secretKey instanceof Uint8Array) || secretKey.length !== BROWSER_IROH_ENDPOINT_KEY_BYTES) {
                    throw new BrowserIrohOwnerError('endpoint_unavailable', 'Browser Iroh endpoint seed is unavailable');
                }
                try {
                    return await dependencies.bindEndpoint({ secretKey, relayUrls });
                } finally {
                    secretKey.fill(0);
                }
            })().then(
                (bound) => {
                    binding = null;
                    handle = bound;
                    return bound;
                },
                (error) => {
                    binding = null;
                    throw error;
                },
            );
        }

        const bound = await binding;
        // A contribution that arrived while the first bind was in flight still
        // has to reach the endpoint. Re-applying the bind-time contribution is
        // a core-level no-op.
        await bound.applyRelayUrls(relayUrls);
        return bound;
    }

    return {
        acquireLease: async ({ clientId, relayUrls }) => {
            const releaseGeneration = releaseGenerationByClientId.get(clientId) ?? 0;
            const bound = await ensureEndpoint(relayUrls);
            if ((releaseGenerationByClientId.get(clientId) ?? 0) !== releaseGeneration) {
                throw new BrowserIrohOwnerError('cancelled');
            }
            const leaseId = newLeaseId();
            leases.set(leaseId, { leaseId, clientId, connections: new Map() });
            return {
                leaseId,
                endpointId: bound.endpointId,
                appliedRelayUrls: bound.appliedRelayUrls(),
            };
        },

        releaseLease: async ({ clientId, leaseId }) => {
            const record = leases.get(leaseId);
            if (record === undefined) {
                // Already gone is the outcome the caller asked for. A reload, a
                // repeated release, and a release after `releaseClient` all
                // arrive here, and none of them is a failure.
                await closeMatchingStreams(
                    (stream) => stream.clientId === clientId && stream.leaseId === leaseId,
                );
                return;
            }
            if (record.clientId !== clientId) {
                // Ports are reachable by any script on the origin, so a lease
                // id another client observed or guessed must not release it.
                // The refusal is the same typed outcome a lease that never
                // existed would produce, and discloses nothing further.
                throw new BrowserIrohOwnerError('unknown_lease');
            }
            await releaseLeaseRecord(record);
            // The endpoint deliberately survives its last lease for the life
            // of this SharedWorker. A Home logout releases leases without
            // replacing the live worker's endpoint; worker destruction ends
            // that ephemeral identity and a later worker mints a new one.
        },

        releaseClient: async (clientId) => {
            releaseGenerationByClientId.set(
                clientId,
                (releaseGenerationByClientId.get(clientId) ?? 0) + 1,
            );
            const failures: unknown[] = [];
            if ([...streams.values()].some((stream) => stream.clientId === clientId)) {
                try {
                    await closeMatchingStreams((stream) => stream.clientId === clientId);
                } catch (error) {
                    failures.push(error);
                }
            }
            const ownedLeases = [...leases.values()].filter((record) => record.clientId === clientId);
            const releases = await Promise.allSettled(ownedLeases.map(releaseLeaseRecord));
            for (const release of releases) {
                if (release.status === 'rejected') {
                    failures.push(release.reason);
                }
            }
            // A dead client cannot retry unattempted siblings, so every owned
            // resource is attempted before the first failure is reported. Each
            // failed record remains in the canonical owner for a later sweep.
            const stillOwned = [...streams.values()].some((stream) => stream.clientId === clientId)
                || [...leases.values()].some((record) => record.clientId === clientId);
            if (failures.length > 0 && stillOwned) throw failures[0];
        },

        openStream: async ({ clientId, leaseId, streamKind, endpointId, relayUrls, signal }) => {
            requireLease(clientId, leaseId);
            if (signal?.aborted) throw new BrowserIrohOwnerError('cancelled');
            const bound = await ensureEndpoint(relayUrls);
            const lease = requireLease(clientId, leaseId);
            if (signal?.aborted) throw new BrowserIrohOwnerError('cancelled');
            const requestedConnection = { streamKind, endpointId };
            // Claim before the asynchronous open so a sibling release cannot
            // close a shared connection underneath this admitted operation.
            // Even a failed open may have dialled before failing, so custody
            // lasts until lease release.
            lease.connections.set(connectionKey(requestedConnection), requestedConnection);
            const opened = await bound.openStream({ streamKind, endpointId, relayUrls, signal });
            const connection = { streamKind, endpointId: opened.remoteEndpointId };
            if (
                leases.get(leaseId) === lease
                && connectionKey(connection) !== connectionKey(requestedConnection)
            ) {
                lease.connections.delete(connectionKey(requestedConnection));
                lease.connections.set(connectionKey(connection), connection);
            }
            const streamId = newStreamId();
            let rejectCancellation!: (error: BrowserIrohOwnerError) => void;
            const cancellation = new Promise<never>((_resolve, reject) => {
                rejectCancellation = reject;
            });
            // The cancellation promise is intentionally consumed only through
            // operation races; attach a sink so cancelling an idle stream is
            // not reported as an unhandled rejection.
            void cancellation.catch(() => undefined);
            const stream: StreamRecord = {
                streamId,
                clientId,
                leaseId,
                connection,
                handle: opened,
                cancelled: false,
                cancellation,
                rejectCancellation,
                closing: null,
                streamClosed: false,
            };
            streams.set(streamId, stream);
            if (signal?.aborted || leases.get(leaseId)?.clientId !== clientId) {
                // Usually Rust rejects before producing a handle. If completion
                // wins the same turn, enter normal stream custody first so a
                // failed late close remains retryable by lease/client cleanup.
                try {
                    await closeRecord(stream);
                } catch (error) {
                    // Cancellation is already the caller-visible outcome; a
                    // cleanup failure stays in custody without masking it. The
                    // established clear/release paths still surface their own
                    // cleanup failure when there was no request cancellation.
                    if (!signal?.aborted) throw error;
                }
                throw new BrowserIrohOwnerError(
                    signal?.aborted ? 'cancelled' : 'unknown_lease',
                );
            }
            return {
                streamId,
                remoteEndpointId: opened.remoteEndpointId,
                observedPath: opened.observedPath,
            };
        },

        readStream: async ({ clientId, streamId, maxBytes }) => {
            if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > BROWSER_IROH_STREAM_CHUNK_BYTES) {
                throw new BrowserIrohOwnerError('resource_limit');
            }
            const stream = requireStream(clientId, streamId);
            const result = await runStreamOperation(stream, () => stream.handle.read(maxBytes));
            if (result.bytes.byteLength > maxBytes || result.bytes.byteLength > BROWSER_IROH_STREAM_CHUNK_BYTES) {
                cancelRecord(stream);
                throw new BrowserIrohOwnerError('resource_limit');
            }
            return result;
        },

        writeStream: async ({ clientId, streamId, bytes }) => {
            if (bytes.byteLength > BROWSER_IROH_STREAM_CHUNK_BYTES) {
                throw new BrowserIrohOwnerError('resource_limit');
            }
            const stream = requireStream(clientId, streamId);
            await runStreamOperation(stream, () => stream.handle.write(bytes));
        },

        finishStreamWrite: async ({ clientId, streamId }) => {
            const stream = requireStream(clientId, streamId);
            await runStreamOperation(stream, () => stream.handle.finishWrite());
        },

        cancelStream: async ({ clientId, streamId }) => {
            const stream = streams.get(streamId);
            if (stream === undefined) return;
            if (stream.clientId !== clientId) throw new BrowserIrohOwnerError('unknown_stream');
            cancelRecord(stream);
        },

        closeStream: async ({ clientId, streamId }) => {
            const stream = streams.get(streamId);
            if (stream === undefined) return;
            if (stream.clientId !== clientId) throw new BrowserIrohOwnerError('unknown_stream');
            await closeRecord(stream);
        },

        status: () => ({
            state: handle === null ? 'idle' : 'ready',
            endpointId: handle?.endpointId ?? null,
            appliedRelayUrls: handle?.appliedRelayUrls() ?? [],
            leaseCount: leases.size,
        }),
    };
}
