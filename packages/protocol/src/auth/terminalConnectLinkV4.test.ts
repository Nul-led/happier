import { describe, expect, it } from 'vitest';

import {
  TerminalConnectLinkV4EnvelopeSchema,
  classifyTerminalConnectLinkParameters,
  decodeTerminalConnectLinkV4Payload,
  encodeTerminalConnectLinkV4Payload,
  parseTerminalConnectLinkV4Parameters,
  readTerminalConnectLinkV4CredentialDestination,
} from './terminalConnectLinkV4.js';

const HOME_DESCRIPTOR = {
  v: 1,
  homeServerIdentityId: 'srv_home_link_v4',
  canonicalServerUrl: 'https://home.example.test',
  revision: 1,
  endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
} as const;

const LINK_V4 = {
  v: 4,
  publicKeyB64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  pairing: {
    v: 3,
    secretB64Url: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    createdAtMs: 1_000,
    expiresAtMs: 61_000,
    homeServerIdentityId: HOME_DESCRIPTOR.homeServerIdentityId,
    supportsTokenOnly: true,
  },
  homeConnectionDescriptor: HOME_DESCRIPTOR,
} as const;

describe('terminal connect link V4', () => {
  it('round-trips one opaque strict authority-bearing payload', () => {
    const payload = encodeTerminalConnectLinkV4Payload(LINK_V4);

    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTerminalConnectLinkV4Payload(payload)).toEqual(LINK_V4);
    expect(parseTerminalConnectLinkV4Parameters(`v4=${payload}`)).toEqual(LINK_V4);
    expect(classifyTerminalConnectLinkParameters(`v4=${payload}`)).toBe('v4');
  });

  it('rejects unknown fields at every authority-bearing object boundary', () => {
    expect(TerminalConnectLinkV4EnvelopeSchema.safeParse({ ...LINK_V4, future: true }).success).toBe(false);
    expect(TerminalConnectLinkV4EnvelopeSchema.safeParse({
      ...LINK_V4,
      pairing: { ...LINK_V4.pairing, future: true },
    }).success).toBe(false);
    expect(TerminalConnectLinkV4EnvelopeSchema.safeParse({
      ...LINK_V4,
      homeConnectionDescriptor: { ...HOME_DESCRIPTOR, future: true },
    }).success).toBe(false);

    const payload = encodeTerminalConnectLinkV4Payload(LINK_V4);
    expect(parseTerminalConnectLinkV4Parameters(`v4=${payload}&key=legacy-downgrade`)).toBeNull();
  });

  it('rejects a V3 pairing destination that does not match the descriptor identity', () => {
    const mismatched = {
      ...LINK_V4,
      pairing: { ...LINK_V4.pairing, homeServerIdentityId: 'srv_other_home' },
    };

    expect(TerminalConnectLinkV4EnvelopeSchema.safeParse(mismatched).success).toBe(false);
    expect(readTerminalConnectLinkV4CredentialDestination(mismatched)).toBeNull();
    expect(readTerminalConnectLinkV4CredentialDestination(LINK_V4)).toEqual({
      homeServerIdentityId: HOME_DESCRIPTOR.homeServerIdentityId,
      descriptor: HOME_DESCRIPTOR,
    });
  });
});

describe('released terminal link compatibility classification', () => {
  // Provenance: cli-v0.2.11 and ui-web-v0.2.11, both immutable commit
  // 98ea8fb76733b1dd785d38c31360179cafa84824. The released writer emitted
  // key/server/pairingSecret/createdAt/expiresAt and its reader required key.
  const RELEASED_V0_2_11_PARAMETERS =
    'key=terminal-key&server=https%3A%2F%2Fhome.example.test&pairingSecret=pairing-secret&createdAt=1000&expiresAt=61000';

  // Extracted from apps/ui/sources/utils/path/terminalConnectUrl.ts at the
  // immutable tag above. This is the released reader's deciding admission:
  // without its required `key`, parsing returns null before pairing handling.
  function readReleasedV0_2_11Parameters(parameters: string): Readonly<{ key: string }> | null {
    const key = (new URLSearchParams(parameters).get('key') ?? '').trim();
    return key ? { key } : null;
  }

  it('classifies the provenance-pinned v0.2.11 parameter shape as legacy', () => {
    expect(classifyTerminalConnectLinkParameters(RELEASED_V0_2_11_PARAMETERS)).toBe('legacy');
    expect(readReleasedV0_2_11Parameters(RELEASED_V0_2_11_PARAMETERS)).toEqual({ key: 'terminal-key' });
  });

  it('is rejected by the representative released v0.2.11 reader', () => {
    const payload = encodeTerminalConnectLinkV4Payload(LINK_V4);

    expect(readReleasedV0_2_11Parameters(`v4=${payload}`)).toBeNull();
  });
});
