/**
 * Tunnel frame layer.
 *
 * This barrel preserves the module specifier `./frames` that `registerRoutes.ts`, `relay.ts` and
 * the directory barrel already import, so the 2026-08-23 split of the former 1,498-line
 * `frames.ts` changed no consumer and no behaviour.
 */
// The shared package owns binary sessions/codecs and the explicitly named
// json_base64_v1 compatibility boundary. This directory contains tests only.
export {
    createLegacyJsonPeerTcpTunnelStreamSession,
    createPeerTcpTunnelApplicationSubstreamSession,
    createPeerTcpTunnelFrameAccounting,
    createPeerTcpTunnelStreamSession,
    createPeerTcpTunnelSubstreamMuxSession,
    decodePeerTcpTunnelBinaryFrameForSession,
    encodePeerTcpTunnelBinaryFrameForSession,
    isSchedulableTimeoutMs,
    substreamAbortFrame,
} from '@happier-dev/peer-transport';
export type {
    LegacyJsonPeerTcpTunnelFrame,
    PeerTcpTunnelApplicationSubstreamSessionResult,
    PeerTcpTunnelFrame,
    PeerTcpTunnelStreamConnection,
    PeerTcpTunnelStreamSessionResult,
    PeerTcpTunnelSubstreamMuxSessionResult,
} from '@happier-dev/peer-transport';
