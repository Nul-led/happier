/**
 * RFC 6455 framing for the browser Iroh Home carrier (Lane 06 amendment A7.3).
 *
 * A browser cannot ask its own WebSocket stack to run over an Iroh stream, so
 * the carrier speaks the wire protocol itself. This module owns only frames:
 * message assembly, the closing handshake, and the transport lifecycle belong
 * to `homeTunnelWebSocket`.
 *
 * Client frames are always masked with bytes from the host's secure random
 * source, and a server frame that arrives masked is a protocol violation. That
 * asymmetry is the specification's, not a policy invented here.
 */

export const WEB_SOCKET_MAX_CONTROL_FRAME_PAYLOAD_BYTES = 125;
export const WEB_SOCKET_MASK_BYTES = 4;

export const WEB_SOCKET_OPCODE = {
    continuation: 0x0,
    text: 0x1,
    binary: 0x2,
    close: 0x8,
    ping: 0x9,
    pong: 0xa,
} as const;

export type WebSocketOpcode = (typeof WEB_SOCKET_OPCODE)[keyof typeof WEB_SOCKET_OPCODE];

/** The subset of RFC 6455 §7.4.1 status codes this carrier originates or reports. */
export const WEB_SOCKET_CLOSE_CODE = {
    normal: 1000,
    goingAway: 1001,
    protocolError: 1002,
    noStatus: 1005,
    abnormal: 1006,
    invalidPayload: 1007,
    messageTooBig: 1009,
} as const;

/** A wire-level violation. `closeCode` is the status the peer should be told. */
export class WebSocketProtocolError extends Error {
    constructor(readonly closeCode: number, message: string) {
        super(message);
        this.name = 'WebSocketProtocolError';
    }
}

export type WebSocketFrame = Readonly<{
    fin: boolean;
    opcode: WebSocketOpcode;
    payload: Uint8Array;
}>;

export function isWebSocketControlOpcode(opcode: number): boolean {
    return (opcode & 0x08) !== 0;
}

/**
 * Masking is a security property of the protocol, not a formality: a
 * predictable mask is what makes proxy cache poisoning possible. A host without
 * a secure random source therefore fails closed instead of degrading.
 */
export function secureWebSocketMask(): Uint8Array {
    const source = globalThis.crypto;
    if (source === undefined || typeof source.getRandomValues !== 'function') {
        throw new Error('Masking a WebSocket frame requires a secure random source');
    }
    return source.getRandomValues(new Uint8Array(WEB_SOCKET_MASK_BYTES));
}

export function encodeMaskedClientFrame(
    opcode: WebSocketOpcode,
    payload: Uint8Array,
    mask: Uint8Array = secureWebSocketMask(),
): Uint8Array {
    if (mask.length !== WEB_SOCKET_MASK_BYTES) {
        throw new Error(`A WebSocket mask is ${WEB_SOCKET_MASK_BYTES} bytes`);
    }
    if (isWebSocketControlOpcode(opcode) && payload.length > WEB_SOCKET_MAX_CONTROL_FRAME_PAYLOAD_BYTES) {
        throw new WebSocketProtocolError(
            WEB_SOCKET_CLOSE_CODE.protocolError,
            `A control frame carries at most ${WEB_SOCKET_MAX_CONTROL_FRAME_PAYLOAD_BYTES} bytes`,
        );
    }

    const length = payload.length;
    const headerBytes = length < 126 ? 2 : length < 0x1_0000 ? 4 : 10;
    const frame = new Uint8Array(headerBytes + WEB_SOCKET_MASK_BYTES + length);
    const view = new DataView(frame.buffer);

    frame[0] = 0x80 | opcode;
    if (length < 126) {
        frame[1] = 0x80 | length;
    } else if (length < 0x1_0000) {
        frame[1] = 0x80 | 126;
        view.setUint16(2, length);
    } else {
        frame[1] = 0x80 | 127;
        view.setBigUint64(2, BigInt(length));
    }

    frame.set(mask, headerBytes);
    const payloadOffset = headerBytes + WEB_SOCKET_MASK_BYTES;
    for (let index = 0; index < length; index += 1) {
        frame[payloadOffset + index] = (payload[index] as number) ^ (mask[index % WEB_SOCKET_MASK_BYTES] as number);
    }
    return frame;
}

