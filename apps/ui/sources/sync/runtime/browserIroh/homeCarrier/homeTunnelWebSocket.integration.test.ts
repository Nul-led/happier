import { createServer, type Server as HttpServer } from 'node:http';
import { connect as connectLoopback, type AddressInfo } from 'node:net';

import { attach, type Server as EngineServer } from 'engine.io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSyncSocketTransport } from '@/sync/api/session/connection/createSyncSocketTransport';

import type { BrowserIrohStream } from '../endpointClient';
import {
    createBrowserIrohHomeTunnelWebSocketFactory,
    type BrowserIrohHomeTunnelWebSocket,
} from './homeTunnelWebSocket';

const HOME_ENDPOINT_ID = 'k51endpointhomeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/**
 * The real Home shape, minus the Iroh hop: Home's acceptor pumps an authenticated
 * `happier/home-tunnel/1` stream straight into its loopback HTTP listener, so a
 * loopback socket is exactly what the carrier's stream handle stands in front of.
 * Everything above it — the upgrade, RFC 6455 framing, the real Engine.IO client
 * and server, and the existing connection owner — stays real.
 */
async function openLoopbackTunnelStream(
    port: number,
    remoteEndpointId: string,
): Promise<BrowserIrohStream> {
    const connection = connectLoopback({ port, host: '127.0.0.1' });
    connection.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
        connection.once('connect', () => { resolve(); });
        connection.once('error', reject);
    });

    const inbound: Uint8Array[] = [];
    let ended = false;
    let cancelled = false;
    let wake: (() => void) | null = null;
    const wakeReader = (): void => {
        const pending = wake;
        wake = null;
        pending?.();
    };
    connection.on('data', (chunk: Buffer) => { inbound.push(new Uint8Array(chunk)); wakeReader(); });
    connection.on('end', () => { ended = true; wakeReader(); });
    connection.on('close', () => { ended = true; wakeReader(); });

    return {
        streamId: `loopback-${port}`,
        remoteEndpointId,
        observedPath: 'relay',
        read: async (maxBytes) => {
            for (;;) {
                if (cancelled) throw new Error('cancelled');
                const head = inbound[0];
                if (head !== undefined) {
                    if (head.length <= maxBytes) {
                        inbound.shift();
                        return { bytes: head, done: false };
                    }
                    inbound[0] = head.subarray(maxBytes);
                    return { bytes: head.subarray(0, maxBytes), done: false };
                }
                if (ended) return { bytes: new Uint8Array(0), done: true };
                await new Promise<void>((resolve) => { wake = resolve; });
            }
        },
        write: async (bytes) => new Promise<void>((resolve, reject) => {
            connection.write(bytes, (error) => (error ? reject(error) : resolve()));
        }),
        finishWrite: async () => { connection.end(); },
        cancel: async () => { cancelled = true; connection.destroy(); wakeReader(); },
        close: async () => { cancelled = true; connection.destroy(); wakeReader(); },
    };
}

async function waitFor<T>(read: () => T | null | undefined | false, label: string): Promise<T> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
        const value = read();
        if (value !== null && value !== undefined && value !== false) return value;
        await new Promise((resolve) => { setTimeout(resolve, 2); });
    }
    throw new Error(`timed out waiting for ${label}`);
}

