/**
 * A `WebSocket`-shaped object carried by one `happier/home-tunnel/1` Iroh
 * stream (Lane 06 amendment A7.3).
 *
 * The browser has no way to point its own WebSocket stack at an Iroh stream, so
 * the carrier performs the upgrade and the RFC 6455 framing itself over the
 * opaque incremental stream the shared endpoint owner hands out. What it
 * produces is deliberately an ordinary `WebSocket` surface — `binaryType`,
 * `onopen`/`onmessage`/`onerror`/`onclose`, `send`, `close` — so the existing
 * connection owner keeps its lifecycle, authentication, reconnection and event
 * deduplication unchanged and simply receives a different underlying socket.
 * This module owns no connection policy, no retry, and no event bus.
 *
 * Relay-only by construction: the browser endpoint never claims a direct path,
 * so a proven connection reports `relay` and an unproven one `unknown`. There is
 * no `direct` value to report.
 *
 * Identity is enforced before any byte leaves the tab: the stream's
 * cryptographically authenticated remote EndpointId must equal the exact
 * EndpointId the caller selected from the Home descriptor, or the stream is
 * released with the upgrade request unsent.
 *
 * No extension is offered. The framing owner applies the existing Socket.IO
 * carrier ceiling to complete messages before they reach the consumer. A
 * protocol violation resets the stream rather than
 * attempting a courteous close handshake with a peer already off-protocol.
 */

import type { BrowserIrohStream } from '../endpointClient';
import { BROWSER_IROH_STREAM_CHUNK_BYTES } from '../protocol';
import {
    WEB_SOCKET_CLOSE_CODE,
    WEB_SOCKET_OPCODE,
    WebSocketFrameDecoder,
    WebSocketProtocolError,
    encodeMaskedClientFrame,
    type WebSocketFrame,
    type WebSocketOpcode,
} from './webSocketFrames';
import {
    assertWebSocketUpgradeAccepted,
    buildWebSocketUpgradeRequest,
    computeWebSocketAccept,
    createWebSocketHandshakeKey,
    readWebSocketUpgradeResponseHead,
    type WebSocketUpgradeResponseHead,
} from './webSocketHandshake';

export type BrowserIrohCarrierBinaryType = 'arraybuffer' | 'nodebuffer' | 'blob';

/** The relay-only path vocabulary. A browser carrier never reports `direct`. */
export type BrowserIrohCarrierObservedPath = 'relay' | 'unknown';

export type BrowserIrohHomeTunnelWebSocketOptions = Readonly<{
    /** The `ws://…/v1/updates/?EIO=4&transport=websocket` URI to upgrade. */
    url: string;
    /** The exact EndpointId selected from the canonical Home descriptor. */
    endpointId: string;
    openStream: (signal?: AbortSignal) => Promise<BrowserIrohStream>;
    randomBytes?: (length: number) => Uint8Array;
}>;

export type BrowserIrohCarrierCloseEvent = Readonly<{
    code: number;
    reason: string;
    wasClean: boolean;
}>;

export type BrowserIrohCarrierErrorEvent = Readonly<{
    type: 'error';
    message: string;
    error: unknown;
}>;

export type BrowserIrohCarrierMessageEvent = Readonly<{ data: string | ArrayBuffer | Uint8Array | Blob }>;

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}

function decodeUtf8Strict(bytes: Uint8Array, what: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new WebSocketProtocolError(
            WEB_SOCKET_CLOSE_CODE.invalidPayload,
            `Home sent a ${what} that is not valid UTF-8`,
        );
    }
}

/** RFC 6455 §7.4: codes a peer may put on the wire. */
function isTransmittableCloseCode(code: number): boolean {
    if (code >= 3000 && code <= 4999) return true;
    return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011);
}

