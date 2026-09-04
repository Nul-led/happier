import { describe, expect, it } from 'vitest';
import { HOME_TUNNEL_ALPN, TUNNEL_PREAMBLE, parseIrohEndpointDescriptor } from './descriptor';

describe('Iroh endpoint descriptor (native adapter over the canonical protocol definition)', () => {
  it('accepts the strict transport-only shape', () => {
    expect(parseIrohEndpointDescriptor({
      endpointId: 'a'.repeat(64),
      relayUrls: ['https://relay.example'],
      directAddresses: ['127.0.0.1:1234'],
    })).toEqual({
      endpointId: 'a'.repeat(64),
      relayUrls: ['https://relay.example'],
      directAddresses: ['127.0.0.1:1234'],
    });
  });

  it('rejects credentials, destinations, and unknown fields', () => {
    expect(() => parseIrohEndpointDescriptor({ endpointId: 'a'.repeat(64), token: 'secret' })).toThrow();
    expect(() => parseIrohEndpointDescriptor({ endpointId: 'a'.repeat(64), port: 80 })).toThrow();
    expect(() => parseIrohEndpointDescriptor({ endpointId: 'a'.repeat(64), extra: true })).toThrow();
  });

  it('honors the shared protocol grammar without a second item-count policy', () => {
    expect(parseIrohEndpointDescriptor({
      endpointId: 'a'.repeat(64),
      directAddresses: Array.from({ length: 17 }, (_, index) => `192.0.2.${index + 1}:443`),
    }).directAddresses).toHaveLength(17);
    expect(parseIrohEndpointDescriptor({
      endpointId: 'a'.repeat(64),
      relayUrls: Array.from({ length: 9 }, (_, index) => `https://relay-${index}.example`),
    }).relayUrls).toHaveLength(9);
    expect(() => parseIrohEndpointDescriptor({
      endpointId: 'a'.repeat(64),
      relayUrls: ['https://user:pass@relay.example'],
    })).toThrow();
  });

  it('publishes the locked ALPN and preamble', () => {
    expect(HOME_TUNNEL_ALPN).toBe('happier/home-tunnel/1');
    expect(TUNNEL_PREAMBLE).toBe(0x01);
  });
});
