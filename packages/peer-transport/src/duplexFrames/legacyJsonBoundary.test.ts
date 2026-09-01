import { describe, expect, it } from 'vitest';

import {
    decodeLegacyJsonPeerTcpTunnelFrame,
    encodeLegacyJsonPeerTcpTunnelFrame,
    parseLegacyJsonPeerTcpTunnelFrame,
    toLegacyJsonPeerTcpTunnelFrame,
} from './legacyJsonAdapter.js';

describe('legacy json_base64_v1 boundary', () => {
    it('preserves the existing JSON/base64 wire while the canonical frame stays binary', () => {
        const frame = {
            v: 1 as const,
            kind: 'data' as const,
            tunnelId: 'tun_legacy',
            direction: 'client_to_daemon' as const,
            sequence: 3,
            payload: new Uint8Array([0, 255, 1, 2]),
        };

        const legacy = toLegacyJsonPeerTcpTunnelFrame(frame);
        expect(legacy).toEqual({
            v: 1,
            kind: 'data',
            tunnelId: 'tun_legacy',
            direction: 'client_to_daemon',
            sequence: 3,
            payloadBase64: 'AP8BAg==',
        });
        expect(parseLegacyJsonPeerTcpTunnelFrame(legacy)).toEqual(frame);
        expect(decodeLegacyJsonPeerTcpTunnelFrame(encodeLegacyJsonPeerTcpTunnelFrame(frame))).toEqual(frame);
    });

    it('rejects the legacy open envelope at the frame boundary', () => {
        expect(parseLegacyJsonPeerTcpTunnelFrame({
            v: 1,
            kind: 'open',
            open: { invalid: true },
        })).toBeNull();
    });
});
