import {
    decodePeerTcpTunnelBinaryFrameV2,
    encodePeerTcpTunnelBinaryFrameV2,
    PEER_TCP_TUNNEL_BINARY_FRAME_ENCODING_V2,
    PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT,
    type PeerTcpTunnelRelayEnvelope,
} from "@happier-dev/protocol";
import {
    createPeerTcpTunnelStreamSession,
    decodePeerTcpTunnelBinaryFrameForSubstreamSession,
    encodePeerTcpTunnelBinaryFrameForSubstream,
} from "@happier-dev/peer-transport/duplexFrames";
import type { PeerTcpTunnelStreamSessionResult } from "@happier-dev/peer-transport/duplexFrames";

export type PeerTcpTunnelRelayTransport = Readonly<{
    relaySocketId: string;
    send(event: typeof PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, envelope: PeerTcpTunnelRelayEnvelope): void;
    subscribe(handler: (envelope: PeerTcpTunnelRelayEnvelope) => void): () => void;
    close(): void;
}>;

export type PeerTcpTunnelRelayTransportFactory = (input: Readonly<{
    accountId: string;
}>) => PeerTcpTunnelRelayTransport;

type QueuedRead =
    | Readonly<{ kind: "chunk"; chunk: Uint8Array; onConsumed: () => void }>
    | Readonly<{ kind: "done" }>;

class AsyncByteQueue implements AsyncIterable<Uint8Array> {
    private readonly items: QueuedRead[] = [];
    private readonly waiters: ((item: QueuedRead) => void)[] = [];
    private closed = false;

    push(chunk: Uint8Array): Promise<void> {
        if (this.closed) return Promise.resolve();
        return new Promise((resolve) => {
            this.publish({ kind: "chunk", chunk, onConsumed: resolve });
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.publish({ kind: "done" });
    }

    private publish(item: QueuedRead): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(item);
            return;
        }
        this.items.push(item);
    }

    private async nextItem(): Promise<QueuedRead> {
        const item = this.items.shift();
        if (item) return item;
        return new Promise((resolve) => {
            this.waiters.push(resolve);
        });
    }

    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        while (true) {
            const item = await this.nextItem();
            if (item.kind === "chunk") {
                yield item.chunk;
                item.onConsumed();
                continue;
            }
            return;
        }
    }
}

export type PeerTcpTunnelRelayByteStream = Readonly<{
    tunnelId: string;
    substreamId: string;
    write(chunk: Uint8Array): Promise<PeerTcpTunnelStreamSessionResult>;
    endWrite(): Promise<PeerTcpTunnelStreamSessionResult>;
    read(): AsyncIterable<Uint8Array>;
    close(): Promise<void>;
    abort(reasonCode: string): Promise<void>;
}>;

export type PeerTcpTunnelRelaySubstream = Readonly<{
    stream: PeerTcpTunnelRelayByteStream;
    open(): void;
    acceptEnvelope(envelope: PeerTcpTunnelRelayEnvelope): void;
    closeFromTunnel(): void;
}>;

function normalizeChunk(chunk: Uint8Array): Uint8Array {
    return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
}

/**
 * Owns only the binary V2 byte-stream mechanics for one already-authorized relay substream.
 * Target selection, route grants, authorization, reuse, and lifecycle remain with the caller.
 */
export function createPeerTcpTunnelRelaySubstream(input: Readonly<{
    tunnelId: string;
    substreamId: string;
    initialWindowBytes: number;
    maxFrameBytes: number;
    maxDecodedPayloadBytes: number;
    maxSendChunkBytes: number;
    sendEncodedBinaryFrame(frame: Uint8Array): void;
    onRelease(): void;
}>): PeerTcpTunnelRelaySubstream {
    const queue = new AsyncByteQueue();
    let closed = false;

    function release(): void {
        if (closed) return;
        closed = true;
        queue.close();
        input.onRelease();
    }

    const frameSession = createPeerTcpTunnelStreamSession({
        tunnelId: input.tunnelId,
        outboundDirection: "client_to_daemon",
        initialWindowBytes: input.initialWindowBytes,
        maxFrameBytes: input.maxFrameBytes,
        maxDecodedPayloadBytes: input.maxDecodedPayloadBytes,
        maxSendChunkBytes: input.maxSendChunkBytes,
        ackAfterBytes: 1,
        connection: {
            write: (bytes) => queue.push(bytes),
            endWrite: () => queue.close(),
            close: () => release(),
        },
        sendFrame: (frame) => {
            input.sendEncodedBinaryFrame(encodePeerTcpTunnelBinaryFrameForSubstream({
                frame,
                substreamId: input.substreamId,
            }));
        },
    });

    const stream: PeerTcpTunnelRelayByteStream = {
        tunnelId: input.tunnelId,
        substreamId: input.substreamId,
        write: (chunk) => frameSession.write(normalizeChunk(chunk)),
        endWrite: () => frameSession.endWrite("client_write_complete"),
        read: () => queue,
        close: () => frameSession.terminate("client_stream_closed"),
        abort: (reasonCode) => frameSession.abort(reasonCode || "client_stream_aborted"),
    };

    return {
        stream,
        open() {
            input.sendEncodedBinaryFrame(encodePeerTcpTunnelBinaryFrameV2({
                header: {
                    version: 2,
                    kind: "open",
                    tunnelId: input.tunnelId,
                    substreamId: input.substreamId,
                    payloadLength: 0,
                },
            }));
        },
        acceptEnvelope(envelope) {
            if (closed || envelope.v !== 2 || envelope.encoding !== PEER_TCP_TUNNEL_BINARY_FRAME_ENCODING_V2) return;
            const decoded = decodePeerTcpTunnelBinaryFrameV2({
                frame: envelope.frame,
                maxHeaderBytes: input.maxFrameBytes,
                maxPayloadBytes: input.maxDecodedPayloadBytes,
            });
            if (!decoded.ok || decoded.header.tunnelId !== input.tunnelId || decoded.header.substreamId !== input.substreamId) {
                return;
            }
            const frame = decodePeerTcpTunnelBinaryFrameForSubstreamSession({
                header: decoded.header,
                payload: decoded.payload,
            });
            if (!frame) return;
            void frameSession.acceptFrame(frame).catch(() => release());
        },
        closeFromTunnel() {
            if (closed) return;
            closed = true;
            queue.close();
        },
    };
}
