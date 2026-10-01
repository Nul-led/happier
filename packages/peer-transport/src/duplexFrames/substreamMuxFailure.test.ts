import { describe, expect, it, vi } from 'vitest';
import { encodePeerTcpTunnelBinaryFrameV2 } from '@happier-dev/protocol';
import { DEFAULT_MACHINE_TUNNEL_SUBSTREAM_CAPABILITIES } from '../../../protocol/src/features/payload/capabilities/machineTunnelCapabilities.js';

import {
    encodePeerTcpTunnelBinaryFrameForSubstream,
    encodePeerTcpTunnelBinarySubstreamOpen,
} from './binaryCodec.js';
import { createPeerTcpTunnelSubstreamMuxSession } from './substreamMux.js';

describe('substream mux terminal cleanup', () => {
    it('applies the existing receive window while a child TCP connection is pending and releases queued data on close', async () => {
        let finishConnect!: (connection: { write: (bytes: Uint8Array) => void; close: () => void }) => void;
        const close = vi.fn();
        const write = vi.fn();
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'pending_window', destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 4, maxFrameBytes: 4, maxBinaryHeaderBytes: 1024, maxRawPayloadBytes: 4,
            caps: { maxConcurrentSubstreams: 1 },
            connectTcp: () => new Promise((resolve) => { finishConnect = resolve; }),
            sendBinaryFrame: async () => undefined,
        });
        const opening = mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({ tunnelId: 'pending_window', substreamId: 'pending' }));
        const data = (sequence: number, payload: Uint8Array) => encodePeerTcpTunnelBinaryFrameV2({
            header: { version: 2, kind: 'data', tunnelId: 'pending_window', substreamId: 'pending',
                direction: 'client_to_daemon', sequence, payloadLength: payload.byteLength }, payload,
        });
        const queued = mux.acceptBinaryFrame(data(0, new Uint8Array([1, 2, 3])));
        await expect(mux.acceptBinaryFrame(data(3, new Uint8Array([4, 5])))).resolves.toMatchObject({
            ok: false, reasonCode: 'receive_window_exceeded', substreamId: 'pending',
        });
        await mux.close();
        await expect(queued).resolves.toMatchObject({ ok: false });
        finishConnect({ write, close });
        await expect(opening).resolves.toMatchObject({ ok: false });
        expect(write).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
    });

    it('keeps the default consumer session usable after idle and repeated completed substreams', async () => {
        let now = 0;
        let deliveredBytes = 0;
        const payload = new Uint8Array(64 * 1024);
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_lifetime',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: payload.byteLength,
            maxFrameBytes: payload.byteLength,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: payload.byteLength,
            caps: DEFAULT_MACHINE_TUNNEL_SUBSTREAM_CAPABILITIES,
            nowMs: () => now,
            connectTcp: async () => ({
                write: async (bytes) => { deliveredBytes += bytes.byteLength; },
                close: async () => undefined,
            }),
            sendBinaryFrame: async () => undefined,
        });
        try {
            for (let i = 0; i < 1025; i++) {
                now += 300_001;
                const substreamId = `sub_${i}`;
                expect(await mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
                    tunnelId: 'tun_lifetime', substreamId,
                }))).toEqual({ ok: true });
                expect(await mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameV2({
                    header: {
                        version: 2, kind: 'data', tunnelId: 'tun_lifetime', substreamId,
                        direction: 'client_to_daemon', sequence: 0, payloadLength: payload.byteLength,
                    },
                    payload,
                }))).toEqual({ ok: true });
                expect(await mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameV2({ header: {
                    version: 2, kind: 'close', tunnelId: 'tun_lifetime', substreamId,
                    halfClose: false, reasonCode: 'complete', payloadLength: 0,
                } }))).toEqual({ ok: true });
            }
            expect(deliveredBytes).toBe(1025 * payload.byteLength);
        } finally {
            await mux.close();
        }
    });

    it('reserves a pending substream id before awaiting TCP connection', async () => {
        let finishFirstConnect!: (connection: { close: () => Promise<void> }) => void;
        const firstClose = vi.fn(async () => undefined);
        const secondClose = vi.fn(async () => undefined);
        const connectTcp = vi.fn()
            .mockImplementationOnce(async () => await new Promise((resolve) => {
                finishFirstConnect = resolve;
            }))
            .mockImplementationOnce(async () => ({ close: secondClose }));
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 2,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp,
            sendBinaryFrame: async () => undefined,
        });
        const open = encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_pending',
        });

        const first = mux.acceptBinaryFrame(open);
        await vi.waitFor(() => expect(connectTcp).toHaveBeenCalledTimes(1));
        const duplicate = mux.acceptBinaryFrame(open);
        finishFirstConnect({ close: firstClose });

        await expect(first).resolves.toEqual({ ok: true });
        await expect(duplicate).resolves.toEqual({
            ok: false,
            reasonCode: 'substream_id_already_open',
            substreamId: 'sub_pending',
        });
        expect(connectTcp).toHaveBeenCalledTimes(1);
        expect(secondClose).not.toHaveBeenCalled();
        await mux.close();
        expect(firstClose).toHaveBeenCalledOnce();
    });

    it('counts pending TCP connections against concurrent substream capacity', async () => {
        let finishFirstConnect!: (connection: { close: () => Promise<void> }) => void;
        const firstClose = vi.fn(async () => undefined);
        const connectTcp = vi.fn()
            .mockImplementationOnce(async () => await new Promise((resolve) => {
                finishFirstConnect = resolve;
            }))
            .mockImplementationOnce(async () => ({ close: vi.fn(async () => undefined) }));
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 2,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp,
            sendBinaryFrame: async () => undefined,
        });

        const first = mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_pending_1',
        }));
        await vi.waitFor(() => expect(connectTcp).toHaveBeenCalledTimes(1));
        const overCapacity = mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_pending_2',
        }));
        finishFirstConnect({ close: firstClose });

        await expect(first).resolves.toEqual({ ok: true });
        await expect(overCapacity).resolves.toEqual({
            ok: false,
            reasonCode: 'substream_cap_exceeded',
            substreamId: 'sub_pending_2',
        });
        expect(connectTcp).toHaveBeenCalledTimes(1);
        await mux.close();
        expect(firstClose).toHaveBeenCalledOnce();
    });

    it('retires pending reservations after connect failure and successful publication', async () => {
        const close = vi.fn(async () => undefined);
        const connectTcp = vi.fn()
            .mockRejectedValueOnce(new Error('connect failed'))
            .mockResolvedValue({ close });
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 2,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp,
            sendBinaryFrame: async () => undefined,
        });
        const open = encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_retry',
        });

        await expect(mux.acceptBinaryFrame(open)).resolves.toEqual({
            ok: false,
            reasonCode: 'tcp_connect_failed',
            substreamId: 'sub_retry',
        });
        await expect(mux.acceptBinaryFrame(open)).resolves.toEqual({ ok: true });
        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameForSubstream({
            substreamId: 'sub_retry',
            frame: {
                v: 1,
                kind: 'close',
                tunnelId: 'tun_mux',
                halfClose: false,
                reasonCode: 'complete',
            },
        }))).resolves.toEqual({ ok: true });
        await expect(mux.acceptBinaryFrame(open)).resolves.toEqual({ ok: true });
        expect(connectTcp).toHaveBeenCalledTimes(3);
        await mux.close();
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('terminalizes the frame session when the mux closes an active substream', async () => {
        let outboundHandler: ((bytes: Uint8Array) => Promise<void> | void) | undefined;
        const detach = vi.fn();
        const close = vi.fn(async () => undefined);
        const sent: Uint8Array[] = [];
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 2,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 2,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 1,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({
                close,
                onData: (handler) => {
                    outboundHandler = handler;
                    return detach;
                },
            }),
            sendBinaryFrame: async (frame) => { sent.push(frame); },
        });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_active',
        }))).resolves.toEqual({ ok: true });
        if (!outboundHandler) throw new Error('Outbound producer was not attached');
        await outboundHandler(new Uint8Array([1]));
        expect(sent).toHaveLength(1);

        await mux.close();

        expect(detach).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        await outboundHandler(new Uint8Array([2]));
        expect(sent).toHaveLength(1);
        await mux.close();
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes a TCP connection acquired after the mux closes without publishing the substream', async () => {
        let finishConnect!: (connection: { close: () => Promise<void> }) => void;
        const close = vi.fn(async () => undefined);
        const sendBinaryFrame = vi.fn(async () => undefined);
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 1,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => await new Promise((resolve) => {
                finishConnect = resolve;
            }),
            sendBinaryFrame,
        });

        const opening = mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_late',
        }));
        await vi.waitFor(() => expect(finishConnect).toBeTypeOf('function'));
        await mux.close();
        finishConnect({ close });

        await expect(opening).resolves.toEqual({
            ok: false,
            reasonCode: 'tunnel_closed',
            substreamId: 'sub_late',
        });
        expect(close).toHaveBeenCalledOnce();
        expect(sendBinaryFrame).not.toHaveBeenCalled();
    });

    it('releases a failed outbound substream before admitting the next one', async () => {
        const close = vi.fn(async () => undefined);
        const outboundHandlers: Array<(bytes: Uint8Array) => Promise<void> | void> = [];
        let carrierSends = 0;
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 2,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 32,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({
                close,
                onData: (handler) => {
                    outboundHandlers.push(handler);
                },
            }),
            sendBinaryFrame: async () => {
                carrierSends += 1;
                if (carrierSends === 1) throw new Error('carrier unavailable');
            },
        });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_1',
        }))).resolves.toEqual({ ok: true });
        await outboundHandlers[0]?.(new Uint8Array([1]));

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_2',
        }))).resolves.toEqual({ ok: true });
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes the exact local substream even when its abort notification fails', async () => {
        const close = vi.fn(async () => undefined);
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 1,
                maxBytesPerSubstream: 1,
                maxAggregateBytes: 1,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({ close }),
            sendBinaryFrame: async () => {
                throw new Error('abort send failed');
            },
        });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_1',
        }))).resolves.toEqual({ ok: true });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameForSubstream({
            substreamId: 'sub_1',
            frame: {
                v: 1,
                kind: 'data',
                tunnelId: 'tun_mux',
                direction: 'client_to_daemon',
                sequence: 0,
                payload: new Uint8Array([1, 2]),
            },
        }))).rejects.toThrow('abort send failed');
        expect(close).toHaveBeenCalledOnce();
    });

    it('makes a locally emitted duplicate-open ABORT terminal for the existing substream', async () => {
        const close = vi.fn(async () => undefined);
        const sent: Uint8Array[] = [];
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 2,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({ close }),
            sendBinaryFrame: async (frame) => { sent.push(frame); },
        });
        const open = encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_1',
        });

        await expect(mux.acceptBinaryFrame(open)).resolves.toEqual({ ok: true });
        await expect(mux.acceptBinaryFrame(open)).resolves.toEqual({
            ok: false,
            reasonCode: 'substream_id_already_open',
            substreamId: 'sub_1',
        });
        expect(sent).toHaveLength(1);
        expect(close).toHaveBeenCalledOnce();
    });

    it('makes a locally emitted invalid-frame ABORT terminal for its identified substream', async () => {
        const close = vi.fn(async () => undefined);
        const sent: Uint8Array[] = [];
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_mux',
            destination: { host: '127.0.0.1', port: 3210 },
            initialWindowBytes: 16,
            maxFrameBytes: 16,
            maxBinaryHeaderBytes: 1024,
            maxRawPayloadBytes: 16,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 1,
                maxBytesPerSubstream: 16,
                maxAggregateBytes: 16,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({ close }),
            sendBinaryFrame: async (frame) => { sent.push(frame); },
        });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinarySubstreamOpen({
            tunnelId: 'tun_mux',
            substreamId: 'sub_1',
        }))).resolves.toEqual({ ok: true });
        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameV2({
            header: {
                version: 2,
                kind: 'data',
                tunnelId: 'tun_mux',
                substreamId: 'sub_1',
                payloadLength: 0,
            },
        }))).resolves.toEqual({
            ok: false,
            reasonCode: 'frame_invalid',
            substreamId: 'sub_1',
        });
        expect(sent).toHaveLength(1);
        expect(close).toHaveBeenCalledOnce();
    });
});
