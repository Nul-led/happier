import { describe, expect, it } from 'vitest';

type TunnelV1Module = typeof import('./v1');

async function loadTunnelV1Module(): Promise<TunnelV1Module | null> {
  const modulePath = './v1.js';
  return import(modulePath).catch(() => null) as Promise<TunnelV1Module | null>;
}

describe('peer TCP tunnel v1 protocol', () => {
  it('parses binary open responses and rejects JSON/base64 data frames', async () => {
    const mod = await loadTunnelV1Module();

    expect(mod?.PeerTcpTunnelOpenResponseV1Schema.safeParse({
      v: 1,
      tunnelId: 'tun_1',
      streamPath: '/peer-mediation/v1/tunnel/stream',
      encoding: 'binary_frame_v2',
      initialWindowBytes: 1024 * 1024,
      maxFrameBytes: 64 * 1024,
    }).success).toBe(true);

    expect(mod?.PeerTcpTunnelFrameV1Schema.safeParse({
      v: 1,
      kind: 'data',
      tunnelId: 'tun_1',
      direction: 'client_to_daemon',
      sequence: 0,
      payloadBase64: Buffer.from('hello').toString('base64'),
    }).success).toBe(false);
  });

  it('requires structured reason codes on close frames', async () => {
    const mod = await loadTunnelV1Module();

    expect(mod?.PeerTcpTunnelFrameV1Schema.safeParse({
      v: 1,
      kind: 'close',
      tunnelId: 'tun_1',
      direction: 'client_to_daemon',
      halfClose: true,
      reasonCode: 'client_half_closed',
    }).success).toBe(true);

    expect(mod?.PeerTcpTunnelFrameV1Schema.safeParse({
      v: 1,
      kind: 'close',
      tunnelId: 'tun_1',
      direction: 'client_to_daemon',
      halfClose: true,
    }).success).toBe(false);
  });
});
