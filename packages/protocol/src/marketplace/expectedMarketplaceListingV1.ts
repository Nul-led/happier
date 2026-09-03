import { z } from 'zod';

import { NpmRegistryProfileIdV1Schema } from '../rpc/npmRegistryProfiles.js';

import {
  MarketplaceIndexEntryV1Schema,
  MarketplaceIndexSourceSnapshotV1Schema,
} from './marketplaceIndexV1.js';
import {
  PluginUpdatePolicyV1Schema,
} from './pluginUpdatePolicyV1.js';

const entry = MarketplaceIndexEntryV1Schema.shape;
const distribution = entry.distribution.shape;
const source = MarketplaceIndexSourceSnapshotV1Schema.shape.source.shape;

/** The one synthesized community npm source id; it is never a persisted row. */
export const COMMUNITY_NPM_MARKETPLACE_SOURCE_ID_V1 = 'marketplace:community-npm';

/**
 * The untrusted exact distribution facts a present user acted on when they
 * chose a listing. Every field is the corresponding marketplace index listing
 * fact, so the daemon revalidates the request against the freshly resolved
 * listing rather than against a second, drifting shape. The host-owned
 * registry profile binding is the one addition: it never comes from a catalog
 * document.
 */
const ExpectedMarketplaceListingBaseShape = {
  pluginId: entry.pluginId,
  publisher: entry.publisher,
  packageName: distribution.packageName,
  registryOrigin: distribution.registryOrigin,
  registryProfileId: NpmRegistryProfileIdV1Schema.optional(),
  version: distribution.version,
  integrity: distribution.integrity,
  manifestDigest: entry.manifestDigest,
} as const;

const ApprovedListingReviewV1Schema = z.object({
  status: z.literal('approved'),
  reviewedAt: z.string().datetime(),
  reason: entry.review.shape.reason,
}).strict();

const UnreviewedListingReviewV1Schema = z.object({
  status: z.literal('unreviewed'),
  reviewedAt: z.null(),
}).strict();

export const ExpectedMarketplaceListingV1Schema = z.union([
  z.object({
    source: z.object({
      id: source.id,
      kind: z.literal('curated'),
      sourceUrl: source.sourceUrl,
    }).strict(),
    ...ExpectedMarketplaceListingBaseShape,
    review: ApprovedListingReviewV1Schema,
    updatePolicy: PluginUpdatePolicyV1Schema,
  }).strict(),
  z.object({
    source: z.object({
      id: z.literal(COMMUNITY_NPM_MARKETPLACE_SOURCE_ID_V1),
      kind: z.literal('community-npm'),
      sourceUrl: source.sourceUrl,
    }).strict(),
    ...ExpectedMarketplaceListingBaseShape,
    registryProfileId: z.undefined().optional(),
    review: UnreviewedListingReviewV1Schema,
    updatePolicy: PluginUpdatePolicyV1Schema,
  }).strict(),
  z.object({
    // A user-added catalog names its own source id and may bind a private
    // registry host, but its listings stay unreviewed: the first install still
    // goes through Install and Trust.
    source: z.object({
      id: source.id,
      kind: z.literal('user'),
      sourceUrl: source.sourceUrl,
    }).strict(),
    ...ExpectedMarketplaceListingBaseShape,
    review: UnreviewedListingReviewV1Schema,
    updatePolicy: PluginUpdatePolicyV1Schema,
  }).strict(),
]);
export type ExpectedMarketplaceListingV1 = z.infer<typeof ExpectedMarketplaceListingV1Schema>;
