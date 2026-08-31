import { describe, expect, it } from 'vitest';

import { buildTerminalConnectLinks } from './index';

describe('buildTerminalConnectLinks authenticated pairing identity', () => {
  it('publishes the stable Home identity in web and mobile links', () => {
    const links = buildTerminalConnectLinks({
      webappUrl: 'https://app.happier.dev',
      serverUrl: 'https://api.happier.dev',
      publicKeyB64Url: 'terminal-key',
      serverIdentityId: 'srv_home_expected',
      pairing: {
        secretB64Url: 'pairing-secret',
        createdAtMs: 1_000,
        expiresAtMs: 61_000,
      },
      supportsTokenOnly: true,
    });

    for (const link of [links.webUrl, links.mobileUrl]) {
      expect(new URL(link.replace('#', '?')).searchParams.get('serverIdentityId')).toBe('srv_home_expected');
    }
  });

  it('rejects authenticated pairing without a stable Home identity', () => {
    expect(() => buildTerminalConnectLinks({
      webappUrl: 'https://app.happier.dev',
      serverUrl: 'https://api.happier.dev',
      publicKeyB64Url: 'terminal-key',
      pairing: {
        secretB64Url: 'pairing-secret',
        createdAtMs: 1_000,
        expiresAtMs: 61_000,
      },
      supportsTokenOnly: true,
    })).toThrow(/stable Home identity/);
  });

  it('rejects malformed authenticated pairing instead of emitting an unpaired link', () => {
    expect(() => buildTerminalConnectLinks({
      webappUrl: 'https://app.happier.dev',
      serverUrl: 'https://api.happier.dev',
      publicKeyB64Url: 'terminal-key',
      serverIdentityId: 'srv_home_expected',
      pairing: {
        secretB64Url: 'pairing-secret',
        createdAtMs: 61_000,
        expiresAtMs: 1_000,
      },
    })).toThrow(/malformed/);
  });
});
