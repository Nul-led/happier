import { describe, expect, it } from 'vitest';
import { FeaturesResponseSchema } from '@happier-dev/protocol';

import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { resolvePeerMediationTrustRoots } from './resolvePeerMediationTrustRoots';

const FEATURES = FeaturesResponseSchema.parse({
  features: {},
  capabilities: {
    machines: {
      peerMediation: {
        grantSigningKeys: [
          { keyId: 'current-key', publicKey: 'cHVibGljLWtleQ', expiresAt: 2_000 },
          { keyId: 'expired-key', publicKey: 'ZXhwaXJlZC1rZXk', expiresAt: 999 },
        ],
      },
    },
  },
});

function ready(
  provenance: 'authenticated' | 'public',
): Extract<CliServerFeaturesSnapshot, { status: 'ready' }> {
  return { status: 'ready', provenance, features: FEATURES };
}

describe('resolvePeerMediationTrustRoots', () => {
  it('accepts only unexpired roots from the authenticated ready projection', () => {
    expect(resolvePeerMediationTrustRoots(ready('authenticated'), 1_000)).toEqual([
      { keyId: 'current-key', publicKey: 'cHVibGljLWtleQ', expiresAt: 2_000 },
    ]);
  });

  it('rejects roots from a public ready fallback instead of promoting advisory data to authority', () => {
    expect(resolvePeerMediationTrustRoots(ready('public'), 1_000)).toEqual([]);
  });
});
