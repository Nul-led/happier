import { describe, expect, it } from 'vitest';

import { ExpectedMarketplaceListingV1Schema } from './expectedMarketplaceListingV1.js';

const INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const MANIFEST_DIGEST = `sha256:${'a'.repeat(64)}`;

const UNREVIEWED_SOURCES = [
  { id: 'marketplace:community-npm', kind: 'community-npm', sourceUrl: 'https://registry.example/-/v1/search' },
  { id: 'team_catalog', kind: 'user', sourceUrl: 'https://catalog.example/index.json' },
] as const;

function unreviewedExpectedListing(
  source: (typeof UNREVIEWED_SOURCES)[number],
  updatePolicy: 'pinned' | 'reviewEveryUpdate' | 'reviewSensitiveChanges',
) {
  return {
    source: { ...source },
    pluginId: 'acme.plugin',
    publisher: { id: 'acme', displayName: 'Acme' },
    packageName: '@acme/plugin',
    registryOrigin: 'https://registry.example',
    version: '1.0.0',
    integrity: INTEGRITY,
    manifestDigest: MANIFEST_DIGEST,
    review: { status: 'unreviewed', reviewedAt: null },
    updatePolicy,
  };
}

describe('ExpectedMarketplaceListingV1', () => {
  it('carries every declared unreviewed update policy exactly, for community npm and user sources alike', () => {
    for (const source of UNREVIEWED_SOURCES) {
      for (const updatePolicy of ['pinned', 'reviewEveryUpdate', 'reviewSensitiveChanges'] as const) {
        const result = ExpectedMarketplaceListingV1Schema.safeParse(unreviewedExpectedListing(source, updatePolicy));
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.updatePolicy).toBe(updatePolicy);
        }
      }
    }
  });

  it('still refuses an unreviewed source that claims a curated approval or a retired policy alias', () => {
    for (const source of UNREVIEWED_SOURCES) {
      expect(ExpectedMarketplaceListingV1Schema.safeParse({
        ...unreviewedExpectedListing(source, 'reviewEveryUpdate'),
        review: { status: 'approved', reviewedAt: '2026-07-13T00:00:00.000Z' },
      }).success).toBe(false);
      expect(ExpectedMarketplaceListingV1Schema.safeParse({
        ...unreviewedExpectedListing(source, 'automatic'),
      }).success).toBe(false);
    }
  });
});
