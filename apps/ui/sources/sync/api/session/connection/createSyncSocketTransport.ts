import { io, type Socket } from 'socket.io-client';

import type { ManagedConnectionTransport, TransportDisconnectEvent } from '@happier-dev/connection-supervisor';
import {
    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
    buildAccountStoredContentCompatibilitySocketAuthV1,
} from '@happier-dev/protocol';
import {
    resolveSocketIoTransportsForCarrier,
    resolveSocketIoTransportsForHomeCarrier,
} from '@/sync/runtime/socketIoTransports';
import type { HomeCarrierWebSocketFactory } from '@/sync/runtime/homeCarrier';

type SyncSocket = Socket;

function isSocketActive(socket: SyncSocket): boolean {
    return (socket as unknown as { active?: boolean }).active === true;
}

function isAlreadyDisconnectedSocketError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.toLowerCase().includes('socket has been disconnected');
}

/**
 * Engine.IO's `createSocket` contract: given the URI Engine.IO wants to reach,
 * return a `WebSocket`-like object. A carrier that owns its own byte transport —
 * today only the relay-only browser Iroh Home carrier, which cannot point the
 * platform WebSocket at an Iroh stream — supplies one. Nothing here selects a
 * carrier: without this parameter, Engine.IO's own transport selection and the
 * default HTTPS/native semantics are untouched.
 */
export type SyncSocketWebSocketFactory = HomeCarrierWebSocketFactory;

export function createSyncSocketTransport(params: Readonly<{
    endpoint: string;
    token: string;
    transports?: string[];
    carrier?: 'https' | 'iroh';
    websocketFactory?: SyncSocketWebSocketFactory;
}>): Readonly<{
    socket: SyncSocket;
    transport: ManagedConnectionTransport;
}> {
    const endpoint = String(params.endpoint ?? '').trim().replace(/\/+$/, '');
    const transports = params.websocketFactory
        ? resolveSocketIoTransportsForHomeCarrier(params.websocketFactory)
        : resolveSocketIoTransportsForCarrier(params.carrier, params.transports);
    const socket = io(endpoint, {
        // Socket.IO mounts on an Engine.IO endpoint that expects a trailing slash on the wire
        // (`/v1/updates/?EIO=...`). Some browser environments can otherwise surface this as
        // a generic `xhr poll error` during bootstrap even when the server is healthy.
        path: '/v1/updates/',
        auth: {
            token: params.token,
            clientType: 'user-scoped' as const,
            clientPurpose: 'sync' as const,
            ...buildAccountStoredContentCompatibilitySocketAuthV1(
                CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
            ),
        },
        ...(transports ? { transports } : null),
        // Explicitly disable cookies/credentialed requests for cross-origin polling transport.
        // Our server authenticates via the token in the Socket.IO handshake, and sets
        // `credentials: false` for CORS, so a credentialed polling request is blocked by
        // browsers and surfaces as `xhr poll error`.
        withCredentials: false,
        // Avoid the socket.io global Manager cache. We manage connection lifecycles explicitly,
        // and cached Managers can retain sockets/listeners across rebuilds.
        forceNew: true,
        multiplex: false,
        reconnection: false,
        autoConnect: false,
    });

    const connectedListeners = new Set<() => void>();
    const disconnectedListeners = new Set<(event: TransportDisconnectEvent) => void>();
    const errorListeners = new Set<(error: unknown) => void>();
    let intentionalDisconnect = false;

    socket.on('connect', () => {
        connectedListeners.forEach((listener) => listener());
    });

    socket.on('disconnect', (reason: string) => {
        const event: TransportDisconnectEvent = {
            intentional: intentionalDisconnect,
            reason,
        };
        intentionalDisconnect = false;
        disconnectedListeners.forEach((listener) => listener(event));
    });

    socket.on('connect_error', (error) => {
        errorListeners.forEach((listener) => listener(error));
    });

    socket.on('error', (error) => {
        errorListeners.forEach((listener) => listener(error));
    });

    const transport: ManagedConnectionTransport = {
        async connect(): Promise<void> {
            // Defensive: disconnect() may be called while already disconnected/connecting, which might not emit
            // a 'disconnect' event. Reset so the next disconnect isn't misclassified as intentional.
            intentionalDisconnect = false;
            socket.connect();
        },
        async disconnect(options?: { intentional?: boolean }): Promise<void> {
            if (socket.connected !== true && !isSocketActive(socket)) {
                intentionalDisconnect = false;
                return;
            }
            intentionalDisconnect = options?.intentional === true;
            try {
                socket.disconnect();
            } catch (error) {
                intentionalDisconnect = false;
                if (isAlreadyDisconnectedSocketError(error)) {
                    return;
                }
                throw error;
            }
        },
        async destroy(): Promise<void> {
            intentionalDisconnect = false;
            connectedListeners.clear();
            disconnectedListeners.clear();
            errorListeners.clear();
            socket.offAny?.();
            socket.removeAllListeners?.();
            try {
                socket.disconnect();
            } catch {
                // ignore
            }
        },
        isConnected(): boolean {
            return socket.connected === true;
        },
        onConnected(listener: () => void): () => void {
            connectedListeners.add(listener);
            return () => connectedListeners.delete(listener);
        },
        onDisconnected(listener: (event: TransportDisconnectEvent) => void): () => void {
            disconnectedListeners.add(listener);
            return () => disconnectedListeners.delete(listener);
        },
        onError(listener: (error: unknown) => void): () => void {
            errorListeners.add(listener);
            return () => errorListeners.delete(listener);
        },
    };

    return { socket, transport };
}
