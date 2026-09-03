/**
 * One HTTP/1.1 request over one browser Iroh `happier/home-tunnel/1` stream
 * (Lane 06 amendment A7.3).
 *
 * A browser cannot bind the native loopback listener, so the bytes a native host
 * would copy through TCP are serialized here instead. That is the whole job: this
 * module is a wire codec, not a second HTTP SDK. Method, URL, headers, body, and
 * response all stay in the platform `Request`/`Headers`/`Response`/`ReadableStream`
 * primitives, so the semantics a caller already relies on are the platform's, not
 * a re-implementation of them.
 *
 * Everything below the stream stays owned elsewhere: the SharedWorker owns the
 * endpoint and leases, `happier-iroh-core` owns identity, ALPN, the one-byte
 * tunnel preamble (written when the stream is opened), relays, and cancellation,
 * and the existing Home acceptor owns the loopback destination. Nothing here
 * decides transport. The canonical semantic HTTP owner (`serverFetch`) consumes
 * this carrier through the browser Home transport resolver.
 *
 * Framing is owned, never inherited. The request is written with chunked framing
 * that this module produces and any caller-supplied length/connection header is
 * dropped, and a response whose framing is ambiguous is rejected rather than
 * guessed at, because "guess the boundary" is exactly how request smuggling
 * works. Bytes flow incrementally in both directions: a request body is streamed
 * as it is produced, and the response is a `ReadableStream` that pulls one
 * bounded `read` at a time, so neither side is buffered whole in the tab.
 */

import type { BrowserIrohStream } from './endpointClient';
import { BROWSER_IROH_STREAM_CHUNK_BYTES } from './protocol';

export type BrowserIrohHttpErrorCode =
    /** The request cannot be represented on the wire at all. */
    | 'invalid_request'
    /** The stream proved a different peer than the caller asked for. */
    | 'endpoint_identity_mismatch'
    /** A head block exceeded {@link BROWSER_IROH_HTTP_MAX_HEAD_BYTES}. */
    | 'head_too_large'
    /** Status line, header line, or chunk size is not valid HTTP/1.1. */
    | 'malformed_response'
    /** Content-Length and Transfer-Encoding disagree, or lengths conflict. */
    | 'conflicting_framing'
    /** A transfer coding other than `chunked`. */
    | 'unsupported_transfer_coding'
    /** A caller-owned connection received framing that cannot delimit another response. */
    | 'connection_not_reusable'
    /** The peer stopped inside a framed body. */
    | 'truncated_response';

export class BrowserIrohHttpError extends Error {
    constructor(readonly code: BrowserIrohHttpErrorCode, message: string) {
        super(message);
        this.name = 'BrowserIrohHttpError';
    }
}

/**
 * The head block bound applied in both directions. It is a parse-buffer bound for
 * a tab, not a product limit: it sits far above the Home server's own header
 * budget (Node's default is 16 KiB) and far below the stream chunk cap, so a
 * legitimate Home response can never reach it and a broken or hostile peer cannot
 * grow the buffer without end.
 */
export const BROWSER_IROH_HTTP_MAX_HEAD_BYTES = 64 * 1024;

/** Read granularity. Bounded by the protocol's per-operation chunk cap. */
const RESPONSE_READ_CHUNK_BYTES = Math.min(64 * 1024, BROWSER_IROH_STREAM_CHUNK_BYTES);

/**
 * Write granularity. A framed chunk must still fit one protocol operation, so the
 * payload slice leaves room for its own size line and terminator.
 */
const REQUEST_WRITE_CHUNK_BYTES = Math.min(256 * 1024, BROWSER_IROH_STREAM_CHUNK_BYTES - 64);

/**
 * Headers this module owns, or that describe a connection the browser does not
 * have. They are stripped from the request it writes and from the response it
 * hands back, so a caller can neither inject framing nor observe a hop-by-hop
 * header that no longer describes anything.
 */
const CARRIER_OWNED_HEADERS: ReadonlySet<string> = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

const RESPONSE_HOP_BY_HOP_HEADERS: readonly string[] = [
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'upgrade',
];

const CRLF = '\r\n';
const EMPTY_BYTES = new Uint8Array(0);
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const STATUS_LINE_PATTERN = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/u;
const REASON_PHRASE_PATTERN = /^[\t\x20-\x7e]*$/u;
const CHUNK_SIZE_PATTERN = /^[0-9A-Fa-f]{1,15}$/u;

