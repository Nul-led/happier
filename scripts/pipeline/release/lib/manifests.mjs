import { listPublicReleaseRingCatalogEntries } from '@happier-dev/release-runtime/releaseRings';
import { RELEASE_PRODUCTS, getReleaseProductArchiveFormat } from '@happier-dev/release-runtime/releaseProducts';
import { CLI_OPTIONAL_COMPONENT_PRODUCTS } from '../publishing/product-specs.mjs';

export const MANIFEST_SCHEMA_VERSION = 'v1';

/**
 * Canonical release product registry.
 *
 * `happier-runner` is the separately composed immutable Happier Runner artifact
 * (Lane 13.5). Publishing an artifact for a product is what makes it real: a
 * registry entry alone advertises nothing.
 */
export { RELEASE_PRODUCTS };

const PRODUCT_NAMES = new Set(RELEASE_PRODUCTS);
// Longest first so a product name that prefixes another cannot claim its artifacts.
const PRODUCT_PATTERN = [...RELEASE_PRODUCTS, ...CLI_OPTIONAL_COMPONENT_PRODUCTS]
  .sort((left, right) => right.length - left.length)
  .join('|');
const ARTIFACT_FILENAME_PATTERN = new RegExp(`^(${PRODUCT_PATTERN})-v(.+)-([a-z]+)-(x64|arm64)\\.(tar\\.gz|zip)$`);
const RELEASE_CHANNELS = new Set(
  listPublicReleaseRingCatalogEntries()
    .map((entry) => entry.manifestChannel)
    .filter((channel) => typeof channel === 'string' && channel.length > 0)
);

// @ts-check

export function parseArtifactFilename(name) {
  const raw = String(name ?? '').trim();
  const match = ARTIFACT_FILENAME_PATTERN.exec(raw);
  if (!match) return null;
  const [, product, version, os, arch, archiveFormat] = match;
  const expectedFormat = CLI_OPTIONAL_COMPONENT_PRODUCTS.includes(product) ? 'tar.gz' : getReleaseProductArchiveFormat(product);
  if (expectedFormat !== archiveFormat) return null;
  return { product, version, os, arch, filename: raw };
}

export function assertValidProduct(product) {
  const value = String(product ?? '').trim();
  if (!PRODUCT_NAMES.has(value)) {
    throw new Error(`[release] invalid product "${value}" (expected ${RELEASE_PRODUCTS.join('|')})`);
  }
  return value;
}

export function buildManifestRecord(params) {
  const product = assertValidProduct(params.product);
  const channel = String(params.channel ?? '').trim();
  if (!RELEASE_CHANNELS.has(channel)) {
    throw new Error(`[release] invalid channel "${channel}"`);
  }
  const version = String(params.version ?? '').trim();
  const os = String(params.os ?? '').trim();
  const arch = String(params.arch ?? '').trim();
  const url = String(params.url ?? '').trim();
  const sha256 = String(params.sha256 ?? '').trim();
  if (!version || !os || !arch || !url || !sha256) {
    throw new Error('[release] manifest record requires version/os/arch/url/sha256');
  }
  if (product === 'happier-runner' && (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes <= 0
      || !Array.isArray(params.entries) || params.entries.length === 0)) {
    throw new Error('[release] Runner manifest record requires signed archive size and entries');
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    product,
    channel,
    version,
    os,
    arch,
    url,
    sha256,
    signature: params.signature ?? null,
    publishedAt: params.publishedAt ?? new Date().toISOString(),
    minSupportedVersion: params.minSupportedVersion ?? null,
    rolloutPercent: Number(params.rolloutPercent ?? 100),
    critical: Boolean(params.critical ?? false),
    notesUrl: params.notesUrl ?? null,
    build: {
      commitSha: params.commitSha ?? null,
      workflowRunId: params.buildWorkflowRunId ?? params.workflowRunId ?? null,
    },
    publication: {
      workflowRunId: params.publicationWorkflowRunId ?? params.workflowRunId ?? null,
    },
    ...(product === 'happier-runner' ? { sizeBytes: params.sizeBytes, entries: params.entries } : {}),
  };
}
