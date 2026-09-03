/**
 * The application send boundary of a `PeerTcpTunnelClientStream` means either accepted for
 * delivery or a typed rejection. A retired carrier must never report a send as delivered, so
 * both carriers (loopback websocket and server relay) raise this one typed error instead of
 * each deciding locally whether to drop, throw, or silently succeed.
 */
export const PEER_TCP_TUNNEL_STREAM_CLOSED_CODE = 'peer_tunnel_stream_closed' as const;

export type PeerTcpTunnelStreamClosedError = Error & Readonly<{
    code: typeof PEER_TCP_TUNNEL_STREAM_CLOSED_CODE;
}>;

export function createPeerTcpTunnelStreamClosedError(): PeerTcpTunnelStreamClosedError {
    return Object.assign(new Error('Peer TCP tunnel stream is closed'), {
        code: PEER_TCP_TUNNEL_STREAM_CLOSED_CODE,
    });
}

/** Throws the typed closed-stream rejection when the carrier is no longer writable. */
export function assertPeerTcpTunnelStreamWritable(closed: boolean): void {
    if (!closed) return;
    throw createPeerTcpTunnelStreamClosedError();
}