export type BrowserIrohHomeHttpResult = Readonly<{
    response: Response;
    /**
     * The remote EndpointId Iroh cryptographically proved for the carrying
     * stream. It equals the requested one — the request is refused otherwise —
     * and is surfaced so the descriptor/enrollment owner can bind a credential
     * destination to it without re-deriving Home identity here.
     */
    remoteEndpointId: string;
}>;

/**
 * Fetch-shaped on purpose: a later composition passes the same `(input, init)`
 * pair it would give any other carrier, and reads `response` out of the result.
 */
export type BrowserIrohHomeHttpRequester = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<BrowserIrohHomeHttpResult>;

export type BrowserIrohHomeHttpRequesterOptions = Readonly<{
    /** Opens one stream for one request; the caller owns the lease it comes from. */
    openStream: (signal?: AbortSignal) => Promise<BrowserIrohStream>;
    /** The exact EndpointId selected from the Home descriptor. */
    expectedRemoteEndpointId: string;
}>;

export type BrowserIrohHttpConnectionRequester = Readonly<{
    request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    close: () => Promise<void>;
    cancel: () => Promise<void>;
}>;

/**
 * Serial HTTP/1.1 over one caller-owned admitted stream. A response must be
 * consumed before the next request can start; this preserves parser ownership
 * and prevents pipelining. The caller owns the one transport grant/lease and
 * explicitly closes or cancels it after its finite operation.
 */
export function createBrowserIrohHttpConnectionRequester(options: Readonly<{
    stream: BrowserIrohStream;
    expectedRemoteEndpointId: string;
}>): BrowserIrohHttpConnectionRequester {
    const { stream } = options;
    const reader = new ResponseByteReader(async (maxBytes) => await stream.read(maxBytes));
    let ready: Promise<void> = Promise.resolve();
    let terminalError: unknown = null;
    let disposed = false;
    let writeFinished = false;
    let disposeAttempt: Promise<void> | null = null;

    const dispose = (how: 'cancel' | 'close'): Promise<void> => {
        if (disposed) return Promise.resolve();
        disposeAttempt ??= (async () => {
            if (how === 'close' && !writeFinished) {
                await stream.finishWrite();
                writeFinished = true;
            }
            if (how === 'cancel') {
                try {
                    await stream.cancel();
                } finally {
                    await stream.close();
                }
            } else {
                await stream.close();
            }
            disposed = true;
        })().catch((error: unknown) => {
            disposeAttempt = null;
            throw error;
        });
        return disposeAttempt;
    };

    const fail = async (error: unknown): Promise<never> => {
        terminalError = error;
        await dispose('cancel').catch(() => undefined);
        throw error;
    };

    const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        await ready;
        if (terminalError !== null) throw terminalError;
        if (disposed) {
            throw new BrowserIrohHttpError('connection_not_reusable', 'Browser Iroh HTTP connection is closed');
        }
        if (stream.remoteEndpointId !== options.expectedRemoteEndpointId) {
            return await fail(new BrowserIrohHttpError(
                'endpoint_identity_mismatch',
                'Browser Iroh stream proved a remote EndpointId other than the requested endpoint',
            ));
        }

        const request = canonicalizeRequest(input, init);
        const url = resolveRequestUrl(request);
        const signal = request.signal;
        if (signal.aborted) return await fail(abortReason(signal));

        let complete!: () => void;
        let rejectComplete!: (error: unknown) => void;
        const responseConsumed = new Promise<void>((resolve, reject) => {
            complete = resolve;
            rejectComplete = reject;
        });
        responseConsumed.catch(() => {});
        ready = responseConsumed;

        let detachAbort: (() => void) | null = null;
        const aborted = new Promise<never>((_resolve, reject) => {
            const onAbort = () => {
                const error = abortReason(signal);
                terminalError = error;
                rejectComplete(error);
                reject(error);
                void dispose('cancel');
            };
            signal.addEventListener('abort', onAbort, { once: true });
            detachAbort = () => signal.removeEventListener('abort', onAbort);
        });
        aborted.catch(() => {});
        const untilAborted = async <T>(operation: Promise<T>): Promise<T> =>
            await Promise.race([operation, aborted]);

        const finishResponse = async (): Promise<void> => {
            detachAbort?.();
            complete();
        };
        const failResponse = async (error?: unknown): Promise<void> => {
            detachAbort?.();
            const failure = error ?? new BrowserIrohHttpError(
                'connection_not_reusable',
                'Browser Iroh HTTP response was not fully consumed',
            );
            terminalError = failure;
            rejectComplete(failure);
            await dispose('cancel').catch(() => undefined);
        };

        try {
            const body = request.body;
            await untilAborted(stream.write(buildRequestHead(request, url, body !== null, 'keep-alive')));
            if (body !== null) {
                await writeChunkedBody(body, async (bytes) => await untilAborted(stream.write(bytes)), untilAborted);
            }
            const head = parseResponseHead(await untilAborted(reader.readHeadBlock()));
            const framing = resolveResponseFraming(request.method, head.status, head.headers);
            const peerWillClose = responseConnectionWillClose(head.httpVersion, head.headers);
            for (const name of RESPONSE_HOP_BY_HOP_HEADERS) head.headers.delete(name);
            if (framing.kind === 'close') {
                return await fail(new BrowserIrohHttpError(
                    'connection_not_reusable',
                    'Browser Iroh HTTP response is close-delimited and cannot share the transfer stream',
                ));
            }
            const onComplete = peerWillClose
                ? async () => await failResponse(new BrowserIrohHttpError(
                    'connection_not_reusable',
                    'Browser Iroh HTTP peer closed a caller-owned persistent connection',
                ))
                : finishResponse;
            if (framing.kind === 'empty') {
                await onComplete();
                return new Response(null, { status: head.status, statusText: head.statusText, headers: head.headers });
            }
            return new Response(
                createResponseBodyStream(framing, reader, untilAborted, {
                    complete: onComplete,
                    fail: failResponse,
                    cancel: failResponse,
                }),
                { status: head.status, statusText: head.statusText, headers: head.headers },
            );
        } catch (error) {
            await failResponse(error);
            throw error;
        }
    };

    return {
        request,
        close: async () => {
            await ready.catch(() => undefined);
            await dispose(terminalError === null ? 'close' : 'cancel');
        },
        cancel: async () => {
            terminalError ??= new BrowserIrohHttpError(
                'connection_not_reusable',
                'Browser Iroh HTTP connection was cancelled',
            );
            await dispose('cancel');
        },
    };
}

