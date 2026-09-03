import { isDeepStrictEqual } from 'node:util';

import {
  decideMarketplaceListingInstallV1,
  type MarketplaceIndexItemV1,
  type MarketplaceIndexQueryResultV1,
  type MarketplaceListingInstallBlockV1,
} from '@happier-dev/protocol';

import {
  COMMUNITY_NPM_MARKETPLACE_SOURCE_ID_V1,
  type ExpectedMarketplaceListingV1,
} from '@happier-dev/protocol/marketplace/internal';

import { requestUserPluginChange, type UserPluginChangeResult } from '@/plugins/daemon/changeClient';

import {
  createMarketplaceIndexService,
  type MarketplaceIndexSourceConfig,
} from './service';

/** The CLI's user-facing copy for each shared Protocol install block. */
function marketplaceInstallBlockMessage(block: MarketplaceListingInstallBlockV1): string {
  switch (block) {
    case 'unsupported-source-kind':
      return 'Only exact curated, user, or community npm listings can use this Install and trust action.';
    case 'curated-review-withdrawn':
      return 'This marketplace listing was withdrawn and cannot be installed.';
    case 'curated-review-not-approved':
      return 'This marketplace listing does not have a current approved review.';
    case 'full-review-unavailable':
      return 'This marketplace listing is not available for full review.';
    case 'source-not-fresh':
      return 'Fresh marketplace source facts are required before installation.';
    case 'artifact-unavailable':
      return 'The marketplace artifact requires a registry profile whose exact host binding is unavailable.';
  }
}

export function readMarketplaceInstallAvailability(item: MarketplaceIndexItemV1):
  | Readonly<{ ok: true; listing: MarketplaceIndexItemV1 }>
  | Readonly<{ ok: false; message: string }> {
  const decision = decideMarketplaceListingInstallV1(item);
  if (decision.installable) {
    return { ok: true, listing: item };
  }
  return { ok: false, message: marketplaceInstallBlockMessage(decision.block) };
}

export function marketplaceInstallUnavailableReason(item: MarketplaceIndexItemV1): string | null {
  const availability = readMarketplaceInstallAvailability(item);
  return availability.ok ? null : availability.message;
}

export async function queryAllMarketplaceSourceItems(
  source: MarketplaceIndexSourceConfig,
  service: Pick<ReturnType<typeof createMarketplaceIndexService>, 'querySources'> = createMarketplaceIndexService(),
): Promise<MarketplaceIndexQueryResultV1> {
  const items: MarketplaceIndexItemV1[] = [];
  let cursor: string | null = null;
  let latest: MarketplaceIndexQueryResultV1 | null = null;
  do {
    latest = await service.querySources({ text: '', cursor, limit: 100, filters: { sourceIds: [source.id], includeUnavailable: true } }, [source]);
    items.push(...latest.items);
    cursor = latest.nextCursor;
  } while (cursor !== null);
  if (!latest) throw new Error('Marketplace index query returned no result');
  return { ...latest, items, nextCursor: null };
}

export type ExactMarketplaceListingResolution = Readonly<{
  source: MarketplaceIndexSourceConfig;
  listing: MarketplaceIndexItemV1;
  registryProfileId: string | null;
}>;

export function projectExpectedMarketplaceListing(
  listing: MarketplaceIndexItemV1,
  registryProfileId: string | null,
): ExpectedMarketplaceListingV1 {
  const distribution = {
    pluginId: listing.pluginId,
    publisher: listing.publisher,
    packageName: listing.distribution.packageName,
    registryOrigin: listing.distribution.registryOrigin,
    version: listing.distribution.version,
    integrity: listing.distribution.integrity,
    manifestDigest: listing.manifestDigest,
  } as const;
  if (listing.source.kind === 'curated') {
    return {
      source: { id: listing.source.id, kind: 'curated', sourceUrl: listing.source.sourceUrl },
      ...distribution,
      ...(registryProfileId ? { registryProfileId } : {}),
      review: {
        status: 'approved',
        reviewedAt: listing.review.reviewedAt!,
        ...(listing.review.reason !== undefined ? { reason: listing.review.reason } : {}),
      },
      updatePolicy: listing.updatePolicy,
    };
  }
  // The unreviewed listing's declared policy travels unchanged: first-install
  // trust comes from the mandatory Install and Trust review, not from
  // curation, so every declared policy — including `reviewSensitiveChanges`
  // for later explicit updates — is submitted exactly as published.
  const review = {
    review: { status: 'unreviewed', reviewedAt: null },
    updatePolicy: listing.updatePolicy,
  } as const;
  if (listing.source.kind === 'community-npm') {
    // Community npm is the one synthesized source, never a persisted row, so
    // it carries the constant id and no private registry binding.
    return {
      source: {
        id: COMMUNITY_NPM_MARKETPLACE_SOURCE_ID_V1,
        kind: 'community-npm',
        sourceUrl: listing.source.sourceUrl,
      },
      ...distribution,
      ...review,
    };
  }
  return {
    source: { id: listing.source.id, kind: 'user', sourceUrl: listing.source.sourceUrl },
    ...distribution,
    // The persisted host binding travels with every persisted source kind: a
    // user catalog can name a private registry just as a curated one can.
    ...(registryProfileId ? { registryProfileId } : {}),
    ...review,
  };
}