function encodeCloseBody(code: number | null, reason: string): Uint8Array {
    if (code === null) return new Uint8Array(0);
    const reasonBytes = new TextEncoder().encode(reason);
    const payload = new Uint8Array(2 + reasonBytes.length);
    new DataView(payload.buffer).setUint16(0, code);
    payload.set(reasonBytes, 2);
    return payload;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function closeCodeForError(error: unknown): number {
    return error instanceof WebSocketProtocolError ? error.closeCode : WEB_SOCKET_CLOSE_CODE.abnormal;
}

export class BrowserIrohHomeTunnelWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    binaryType: BrowserIrohCarrierBinaryType = 'arraybuffer';
    readyState: number = BrowserIrohHomeTunnelWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: BrowserIrohCarrierMessageEvent) => void) | null = null;
    onerror: ((event: BrowserIrohCarrierErrorEvent) => void) | null = null;
    onclose: ((event: BrowserIrohCarrierCloseEvent) => void) | null = null;

    private stream: BrowserIrohStream | null = null;
    private readonly decoder = new WebSocketFrameDecoder();
    private writeChain: Promise<void> = Promise.resolve();
    private upgraded = false;
    private settled = false;
    private errorReported = false;
    private released = false;
    private readonly opening = new AbortController();

    constructor(options: BrowserIrohHomeTunnelWebSocketOptions) {
        this.url = options.url;
        void this.start(options);
    }

    get observedPath(): BrowserIrohCarrierObservedPath {
        return this.upgraded ? 'relay' : 'unknown';
    }

    /**
     * Whether a frame may still be delivered. Both a close frame from Home and a
     * `close()` from the consumer — which can arrive synchronously from inside
     * `onmessage` — move the state before their own settle completes, so this is
     * what stops the rest of an already-decoded read from being handed on.
     */
    private get receiving(): boolean {
        return !this.settled && this.readyState === BrowserIrohHomeTunnelWebSocket.OPEN;
    }

    send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
        if (this.readyState !== BrowserIrohHomeTunnelWebSocket.OPEN) return;
        if (typeof data === 'string') {
            this.writeFrameDetached(WEB_SOCKET_OPCODE.text, new TextEncoder().encode(data));
            return;
        }
        if (data instanceof ArrayBuffer) {
            this.writeFrameDetached(WEB_SOCKET_OPCODE.binary, new Uint8Array(data));
            return;
        }
        if (ArrayBuffer.isView(data)) {
            this.writeFrameDetached(
                WEB_SOCKET_OPCODE.binary,
                new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            );
            return;
        }
        // A `Blob` payload is only readable asynchronously, so it is resolved
        // inside the write queue and keeps its place in the frame order.
        const blob = data;
        this.detach(this.enqueueWrite(async () => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await this.writeAll(encodeMaskedClientFrame(WEB_SOCKET_OPCODE.binary, bytes));
        }));
    }

    close(code: number = WEB_SOCKET_CLOSE_CODE.normal, reason = ''): void {
        if (
            this.readyState === BrowserIrohHomeTunnelWebSocket.CLOSING
            || this.readyState === BrowserIrohHomeTunnelWebSocket.CLOSED
        ) return;
        const wasOpen = this.readyState === BrowserIrohHomeTunnelWebSocket.OPEN;
        this.readyState = BrowserIrohHomeTunnelWebSocket.CLOSING;
        if (!wasOpen) {
            this.opening.abort(new Error('Browser Iroh WebSocket closed while its stream was opening'));
            // Nothing was ever upgraded, so there is no close frame to send and
            // no negotiated status to report: closing a connection that never
            // opened fails it, exactly as a platform `WebSocket` reports.
            this.settleClose(
                { code: WEB_SOCKET_CLOSE_CODE.abnormal, reason: '', wasClean: false },
                false,
            );
            return;
        }
        void (async () => {
            try {
                await this.writeFrame(WEB_SOCKET_OPCODE.close, encodeCloseBody(code, reason));
            } catch {
                // The stream may already be gone; the close is still recorded.
            }
            this.settleClose({ code, reason, wasClean: true }, true);
        })();
    }

    private async start(options: BrowserIrohHomeTunnelWebSocketOptions): Promise<void> {
        try {
            const opened = await options.openStream(this.opening.signal);
            this.stream = opened;
            if (this.settled) {
                await this.releaseStream(false);
                return;
            }
            if (opened.remoteEndpointId !== options.endpointId) {
                // Fail before the request is written: nothing this tab knows
                // may reach an endpoint that is not the selected one.
                await this.releaseStream(false);
                throw new Error(
                    `The Home tunnel stream authenticated EndpointId ${opened.remoteEndpointId}, not the selected ${options.endpointId}`,
                );
            }

            const key = createWebSocketHandshakeKey(options.randomBytes);
            const accept = await computeWebSocketAccept(key);
            if (this.settled) return;
            await this.enqueueWrite(() => this.writeAll(buildWebSocketUpgradeRequest({ url: this.url, key })));

            const upgrade = await this.readUpgradeResponse();
            if (this.settled) return;
            assertWebSocketUpgradeAccepted(upgrade.head, accept);

            this.upgraded = true;
            this.readyState = BrowserIrohHomeTunnelWebSocket.OPEN;
            this.onopen?.();
            await this.pump(upgrade.carryOver);
        } catch (error) {
            this.failOnce(error, closeCodeForError(error));
        }
    }

    private async readUpgradeResponse(): Promise<Readonly<{
        head: WebSocketUpgradeResponseHead;
        carryOver: Uint8Array;
    }>> {
        let buffer = new Uint8Array(0);
        let ended = false;
        for (;;) {
            const parsed = readWebSocketUpgradeResponseHead(buffer);
            if (parsed !== null) {
                return { head: parsed.head, carryOver: buffer.slice(parsed.bodyOffset) };
            }
            if (ended) {
                throw new Error('The Home tunnel stream ended before the upgrade response completed');
            }
            const read = await this.readOnce();
            buffer = concatBytes(buffer, read.bytes);
            if (read.done) ended = true;
        }
    }

    private async pump(initial: Uint8Array): Promise<void> {
        let chunk = initial;
        let ended = false;
        for (;;) {
            if (!this.receiving) return;
            if (chunk.length > 0) {
                // One read can carry several frames, and the frame that ends the
                // connection can be any of them.
                for (const frame of this.decoder.push(chunk)) {
                    this.handleFrame(frame);
                    if (!this.receiving) return;
                }
            }
            if (ended) {
                this.settleClose(
                    { code: WEB_SOCKET_CLOSE_CODE.abnormal, reason: '', wasClean: false },
                    false,
                );
                return;
            }
            const read = await this.readOnce();
            chunk = read.bytes;
            ended = read.done;
        }
    }

    private handleFrame(frame: WebSocketFrame): void {
        switch (frame.opcode) {
            case WEB_SOCKET_OPCODE.ping:
                this.writeFrameDetached(WEB_SOCKET_OPCODE.pong, frame.payload);
                return;
            case WEB_SOCKET_OPCODE.pong:
                return;
            case WEB_SOCKET_OPCODE.close:
                this.handleRemoteClose(frame.payload);
                return;
            default:
                this.handleDataFrame(frame);
        }
    }

    private handleRemoteClose(payload: Uint8Array): void {
        if (payload.length === 1) {
            throw new WebSocketProtocolError(
                WEB_SOCKET_CLOSE_CODE.protocolError,
                'Home sent a close frame with a one-byte payload',
            );
        }
        let code = WEB_SOCKET_CLOSE_CODE.noStatus;
        let reason = '';
        if (payload.length >= 2) {
            code = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0);
            if (!isTransmittableCloseCode(code)) {
                throw new WebSocketProtocolError(
                    WEB_SOCKET_CLOSE_CODE.protocolError,
                    `Home sent the reserved close code ${code}`,
                );
            }
            reason = decodeUtf8Strict(payload.subarray(2), 'close reason');
        }
        this.readyState = BrowserIrohHomeTunnelWebSocket.CLOSING;
        const echoed = payload.length >= 2 ? code : null;
        void (async () => {
            try {
                await this.writeFrame(WEB_SOCKET_OPCODE.close, encodeCloseBody(echoed, ''));
            } catch {
                // Best effort: the peer already asked to close.
            }
            this.settleClose({ code, reason, wasClean: true }, true);
        })();
    }

    private handleDataFrame(frame: WebSocketFrame): void {
        this.deliver(frame.opcode, frame.payload);
    }

    private deliver(opcode: WebSocketOpcode, payload: Uint8Array): void {
        if (opcode === WEB_SOCKET_OPCODE.text) {
            this.onmessage?.({ data: decodeUtf8Strict(payload, 'text message') });
            return;
        }
        this.onmessage?.({ data: this.toBinary(payload) });
    }

    private toBinary(payload: Uint8Array): ArrayBuffer | Uint8Array | Blob {
        if (this.binaryType === 'nodebuffer') return payload;
        if (this.binaryType === 'blob' && typeof Blob === 'function') return new Blob([payload]);
        return payload.slice().buffer;
    }

    private async readOnce(): Promise<Readonly<{ bytes: Uint8Array; done: boolean }>> {
        const current = this.stream;
        if (current === null) throw new Error('The Home tunnel stream is no longer held');
        return current.read(BROWSER_IROH_STREAM_CHUNK_BYTES);
    }

    private enqueueWrite(task: () => Promise<void>): Promise<void> {
        const run = this.writeChain.then(async () => {
            if (this.released) return;
            await task();
        });
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }

    private writeFrame(opcode: WebSocketOpcode, payload: Uint8Array): Promise<void> {
        return this.enqueueWrite(() => this.writeAll(encodeMaskedClientFrame(opcode, payload)));
    }

    private writeFrameDetached(opcode: WebSocketOpcode, payload: Uint8Array): void {
        this.detach(this.writeFrame(opcode, payload));
    }

    private detach(pending: Promise<void>): void {
        void pending.catch((error: unknown) => {
            this.failOnce(error, closeCodeForError(error));
        });
    }

    /** The stream command boundary caps one write; a frame may exceed it. */
    private async writeAll(bytes: Uint8Array): Promise<void> {
        const current = this.stream;
        if (current === null) throw new Error('The Home tunnel stream is no longer held');
        for (let offset = 0; offset < bytes.length; offset += BROWSER_IROH_STREAM_CHUNK_BYTES) {
            await current.write(bytes.subarray(offset, offset + BROWSER_IROH_STREAM_CHUNK_BYTES));
        }
    }

    private failOnce(error: unknown, code: number): void {
        if (this.settled) return;
        if (!this.errorReported) {
            this.errorReported = true;
            this.onerror?.({ type: 'error', message: describeError(error), error });
        }
        this.settleClose({ code, reason: '', wasClean: false }, false);
    }

    private settleClose(event: BrowserIrohCarrierCloseEvent, finishWrite: boolean): void {
        if (this.settled) return;
        this.settled = true;
        this.readyState = BrowserIrohHomeTunnelWebSocket.CLOSED;
        void this.releaseStream(finishWrite);
        this.onclose?.(event);
    }

    /**
     * Cancelling before closing is what releases a read parked on the stream;
     * without it the endpoint owner would keep a reader outstanding for a
     * connection nobody is listening to any more.
     */
    private async releaseStream(finishWrite: boolean): Promise<void> {
        this.released = true;
        const current = this.stream;
        this.stream = null;
        if (current === null) return;
        if (finishWrite) {
            try {
                await current.finishWrite();
            } catch {
                // The peer may have gone first; the release still proceeds.
            }
        }
        try {
            await current.cancel();
        } catch {
            // Ignored: cancellation is best effort by contract.
        }
        try {
            await current.close();
        } catch {
            // Ignored: the owner treats an unknown stream as already closed.
        }
    }
}

/**
 * The injection shape Engine.IO's WebSocket transport asks for: give it a URI,
 * get a `WebSocket`-like object back. Each call opens its own Iroh stream, so a
 * reconnect performed by the existing connection owner gets a fresh carrier
 * without this module owning any reconnection policy.
 */
export function createBrowserIrohHomeTunnelWebSocketFactory(
    input: Readonly<{
        endpointId: string;
        openStream: (signal?: AbortSignal) => Promise<BrowserIrohStream>;
        randomBytes?: (length: number) => Uint8Array;
    }>,
): (url: string) => BrowserIrohHomeTunnelWebSocket {
    return (url) => new BrowserIrohHomeTunnelWebSocket({ ...input, url });
}
