import { describe, expect, it, vi } from 'vitest';

import type { MarketplaceIndexQueryResultV1 } from '@happier-dev/protocol';

import { createMarketplaceIndex } from './index';
import { requestExactMarketplaceInstall } from './exactInstall';
import { createMarketplaceIndexService, type MarketplaceIndexSourceConfig } from './service';
import { createMarketplaceSourceRegistryStore } from './sources/store';
import { createNpmRegistryProfileService } from '@/plugins/distribution/npm/profiles/service';
import { SAMPLE_PLUGIN_ID } from '@/plugins/testkit/samplePackage';
import { createPluginInstallationReviewFixture } from '@happier-dev/protocol/testing/pluginInstallationReviewFixture';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

const CURATED_SOURCE: MarketplaceIndexSourceConfig = {
  id: 'marketplace:curated',
  title: 'Curated',
  sourceUrl: 'https://marketplace.invalid/catalog.json',
  enabled: true,
  origin: 'curated',
};
const COMMUNITY_SOURCE: MarketplaceIndexSourceConfig = {
  id: 'marketplace:community-npm',
  title: 'Community npm',
  sourceUrl: 'https://registry.npmjs.org/-/v1/search',
  enabled: true,
  origin: 'community-npm',
};
const USER_SOURCE: MarketplaceIndexSourceConfig = {
  id: 'marketplace:user',
  title: 'Team catalog',
  sourceUrl: 'https://catalog.invalid/team.json',
  enabled: true,
  origin: 'user',
};
const INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const MANIFEST_DIGEST = `sha256:${'a'.repeat(64)}`;

function createSnapshot(params: Readonly<{
  source: MarketplaceIndexSourceConfig;
  freshnessState?: 'fresh' | 'stale';
  registryProfileId?: string;
  updatePolicy?: 'pinned' | 'allowed';
  reviewStatus?: 'approved' | 'withdrawn' | 'blocked';
}>) {
  const fetchedAtMs = Date.now();
  const curated = params.source.origin === 'curated';
  return {
    source: { id: params.source.id, title: params.source.title, kind: params.source.origin, sourceUrl: params.source.sourceUrl },
    freshness: {
      state: params.freshnessState ?? 'fresh',
      fetchedAtMs,
      ...(params.freshnessState === 'stale' ? { staleSinceMs: fetchedAtMs } : {}),
    },
    entries: [{
      pluginId: SAMPLE_PLUGIN_ID,
      publisher: { id: 'acme', displayName: 'Acme' },
      display: { title: 'Acme Sample', description: 'Exact marketplace listing' },
      distribution: {
        kind: 'npm' as const,
        registryOrigin: 'https://registry.npmjs.org',
        packageName: '@acme/sample',
        version: '1.0.0',
        integrity: INTEGRITY,
        ...(params.registryProfileId ? { registryProfileId: params.registryProfileId } : {}),
      },
      manifestDigest: MANIFEST_DIGEST,
      compatibility: { happier: '>=1.0.0', platforms: ['darwin' as const] },
      summary: { contributions: ['actions'], requiredHostAccess: [], optionalHostAccess: [], executableRealms: ['daemon' as const] },
      review: curated
        ? { status: params.reviewStatus ?? 'approved', reviewedAt: '2026-07-22T00:00:00.000Z' }
        : { status: 'unreviewed' as const, reviewedAt: null },
      categories: ['actions'],
      media: [],
      updatePolicy: params.updatePolicy ?? 'allowed' as const,
      links: {},
    }],
    diagnostics: [],
  };
}

/**
 * A double for the one exact-listing method the install action consumes. It
 * mirrors the real service contract: the source binding is resolved first and
 * the caller only ever sees that one source's answer.
 */
function exactListingService(
  source: MarketplaceIndexSourceConfig,
  snapshot: ReturnType<typeof createSnapshot>,
  project?: (result: MarketplaceIndexQueryResultV1) => MarketplaceIndexQueryResultV1,
) {
  return {
    queryExactListing: vi.fn(async (query: Readonly<{ sourceId: string; pluginId: string; packageName?: string }>) => {
      const indexed = createMarketplaceIndex({
        revision: 1,
        sources: [snapshot],
        query: { text: '', cursor: null, limit: 1, filters: { sourceIds: [query.sourceId], pluginIds: [query.pluginId], includeUnavailable: true } },
      });
      return { ok: true as const, source, result: project ? project(indexed) : indexed };
    }),
  };
}