export function marketplaceListingMatchesExpected(
  expected: ExpectedMarketplaceListingV1,
  listing: MarketplaceIndexItemV1,
): boolean {
  const registryProfileId = listing.artifactAccess.state === 'available'
    ? listing.artifactAccess.registryProfileId
    : null;
  return isDeepStrictEqual(projectExpectedMarketplaceListing(listing, registryProfileId), expected);
}

export async function resolveExactMarketplaceListingForInstall(
  params: Readonly<{
    happyHomeDir: string;
    sourceId: string;
    pluginId: string;
    /**
     * The package name of the listing the user acted on. It is untrusted
     * caller input used only to target the source before acquisition; every
     * fact installed afterwards comes from the source's own answer.
     */
    packageName?: string;
  }>,
  serviceOverride?: Pick<ReturnType<typeof createMarketplaceIndexService>, 'queryExactListing'>,
): Promise<
  | Readonly<{ ok: true; resolution: ExactMarketplaceListingResolution }>
  | Readonly<{ ok: false; code: 'install_unavailable' | 'source_changed'; message: string }>
> {
  const sourceId = params.sourceId.trim();
  const pluginId = params.pluginId.trim();
  if (!sourceId || !pluginId) {
    return { ok: false, code: 'install_unavailable', message: 'A persisted marketplace source identity and plugin ID are required.' };
  }

  const service = serviceOverride ?? createMarketplaceIndexService({ happyHomeDir: params.happyHomeDir });
  const exact = await service.queryExactListing({
    sourceId,
    pluginId,
    ...(params.packageName ? { packageName: params.packageName } : {}),
  });
  if (!exact.ok) {
    return exact;
  }
  const source = exact.source;
  const result = exact.result;

  const listing = result.items.find((item) => (
    item.pluginId === pluginId
    && item.source.id === source.id
    && item.source.sourceUrl === source.sourceUrl
  )) ?? null;
  if (!listing) {
    return { ok: false, code: 'install_unavailable', message: `No installable exact marketplace listing was found for ${pluginId}.` };
  }
  const availability = readMarketplaceInstallAvailability(listing);
  if (!availability.ok) {
    return { ok: false, code: 'install_unavailable', message: availability.message };
  }
  const approvedListing = availability.listing;
  const registryProfileId = approvedListing.artifactAccess.state === 'available'
    ? approvedListing.artifactAccess.registryProfileId
    : null;
  if ((source.registryProfileId ?? null) !== registryProfileId) {
    return { ok: false, code: 'source_changed', message: 'The exact private registry profile binding changed before installation.' };
  }
  return { ok: true, resolution: { source, listing: approvedListing, registryProfileId } };
}

export type ExactMarketplaceInstallResult =
  | Readonly<{
      ok: true;
      listing: MarketplaceIndexItemV1;
      change: UserPluginChangeResult;
    }>
  | Readonly<{
      ok: false;
      code: 'install_unavailable' | 'source_changed';
      message: string;
    }>;

export async function requestExactMarketplaceInstall(
  params: Readonly<{
    happyHomeDir: string;
    sourceId: string;
    pluginId: string;
    /** The clicked listing's package name; see the resolver for why. */
    packageName?: string;
    approval?: 'prompt' | 'none';
  }>,
  dependencies: Readonly<{
    marketplaceIndexService?: Pick<ReturnType<typeof createMarketplaceIndexService>, 'queryExactListing'>;
    requestChange?: typeof requestUserPluginChange;
  }> = {},
): Promise<ExactMarketplaceInstallResult> {
  const resolution = await resolveExactMarketplaceListingForInstall({
    happyHomeDir: params.happyHomeDir,
    sourceId: params.sourceId,
    pluginId: params.pluginId,
    ...(params.packageName ? { packageName: params.packageName } : {}),
  }, dependencies.marketplaceIndexService);
  if (!resolution.ok) {
    return { ok: false, code: resolution.code, message: resolution.message };
  }
  const { listing: approvedListing, registryProfileId } = resolution.resolution;

  const change = await (dependencies.requestChange ?? requestUserPluginChange)({
    request: {
      kind: 'installNpm',
      packageName: approvedListing.distribution.packageName,
      selector: approvedListing.distribution.version,
      registryOrigin: approvedListing.distribution.registryOrigin,
      ...(registryProfileId ? { registryProfileId } : {}),
      expectedMarketplaceListing: projectExpectedMarketplaceListing(approvedListing, registryProfileId),
    },
    approval: params.approval ?? 'none',
  });
  return { ok: true, listing: approvedListing, change };
}
