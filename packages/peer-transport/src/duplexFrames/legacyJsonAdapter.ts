/** The retained `json_base64_v1` wire boundary. Canonical frame/session logic stays binary. */
import {
    decodeBase64,
    encodeBase64,
    PeerTcpTunnelFrameV1Schema,
    validatePeerTcpTunnelDataFrameCaps,
    type PeerTcpTunnelFrameV1,
} from '@happier-dev/protocol';

import { createPeerTcpTunnelStreamSession } from './streamSession.js';
import type {
    PeerTcpTunnelFrame,
    PeerTcpTunnelStreamConnection,
    PeerTcpTunnelStreamSessionResult,
} from './types.js';

export type LegacyJsonPeerTcpTunnelFrame = Exclude<PeerTcpTunnelFrameV1, { kind: 'open' }>;

function toBytes(payload: unknown): Uint8Array | null {
    if (payload instanceof Uint8Array) return payload;
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    return null;
}

export function toLegacyJsonPeerTcpTunnelFrame(frame: PeerTcpTunnelFrame): LegacyJsonPeerTcpTunnelFrame {
    if (frame.kind !== 'data') return frame;
    return {
        v: 1,
        kind: 'data',
        tunnelId: frame.tunnelId,
        direction: frame.direction,
        sequence: frame.sequence,
        payloadBase64: encodeBase64(frame.payload),
    };
}

export function parseLegacyJsonPeerTcpTunnelFrame(raw: unknown): PeerTcpTunnelFrame | null {
    const parsed = PeerTcpTunnelFrameV1Schema.safeParse(raw);
    if (!parsed.success || parsed.data.kind === 'open') return null;
    const frame = parsed.data;
    if (frame.kind !== 'data') return frame;
    return {
        v: 1,
        kind: 'data',
        tunnelId: frame.tunnelId,
        direction: frame.direction,
        sequence: frame.sequence,
        payload: decodeBase64(frame.payloadBase64),
    };
}

export function encodeLegacyJsonPeerTcpTunnelFrame(frame: PeerTcpTunnelFrame): string {
    return JSON.stringify(toLegacyJsonPeerTcpTunnelFrame(frame));
}

export function decodeLegacyJsonPeerTcpTunnelFrame(payload: unknown): PeerTcpTunnelFrame | null {
    try {
        const bytes = toBytes(payload);
        const raw = typeof payload === 'string'
            ? JSON.parse(payload)
            : bytes
                ? JSON.parse(new TextDecoder().decode(bytes))
                : payload;
        return parseLegacyJsonPeerTcpTunnelFrame(raw);
    } catch {
        return null;
    }
}

export function createLegacyJsonPeerTcpTunnelStreamSession(input: Readonly<{
    tunnelId: string;
    initialWindowBytes: number;
    maxFrameBytes: number;
    maxEncodedFrameBytes?: number;
    maxDecodedPayloadBytes?: number;
    maxSendChunkBytes?: number;
    ackAfterBytes?: number;
    ackAfterMs?: number;
    maxIdleMs?: number;
    maxDurationMs?: number;
    maxTotalBytes?: number;
    nowMs?: () => number;
    connection: PeerTcpTunnelStreamConnection;
    sendFrame: (frame: LegacyJsonPeerTcpTunnelFrame) => Promise<void> | void;
}>) {
    const maxEncodedFrameBytes = input.maxEncodedFrameBytes ?? input.maxFrameBytes;
    const maxDecodedPayloadBytes = input.maxDecodedPayloadBytes ?? input.maxFrameBytes;
    const session = createPeerTcpTunnelStreamSession({
        ...input,
        maxFrameBytes: maxDecodedPayloadBytes,
        maxDecodedPayloadBytes,
        sendFrame: (frame) => input.sendFrame(toLegacyJsonPeerTcpTunnelFrame(frame)),
    });

    async function rejectLegacyFrame(reasonCode: Extract<PeerTcpTunnelStreamSessionResult, { ok: false }>['reasonCode']) {
        try {
            await session.abort(reasonCode);
        } catch {
            // The typed validation failure remains authoritative after terminal cleanup.
        }
        return { ok: false as const, reasonCode };
    }

    return {
        ...session,
        async acceptFrame(raw: unknown): Promise<PeerTcpTunnelStreamSessionResult> {
            const parsed = PeerTcpTunnelFrameV1Schema.safeParse(raw);
            if (!parsed.success || parsed.data.kind === 'open') {
                return rejectLegacyFrame('frame_invalid');
            }
            const frame = parsed.data;
            if (frame.kind === 'data') {
                const caps = validatePeerTcpTunnelDataFrameCaps({
                    frame,
                    maxEncodedFrameBytes,
                    maxDecodedPayloadBytes,
                });
                if (!caps.ok) return rejectLegacyFrame(caps.reasonCode);
            }
            return session.acceptFrame(parseLegacyJsonPeerTcpTunnelFrame(frame));
        },
    };
}
