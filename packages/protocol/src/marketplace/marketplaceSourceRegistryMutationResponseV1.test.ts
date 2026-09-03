import { describe, expect, it } from 'vitest';

import { HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema } from './marketplaceSourceRegistryMutationResponseV1.js';

describe('HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema', () => {
  it('distinguishes a committed registry from a definite invalid request', () => {
    const registry = {
      t: 'happier_marketplace_source_registry_v1' as const,
      schemaVersion: 1 as const,
      sources: [],
    };

    expect(HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema.parse(registry)).toEqual(registry);
    expect(HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema.parse({
      ok: false,
      errorCode: 'invalid_request',
      error: 'invalid_request',
    })).toEqual({ ok: false, errorCode: 'invalid_request', error: 'invalid_request' });
    expect(HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema.safeParse({
      ok: false,
      errorCode: 'invalid_request',
      error: 'invalid_request',
      unknown: true,
    }).success).toBe(false);
  });
});