export function createBrowserIrohHomeHttpRequester(
    options: BrowserIrohHomeHttpRequesterOptions,
): BrowserIrohHomeHttpRequester {
    return async (input, init) => {
        const request = canonicalizeRequest(input, init);
        const url = resolveRequestUrl(request);
        const signal = request.signal;
        if (signal.aborted) throw abortReason(signal);

        const stream = await options.openStream(signal);
        return await carryRequest({
            stream,
            request,
            url,
            signal,
            expectedRemoteEndpointId: options.expectedRemoteEndpointId,
        });
    };
}

/**
 * The Fetch primitives own request validation. A URL carrying userinfo, a body on
 * GET/HEAD, an unsupported body form, and a stream body without `duplex: 'half'`
 * all fail here rather than reaching a stream, and their message is preserved so
 * the caller learns which one it was.
 */
function canonicalizeRequest(input: RequestInfo | URL, init: RequestInit | undefined): Request {
    try {
        return new Request(input as RequestInfo, init);
    } catch (error) {
        throw new BrowserIrohHttpError(
            'invalid_request',
            `Browser Iroh cannot carry this request: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function resolveRequestUrl(request: Request): URL {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BrowserIrohHttpError(
            'invalid_request',
            `Browser Iroh carries HTTP(S) requests only, not ${url.protocol}`,
        );
    }
    return url;
}

async function carryRequest(
    params: Readonly<{
        stream: BrowserIrohStream;
        request: Request;
        url: URL;
        signal: AbortSignal;
        expectedRemoteEndpointId: string;
    }>,
): Promise<BrowserIrohHomeHttpResult> {
    const { stream, request, url, signal, expectedRemoteEndpointId } = params;

    let disposed = false;
    let detachAbort: (() => void) | null = null;

    const dispose = async (how: 'cancel' | 'close'): Promise<void> => {
        if (disposed) return;
        disposed = true;
        detachAbort?.();
        detachAbort = null;
        try {
            if (how === 'cancel') {
                // Cancellation interrupts any pending read/write immediately,
                // but it deliberately leaves the worker's stream record in
                // custody so that cleanup can be retried. Close it as the
                // terminal step of this one-request carrier; otherwise every
                // aborted request survives until the whole Home lease ends.
                try {
                    await stream.cancel();
                } finally {
                    await stream.close();
                }
            } else {
                await stream.close();
            }
        } catch {
            // Cleanup is best-effort and never retried here: the stream's own
            // owner keeps custody of a failed release, and a cleanup failure
            // cannot change an outcome the caller already observed.
        }
    };

    // The proven peer is checked before one request byte — including any bearer
    // the caller attached — reaches the wire.
    if (stream.remoteEndpointId !== expectedRemoteEndpointId) {
        await dispose('cancel');
        throw new BrowserIrohHttpError(
            'endpoint_identity_mismatch',
            'Browser Iroh stream proved a remote EndpointId other than the requested Home endpoint',
        );
    }

    const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
            reject(abortReason(signal));
            void dispose('cancel');
        };
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        detachAbort = () => signal.removeEventListener('abort', onAbort);
    });
    // Nothing awaits this until it is raced, and an abort before then would
    // otherwise be an unhandled rejection.
    aborted.catch(() => {});

    const untilAborted = async <T>(operation: Promise<T>): Promise<T> =>
        await Promise.race([operation, aborted]);

    try {
        const body = request.body;
        await untilAborted(stream.write(buildRequestHead(request, url, body !== null, 'close')));
        if (body !== null) {
            await writeChunkedBody(body, async (bytes) => {
                await untilAborted(stream.write(bytes));
            }, untilAborted);
        }
        // Half-close: the Home side sees a complete request and no more.
        await untilAborted(stream.finishWrite());

        const reader = new ResponseByteReader(
            async (maxBytes) => await untilAborted(stream.read(maxBytes)),
        );
        const head = parseResponseHead(await reader.readHeadBlock());
        const framing = resolveResponseFraming(request.method, head.status, head.headers);
        for (const name of RESPONSE_HOP_BY_HOP_HEADERS) head.headers.delete(name);

        if (framing.kind === 'empty') {
            await dispose('close');
            return {
                response: new Response(null, {
                    status: head.status,
                    statusText: head.statusText,
                    headers: head.headers,
                }),
                remoteEndpointId: stream.remoteEndpointId,
            };
        }

        return {
            response: new Response(
                createResponseBodyStream(framing, reader, untilAborted, {
                    complete: async () => await dispose('close'),
                    fail: async () => await dispose('cancel'),
                    cancel: async () => await dispose('cancel'),
                }),
                { status: head.status, statusText: head.statusText, headers: head.headers },
            ),
            remoteEndpointId: stream.remoteEndpointId,
        };
    } catch (error) {
        await dispose('cancel');
        throw error;
    }
}

function abortReason(signal: AbortSignal): unknown {
    const reason: unknown = (signal as AbortSignal & { reason?: unknown }).reason;
    if (reason !== undefined) return reason;
    const fallback = new Error('The browser Iroh request was aborted');
    fallback.name = 'AbortError';
    return fallback;
}

function buildRequestHead(
    request: Request,
    url: URL,
    hasBody: boolean,
    connection: 'close' | 'keep-alive',
): Uint8Array {
    // Origin-form only: the fragment is request-URL state, and userinfo cannot
    // exist here because the Request constructor refuses it.
    const lines: string[] = [
        `${request.method} ${url.pathname}${url.search} HTTP/1.1`,
        `host: ${url.host}`,
        // One stream carries one request and is never reused, so saying so lets
        // the Home side end a close-delimited response cleanly.
        `connection: ${connection}`,
    ];
    if (hasBody) lines.push('transfer-encoding: chunked');
    for (const [name, value] of request.headers) {
        if (CARRIER_OWNED_HEADERS.has(name.toLowerCase())) continue;
        lines.push(`${name}: ${value}`);
    }

    const head = ENCODER.encode(`${lines.join(CRLF)}${CRLF}${CRLF}`);
    if (head.byteLength > BROWSER_IROH_HTTP_MAX_HEAD_BYTES) {
        throw new BrowserIrohHttpError(
            'head_too_large',
            `Request head is ${head.byteLength} bytes, above the ${BROWSER_IROH_HTTP_MAX_HEAD_BYTES} byte bound`,
        );
    }
    return head;
}

async function writeChunkedBody(
    body: ReadableStream<Uint8Array>,
    write: (bytes: Uint8Array) => Promise<void>,
    untilAborted: <T>(operation: Promise<T>) => Promise<T>,
): Promise<void> {
    const reader = body.getReader();
    try {
        for (;;) {
            const { value, done } = await untilAborted(reader.read());
            if (done) break;
            if (value === undefined || value.byteLength === 0) continue;
            for (let offset = 0; offset < value.byteLength; offset += REQUEST_WRITE_CHUNK_BYTES) {
                await write(encodeChunk(
                    value.subarray(offset, Math.min(offset + REQUEST_WRITE_CHUNK_BYTES, value.byteLength)),
                ));
            }
        }
        await write(ENCODER.encode(`0${CRLF}${CRLF}`));
    } finally {
        reader.releaseLock();
    }
}

function encodeChunk(payload: Uint8Array): Uint8Array {
    const header = ENCODER.encode(`${payload.byteLength.toString(16)}${CRLF}`);
    const framed = new Uint8Array(header.byteLength + payload.byteLength + 2);
    framed.set(header, 0);
    framed.set(payload, header.byteLength);
    framed.set(ENCODER.encode(CRLF), header.byteLength + payload.byteLength);
    return framed;
}

/** Incremental reader over the stream's bounded `read`. */
class ResponseByteReader {
    private buffered: Uint8Array = EMPTY_BYTES;
    private ended = false;

    constructor(private readonly read: (maxBytes: number) => Promise<Readonly<{ bytes: Uint8Array; done: boolean }>>) {}

    private async fill(): Promise<void> {
        if (this.ended) return;
        const { bytes, done } = await this.read(RESPONSE_READ_CHUNK_BYTES);
        if (bytes.byteLength > 0) {
            if (this.buffered.byteLength === 0) {
                this.buffered = bytes;
            } else {
                const merged = new Uint8Array(this.buffered.byteLength + bytes.byteLength);
                merged.set(this.buffered, 0);
                merged.set(bytes, this.buffered.byteLength);
                this.buffered = merged;
            }
        }
        if (done) this.ended = true;
    }

    /** Reads through the next CRLFCRLF and returns the block before it. */
    async readHeadBlock(): Promise<string> {
        let searchFrom = 0;
        for (;;) {
            const terminator = indexOfHeadTerminator(this.buffered, searchFrom);
            if (terminator >= 0) {
                const block = DECODER.decode(this.buffered.subarray(0, terminator));
                this.buffered = this.buffered.subarray(terminator + 4);
                return block;
            }
            if (this.buffered.byteLength > BROWSER_IROH_HTTP_MAX_HEAD_BYTES) {
                throw new BrowserIrohHttpError(
                    'head_too_large',
                    `Response head exceeded the ${BROWSER_IROH_HTTP_MAX_HEAD_BYTES} byte bound`,
                );
            }
            if (this.ended) {
                throw new BrowserIrohHttpError(
                    'truncated_response',
                    'Browser Iroh stream ended inside the response head',
                );
            }
            searchFrom = Math.max(0, this.buffered.byteLength - 3);
            await this.fill();
        }
    }

    /** Reads one CRLF-terminated line, without the terminator. */
    async readLine(maxBytes: number): Promise<string> {
        let searchFrom = 0;
        for (;;) {
            const terminator = indexOfCrlf(this.buffered, searchFrom);
            if (terminator >= 0) {
                const line = DECODER.decode(this.buffered.subarray(0, terminator));
                this.buffered = this.buffered.subarray(terminator + 2);
                return line;
            }
            if (this.buffered.byteLength > maxBytes) {
                throw new BrowserIrohHttpError(
                    'head_too_large',
                    `Response line exceeded the ${maxBytes} byte bound`,
                );
            }
            if (this.ended) {
                throw new BrowserIrohHttpError(
                    'truncated_response',
                    'Browser Iroh stream ended inside a framed response body',
                );
            }
            searchFrom = Math.max(0, this.buffered.byteLength - 1);
            await this.fill();
        }
    }

    /** Up to `maxBytes` buffered bytes; empty means the peer stopped sending. */
    async take(maxBytes: number): Promise<Uint8Array> {
        while (this.buffered.byteLength === 0) {
            if (this.ended) return EMPTY_BYTES;
            await this.fill();
        }
        const size = Math.min(maxBytes, this.buffered.byteLength);
        const taken = this.buffered.subarray(0, size);
        this.buffered = this.buffered.subarray(size);
        return taken;
    }

    async expectCrlf(): Promise<void> {
        // Bounded like any other line: a peer that never terminates the chunk is
        // stopped by the same budget, and anything before the terminator is the
        // malformed framing it looks like.
        const line = await this.readLine(BROWSER_IROH_HTTP_MAX_HEAD_BYTES);
        if (line.length !== 0) {
            throw new BrowserIrohHttpError(
                'malformed_response',
                'Chunked response body is missing a chunk terminator',
            );
        }
    }

    /** Consumes the trailer section that terminates a chunked body. */
    async readTrailerSection(): Promise<void> {
        let consumed = 0;
        for (;;) {
            const line = await this.readLine(BROWSER_IROH_HTTP_MAX_HEAD_BYTES);
            if (line.length === 0) return;
            consumed += line.length + 2;
            if (consumed > BROWSER_IROH_HTTP_MAX_HEAD_BYTES) {
                throw new BrowserIrohHttpError(
                    'head_too_large',
                    `Response trailer section exceeded the ${BROWSER_IROH_HTTP_MAX_HEAD_BYTES} byte bound`,
                );
            }
        }
    }
}

function indexOfHeadTerminator(bytes: Uint8Array, from: number): number {
    for (let index = from; index + 3 < bytes.byteLength; index += 1) {
        if (bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10) {
            return index;
        }
    }
    return -1;
}

function indexOfCrlf(bytes: Uint8Array, from: number): number {
    for (let index = from; index + 1 < bytes.byteLength; index += 1) {
        if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
    }
    return -1;
}

type ResponseHead = Readonly<{
    httpVersion: '1.0' | '1.1';
    status: number;
    statusText: string;
    headers: Headers;
}>;

function parseResponseHead(block: string): ResponseHead {
    const lines = block.split(CRLF);
    const statusLine = lines[0] ?? '';
    const parsedStatusLine = STATUS_LINE_PATTERN.exec(statusLine);
    if (parsedStatusLine === null) {
        throw new BrowserIrohHttpError('malformed_response', 'Response status line is not HTTP/1.x');
    }
    const status = Number(parsedStatusLine[1]);
    if (status < 200 || status > 599) {
        // Informational and upgrade responses have no reachable caller here: this
        // carrier never sends `Expect` and never upgrades a Home tunnel stream.
        throw new BrowserIrohHttpError(
            'malformed_response',
            `Browser Iroh does not carry a ${status} response`,
        );
    }
    const reasonPhrase = parsedStatusLine[2] ?? '';
    const statusText = REASON_PHRASE_PATTERN.test(reasonPhrase) ? reasonPhrase : '';

    const headers = new Headers();
    for (const line of lines.slice(1)) {
        if (line.length === 0) continue;
        if (line.startsWith(' ') || line.startsWith('\t')) {
            // Obsolete line folding is a smuggling primitive, not a feature.
            throw new BrowserIrohHttpError('malformed_response', 'Response header uses obsolete line folding');
        }
        const separator = line.indexOf(':');
        const name = separator > 0 ? line.slice(0, separator) : '';
        if (!HEADER_NAME_PATTERN.test(name)) {
            throw new BrowserIrohHttpError('malformed_response', 'Response header name is not a valid token');
        }
        try {
            headers.append(name, line.slice(separator + 1).trim());
        } catch {
            throw new BrowserIrohHttpError('malformed_response', `Response header ${name} has an invalid value`);
        }
    }
    return {
        httpVersion: statusLine.startsWith('HTTP/1.0') ? '1.0' : '1.1',
        status,
        statusText,
        headers,
    };
}

type ResponseFraming =
    | Readonly<{ kind: 'empty' }>
    | Readonly<{ kind: 'length'; length: number }>
    | Readonly<{ kind: 'chunked' }>
    | Readonly<{ kind: 'close' }>;

function resolveResponseFraming(method: string, status: number, headers: Headers): ResponseFraming {
    const transferEncoding = headers.get('transfer-encoding');
    const contentLength = headers.get('content-length');
    if (transferEncoding !== null && contentLength !== null) {
        throw new BrowserIrohHttpError(
            'conflicting_framing',
            'Response declares both Content-Length and Transfer-Encoding',
        );
    }
    if (method === 'HEAD' || status === 204 || status === 304) return { kind: 'empty' };

    if (transferEncoding !== null) {
        const codings = transferEncoding.split(',').map((coding) => coding.trim().toLowerCase());
        if (codings.length !== 1 || codings[0] !== 'chunked') {
            throw new BrowserIrohHttpError(
                'unsupported_transfer_coding',
                `Response uses unsupported transfer coding "${transferEncoding}"`,
            );
        }
        return { kind: 'chunked' };
    }

    if (contentLength !== null) {
        // A repeated header arrives combined; identical values are one length,
        // differing values are a smuggling attempt.
        const values = new Set(contentLength.split(',').map((value) => value.trim()));
        if (values.size !== 1) {
            throw new BrowserIrohHttpError(
                'conflicting_framing',
                `Response declares conflicting Content-Length values "${contentLength}"`,
            );
        }
        const [value] = [...values];
        if (value === undefined || !/^\d{1,15}$/u.test(value)) {
            throw new BrowserIrohHttpError(
                'malformed_response',
                `Response Content-Length "${contentLength}" is not a length`,
            );
        }
        return { kind: 'length', length: Number(value) };
    }

    return { kind: 'close' };
}

function createResponseBodyStream(
    framing: Exclude<ResponseFraming, Readonly<{ kind: 'empty' }>>,
    reader: ResponseByteReader,
    untilAborted: <T>(operation: Promise<T>) => Promise<T>,
    lifecycle: Readonly<{
        complete: () => Promise<void>;
        fail: (error?: unknown) => Promise<void>;
        cancel: () => Promise<void>;
    }>,
): ReadableStream<Uint8Array> {
    let remaining = framing.kind === 'length' ? framing.length : 0;
    let chunkRemaining = 0;

    const pullOnce = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
        if (framing.kind === 'length') {
            if (remaining === 0) {
                await lifecycle.complete();
                controller.close();
                return;
            }
            const bytes = await reader.take(Math.min(remaining, RESPONSE_READ_CHUNK_BYTES));
            if (bytes.byteLength === 0) {
                throw new BrowserIrohHttpError(
                    'truncated_response',
                    `Browser Iroh stream ended with ${remaining} declared response bytes missing`,
                );
            }
            remaining -= bytes.byteLength;
            controller.enqueue(bytes);
            if (remaining === 0) {
                await lifecycle.complete();
                controller.close();
            }
            return;
        }

        if (framing.kind === 'chunked') {
            if (chunkRemaining === 0) {
                const sizeLine = await reader.readLine(BROWSER_IROH_HTTP_MAX_HEAD_BYTES);
                const size = parseChunkSize(sizeLine);
                if (size === 0) {
                    await reader.readTrailerSection();
                    await lifecycle.complete();
                    controller.close();
                    return;
                }
                chunkRemaining = size;
            }
            const bytes = await reader.take(Math.min(chunkRemaining, RESPONSE_READ_CHUNK_BYTES));
            if (bytes.byteLength === 0) {
                throw new BrowserIrohHttpError(
                    'truncated_response',
                    'Browser Iroh stream ended inside a chunked response body',
                );
            }
            chunkRemaining -= bytes.byteLength;
            controller.enqueue(bytes);
            if (chunkRemaining === 0) await reader.expectCrlf();
            return;
        }

        const bytes = await reader.take(RESPONSE_READ_CHUNK_BYTES);
        if (bytes.byteLength === 0) {
            await lifecycle.complete();
            controller.close();
            return;
        }
        controller.enqueue(bytes);
    };

    return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
            try {
                await untilAborted(pullOnce(controller));
            } catch (error) {
                await lifecycle.fail(error);
                throw error;
            }
        },
        cancel: async () => {
            await lifecycle.cancel();
        },
    }, { highWaterMark: 0 });
}

function responseConnectionWillClose(httpVersion: ResponseHead['httpVersion'], headers: Headers): boolean {
    const tokens = (headers.get('connection') ?? '')
        .split(',')
        .map((token) => token.trim().toLowerCase());
    if (tokens.includes('close')) return true;
    return httpVersion === '1.0' && !tokens.includes('keep-alive');
}

function parseChunkSize(sizeLine: string): number {
    // Chunk extensions are permitted and carry nothing this carrier consumes.
    const size = sizeLine.split(';')[0]?.trim() ?? '';
    if (!CHUNK_SIZE_PATTERN.test(size)) {
        throw new BrowserIrohHttpError(
            'malformed_response',
            `Chunked response declares an invalid chunk size "${sizeLine}"`,
        );
    }
    return Number.parseInt(size, 16);
}
