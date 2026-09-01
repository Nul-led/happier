import { describe, expect, it } from 'vitest';

import { readIrohRelayConfigFromEnv } from './relayConfig';

describe('readIrohRelayConfigFromEnv', () => {
  it('normalizes explicit relay configuration without ambient discovery', () => {
    expect(readIrohRelayConfigFromEnv({
      HAPPIER_IROH_RELAY_POLICY: ' AUTOMATIC ',
      HAPPIER_IROH_RELAY_URLS: 'https://relay-b.example, https://relay-a.example',
    })).toEqual({
      relayPolicy: 'automatic',
      relayUrls: ['https://relay-a.example', 'https://relay-b.example'],
      explicitlyConfigured: true,
    });

    expect(readIrohRelayConfigFromEnv({})).toEqual({
      relayPolicy: 'automatic',
      relayUrls: [],
      explicitlyConfigured: false,
    });

    expect(readIrohRelayConfigFromEnv({ HAPPIER_IROH_RELAY_POLICY: 'disabled' })).toEqual({
      relayPolicy: 'disabled',
      relayUrls: [],
      explicitlyConfigured: true,
    });
  });

  it('fails closed for disabled relays with explicit URLs', () => {
    expect(() => readIrohRelayConfigFromEnv({
      HAPPIER_IROH_RELAY_POLICY: 'disabled',
      HAPPIER_IROH_RELAY_URLS: 'https://relay.example',
    })).toThrow(/cannot be combined/);
  });
});
