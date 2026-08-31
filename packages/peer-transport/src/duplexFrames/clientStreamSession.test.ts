import { describe, expect, it, vi } from 'vitest';

import { createPeerTcpTunnelStreamSession } from './streamSession.js';

describe('client-side duplex stream session', () => {
    it('keeps directional half-closes independent and rejects writes after the local write half closes', async () => {
        const endWrite = vi.fn();
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: {
                endWrite,
                close: async () => undefined,
            },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        await expect(session.acceptFrame({
            v: 1,
            kind: 'close',
            tunnelId: 'preview_tunnel',
            direction: 'daemon_to_client',
            halfClose: true,
            reasonCode: 'response_complete',
        })).resolves.toEqual({ ok: true });
        expect(endWrite).toHaveBeenCalledOnce();

        await session.write(new TextEncoder().encode('request tail'));
        expect(sent).toContainEqual(expect.objectContaining({
            kind: 'data',
            direction: 'client_to_daemon',
        }));

        await expect(session.endWrite('request_complete')).resolves.toEqual({ ok: true });
        await expect(session.write(new TextEncoder().encode('late'))).resolves.toEqual({
            ok: false,
            reasonCode: 'direction_half_closed',
        });
    });

    it('rejects regressive and beyond-sent ACKs at the shared owner', async () => {
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: {
                close: async () => undefined,
            },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        await session.write(new Uint8Array([0, 255, 1]));
        await expect(session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 3,
            windowBytes: 16,
        })).resolves.toEqual({ ok: true });
        await expect(session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 2,
            windowBytes: 16,
        })).resolves.toEqual({ ok: false, reasonCode: 'ack_sequence_invalid' });
        await expect(session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 4,
            windowBytes: 16,
        })).resolves.toEqual({ ok: false, reasonCode: 'ack_sequence_invalid' });
    });

    it('preserves exact bytes, enforces credit, and propagates abort', async () => {
        const writes: Uint8Array[] = [];
        const close = vi.fn();
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 3,
            maxFrameBytes: 1024,
            connection: {
                write: async (bytes) => {
                    writes.push(bytes);
                },
                close,
            },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        const pendingWrite = session.write(new Uint8Array([0, 255, 1, 2]));
        expect(sent).toContainEqual(expect.objectContaining({
            kind: 'data',
            payload: new Uint8Array([0, 255, 1]),
        }));
        expect(sent).not.toContainEqual(expect.objectContaining({
            kind: 'data',
            payload: new Uint8Array([2]),
        }));

        await session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 3,
            windowBytes: 3,
        });
        await expect(pendingWrite).resolves.toEqual({ ok: true });
        expect(sent).toContainEqual(expect.objectContaining({
            kind: 'data',
            payload: new Uint8Array([2]),
        }));

        await session.acceptFrame({
            v: 1,
            kind: 'data',
            tunnelId: 'preview_tunnel',
            direction: 'daemon_to_client',
            sequence: 0,
            payload: new Uint8Array([9, 0, 255]),
        });
        expect(writes).toEqual([new Uint8Array([9, 0, 255])]);

        await session.acceptFrame({
            v: 1,
            kind: 'abort',
            tunnelId: 'preview_tunnel',
            reasonCode: 'remote_abort',
        });
        expect(close).toHaveBeenCalledOnce();
    });
});