function isKnownOpcode(opcode: number): opcode is WebSocketOpcode {
    return opcode === 0x0 || opcode === 0x1 || opcode === 0x2 || opcode === 0x8 || opcode === 0x9 || opcode === 0xa;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}

/**
 * Incremental server-frame decoder. Iroh reads deliver arbitrary byte runs, so
 * a frame may span reads and a read may carry several frames; the decoder holds
 * the remainder and yields only whole frames.
 *
 * Extended lengths are accepted as sent. Minimal-length encoding is not
 * enforced, because rejecting a legal-but-verbose length would only break
 * interoperability with a compliant Home for no safety gain.
 */
export class WebSocketFrameDecoder {
    private buffer = new Uint8Array(0);

    push(chunk: Uint8Array): WebSocketFrame[] {
        this.buffer = concatBytes(this.buffer, chunk);
        const frames: WebSocketFrame[] = [];
        const buffer = this.buffer;
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;

        for (;;) {
            const available = buffer.length - offset;
            if (available < 2) break;

            const first = buffer[offset] as number;
            const second = buffer[offset + 1] as number;

            if ((first & 0x70) !== 0) {
                throw new WebSocketProtocolError(
                    WEB_SOCKET_CLOSE_CODE.protocolError,
                    'Home set a reserved WebSocket frame bit without a negotiated extension',
                );
            }
            const opcode = first & 0x0f;
            if (!isKnownOpcode(opcode)) {
                throw new WebSocketProtocolError(
                    WEB_SOCKET_CLOSE_CODE.protocolError,
                    `Home sent an unknown WebSocket opcode 0x${opcode.toString(16)}`,
                );
            }
            if ((second & 0x80) !== 0) {
                throw new WebSocketProtocolError(
                    WEB_SOCKET_CLOSE_CODE.protocolError,
                    'Home masked a server-to-client WebSocket frame',
                );
            }

            const fin = (first & 0x80) !== 0;
            const indicator = second & 0x7f;
            let headerBytes = 2;
            let length = indicator;
            if (indicator === 126) {
                if (available < 4) break;
                length = view.getUint16(offset + 2);
                headerBytes = 4;
            } else if (indicator === 127) {
                if (available < 10) break;
                const extended = view.getBigUint64(offset + 2);
                if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
                    throw new WebSocketProtocolError(
                        WEB_SOCKET_CLOSE_CODE.messageTooBig,
                        'Home announced a WebSocket frame larger than this runtime can address',
                    );
                }
                length = Number(extended);
                headerBytes = 10;
            }

            if (isWebSocketControlOpcode(opcode)) {
                if (!fin) {
                    throw new WebSocketProtocolError(
                        WEB_SOCKET_CLOSE_CODE.protocolError,
                        'Home fragmented a WebSocket control frame',
                    );
                }
                if (length > WEB_SOCKET_MAX_CONTROL_FRAME_PAYLOAD_BYTES) {
                    throw new WebSocketProtocolError(
                        WEB_SOCKET_CLOSE_CODE.protocolError,
                        `Home sent a control frame of ${length} bytes, above the ${WEB_SOCKET_MAX_CONTROL_FRAME_PAYLOAD_BYTES}-byte limit`,
                    );
                }
            }

            if (available < headerBytes + length) break;
            const start = offset + headerBytes;
            frames.push({ fin, opcode, payload: buffer.slice(start, start + length) });
            offset = start + length;
        }

        this.buffer = offset === 0 ? buffer : buffer.slice(offset);
        return frames;
    }
}
