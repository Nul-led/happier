/**
 * The canonical shape of a Home carrier that owns its own bytes (Lane 06 A7.3).
 *
 * Every other transport this app resolves is addressable by URL: an HTTPS
 * origin, or the loopback origin a native Iroh lease binds. A browser cannot
 * bind a listener, so its Iroh carrier has no origin at all — and inventing one
 * would put a fake `http://127.0.0.1:<port>` into request URLs, logs, reachability
 * keys, and the auth same-origin check, none of which is true. This type is the
 * alternative: the transport is named semantically, and the canonical Home URL
 * keeps describing identity, audience, storage scope, and logging.
 *
 * It is deliberately structural and dependency-free so the HTTP owner, the
 * Socket.IO owners, the reachability supervisor, and the scoped-transport
 * resolver can all speak it without importing the browser Iroh implementation
 * (which must stay lazily loaded).
 */

/**
 * Engine.IO's `createSocket` contract, narrowed to what a carrier supplies:
 * given the URI Engine.IO wants to reach, return a `WebSocket`-like object.
 */
export type HomeCarrierWebSocketFactory = (
    uri: string,
    protocols?: string | string[],
    options?: Record<string, unknown>,
) => unknown;

export class ServerScopedTransportUnavailableError extends Error {
    constructor() {
        super('No verified transport is available for the target Home');
        this.name = 'ServerScopedTransportUnavailableError';
    }
}

export type HomeCarrier = Readonly<{
    /**
     * The EndpointId the carrier's transport cryptographically proves for every
     * stream it opens. Surfaced so the descriptor/enrollment owner can bind a
     * credential destination to it; the carrier itself never derives Home
     * identity from it.
     */
    endpointId: string;
    /**
     * The path fact observed so far. A browser carrier is relay-only, so this is
     * `relay` once a stream has proven one and `unknown` before that — there is
     * no `direct` value it could report.
     */
    readObservedPath: () => 'relay' | 'unknown';
    /**
     * Carries one already-composed request. The caller owns method, final URL,
     * headers (including any bearer), body, and cancellation; the carrier moves
     * the bytes and returns the peer's response.
     */
    request: (url: string, init: RequestInit) => Promise<Response>;
    createWebSocket: HomeCarrierWebSocketFactory;
}>;
