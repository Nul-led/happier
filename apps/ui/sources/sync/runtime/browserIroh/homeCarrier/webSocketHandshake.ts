/**
 * The HTTP/1.1 Upgrade half of the browser Iroh Home carrier (A7.3).
 *
 * A `happier/home-tunnel/1` stream is a byte pipe to Home's existing loopback
 * HTTP listener, so the carrier performs the ordinary client-side upgrade the
 * server already answers. Nothing here invents a Happier-specific handshake,
 * envelope, or second Home protocol.
 *
 * Everything the response promises is checked before the stream is treated as a
 * WebSocket: a non-101 status, a missing or wrong `Sec-WebSocket-Accept`, an
 * extension we never offered, or a subprotocol we never asked for all fail
 * closed, because after this point the carrier would be feeding authenticated
 * bytes to whatever answered.
 */

import { encodeBase64 } from '@/encryption/base64';

export const WEB_SOCKET_ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const WEB_SOCKET_HANDSHAKE_KEY_BYTES = 16;
/**
 * Bounded response head. Home's own listener answers an upgrade in a few
 * hundred bytes; a peer that never terminates the head must not be able to grow
 * this tab's buffer without limit.
 */
export const WEB_SOCKET_HANDSHAKE_MAX_HEAD_BYTES = 16 * 1024;

export class WebSocketHandshakeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WebSocketHandshakeError';
    }
}

export type WebSocketUpgradeResponseHead = Readonly<{
    statusCode: number;
    statusText: string;
    headers: ReadonlyMap<string, string>;
}>;

export function secureRandomBytes(length: number): Uint8Array {
    const source = globalThis.crypto;
    if (source === undefined || typeof source.getRandomValues !== 'function') {
        throw new WebSocketHandshakeError('A WebSocket handshake requires a secure random source');
    }
    return source.getRandomValues(new Uint8Array(length));
}

export function createWebSocketHandshakeKey(
    randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): string {
    const bytes = randomBytes(WEB_SOCKET_HANDSHAKE_KEY_BYTES);
    if (!(bytes instanceof Uint8Array) || bytes.length !== WEB_SOCKET_HANDSHAKE_KEY_BYTES) {
        throw new WebSocketHandshakeError('A WebSocket handshake key needs 16 secure random bytes');
    }
    return encodeBase64(bytes);
}

export function buildWebSocketUpgradeRequest(input: Readonly<{ url: string; key: string }>): Uint8Array {
    let parsed: URL;
    try {
        parsed = new URL(input.url);
    } catch {
        throw new WebSocketHandshakeError(`Not a usable carrier URL: ${input.url}`);
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        throw new WebSocketHandshakeError(`A WebSocket carrier URL uses ws: or wss:, not ${parsed.protocol}`);
    }

    const target = `${parsed.pathname}${parsed.search}`;
    const request = [
        `GET ${target} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${input.key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
    ].join('\r\n');
    return new TextEncoder().encode(request);
}

/**
 * `null` means the head is incomplete and more stream bytes are needed.
 * `bodyOffset` is where the first WebSocket frame byte starts.
 */
export function readWebSocketUpgradeResponseHead(
    buffer: Uint8Array,
): Readonly<{ head: WebSocketUpgradeResponseHead; bodyOffset: number }> | null {
    const terminator = findHeadTerminator(buffer);
    if (terminator === -1) {
        if (buffer.length > WEB_SOCKET_HANDSHAKE_MAX_HEAD_BYTES) {
            throw new WebSocketHandshakeError(
                `Home sent more than ${WEB_SOCKET_HANDSHAKE_MAX_HEAD_BYTES} bytes without completing the upgrade response head`,
            );
        }
        return null;
    }

    const lines = new TextDecoder().decode(buffer.subarray(0, terminator)).split('\r\n');
    const statusLine = lines[0] ?? '';
    const status = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/u.exec(statusLine);
    if (status === null) {
        throw new WebSocketHandshakeError(`Home did not answer the upgrade with an HTTP/1.1 status line: ${statusLine}`);
    }

    const headers = new Map<string, string>();
    for (const line of lines.slice(1)) {
        if (line.length === 0) continue;
        const separator = line.indexOf(':');
        if (separator <= 0 || line.startsWith(' ') || line.startsWith('\t')) {
            throw new WebSocketHandshakeError(`Home sent a malformed upgrade response header: ${line}`);
        }
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        const existing = headers.get(name);
        headers.set(name, existing === undefined ? value : `${existing}, ${value}`);
    }

    return {
        head: { statusCode: Number(status[1]), statusText: status[2] ?? '', headers },
        bodyOffset: terminator + 4,
    };
}

export async function computeWebSocketAccept(key: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined || typeof subtle.digest !== 'function') {
        throw new WebSocketHandshakeError('Validating a WebSocket handshake requires SubtleCrypto');
    }
    const digest = await subtle.digest('SHA-1', new TextEncoder().encode(`${key}${WEB_SOCKET_ACCEPT_GUID}`));
    return encodeBase64(new Uint8Array(digest));
}

export function assertWebSocketUpgradeAccepted(
    head: WebSocketUpgradeResponseHead,
    expectedAccept: string,
): void {
    if (head.statusCode !== 101) {
        throw new WebSocketHandshakeError(
            `Home answered the WebSocket upgrade with ${head.statusCode} ${head.statusText}`.trimEnd(),
        );
    }
    if ((head.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        throw new WebSocketHandshakeError('Home did not confirm a websocket upgrade');
    }
    const connection = (head.headers.get('connection') ?? '').toLowerCase();
    if (!connection.split(',').some((token) => token.trim() === 'upgrade')) {
        throw new WebSocketHandshakeError('Home did not confirm the Upgrade connection token');
    }
    if (head.headers.get('sec-websocket-accept') !== expectedAccept) {
        throw new WebSocketHandshakeError('Home returned a Sec-WebSocket-Accept that does not match this handshake key');
    }
    // Nothing was offered, so nothing may be selected. Accepting a
    // permessage-deflate or subprotocol selection we cannot honour would leave
    // the two sides reading different bytes off the same stream.
    const extensions = head.headers.get('sec-websocket-extensions');
    if (extensions !== undefined && extensions.length > 0) {
        throw new WebSocketHandshakeError(`Home selected a WebSocket extension that was never offered: ${extensions}`);
    }
    const subprotocol = head.headers.get('sec-websocket-protocol');
    if (subprotocol !== undefined && subprotocol.length > 0) {
        throw new WebSocketHandshakeError(`Home selected a WebSocket subprotocol that was never offered: ${subprotocol}`);
    }
}

function findHeadTerminator(buffer: Uint8Array): number {
    for (let index = 0; index + 3 < buffer.length; index += 1) {
        if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a && buffer[index + 2] === 0x0d && buffer[index + 3] === 0x0a) {
            return index;
        }
    }
    return -1;
}
