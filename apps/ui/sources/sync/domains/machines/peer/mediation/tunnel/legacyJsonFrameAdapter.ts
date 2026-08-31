/** Legacy JSON/base64 wire adapter. Binary tunnel paths stay Uint8Array end to end. */
import { PeerTcpTunnelFrameV1Schema, type PeerTcpTunnelFrameV1 } from '@happier-dev/protocol';
import type { PeerTcpTunnelFrame } from '@happier-dev/peer-transport/duplexFrames';

import { decodeBase64, encodeBase64 } from '@/encryption/base64';

function toBytes(payload: unknown): Uint8Array | null {
    if (payload instanceof Uint8Array) return payload;
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    return null;
}

export function encodeLegacyJsonPeerTcpTunnelFrame(frame: PeerTcpTunnelFrame): string {
    return JSON.stringify(toLegacyJsonPeerTcpTunnelFrame(frame));
}

export function toLegacyJsonPeerTcpTunnelFrame(
    frame: PeerTcpTunnelFrame,
): Exclude<PeerTcpTunnelFrameV1, { kind: 'open' }> {
    return frame.kind === 'data'
        ? {
            v: 1,
            kind: 'data',
            tunnelId: frame.tunnelId,
            direction: frame.direction,
            sequence: frame.sequence,
            payloadBase64: encodeBase64(frame.payload),
        }
        : frame;
}

export function decodeLegacyJsonPeerTcpTunnelFrame(payload: unknown): PeerTcpTunnelFrame | null {
    try {
        const bytes = toBytes(payload);
        const raw = typeof payload === 'string'
            ? JSON.parse(payload)
            : bytes
                ? JSON.parse(new TextDecoder().decode(bytes))
                : payload;
        const parsed = PeerTcpTunnelFrameV1Schema.safeParse(raw);
        if (!parsed.success || parsed.data.kind === 'open') return null;
        return parsed.data.kind === 'data'
            ? {
                v: 1,
                kind: 'data',
                tunnelId: parsed.data.tunnelId,
                direction: parsed.data.direction,
                sequence: parsed.data.sequence,
                payload: decodeBase64(parsed.data.payloadBase64),
            }
            : parsed.data;
    } catch {
        return null;
    }
}
