import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeHomeQrInviteV2Payload, type HomeQrInviteV2 } from '@happier-dev/protocol';

import {
  encodeCliDirectHomeQrTaskStreamEvent,
  parseCliDirectHomeQrTaskStreamEvent,
  presentCliDirectHomeQrInvite,
} from './runCliDirectHomeQr';

const NOW_MS = 5_000;
const invite: HomeQrInviteV2 = {
  v: 2,
  intent: 'home_device',
  direction: 'trusted_home_displays',
  pairId: 'remote-home-pair',
  home: {
    v: 1,
    homeServerIdentityId: 'srv_remote_home',
    canonicalServerUrl: 'http://127.0.0.1:43123',
    revision: 1,
    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
  },
  qrSecretBase64Url: Buffer.alloc(32, 7).toString('base64url'),
  issuedAtMs: 1_000,
  expiresAtMs: 61_000,
};
const link = `happier:///pair?v=2&payload=${encodeURIComponent(encodeHomeQrInviteV2Payload(invite))}`;

afterEach(() => vi.restoreAllMocks());

describe('remote direct-Home QR task stream presentation', () => {
  it('strictly parses only a current protocol-owned V2 invite and typed result', () => {
    const inviteLine = encodeCliDirectHomeQrTaskStreamEvent({ v: 1, kind: 'home_pair_device.invite', link });
    const resultLine = encodeCliDirectHomeQrTaskStreamEvent({
      v: 1,
      kind: 'home_pair_device.result',
      result: { kind: 'expired' },
    });

    expect(parseCliDirectHomeQrTaskStreamEvent(inviteLine, NOW_MS)).toEqual({
      v: 1,
      kind: 'home_pair_device.invite',
      link,
    });
    expect(parseCliDirectHomeQrTaskStreamEvent(resultLine, NOW_MS)).toEqual({
      v: 1,
      kind: 'home_pair_device.result',
      result: { kind: 'expired' },
    });
    expect(parseCliDirectHomeQrTaskStreamEvent(inviteLine, NOW_MS, 'srv_other_home')).toBeNull();
    expect(parseCliDirectHomeQrTaskStreamEvent(JSON.stringify({ v: 1, kind: 'home_pair_device.invite', link, token: 'bearer' }), NOW_MS)).toBeNull();
    expect(parseCliDirectHomeQrTaskStreamEvent(JSON.stringify({ v: 1, kind: 'home_pair_device.invite', link: 'https://attacker.test' }), NOW_MS)).toBeNull();
  });

  it('renders the received invite as a local terminal QR instead of printing the raw link', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    presentCliDirectHomeQrInvite({ link, copyLink: false });

    expect(output.mock.calls[0]?.[0]).toBe('Scan this QR code with the phone or browser you want to add:');
    expect(output.mock.calls.some(([value]) => value === link)).toBe(false);
    expect(output.mock.calls.length).toBeGreaterThan(1);
  });
});
