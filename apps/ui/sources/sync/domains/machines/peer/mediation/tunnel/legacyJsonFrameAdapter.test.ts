import { describe, expect, it } from 'vitest';

import {
    decodeLegacyJsonPeerTcpTunnelFrame,
    encodeLegacyJsonPeerTcpTunnelFrame,
} from '@happier-dev/peer-transport/duplexFrames';

describe('legacy JSON tunnel frame adapter', () => {
    it('keeps base64 at the V1 wire boundary while preserving exact data bytes', () => {
        const encoded = encodeLegacyJsonPeerTcpTunnelFrame({
            v: 1,
            kind: 'data',
            tunnelId: 'tun_1',
            direction: 'client_to_daemon',
            sequence: 7,
            payload: new Uint8Array([0, 255, 128, 1]),
        });

        expect(JSON.parse(encoded)).toMatchObject({
            kind: 'data',
            payloadBase64: 'AP+AAQ==',
        });
        expect(decodeLegacyJsonPeerTcpTunnelFrame(encoded)).toEqual({
            v: 1,
            kind: 'data',
            tunnelId: 'tun_1',
            direction: 'client_to_daemon',
            sequence: 7,
            payload: new Uint8Array([0, 255, 128, 1]),
        });
    });

    it('rejects malformed JSON instead of leaking a boundary exception', () => {
        expect(decodeLegacyJsonPeerTcpTunnelFrame('{')).toBeNull();
    });
});
