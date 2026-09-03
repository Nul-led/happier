/**
 * The typed command boundary between a browser tab and the one shared browser
 * Iroh endpoint and stream owner (Lane 06 amendment A7.2/A7.3).
 *
 * Deliberately small: it carries endpoint leases/configuration/clear plus opaque,
 * bounded incremental stream operations. It is not a generic RPC framework and
 * exposes neither raw endpoint internals nor HTTP/Socket.IO semantics; activating
 * those production consumers remains separate work.
 *
 * Both sides parse explicitly and fail closed, because the port is reachable by
 * any script on the origin. Stream payloads stay binary structured-clone values
 * and each operation is capped below the Home carrier's receive-window bound.
 */

export const BROWSER_IROH_PROTOCOL_VERSION = 1;
export const BROWSER_IROH_STREAM_CHUNK_BYTES = 1024 * 1024;

export type BrowserIrohErrorCode =
    | 'protocol_violation'
    | 'relay_required'
    | 'owner_cleared'
    | 'unknown_lease'
    | 'unknown_stream'
    | 'resource_limit'
    | 'cancelled'
    | 'endpoint_unavailable';

export type BrowserIrohEndpointState = 'idle' | 'ready' | 'cleared';

/**
 * The closed set of protocols a browser stream may be opened for. It is a kind,
 * never an ALPN string: the endpoint owner maps it to the shared core's ALPN
 * constant, so no caller — including a script that merely reached this origin's
 * worker port — can name a protocol the core did not define.
 */
export type BrowserIrohStreamKind = 'home' | 'machine';

/**
 * The path an opened stream's connection actually selected. The browser carrier
 * is relay-only and has no IP transports, so `direct` is not a value this
 * boundary can carry.
 */
export type BrowserIrohObservedPath = 'relay' | 'unknown';

/** The bounded projection a client may observe. No transport internals. */
export type BrowserIrohEndpointStatus = Readonly<{
    state: BrowserIrohEndpointState;
    endpointId: string | null;
    appliedRelayUrls: readonly string[];
    leaseCount: number;
}>;

export type BrowserIrohClientCommand =
    | Readonly<{ v: 1; kind: 'acquireLease'; requestId: string; relayUrls: readonly string[] }>
    | Readonly<{ v: 1; kind: 'releaseLease'; requestId: string; leaseId: string }>
    | Readonly<{ v: 1; kind: 'releaseClient'; requestId: string }>
    | Readonly<{ v: 1; kind: 'configureRelays'; requestId: string; relayUrls: readonly string[] }>
    | Readonly<{
        v: 1;
        kind: 'openStream';
        requestId: string;
        leaseId: string;
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
        relayUrls: readonly string[];
    }>
    | Readonly<{ v: 1; kind: 'readStream'; requestId: string; streamId: string; maxBytes: number }>
    | Readonly<{ v: 1; kind: 'writeStream'; requestId: string; streamId: string; bytes: Uint8Array }>
    | Readonly<{ v: 1; kind: 'finishStreamWrite'; requestId: string; streamId: string }>
    | Readonly<{ v: 1; kind: 'cancelStream'; requestId: string; streamId: string }>
    | Readonly<{ v: 1; kind: 'closeStream'; requestId: string; streamId: string }>
    | Readonly<{ v: 1; kind: 'status'; requestId: string }>
    | Readonly<{ v: 1; kind: 'clearApplicationData'; requestId: string }>;

export type BrowserIrohWorkerReply =
    | Readonly<{
        v: 1;
        kind: 'leaseAcquired';
        requestId: string;
        leaseId: string;
        endpointId: string;
        appliedRelayUrls: readonly string[];
    }>
    | Readonly<{ v: 1; kind: 'released'; requestId: string }>
    | Readonly<{
        v: 1;
        kind: 'relaysConfigured';
        requestId: string;
        endpointId: string;
        appliedRelayUrls: readonly string[];
    }>
    | Readonly<{ v: 1; kind: 'status'; requestId: string; status: BrowserIrohEndpointStatus }>
    | Readonly<{
        v: 1;
        kind: 'streamOpened';
        requestId: string;
        streamId: string;
        /** The EndpointId the transport cryptographically proved. */
        remoteEndpointId: string;
        observedPath: BrowserIrohObservedPath;
    }>
    | Readonly<{ v: 1; kind: 'streamRead'; requestId: string; bytes: Uint8Array; done: boolean }>
    | Readonly<{
        v: 1;
        kind: 'streamWritten' | 'streamWriteFinished' | 'streamCancelled' | 'streamClosed';
        requestId: string;
    }>
    | Readonly<{ v: 1; kind: 'cleared'; requestId: string }>
    | Readonly<{ v: 1; kind: 'error'; requestId: string; code: BrowserIrohErrorCode; message: string }>;

function readRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return record.v === BROWSER_IROH_PROTOCOL_VERSION ? record : null;
}

function readRequestId(record: Record<string, unknown>): string | null {
    const requestId = record.requestId;
    return typeof requestId === 'string' && requestId.length > 0 ? requestId : null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const expected = new Set(keys);
    const actual = Object.keys(record);
    return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function readRelayUrls(record: Record<string, unknown>): string[] | null {
    const relayUrls = record.relayUrls;
    if (!Array.isArray(relayUrls)) return null;
    const urls: string[] = [];
    for (const entry of relayUrls) {
        if (typeof entry !== 'string') return null;
        urls.push(entry);
    }
    return urls;
}

/** Parses one inbound client command. `null` means the message is not one. */
export function parseBrowserIrohClientCommand(value: unknown): BrowserIrohClientCommand | null {
    const record = readRecord(value);
    if (record === null) return null;
    const requestId = readRequestId(record);
    if (requestId === null) return null;

    switch (record.kind) {
        case 'acquireLease':
        case 'configureRelays': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'relayUrls'])) return null;
            const relayUrls = readRelayUrls(record);
            if (relayUrls === null) return null;
            return { v: 1, kind: record.kind, requestId, relayUrls };
        }
        case 'releaseLease': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'leaseId'])) return null;
            const leaseId = record.leaseId;
            if (typeof leaseId !== 'string' || leaseId.length === 0) return null;
            return { v: 1, kind: 'releaseLease', requestId, leaseId };
        }
        case 'openStream': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'leaseId', 'streamKind', 'endpointId', 'relayUrls'])) return null;
            const leaseId = readNonEmptyString(record, 'leaseId');
            const endpointId = readNonEmptyString(record, 'endpointId');
            const relayUrls = readRelayUrls(record);
            const streamKind = record.streamKind;
            // The protocol has to be named explicitly. Defaulting an
            // unnamed open would mean a machine dial could be served over
            // the Home tunnel by omission alone.
            if (
                leaseId === null
                || endpointId === null
                || relayUrls === null
                || !isBrowserIrohStreamKind(streamKind)
            ) return null;
            return { v: 1, kind: 'openStream', requestId, leaseId, streamKind, endpointId, relayUrls };
        }
        case 'readStream': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'streamId', 'maxBytes'])) return null;
            const streamId = readNonEmptyString(record, 'streamId');
            const maxBytes = record.maxBytes;
            if (
                streamId === null
                || typeof maxBytes !== 'number'
                || !Number.isInteger(maxBytes)
                || maxBytes < 1
                || maxBytes > BROWSER_IROH_STREAM_CHUNK_BYTES
            ) return null;
            return { v: 1, kind: 'readStream', requestId, streamId, maxBytes };
        }
        case 'writeStream': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'streamId', 'bytes'])) return null;
            const streamId = readNonEmptyString(record, 'streamId');
            const bytes = record.bytes;
            if (streamId === null || !(bytes instanceof Uint8Array) || bytes.byteLength > BROWSER_IROH_STREAM_CHUNK_BYTES) return null;
            return { v: 1, kind: 'writeStream', requestId, streamId, bytes };
        }
        case 'finishStreamWrite':
        case 'cancelStream':
        case 'closeStream': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'streamId'])) return null;
            const streamId = readNonEmptyString(record, 'streamId');
            if (streamId === null) return null;
            return { v: 1, kind: record.kind, requestId, streamId };
        }
        case 'releaseClient':
        case 'status':
        case 'clearApplicationData': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId'])) return null;
            return { v: 1, kind: record.kind, requestId };
        }
        default:
            return null;
    }
}