const committedChange = () => vi.fn(async () => ({
  kind: 'committed' as const,
  pluginId: SAMPLE_PLUGIN_ID,
  desiredGeneration: 'generation-1',
  appliedGeneration: 'generation-1',
  pendingSurfaces: [],
}));

describe('requestExactMarketplaceInstall', () => {
  it('carries the clicked community npm package to the source and submits its exact untrusted facts for full review', async () => {
    const home = await createTempDir('happier-community-marketplace-install-');
    const service = exactListingService(COMMUNITY_SOURCE, createSnapshot({ source: COMMUNITY_SOURCE }));
    const requestChange = committedChange();

    try {
      const result = await requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: COMMUNITY_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
        packageName: '@acme/sample',
      }, { marketplaceIndexService: service, requestChange });

      expect(result).toMatchObject({ ok: true, change: { kind: 'committed' } });
      // The package name only targets the source before acquisition; every
      // installed fact still comes back from the source's own answer.
      expect(service.queryExactListing).toHaveBeenCalledWith({
        sourceId: COMMUNITY_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
        packageName: '@acme/sample',
      });
      expect(requestChange).toHaveBeenCalledWith({
        request: {
          kind: 'installNpm',
          packageName: '@acme/sample',
          selector: '1.0.0',
          registryOrigin: 'https://registry.npmjs.org',
          expectedMarketplaceListing: {
            source: { id: COMMUNITY_SOURCE.id, kind: 'community-npm', sourceUrl: COMMUNITY_SOURCE.sourceUrl },
            pluginId: SAMPLE_PLUGIN_ID,
            publisher: { id: 'acme', displayName: 'Acme' },
            packageName: '@acme/sample',
            registryOrigin: 'https://registry.npmjs.org',
            version: '1.0.0',
            integrity: INTEGRITY,
            manifestDigest: MANIFEST_DIGEST,
            review: { status: 'unreviewed', reviewedAt: null },
            updatePolicy: 'allowed',
          },
        },
        approval: 'none',
      });
    } finally {
      await removeTempDir(home);
    }
  });

  it('installs an exact user-source listing through the same owner as every other source', async () => {
    const home = await createTempDir('happier-user-marketplace-install-');
    const service = exactListingService(
      { ...USER_SOURCE, registryProfileId: 'registry_private' },
      createSnapshot({ source: USER_SOURCE, registryProfileId: 'catalog-controlled' }),
      (indexed) => ({
        ...indexed,
        items: indexed.items.map((item) => ({
          ...item,
          artifactAccess: { state: 'available' as const, registryProfileId: 'registry_private' },
        })),
      }),
    );
    const requestChange = committedChange();

    try {
      const result = await requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: USER_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, { marketplaceIndexService: service, requestChange });

      expect(result).toMatchObject({ ok: true });
      expect(requestChange).toHaveBeenCalledWith(expect.objectContaining({
        request: expect.objectContaining({
          registryProfileId: 'registry_private',
          expectedMarketplaceListing: expect.objectContaining({
            source: { id: USER_SOURCE.id, kind: 'user', sourceUrl: USER_SOURCE.sourceUrl },
            registryProfileId: 'registry_private',
            // An unreviewed source never claims a review, whatever it published.
            review: { status: 'unreviewed', reviewedAt: null },
          }),
        }),
      }));
      // Only the persisted host binding may select a profile.
      expect(JSON.stringify(requestChange.mock.calls)).not.toContain('catalog-controlled');
    } finally {
      await removeTempDir(home);
    }
  });

  it.each(['pinned', 'allowed'] as const)(
    'submits the curated %s policy exactly as published, with no coercion',
    async (updatePolicy) => {
      const home = await createTempDir('happier-exact-marketplace-install-');
      const service = exactListingService(CURATED_SOURCE, createSnapshot({ source: CURATED_SOURCE, updatePolicy }));
      const requestChange = vi.fn(async () => ({
        kind: 'reviewRequired' as const,
        reviewKind: 'installation' as const,
        pendingChangeId: 'pending-curated',
        reason: 'firstInstall' as const,
        currentVersion: null,
        authorityExpansion: [],
        review: createPluginInstallationReviewFixture({
          pluginId: SAMPLE_PLUGIN_ID,
          displayName: 'Sample plugin',
          packageIdentity: { name: '@acme/sample', version: '1.0.0' },
          source: { kind: 'npm', locator: '@acme/sample@1.0.0', integrity: INTEGRITY, integrityBasis: 'expected' },
          updateChannel: { kind: 'npm', packageName: '@acme/sample', registryOrigin: 'https://registry.npmjs.org' },
        }),
      }));

      try {
        const result = await requestExactMarketplaceInstall({
          happyHomeDir: home,
          sourceId: CURATED_SOURCE.id,
          pluginId: SAMPLE_PLUGIN_ID,
        }, { marketplaceIndexService: service, requestChange });

        expect(result).toMatchObject({ ok: true, change: { kind: 'reviewRequired' } });
        expect(requestChange).toHaveBeenCalledWith({
          request: {
            kind: 'installNpm',
            packageName: '@acme/sample',
            selector: '1.0.0',
            registryOrigin: 'https://registry.npmjs.org',
            expectedMarketplaceListing: {
              source: { id: CURATED_SOURCE.id, kind: 'curated', sourceUrl: CURATED_SOURCE.sourceUrl },
              pluginId: SAMPLE_PLUGIN_ID,
              publisher: { id: 'acme', displayName: 'Acme' },
              packageName: '@acme/sample',
              registryOrigin: 'https://registry.npmjs.org',
              version: '1.0.0',
              integrity: INTEGRITY,
              manifestDigest: MANIFEST_DIGEST,
              review: { status: 'approved', reviewedAt: '2026-07-22T00:00:00.000Z' },
              updatePolicy,
            },
          },
          approval: 'none',
        });
      } finally {
        await removeTempDir(home);
      }
    },
  );

  it.each(
    ([COMMUNITY_SOURCE, USER_SOURCE] as const).flatMap((source) =>
      (['pinned', 'allowed'] as const).map((updatePolicy) =>
        [source.origin, source, updatePolicy] as const),
    ),
  )(
    'submits the unreviewed %s listing with its published %s policy unchanged, with no coercion',
    async (_origin, source, updatePolicy) => {
      const home = await createTempDir('happier-unreviewed-marketplace-policy-');
      const service = exactListingService(source, createSnapshot({ source, updatePolicy }));
      const requestChange = committedChange();

      try {
        const result = await requestExactMarketplaceInstall({
          happyHomeDir: home,
          sourceId: source.id,
          pluginId: SAMPLE_PLUGIN_ID,
          packageName: '@acme/sample',
        }, { marketplaceIndexService: service, requestChange });

        expect(result).toMatchObject({ ok: true, change: { kind: 'committed' } });
        // The listing's declared policy travels into the install request
        // unchanged: first-install trust comes from the mandatory Install and
        // Trust review, not from curation, so no unreviewed policy is coerced.
        expect(requestChange).toHaveBeenCalledWith({
          request: {
            kind: 'installNpm',
            packageName: '@acme/sample',
            selector: '1.0.0',
            registryOrigin: 'https://registry.npmjs.org',
            expectedMarketplaceListing: {
              source: { id: source.id, kind: source.origin, sourceUrl: source.sourceUrl },
              pluginId: SAMPLE_PLUGIN_ID,
              publisher: { id: 'acme', displayName: 'Acme' },
              packageName: '@acme/sample',
              registryOrigin: 'https://registry.npmjs.org',
              version: '1.0.0',
              integrity: INTEGRITY,
              manifestDigest: MANIFEST_DIGEST,
              review: { status: 'unreviewed', reviewedAt: null },
              updatePolicy,
            },
          },
          approval: 'none',
        });
      } finally {
        await removeTempDir(home);
      }
    },
  );

  it('rejects stale canonical facts before contacting the daemon owner', async () => {
    const home = await createTempDir('happier-stale-marketplace-install-');
    const service = exactListingService(CURATED_SOURCE, createSnapshot({ source: CURATED_SOURCE, freshnessState: 'stale' }));
    const requestChange = vi.fn();

    try {
      await expect(requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: CURATED_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, { marketplaceIndexService: service, requestChange }))
        .resolves.toMatchObject({ ok: false, code: 'install_unavailable' });
      expect(requestChange).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(home);
    }
  });

  it('refuses a withdrawn curated listing without treating withdrawal as an installed-code decision', async () => {
    const home = await createTempDir('happier-withdrawn-marketplace-install-');
    const service = exactListingService(CURATED_SOURCE, createSnapshot({ source: CURATED_SOURCE, reviewStatus: 'withdrawn' }));
    const requestChange = vi.fn();

    try {
      const result = await requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: CURATED_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, { marketplaceIndexService: service, requestChange });

      expect(result).toMatchObject({ ok: false, code: 'install_unavailable' });
      expect(result.ok === false && result.message).toContain('withdrawn');
      expect(requestChange).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(home);
    }
  });

  it('refuses when the exact private-profile binding no longer matches the persisted source', async () => {
    const home = await createTempDir('happier-rebound-marketplace-source-');
    const service = exactListingService(
      { ...CURATED_SOURCE, registryProfileId: 'registry_one' },
      createSnapshot({ source: CURATED_SOURCE }),
      (indexed) => ({
        ...indexed,
        items: indexed.items.map((item) => ({
          ...item,
          artifactAccess: { state: 'available' as const, registryProfileId: 'registry_two' },
        })),
      }),
    );
    const requestChange = vi.fn();

    try {
      await expect(requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: CURATED_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, { marketplaceIndexService: service, requestChange }))
        .resolves.toMatchObject({ ok: false, code: 'source_changed' });
      expect(requestChange).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(home);
    }
  });

  it('propagates an unavailable exact source without asking the daemon owner to install', async () => {
    const home = await createTempDir('happier-unavailable-marketplace-source-');
    const requestChange = vi.fn();

    try {
      await expect(requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: CURATED_SOURCE.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, {
        marketplaceIndexService: {
          queryExactListing: async () => ({
            ok: false as const,
            code: 'install_unavailable' as const,
            message: 'The exact marketplace source facts are currently unavailable.',
          }),
        },
        requestChange,
      })).resolves.toMatchObject({ ok: false, code: 'install_unavailable' });
      expect(requestChange).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(home);
    }
  });

  it('names the private registry a listing still needs, from the real source binding and profile state, without asking the daemon owner', async () => {
    const home = await createTempDir('happier-registry-required-marketplace-install-');
    const requestChange = vi.fn();
    try {
      const source = await createMarketplaceSourceRegistryStore({ happyHomeDir: home })
        .upsertSource({ sourceUrl: USER_SOURCE.sourceUrl, title: USER_SOURCE.title, origin: 'user' });
      const snapshot = createSnapshot({ source: { ...USER_SOURCE, id: source.id } });
      const privateSnapshot = {
        ...snapshot,
        entries: snapshot.entries.map((entry) => ({
          ...entry,
          distribution: { ...entry.distribution, registryOrigin: 'https://npm.acme.example.test' },
        })),
      };
      // Only the catalog fetch — the network boundary — is replaced; the source
      // binding and the registry profile state are the real persisted owners.
      const marketplaceIndexService = createMarketplaceIndexService({
        happyHomeDir: home,
        loadSource: async () => privateSnapshot,
      });
      const install = () => requestExactMarketplaceInstall({
        happyHomeDir: home,
        sourceId: source.id,
        pluginId: SAMPLE_PLUGIN_ID,
      }, { marketplaceIndexService, requestChange });

      await expect(install()).resolves.toMatchObject({
        ok: false,
        code: 'registry_profile_required',
        requirement: { registryOrigin: 'https://npm.acme.example.test', packageName: '@acme/sample', registryProfileId: null },
      });

      // Bound to this Home's profile that still needs signing in: that profile is named.
      await createNpmRegistryProfileService({ happyHomeDir: home }).mutate({
        action: 'add', machineId: 'machine-1', expectedRevision: 0, mutationId: 'mutation-add-acme',
        profileId: 'registry_acme',
        profile: { displayName: 'Acme', origin: 'https://npm.acme.example.test', scopes: ['@acme'], useAsDefault: false, allowPrivateNetwork: false },
      });
      await createMarketplaceSourceRegistryStore({ happyHomeDir: home }).setSourceRegistryProfile(source.id, 'registry_acme');
      await expect(install()).resolves.toMatchObject({
        ok: false,
        code: 'registry_profile_required',
        requirement: { registryOrigin: 'https://npm.acme.example.test', packageName: '@acme/sample', registryProfileId: 'registry_acme' },
      });
      expect(requestChange).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(home);
    }
  });
});
