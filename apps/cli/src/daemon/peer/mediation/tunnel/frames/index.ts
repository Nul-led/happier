/**
 * Tunnel frame layer.
 *
 * This barrel preserves the module specifier `./frames` that `registerRoutes.ts`, `relay.ts` and
 * the directory barrel already import, so the 2026-08-23 split of the former 1,498-line
 * `frames.ts` changed no consumer and no behaviour.
 */
// The shared package is the sole owner of binary sessions and codecs.
export {
    createPeerTcpTunnelApplicationSubstreamSession,
    createPeerTcpTunnelFrameAccounting,
    createPeerTcpTunnelStreamSession,
    createPeerTcpTunnelSubstreamMuxSession,
    decodePeerTcpTunnelBinaryFrameForSession,
    encodePeerTcpTunnelBinaryFrameForSession,
    isSchedulableTimeoutMs,
    peerTcpTunnelBinaryDecodeFailureReason,
    substreamAbortFrame,
} from '@happier-dev/peer-transport';
export type {
    PeerTcpTunnelApplicationSubstreamSessionResult,
    PeerTcpTunnelFrame,
    PeerTcpTunnelStreamConnection,
    PeerTcpTunnelStreamSessionResult,
    PeerTcpTunnelSubstreamMuxSessionResult,
} from '@happier-dev/peer-transport';