/** Parses one reply. `null` means the message is not one. */
export function parseBrowserIrohWorkerReply(value: unknown): BrowserIrohWorkerReply | null {
    const record = readRecord(value);
    if (record === null) return null;
    const requestId = readRequestId(record);
    if (requestId === null) return null;

    switch (record.kind) {
        case 'leaseAcquired': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'leaseId', 'endpointId', 'appliedRelayUrls'])) return null;
            const relayUrls = readAppliedRelayUrls(record);
            const leaseId = record.leaseId;
            const endpointId = record.endpointId;
            if (relayUrls === null || typeof leaseId !== 'string' || typeof endpointId !== 'string') {
                return null;
            }
            return { v: 1, kind: 'leaseAcquired', requestId, leaseId, endpointId, appliedRelayUrls: relayUrls };
        }
        case 'relaysConfigured': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'endpointId', 'appliedRelayUrls'])) return null;
            const relayUrls = readAppliedRelayUrls(record);
            const endpointId = record.endpointId;
            if (relayUrls === null || typeof endpointId !== 'string') return null;
            return { v: 1, kind: 'relaysConfigured', requestId, endpointId, appliedRelayUrls: relayUrls };
        }
        case 'status': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'status'])) return null;
            const status = parseBrowserIrohEndpointStatus(record.status);
            if (status === null) return null;
            return { v: 1, kind: 'status', requestId, status };
        }
        case 'streamOpened': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'streamId', 'remoteEndpointId', 'observedPath'])) return null;
            const streamId = record.streamId;
            const remoteEndpointId = record.remoteEndpointId;
            const observedPath = record.observedPath;
            if (
                typeof streamId !== 'string'
                || typeof remoteEndpointId !== 'string'
                || !isBrowserIrohObservedPath(observedPath)
            ) return null;
            return { v: 1, kind: 'streamOpened', requestId, streamId, remoteEndpointId, observedPath };
        }
        case 'streamRead': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'bytes', 'done'])) return null;
            const bytes = record.bytes;
            const done = record.done;
            if (!(bytes instanceof Uint8Array) || typeof done !== 'boolean') return null;
            return { v: 1, kind: 'streamRead', requestId, bytes, done };
        }
        case 'streamWritten':
        case 'streamWriteFinished':
        case 'streamCancelled':
        case 'streamClosed':
            if (!hasExactKeys(record, ['v', 'kind', 'requestId'])) return null;
            return { v: 1, kind: record.kind, requestId };
        case 'released':
        case 'cleared':
            if (!hasExactKeys(record, ['v', 'kind', 'requestId'])) return null;
            return { v: 1, kind: record.kind, requestId };
        case 'error': {
            if (!hasExactKeys(record, ['v', 'kind', 'requestId', 'code', 'message'])) return null;
            const code = record.code;
            const message = record.message;
            if (!isBrowserIrohErrorCode(code) || typeof message !== 'string') return null;
            return { v: 1, kind: 'error', requestId, code, message };
        }
        default:
            return null;
    }
}

function readAppliedRelayUrls(record: Record<string, unknown>): string[] | null {
    const relayUrls = record.appliedRelayUrls;
    if (!Array.isArray(relayUrls)) return null;
    const urls: string[] = [];
    for (const entry of relayUrls) {
        if (typeof entry !== 'string') return null;
        urls.push(entry);
    }
    return urls;
}

export function isBrowserIrohStreamKind(value: unknown): value is BrowserIrohStreamKind {
    return value === 'home' || value === 'machine';
}

export function isBrowserIrohObservedPath(value: unknown): value is BrowserIrohObservedPath {
    return value === 'relay' || value === 'unknown';
}

function isBrowserIrohErrorCode(value: unknown): value is BrowserIrohErrorCode {
    return (
        value === 'protocol_violation'
        || value === 'relay_required'
        || value === 'owner_cleared'
        || value === 'unknown_lease'
        || value === 'unknown_stream'
        || value === 'resource_limit'
        || value === 'cancelled'
        || value === 'endpoint_unavailable'
    );
}

export function parseBrowserIrohEndpointStatus(value: unknown): BrowserIrohEndpointStatus | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, ['state', 'endpointId', 'appliedRelayUrls', 'leaseCount'])) return null;
    const state = record.state;
    if (state !== 'idle' && state !== 'ready' && state !== 'cleared') return null;

    const endpointId = record.endpointId;
    if (endpointId !== null && typeof endpointId !== 'string') return null;

    const appliedRelayUrls = readAppliedRelayUrls(record);
    if (appliedRelayUrls === null) return null;

    const leaseCount = record.leaseCount;
    if (typeof leaseCount !== 'number' || !Number.isInteger(leaseCount) || leaseCount < 0) return null;

    return { state, endpointId, appliedRelayUrls, leaseCount };
}
