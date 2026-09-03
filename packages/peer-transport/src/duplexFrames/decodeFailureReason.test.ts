import { encodePeerTcpTunnelBinaryFrameV2 } from '@happier-dev/protocol';
import type { PeerTcpTunnelBinaryFrameDecodeFailureReasonV2 } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { peerTcpTunnelBinaryDecodeFailureReason } from './binaryCodec';
import { createPeerTcpTunnelSubstreamMuxSession } from './substreamMux';

/**
 * Transport policy owns exactly one translation from a protocol V2 decode failure to a
 * tunnel admission denial. Every admitting seam — mux, application substreams, session
 * codec, and the CLI relay/route admission callers — routes through this function.
 */
describe('peerTcpTunnelBinaryDecodeFailureReason', () => {
    it('maps every protocol decode failure to a stable admission denial', () => {
        const expected: Readonly<Record<
            PeerTcpTunnelBinaryFrameDecodeFailureReasonV2,
            'encoded_frame_too_large' | 'decoded_payload_too_large' | 'frame_invalid'
        >> = {
            frame_too_short: 'frame_invalid',
            header_too_large: 'encoded_frame_too_large',
            header_truncated: 'frame_invalid',
            header_json_invalid: 'frame_invalid',
            header_invalid: 'frame_invalid',
            payload_too_large: 'decoded_payload_too_large',
            payload_length_mismatch: 'frame_invalid',
        };

        for (const [reasonCode, denial] of Object.entries(expected)) {
            expect(peerTcpTunnelBinaryDecodeFailureReason(
                reasonCode as PeerTcpTunnelBinaryFrameDecodeFailureReasonV2,
            )).toBe(denial);
        }
    });

    it('is the denial the substream mux reports for an oversized encoded header', async () => {
        const mux = createPeerTcpTunnelSubstreamMuxSession({
            tunnelId: 'tun_1',
            destination: { host: '127.0.0.1', port: 1234 },
            initialWindowBytes: 1024,
            maxFrameBytes: 1024,
            maxBinaryHeaderBytes: 1,
            maxRawPayloadBytes: 1024,
            caps: {
                maxConcurrentSubstreams: 1,
                maxTotalSubstreams: 1,
                maxBytesPerSubstream: 1024,
                maxAggregateBytes: 1024,
                maxSubstreamIdleMs: Number.MAX_SAFE_INTEGER,
                maxSessionIdleMs: Number.MAX_SAFE_INTEGER,
            },
            connectTcp: async () => ({ close: () => undefined }),
            sendBinaryFrame: () => undefined,
        });

        await expect(mux.acceptBinaryFrame(encodePeerTcpTunnelBinaryFrameV2({
            header: {
                version: 2,
                kind: 'data',
                tunnelId: 'tun_1',
                substreamId: 'application.stream-1',
                direction: 'client_to_daemon',
                sequence: 0,
                payloadLength: 0,
            },
        }))).resolves.toEqual({
            ok: false,
            reasonCode: peerTcpTunnelBinaryDecodeFailureReason('header_too_large'),
        });
    });
});
