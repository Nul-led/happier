import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { connectPeerTcpTunnelTcp } from './open';
import { createPeerTcpTunnelStreamSession, type PeerTcpTunnelFrame } from './frames';

describe('TCP tunnel connection lifecycle', () => {
    it('drains upstream bytes before EOF and keeps the reverse half usable until both halves close', async () => {
        const server = createServer({ allowHalfOpen: true });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('TCP fixture did not listen');
        const accepted = once(server, 'connection') as Promise<[Socket]>;
        const connection = await connectPeerTcpTunnelTcp({ host: '127.0.0.1', port: address.port });
        const [peer] = await accepted;
        const frames: PeerTcpTunnelFrame[] = [];
        let closed = false;
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'tcp_eof', initialWindowBytes: 2, maxFrameBytes: 1024,
            connection,
            sendFrame: (frame) => { frames.push(frame); },
            onClosed: () => { closed = true; },
        });
        try {
            peer.end(Buffer.from([0, 1, 2, 255]));
            await expect.poll(() => frames.filter((frame) => frame.kind === 'data').length).toBe(1);
            expect(frames.some((frame) => frame.kind === 'close')).toBe(false);
            await session.acceptFrame({ v: 1, kind: 'ack', tunnelId: 'tcp_eof',
                direction: 'daemon_to_client', nextSequence: 2, windowBytes: 2 });
            await expect.poll(() => frames.some((frame) => frame.kind === 'close')).toBe(true);
            expect(frames.filter((frame) => frame.kind === 'data').flatMap((frame) => [...frame.payload]))
                .toEqual([0, 1, 2, 255]);
            expect(frames.at(-1)).toMatchObject({ kind: 'close', halfClose: true, direction: 'daemon_to_client' });
            expect(closed).toBe(false);
            const received = once(peer, 'data') as Promise<[Buffer]>;
            await expect(session.acceptFrame({ v: 1, kind: 'data', tunnelId: 'tcp_eof',
                direction: 'client_to_daemon', sequence: 0, payload: new Uint8Array([7]) })).resolves.toEqual({ ok: true });
            expect((await received)[0]).toEqual(Buffer.from([7]));
            await session.acceptFrame({ v: 1, kind: 'close', tunnelId: 'tcp_eof',
                halfClose: true, direction: 'client_to_daemon', reasonCode: 'request_complete' });
            await expect.poll(() => closed).toBe(true);
            await expect(session.write(new Uint8Array([8]))).resolves.toEqual({ ok: false, reasonCode: 'tunnel_closed' });
        } finally {
            await session.close();
            peer.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('propagates a real upstream reset as an abort and releases pending writes', async () => {
        const server = createServer();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('TCP fixture did not listen');
        const accepted = once(server, 'connection') as Promise<[Socket]>;
        const connection = await connectPeerTcpTunnelTcp({ host: '127.0.0.1', port: address.port });
        const [peer] = await accepted;
        const frames: PeerTcpTunnelFrame[] = [];
        let closed = false;
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'tcp_reset', initialWindowBytes: 1, maxFrameBytes: 1024,
            connection,
            sendFrame: (frame) => { frames.push(frame); },
            onClosed: () => { closed = true; },
        });
        try {
            const pending = session.write(new Uint8Array([1, 2]));
            peer.resetAndDestroy();
            await expect.poll(() => closed).toBe(true);
            expect(frames.filter((frame) => frame.kind === 'abort')).toEqual([
                expect.objectContaining({ reasonCode: 'connection_read_failed' }),
            ]);
            await expect(pending).resolves.toEqual({ ok: false, reasonCode: 'connection_read_failed' });
        } finally {
            await session.close();
            peer.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
