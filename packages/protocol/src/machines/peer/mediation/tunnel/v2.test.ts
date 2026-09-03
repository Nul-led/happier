import { describe, expect, it } from 'vitest';

import {
  decodePeerTcpTunnelBinaryFrameHeaderV2,
  decodePeerTcpTunnelBinaryFrameV2,
  encodePeerTcpTunnelBinaryFrameV2,
  negotiatePeerTcpTunnelEncoding,
  PeerTcpTunnelBinaryFrameHeaderV2Schema,
} from './index';

describe('Peer TCP tunnel V2 encoding', () => {
  it('negotiates binary_frame_v2 ahead of json_base64_v1 when both peers support it', () => {
    expect(negotiatePeerTcpTunnelEncoding({
      clientSupported: ['json_base64_v1', 'binary_frame_v2'],
      serverSupported: ['json_base64_v1', 'binary_frame_v2'],
      allowV1Fallback: true,
    })).toEqual({ ok: true, encoding: 'binary_frame_v2' });
  });

  it('falls back to json_base64_v1 only when fallback is explicitly allowed', () => {
    expect(negotiatePeerTcpTunnelEncoding({
      clientSupported: ['json_base64_v1'],
      serverSupported: ['json_base64_v1', 'binary_frame_v2'],
      allowV1Fallback: true,
    })).toEqual({ ok: true, encoding: 'json_base64_v1' });
    expect(negotiatePeerTcpTunnelEncoding({
      clientSupported: ['json_base64_v1'],
      serverSupported: ['json_base64_v1', 'binary_frame_v2'],
      allowV1Fallback: false,
    })).toEqual({ ok: false, reasonCode: 'encoding_unsupported' });
  });

  it('encodes binary_frame_v2 metadata separately from raw payload bytes', () => {
    const payload = new TextEncoder().encode('hello');
    const encoded = encodePeerTcpTunnelBinaryFrameV2({
      header: {
        version: 2,
        kind: 'data',
        tunnelId: 'tun_1',
        direction: 'client_to_daemon',
        sequence: 0,
        payloadLength: payload.byteLength,
      },
      payload,
    });

    expect(encoded.byteLength).toBeGreaterThan(payload.byteLength);
    const decoded = decodePeerTcpTunnelBinaryFrameV2({
      frame: encoded,
      maxHeaderBytes: 1024,
      maxPayloadBytes: 1024,
    });

    expect(decoded).toEqual({
      ok: true,
      header: {
        version: 2,
        kind: 'data',
        tunnelId: 'tun_1',
        direction: 'client_to_daemon',
        sequence: 0,
        payloadLength: 5,
      },
      payload,
    });
  });

  it('rejects malformed binary_frame_v2 payload lengths and oversized headers', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const encoded = encodePeerTcpTunnelBinaryFrameV2({
      header: {
        version: 2,
        kind: 'data',
        tunnelId: 'tun_1',
        direction: 'client_to_daemon',
        sequence: 0,
        payloadLength: 4,
      },
      payload,
    });

    expect(decodePeerTcpTunnelBinaryFrameV2({
      frame: encoded,
      maxHeaderBytes: 1024,
      maxPayloadBytes: 1024,
    })).toEqual({ ok: false, reasonCode: 'payload_length_mismatch' });
    expect(decodePeerTcpTunnelBinaryFrameV2({
      frame: encoded,
      maxHeaderBytes: 1,
      maxPayloadBytes: 1024,
    })).toEqual({ ok: false, reasonCode: 'header_too_large' });
  });

  it('routes on the bounded header alone before the payload has arrived', () => {
    const payload = new TextEncoder().encode('pcm!');
    const encoded = encodePeerTcpTunnelBinaryFrameV2({
      header: {
        version: 2,
        kind: 'data',
        tunnelId: 'tun_1',
        substreamId: 'application.stream-1',
        direction: 'client_to_daemon',
        sequence: 0,
        payloadLength: payload.byteLength,
      },
      payload,
    });
    const headerOnly = encoded.subarray(0, encoded.byteLength - payload.byteLength);

    // The full decoder cannot admit a frame whose payload has not been received; routing
    // must still be able to select the owning tunnel from the prefix alone.
    expect(decodePeerTcpTunnelBinaryFrameV2({
      frame: headerOnly,
      maxHeaderBytes: 1024,
      maxPayloadBytes: 1024,
    })).toEqual({ ok: false, reasonCode: 'payload_length_mismatch' });

    const routed = decodePeerTcpTunnelBinaryFrameHeaderV2({ frame: headerOnly, maxHeaderBytes: 1024 });
    expect(routed).toMatchObject({
      ok: true,
      header: { tunnelId: 'tun_1', substreamId: 'application.stream-1', payloadLength: 4 },
      payloadOffset: headerOnly.byteLength,
    });
  });

  it('applies the same header magic, bounds, and schema semantics as the full frame decoder', () => {
    const createRaw = (header: string): Uint8Array => {
      const bytes = new TextEncoder().encode(header);
      const frame = new Uint8Array(4 + bytes.byteLength);
      new DataView(frame.buffer).setUint32(0, bytes.byteLength, false);
      frame.set(bytes, 4);
      return frame;
    };
    const validHeader = JSON.stringify({
      version: 2,
      kind: 'data',
      tunnelId: 'tun_1',
      direction: 'client_to_daemon',
      sequence: 0,
      payloadLength: 0,
    });

    const cases: ReadonlyArray<Readonly<{ frame: Uint8Array; maxHeaderBytes: number; reasonCode: string }>> = [
      { frame: new Uint8Array([0, 0, 1]), maxHeaderBytes: 1024, reasonCode: 'frame_too_short' },
      { frame: createRaw(validHeader), maxHeaderBytes: 1, reasonCode: 'header_too_large' },
      { frame: createRaw(validHeader).subarray(0, 6), maxHeaderBytes: 1024, reasonCode: 'header_truncated' },
      { frame: createRaw('{'), maxHeaderBytes: 1024, reasonCode: 'header_json_invalid' },
      { frame: createRaw(''), maxHeaderBytes: 1024, reasonCode: 'header_json_invalid' },
      { frame: createRaw('{}'), maxHeaderBytes: 1024, reasonCode: 'header_invalid' },
      { frame: createRaw(JSON.stringify({ version: 1, kind: 'data', tunnelId: 'tun_1', payloadLength: 0 })), maxHeaderBytes: 1024, reasonCode: 'header_invalid' },
    ];

    for (const testCase of cases) {
      expect(decodePeerTcpTunnelBinaryFrameHeaderV2({
        frame: testCase.frame,
        maxHeaderBytes: testCase.maxHeaderBytes,
      })).toEqual({ ok: false, reasonCode: testCase.reasonCode });
      // One owner decides header admission: the full decoder must reject identically.
      expect(decodePeerTcpTunnelBinaryFrameV2({
        frame: testCase.frame,
        maxHeaderBytes: testCase.maxHeaderBytes,
        maxPayloadBytes: 1024,
      })).toEqual({ ok: false, reasonCode: testCase.reasonCode });
    }

    expect(decodePeerTcpTunnelBinaryFrameHeaderV2({
      frame: createRaw(validHeader),
      maxHeaderBytes: 1024,
    })).toMatchObject({ ok: true, header: { tunnelId: 'tun_1' } });
  });

  it('carries ack, close, and abort metadata in the binary_frame_v2 header', () => {
    expect(PeerTcpTunnelBinaryFrameHeaderV2Schema.parse({
      version: 2,
      kind: 'ack',
      tunnelId: 'tun_1',
      direction: 'daemon_to_client',
      ack: 64,
      window: 1024,
      payloadLength: 0,
    }).ack).toBe(64);

    expect(PeerTcpTunnelBinaryFrameHeaderV2Schema.parse({
      version: 2,
      kind: 'close',
      tunnelId: 'tun_1',
      direction: 'client_to_daemon',
      halfClose: true,
      reasonCode: 'client_half_closed',
      payloadLength: 0,
    }).halfClose).toBe(true);

    expect(PeerTcpTunnelBinaryFrameHeaderV2Schema.parse({
      version: 2,
      kind: 'abort',
      tunnelId: 'tun_1',
      reasonCode: 'relay_cap_exceeded',
      payloadLength: 0,
    }).reasonCode).toBe('relay_cap_exceeded');
  });
});
