import { describe, expect, it, vi } from 'vitest';

import { createPeerTcpTunnelStreamSession } from './streamSession.js';

describe('client-side duplex stream session', () => {
    it('terminalizes a rejected sink write, settles queued writers, and emits one typed abort', async () => {
        const close = vi.fn(async () => undefined);
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 1,
            maxFrameBytes: 1024,
            connection: {
                write: async () => {
                    throw new Error('sink write failed');
                },
                close,
            },
            sendFrame: (frame) => {
                sent.push(frame);
                if (frame.kind === 'data') return new Promise<void>(() => undefined);
            },
        });

        const activeWrite = session.write(new Uint8Array([1]));
        const queuedWrite = session.write(new Uint8Array([2]));

        await expect(session.acceptFrame({
            v: 1,
            kind: 'data',
            tunnelId: 'preview_tunnel',
            direction: 'daemon_to_client',
            sequence: 0,
            payload: new Uint8Array([9]),
        })).resolves.toEqual({ ok: false, reasonCode: 'connection_write_failed' });
        await expect(activeWrite).resolves.toEqual({ ok: false, reasonCode: 'connection_write_failed' });
        await expect(queuedWrite).resolves.toEqual({ ok: false, reasonCode: 'connection_write_failed' });
        expect(close).toHaveBeenCalledOnce();
        expect(sent.filter((frame) => (
            typeof frame === 'object'
            && frame !== null
            && 'kind' in frame
            && frame.kind === 'abort'
        ))).toEqual([{
            v: 1,
            kind: 'abort',
            tunnelId: 'preview_tunnel',
            reasonCode: 'connection_write_failed',
        }]);
    });

    it('terminalizes a rejected sink half-close and emits one typed abort', async () => {
        const close = vi.fn(async () => undefined);
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: {
                endWrite: async () => {
                    throw new Error('sink half-close failed');
                },
                close,
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
        })).resolves.toEqual({ ok: false, reasonCode: 'connection_write_failed' });
        expect(close).toHaveBeenCalledOnce();
        expect(sent).toEqual([{
            v: 1,
            kind: 'abort',
            tunnelId: 'preview_tunnel',
            reasonCode: 'connection_write_failed',
        }]);
    });

    it('settles the active and queued writes when sending a data frame fails', async () => {
        let rejectSend: ((error: Error) => void) | undefined;
        const close = vi.fn(async () => undefined);
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: { close },
            sendFrame: () => new Promise<void>((_resolve, reject) => {
                rejectSend = reject;
            }),
        });

        const firstWrite = session.write(new Uint8Array([1]));
        const queuedWrite = session.write(new Uint8Array([2]));
        rejectSend?.(new Error('send failed'));

        await expect(firstWrite).resolves.toEqual({ ok: false, reasonCode: 'frame_send_failed' });
        await expect(queuedWrite).resolves.toEqual({ ok: false, reasonCode: 'frame_send_failed' });
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes locally when abort or terminate notification fails', async () => {
        const abortClose = vi.fn(async () => undefined);
        const abortSession = createPeerTcpTunnelStreamSession({
            tunnelId: 'abort_tunnel',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: { close: abortClose },
            sendFrame: async () => {
                throw new Error('abort send failed');
            },
        });

        await expect(abortSession.abort('local_abort')).rejects.toThrow('abort send failed');
        expect(abortClose).toHaveBeenCalledOnce();
        await expect(abortSession.write(new Uint8Array([1]))).resolves.toEqual({
            ok: false,
            reasonCode: 'tunnel_closed',
        });

        const terminateClose = vi.fn(async () => undefined);
        const terminateSession = createPeerTcpTunnelStreamSession({
            tunnelId: 'terminate_tunnel',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: { close: terminateClose },
            sendFrame: async () => {
                throw new Error('close send failed');
            },
        });

        await expect(terminateSession.terminate('local_close')).rejects.toThrow('close send failed');
        expect(terminateClose).toHaveBeenCalledOnce();
        await expect(terminateSession.write(new Uint8Array([1]))).resolves.toEqual({
            ok: false,
            reasonCode: 'tunnel_closed',
        });
    });

    it('makes every locally emitted abort terminal even if peer notification fails', async () => {
        const close = vi.fn(async () => undefined);
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            initialWindowBytes: 16,
            maxFrameBytes: 1024,
            connection: { close },
            sendFrame: async () => {
                throw new Error('abort send failed');
            },
        });

        await expect(session.acceptFrame({ invalid: true })).resolves.toEqual({
            ok: false,
            reasonCode: 'frame_invalid',
        });
        expect(close).toHaveBeenCalledOnce();
        await expect(session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 0,
            windowBytes: 16,
        })).resolves.toEqual({ ok: false, reasonCode: 'tunnel_closed' });
    });

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

    it('flushes data already waiting for ACK credit before emitting the local half-close', async () => {
        const sent: Array<{ kind?: unknown; payload?: Uint8Array }> = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 1,
            maxFrameBytes: 1024,
            connection: { close: async () => undefined },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        const write = session.write(new Uint8Array([1, 2]));
        const endWrite = session.endWrite('request_complete');

        await expect(session.write(new Uint8Array([3]))).resolves.toEqual({
            ok: false,
            reasonCode: 'direction_half_closed',
        });
        expect(sent.map((frame) => frame.kind)).toEqual(['data']);

        await session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 1,
            windowBytes: 1,
        });

        await expect(write).resolves.toEqual({ ok: true });
        await expect(endWrite).resolves.toEqual({ ok: true });
        expect(sent.map((frame) => frame.kind)).toEqual(['data', 'data', 'close']);
        expect(sent[1]?.payload).toEqual(new Uint8Array([2]));
    });

    it('does not strand a half-close requested while the final drain is resuming reads', async () => {
        const sent: Array<{ kind?: unknown }> = [];
        let pauseStarted!: () => void;
        let resumeStarted!: () => void;
        let finishResume!: () => void;
        const pauseStartedPromise = new Promise<void>((resolve) => { pauseStarted = resolve; });
        const resumeStartedPromise = new Promise<void>((resolve) => { resumeStarted = resolve; });
        const finishResumePromise = new Promise<void>((resolve) => { finishResume = resolve; });
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 1,
            maxFrameBytes: 1024,
            connection: {
                close: async () => undefined,
                pauseRead: async () => { pauseStarted(); },
                resumeRead: async () => {
                    resumeStarted();
                    await finishResumePromise;
                },
            },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        const write = session.write(new Uint8Array([1, 2]));
        await pauseStartedPromise;
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        const ack = session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 1,
            windowBytes: 1,
        });
        await resumeStartedPromise;
        const endWrite = session.endWrite('request_complete');
        finishResume();
        await ack;
        await Promise.resolve();

        expect(sent.map((frame) => frame.kind)).toEqual(['data', 'data', 'close']);
        await expect(write).resolves.toEqual({ ok: true });
        await expect(endWrite).resolves.toEqual({ ok: true });
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
        })).resolves.toEqual({ ok: false, reasonCode: 'tunnel_closed' });
    });

    it('rejects ACK credit above the configured session maximum', async () => {
        const close = vi.fn(async () => undefined);
        const sent: unknown[] = [];
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: 'preview_tunnel',
            outboundDirection: 'client_to_daemon',
            initialWindowBytes: 3,
            maxFrameBytes: 1024,
            connection: { close },
            sendFrame: async (frame) => {
                sent.push(frame);
            },
        });

        await session.write(new Uint8Array([1, 2, 3]));
        await expect(session.acceptFrame({
            v: 1,
            kind: 'ack',
            tunnelId: 'preview_tunnel',
            direction: 'client_to_daemon',
            nextSequence: 3,
            windowBytes: 4,
        })).resolves.toEqual({ ok: false, reasonCode: 'ack_window_invalid' });
        expect(close).toHaveBeenCalledOnce();
        expect(sent).toContainEqual({
            v: 1,
            kind: 'abort',
            tunnelId: 'preview_tunnel',
            reasonCode: 'ack_window_invalid',
        });
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
