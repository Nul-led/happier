import { WebSocket as EngineWebSocketTransport } from 'socket.io-client';

import { config } from '@/config';
import type { HomeCarrierWebSocketFactory } from '@/sync/runtime/homeCarrier';

export function resolveSocketIoTransports(): string[] | undefined {
    if (config.socketForceWebsocketOnly) return ['websocket'];
    // Default to Engine.IO transport behavior (polling-first, then upgrade) for maximum
    // compatibility across proxies and dev gateways. We only override when explicitly asked.
    return undefined;
}

export function resolveSocketIoTransportsForCarrier(
    carrier: 'https' | 'iroh' | undefined,
    fallback: string[] | undefined = resolveSocketIoTransports(),
): string[] | undefined {
    return carrier === 'iroh' ? ['websocket'] : fallback;
}

/**
 * Engine.IO transport implementations for a Home carrier that owns its own
 * bytes. A carrier-provided socket can only be a WebSocket, so polling and every
 * upgrade path are excluded by construction rather than by policy — and the
 * carrier never becomes a second reconnect, event, or lifecycle owner: Engine.IO
 * keeps all of that and merely receives a different underlying socket.
 */
export function resolveSocketIoTransportsForHomeCarrier(
    websocketFactory: HomeCarrierWebSocketFactory,
): Array<new (options: unknown) => InstanceType<typeof EngineWebSocketTransport>> {
    return [class HomeCarrierWebSocketTransport extends EngineWebSocketTransport {
        createSocket(uri: string, protocols: string | string[] | undefined, options: Record<string, unknown>) {
            return websocketFactory(uri, protocols, options);
        }
    }];
}