describe('browserIroh/homeCarrier Engine.IO vertical', () => {
    let httpServer: HttpServer;
    let engine: EngineServer;
    let port = 0;
    const received: string[] = [];

    beforeEach(async () => {
        received.length = 0;
        httpServer = createServer();
        engine = attach(httpServer, { path: '/v1/updates/', transports: ['websocket'] });
        engine.on('connection', (connected) => {
            connected.on('message', (data: string | Buffer) => {
                const packet = typeof data === 'string' ? data : data.toString('utf8');
                received.push(packet);
                // The Engine.IO server has already stripped its own MESSAGE
                // prefix, so this is the namespace CONNECT packet. Answering it
                // the way the real Home does lets the existing connection owner
                // reach its `connect` state.
                if (packet.startsWith('0')) connected.send('0{"sid":"home-side-sid"}');
            });
        });
        await new Promise<void>((resolve) => { httpServer.listen(0, '127.0.0.1', resolve); });
        port = (httpServer.address() as AddressInfo).port;
    });

    afterEach(async () => {
        engine.close();
        await new Promise<void>((resolve) => { httpServer.close(() => { resolve(); }); });
    });

    it('reaches an Engine.IO server through the tunnel carrier and preserves the handshake auth', async () => {
        const requestedUris: string[] = [];
        const carriers: BrowserIrohHomeTunnelWebSocket[] = [];
        const carrierFactory = createBrowserIrohHomeTunnelWebSocketFactory({
            endpointId: HOME_ENDPOINT_ID,
            openStream: () => openLoopbackTunnelStream(port, HOME_ENDPOINT_ID),
        });

        const { transport } = createSyncSocketTransport({
            endpoint: `http://127.0.0.1:${port}`,
            token: 'carrier-token',
            carrier: 'iroh',
            websocketFactory: (uri: string) => {
                requestedUris.push(uri);
                const carrier = carrierFactory(uri);
                carriers.push(carrier);
                return carrier;
            },
        });

        const connectedListener: number[] = [];
        transport.onConnected(() => { connectedListener.push(1); });
        await transport.connect();

        await waitFor(() => connectedListener.length > 0, 'the connection owner to report connected');
        const handshake = received.find((packet) => packet.startsWith('0'));

        expect(requestedUris).toEqual([`ws://127.0.0.1:${port}/v1/updates/?EIO=4&transport=websocket`]);
        expect(handshake).toBeDefined();
        expect(JSON.parse((handshake as string).slice(1))).toMatchObject({
            token: 'carrier-token',
            clientType: 'user-scoped',
            clientPurpose: 'sync',
        });
        expect(transport.isConnected()).toBe(true);
        expect(carriers).toHaveLength(1);
        expect(carriers[0]?.observedPath).toBe('relay');

        await transport.disconnect({ intentional: true });
        await transport.destroy();
        expect(transport.isConnected()).toBe(false);
    }, 30_000);

    it('opens a second carrier when the connection owner reconnects, with no leftover stream', async () => {
        const carriers: BrowserIrohHomeTunnelWebSocket[] = [];
        const carrierFactory = createBrowserIrohHomeTunnelWebSocketFactory({
            endpointId: HOME_ENDPOINT_ID,
            openStream: () => openLoopbackTunnelStream(port, HOME_ENDPOINT_ID),
        });
        const build = () => createSyncSocketTransport({
            endpoint: `http://127.0.0.1:${port}`,
            token: 'carrier-token',
            carrier: 'iroh',
            websocketFactory: (uri: string) => {
                const carrier = carrierFactory(uri);
                carriers.push(carrier);
                return carrier;
            },
        });

        const first = build();
        await first.transport.connect();
        await waitFor(() => first.transport.isConnected(), 'the first connection');
        await first.transport.disconnect({ intentional: true });
        await first.transport.destroy();

        const second = build();
        await second.transport.connect();
        await waitFor(() => second.transport.isConnected(), 'the reconnected connection');

        expect(carriers).toHaveLength(2);
        expect(carriers[0]).not.toBe(carriers[1]);
        expect(received.filter((packet) => packet.startsWith('0'))).toHaveLength(2);

        await second.transport.destroy();
    }, 30_000);

    it('refuses the vertical when the stream authenticates a different EndpointId', async () => {
        const carrierFactory = createBrowserIrohHomeTunnelWebSocketFactory({
            endpointId: HOME_ENDPOINT_ID,
            openStream: () => openLoopbackTunnelStream(port, 'k51endpointimposteraaaaaaaaaaaaaaaaaaaaaaaaaa'),
        });
        const { transport } = createSyncSocketTransport({
            endpoint: `http://127.0.0.1:${port}`,
            token: 'carrier-token',
            carrier: 'iroh',
            websocketFactory: (uri: string) => carrierFactory(uri),
        });

        const errors: unknown[] = [];
        transport.onError((error) => { errors.push(error); });
        await transport.connect();

        await waitFor(() => errors.length > 0, 'a connection error');
        expect(transport.isConnected()).toBe(false);
        expect(received).toHaveLength(0);

        await transport.destroy();
    }, 30_000);
});
