/**
 * The one browser Iroh endpoint and stream owner (Lane 06 amendment A7.2/A7.3).
 *
 * Exactly one live Iroh endpoint per browser application/profile, shared by
 * every client (tab) through the SharedWorker this owner runs inside. It is not
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
    resolvePersistentBrowserIrohEndpointKey,
    type BrowserIrohEndpointKeyStore,
} from './endpointKey';
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
    configureRelays: (
        relayUrls: readonly string[],
    ) => Promise<Readonly<{ endpointId: string; appliedRelayUrls: readonly string[] }>>;
    openStream: (input: Readonly<{
        clientId: string;
        leaseId: string;
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
        relayUrls: readonly string[];
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
    clearApplicationData: () => Promise<void>;
}>;

type OwnerDependencies = Readonly<{
    keyStore: BrowserIrohEndpointKeyStore;
    randomBytes: (length: number) => Uint8Array;
    bindEndpoint: BrowserIrohEndpointBinder;
    newLeaseId?: () => string;
    newStreamId?: () => string;
}>;

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

    let cleared = false;
    let handle: BrowserIrohEndpointHandle | null = null;
    /** The one in-flight bind. Concurrent acquires join it instead of racing. */
    let binding: Promise<BrowserIrohEndpointHandle> | null = null;
    /**
     * The endpoint a clear has taken custody of and has not successfully closed
     * yet — either the live one or one whose first bind settled after the clear
     * began. It is the handle itself, not a spent promise, because a close that
     * failed has to be retryable: dropping the handle would leak the endpoint
     * with no caller able to reach it again.
     */
    let retainedForClose: BrowserIrohEndpointHandle | null = null;
    /** The one in-flight terminal clear. Concurrent clears join it. */
    let clearing: Promise<void> | null = null;

    function requireLive(): void {
        if (cleared) {
            throw new BrowserIrohOwnerError('owner_cleared');
        }
    }

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
        if (!cleared && !leases.has(stream.leaseId)) {
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
            // custody. Terminal clear owns the endpoint instead once begun.
            if (!cleared) leases.set(record.leaseId, record);
            throw error;
        }
    }

    async function runStreamOperation<T>(stream: StreamRecord, operation: Promise<T>): Promise<T> {
        if (stream.cancelled) throw new BrowserIrohOwnerError('cancelled');
        const result = await Promise.race([operation, stream.cancellation]);
        if (stream.cancelled || streams.get(stream.streamId) !== stream) {
            throw new BrowserIrohOwnerError('cancelled');
        }
        return result;
    }

    async function ensureEndpoint(relayUrls: readonly string[]): Promise<BrowserIrohEndpointHandle> {
        requireLive();

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
            // A clear that began while that work was in flight ends this
            // operation: it must not report success on a cleared owner.
            requireLive();
            return handle;
        }

        if (binding === null) {
            binding = (async () => {
                const secretKey = await resolvePersistentBrowserIrohEndpointKey(
                    dependencies.keyStore,
                    dependencies.randomBytes,
                );
                return await dependencies.bindEndpoint({ secretKey, relayUrls });
            })().then(
                (bound) => {
                    binding = null;
                    // An endpoint bound after a clear must not become live
                    // state, and its release belongs to that clear: the handle
                    // is handed to the clear's custody so the clear can await a
                    // fully released endpoint — and retry it — instead of
                    // racing a background teardown it cannot repeat.
                    if (cleared) {
                        retainedForClose = bound;
                        throw new BrowserIrohOwnerError('owner_cleared');
                    }
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
        // Same re-check as the live-handle path: work that was admitted before
        // a clear but finishes after it never becomes a success or a lease.
        requireLive();
        return bound;
    }

    /**
     * One terminal-clear attempt: settle the bind, release the endpoint this
     * clear has custody of, and delete the persistent key. Both steps are
     * always attempted and both failures are reported separately, so a caller
     * can tell an endpoint that would not close from a key that would not go.
     */
    async function runTerminalClear(): Promise<void> {
        let teardownError: unknown = null;
        try {
            await closeMatchingStreams(() => true);
            // The binding promise performs the only key write this owner ever
            // issues, so it has to be fully settled — key persisted or rejected
            // — before the store is cleared. Otherwise an acquire that was
            // still minting the key would re-write the record after this clear
            // resolved, resurrecting the identity the clear removed. No new
            // binding can start behind this point: every later entry rejects
            // `owner_cleared` before reaching the bind, and a bind that settles
            // here hands its endpoint to this attempt's custody.
            while (binding !== null) {
                await binding.then(undefined, () => undefined);
            }
            const pending = retainedForClose;
            if (pending !== null) {
                await pending.close();
                // Custody ends only on a close that actually succeeded.
                retainedForClose = null;
            }
        } catch (error) {
            // A failed endpoint release does not cancel the clear: the
            // persistent key is still removed, the endpoint stays in this
            // owner's custody for the next attempt, and the failure is reported
            // truthfully instead of being swallowed into a completed clear.
            teardownError = error;
        }

        try {
            await dependencies.keyStore.clear();
        } catch (error) {
            if (teardownError === null) throw error;
            throw new Error(
                `browser Iroh clear failed at both teardown steps: ${
                    teardownError instanceof Error ? teardownError.message : String(teardownError)
                }; then ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (teardownError !== null) {
            throw teardownError;
        }
    }

    return {
        acquireLease: async ({ clientId, relayUrls }) => {
            const bound = await ensureEndpoint(relayUrls);
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
            // The endpoint deliberately survives its last lease. It is the
            // browser application/profile's endpoint, not the session's: a Home
            // logout releases leases and must not cost the endpoint or the key.
            // SharedWorker global termination is the browser's to decide.
        },

        releaseClient: async (clientId) => {
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

        configureRelays: async (relayUrls) => {
            const bound = await ensureEndpoint(relayUrls);
            return { endpointId: bound.endpointId, appliedRelayUrls: bound.appliedRelayUrls() };
        },

        openStream: async ({ clientId, leaseId, streamKind, endpointId, relayUrls }) => {
            requireLease(clientId, leaseId);
            const bound = await ensureEndpoint(relayUrls);
            const lease = requireLease(clientId, leaseId);
            const requestedConnection = { streamKind, endpointId };
            // Claim before the asynchronous open so a sibling release cannot
            // close a shared connection underneath this admitted operation.
            // Even a failed open may have dialled before failing, so custody
            // lasts until lease release.
            lease.connections.set(connectionKey(requestedConnection), requestedConnection);
            const opened = await bound.openStream({ streamKind, endpointId, relayUrls });
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
            if (cleared || leases.get(leaseId)?.clientId !== clientId) {
                await closeRecord(stream);
                throw new BrowserIrohOwnerError(cleared ? 'owner_cleared' : 'unknown_lease');
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
            const result = await runStreamOperation(stream, stream.handle.read(maxBytes));
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
            await runStreamOperation(stream, stream.handle.write(bytes));
        },

        finishStreamWrite: async ({ clientId, streamId }) => {
            const stream = requireStream(clientId, streamId);
            await runStreamOperation(stream, stream.handle.finishWrite());
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
            state: cleared ? 'cleared' : handle === null ? 'idle' : 'ready',
            endpointId: handle?.endpointId ?? null,
            appliedRelayUrls: handle?.appliedRelayUrls() ?? [],
            leaseCount: leases.size,
        }),

        clearApplicationData: async () => {
            // Terminal by design. A clear ends this owner's life; a later
            // endpoint needs a fresh worker global, which is what clearing
            // application data implies anyway. There is no half-cleared state
            // for a caller to observe: the owner refuses every later command
            // from this point, whether or not the teardown itself succeeds.
            cleared = true;
            leases.clear();
            if (handle !== null) {
                retainedForClose = handle;
                handle = null;
            }

            // One attempt, however many callers ask. Tabs clear concurrently,
            // and a caller that observed the emptied field and returned success
            // while the real teardown was still running — or still failing —
            // would be reporting a clear that did not happen.
            if (clearing !== null) {
                await clearing;
                return;
            }
            const attempt = runTerminalClear();
            clearing = attempt;
            try {
                await attempt;
            } finally {
                // Only the caller that started this attempt retires it, so a
                // failed clear stays retryable by a later call — with the same
                // endpoint still in custody.
                if (clearing === attempt) clearing = null;
            }
        },
    };
}
