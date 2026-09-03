import { describe, expect, it } from 'vitest';

import {
  CanonicalPluginNetworkHostSuffixSchema,
  matchesPluginNetworkHostSuffix,
  pluginNetworkOriginPolicyAdmitsOrigin,
} from './networkHostSuffix.js';

describe('canonical plugin network host suffix', () => {
  it('accepts only a normalized multi-label ASCII host suffix', () => {
    for (const value of ['discord.gg', 'gateway.discord.gg', 'a-b.example.test']) {
      expect(CanonicalPluginNetworkHostSuffixSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      '',
      'gg',
      '.discord.gg',
      'discord.gg.',
      'Discord.GG',
      '*.discord.gg',
      'discord..gg',
      '-discord.gg',
      'discord-.gg',
      'discord.gg:443',
      'https://discord.gg',
      'discord.gg/path',
      'dïscord.gg',
      '93.184.216.34',
      `${'a'.repeat(64)}.gg`,
    ]) {
      expect(CanonicalPluginNetworkHostSuffixSchema.safeParse(value).success).toBe(false);
    }
  });

  it('matches an HTTPS origin only inside the suffix family on a DNS label boundary', () => {
    expect(matchesPluginNetworkHostSuffix('https://discord.gg', 'discord.gg')).toBe(true);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg', 'discord.gg')).toBe(true);
    expect(matchesPluginNetworkHostSuffix('https://gateway-us-east1-b.discord.gg', 'discord.gg')).toBe(true);

    // Suffix confusion, lookalikes and unrelated registrable domains.
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg.evil.example', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://notdiscord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://xdiscord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://discord.ggz', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://discord.com', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg.', 'discord.gg')).toBe(false);
  });

  it('refuses insecure schemes, credentials, non-standard ports and non-canonical origins', () => {
    expect(matchesPluginNetworkHostSuffix('http://gateway.discord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('wss://gateway.discord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://token@gateway.discord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://user:pass@gateway.discord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg:8443', 'discord.gg')).toBe(false);
    // Even the default port is not the canonical origin form: an admitted
    // origin is exactly what `URL.origin` produces, so `:443` is refused here
    // and reaches this owner already normalized away by its callers.
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg:443', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg/socket', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://GATEWAY.discord.gg', 'discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('not a url', 'discord.gg')).toBe(false);
  });

  it('never matches through a suffix the canonical schema would reject', () => {
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg', 'gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg', '.discord.gg')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg', 'DISCORD.GG')).toBe(false);
    expect(matchesPluginNetworkHostSuffix('https://gateway.discord.gg', '*.discord.gg')).toBe(false);
  });

  it('admits an origin through exact origins or declared suffix families in one policy decision', () => {
    const policy = {
      origins: ['https://discord.com'],
      hostSuffixes: ['discord.gg'],
    };

    expect(pluginNetworkOriginPolicyAdmitsOrigin(policy, 'https://discord.com')).toBe(true);
    expect(pluginNetworkOriginPolicyAdmitsOrigin(policy, 'https://gateway-us-east1-b.discord.gg')).toBe(true);
    expect(pluginNetworkOriginPolicyAdmitsOrigin(policy, 'https://cdn.discord.com')).toBe(false);
    expect(pluginNetworkOriginPolicyAdmitsOrigin({ origins: ['https://discord.com'] }, 'https://gateway.discord.gg')).toBe(false);
  });
});
