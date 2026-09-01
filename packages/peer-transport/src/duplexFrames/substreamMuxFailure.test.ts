import { describe, expect, it, vi } from 'vitest';
import { encodePeerTcpTunnelBinaryFrameV2 } from '@happier-dev/protocol';

import {
    encodePeerTcpTunnelBinaryFrameForSubstream,
    encodePeerTcpTunnelBinarySubstreamOpen,
} from './binaryCodec.js';
import { createPeerTcpTunnelSubstreamMuxSession } from './substreamMux.js';

describe('substream mux terminal cleanup', () => {
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
