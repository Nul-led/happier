import { describe, expect, it, vi } from 'vitest';

import type { MarketplaceIndexQueryResultV1 } from '@happier-dev/protocol';

import {
    mergeDiscoverEntries,
    mergeDiscoverNonInstallableListings,
    projectDaemonMarketplaceIndexPage,
} from './readPluginMarketplaceCatalog';

type IndexItem = MarketplaceIndexQueryResultV1['items'][number];

const INTEGRITY = 'sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==';
const MANIFEST_DIGEST = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const CURATED_SOURCE = {
    id: 'marketplace:curated',
    title: 'Happier curated',
    kind: 'curated',
    sourceUrl: 'https://marketplace.example.test/index.json',
} as const satisfies IndexItem['source'];

function createIndexItem(overrides: Partial<IndexItem> = {}): IndexItem {
    return {
        pluginId: 'sample.plugin',
        publisher: { id: 'sample', displayName: 'Sample' },
        display: { title: 'Sample Plugin', description: 'Daemon-owned marketplace entry' },
        distribution: {
            kind: 'npm',
            registryOrigin: 'https://registry.npmjs.org',
            packageName: 'sample-plugin',
            version: '1.2.3',
            integrity: INTEGRITY,
        },
        manifestDigest: MANIFEST_DIGEST,
        compatibility: { happier: '>=1', platforms: ['web'] },
        summary: { contributions: ['agents'], requiredHostAccess: [], optionalHostAccess: [], executableRealms: ['daemon'] },
        review: { status: 'approved', reviewedAt: '2026-07-13T00:00:00.000Z' },
        categories: ['agents'],
        media: [],
        updatePolicy: 'reviewEveryUpdate',
        links: {},
        source: CURATED_SOURCE,
        freshness: { state: 'fresh', fetchedAtMs: 1 },
        admission: {
            install: 'full-review',
            mutatesInstalledTrust: false,
            disablesInstalledCode: false,
            directNpmRequiresFullReview: true,
        },
        artifactAccess: { state: 'public', registryProfileId: null },
        ...overrides,
    };
}

function createPage(overrides: Partial<MarketplaceIndexQueryResultV1> = {}): MarketplaceIndexQueryResultV1 {
    return {
        revision: 4,
        nextCursor: null,
        sources: [],
        diagnostics: [],
        items: [],
        ...overrides,
    };
}

describe('projectDaemonMarketplaceIndexPage', () => {
    it('projects a curated listing from the typed daemon page without fetching anything in the client', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const page = projectDaemonMarketplaceIndexPage(createPage({
            nextCursor: 'cursor-2',
            items: [createIndexItem()],
        }));

        expect(page.revision).toBe(4);
        expect(page.nextCursor).toBe('cursor-2');
        expect(page.entries).toEqual([{
            id: 'sample.plugin',
            sourceId: 'marketplace:curated',
            sourceKind: 'curated',
            sourceTitle: 'Happier curated',
            reviewStatus: 'approved',
            updatePolicy: 'reviewEveryUpdate',
            publisher: { id: 'sample', displayName: 'Sample' },
            categories: ['agents'],
            executableRealms: ['daemon'],
            platforms: ['web'],
            title: 'Sample Plugin',
            description: 'Daemon-owned marketplace entry',
            version: '1.2.3',
            // The npm coordinate is carried, not derived: it differs from the
            // manifest plugin id and the install action depends on it.
            packageName: 'sample-plugin',
            installable: true,
        }]);
        expect(page.nonInstallable).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('keeps a pinned curated listing installable while refusing to advertise an update from it', () => {
        const page = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ updatePolicy: 'pinned' })],
        }));

        expect(page.entries[0]).toMatchObject({
            updatePolicy: 'pinned',
            installable: true,
        });
    });

    it('surfaces an exact community npm listing as unreviewed code eligible for the normal trust flow', () => {
        const page = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({
                pluginId: 'community.plugin',
                display: { title: 'Community Plugin', description: 'Third-party plugin from npm' },
                review: { status: 'unreviewed', reviewedAt: null },
                source: {
                    id: 'marketplace:community-npm',
                    title: 'Community npm',
                    kind: 'community-npm',
                    sourceUrl: 'https://registry.npmjs.org/-/v1/search?text=keywords:happier-plugin',
                },
            })],
        }));

        expect(page.entries).toEqual([{
            id: 'community.plugin',
            sourceId: 'marketplace:community-npm',
            sourceKind: 'community-npm',
            sourceTitle: 'Community npm',
            reviewStatus: 'unreviewed',
            updatePolicy: 'reviewEveryUpdate',
            publisher: { id: 'sample', displayName: 'Sample' },
            categories: ['agents'],
            executableRealms: ['daemon'],
            platforms: ['web'],
            title: 'Community Plugin',
            description: 'Third-party plugin from npm',
            version: '1.2.3',
            packageName: 'sample-plugin',
            installable: true,
            warning: 'unreviewed',
        }]);
    });

    it('retains a withdrawn curated listing as a non-installable warning without granting disable authority', () => {
        const page = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({
                pluginId: 'sample.withdrawn',
                display: { title: 'Withdrawn Plugin', description: 'Previously curated plugin' },
                review: { status: 'withdrawn', reviewedAt: null },
            })],
        }));

        expect(page.entries).toEqual([{
            id: 'sample.withdrawn',
            sourceId: 'marketplace:curated',
            sourceKind: 'curated',
            sourceTitle: 'Happier curated',
            reviewStatus: 'withdrawn',
            updatePolicy: 'reviewEveryUpdate',
            publisher: { id: 'sample', displayName: 'Sample' },
            categories: ['agents'],
            executableRealms: ['daemon'],
            platforms: ['web'],
            title: 'Withdrawn Plugin',
            description: 'Previously curated plugin',
            version: '1.2.3',
            packageName: 'sample-plugin',
            installable: false,
            warning: 'withdrawn',
        }]);
        // A withdrawal is a warning the reader must see, not a listing this
        // machine merely failed to acquire.
        expect(page.nonInstallable).toEqual([]);
    });

    it.each([
        ['sourceStale', { freshness: { state: 'stale' as const, fetchedAtMs: 1, staleSinceMs: 1 } }],
        ['notApproved', { review: { status: 'blocked' as const, reviewedAt: null } }],
        ['artifactUnavailable', { artifactAccess: { state: 'auth-unavailable' as const, registryProfileId: 'profile-1' } }],
    ])('reports a dropped %s listing instead of silently discarding the source fact', (reason, override) => {
        const page = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem(override)],
        }));

        expect(page.entries).toEqual([]);
        expect(page.nonInstallable).toEqual([{
            pluginId: 'sample.plugin',
            title: 'Sample Plugin',
            sourceId: 'marketplace:curated',
            sourceTitle: 'Happier curated',
            reason,
        }]);
    });

    it('carries per-source freshness and diagnostics through instead of collapsing them into one failure', () => {
        const page = projectDaemonMarketplaceIndexPage(createPage({
            sources: [
                {
                    source: CURATED_SOURCE,
                    freshness: { state: 'fresh', fetchedAtMs: 10 },
                    diagnostics: [],
                },
                {
                    source: {
                        id: 'marketplace:user',
                        title: 'Internal index',
                        kind: 'user',
                        sourceUrl: 'https://internal.example.test/index.json',
                    },
                    freshness: { state: 'stale-offline', fetchedAtMs: 5, staleSinceMs: 6 },
                    diagnostics: [
                        { code: 'source_offline', message: 'The index host could not be reached.' },
                        { code: 'source_offline', message: 'The cached index is also unavailable.' },
                    ],
                },
            ],
            diagnostics: [
                { code: 'index_partial', message: 'Some sources did not answer.' },
                { code: 'index_partial', message: 'Some results may be missing.' },
            ],
        }));

        expect(page.sources).toEqual([
            {
                id: 'marketplace:curated',
                title: 'Happier curated',
                kind: 'curated',
                freshness: 'fresh',
                diagnostics: [],
            },
            {
                id: 'marketplace:user',
                title: 'Internal index',
                kind: 'user',
                freshness: 'stale-offline',
                diagnostics: [{
                    id: 'source:marketplace%3Auser:source_offline:0',
                    sourceId: 'marketplace:user',
                    sourceTitle: 'Internal index',
                    code: 'source_offline',
                    message: 'The index host could not be reached.',
                }, {
                    id: 'source:marketplace%3Auser:source_offline:1',
                    sourceId: 'marketplace:user',
                    sourceTitle: 'Internal index',
                    code: 'source_offline',
                    message: 'The cached index is also unavailable.',
                }],
            },
        ]);
        expect(page.diagnostics).toEqual([{
            id: 'index:index_partial:0',
            sourceId: null,
            sourceTitle: null,
            code: 'index_partial',
            message: 'Some sources did not answer.',
        }, {
            id: 'index:index_partial:1',
            sourceId: null,
            sourceTitle: null,
            code: 'index_partial',
            message: 'Some results may be missing.',
        }]);
    });
});

describe('mergeDiscoverEntries', () => {
    it('appends a following page deterministically and drops listings already shown', () => {
        const first = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ pluginId: 'a.plugin' }), createIndexItem({ pluginId: 'b.plugin' })],
        })).entries;
        const second = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ pluginId: 'b.plugin' }), createIndexItem({ pluginId: 'c.plugin' })],
        })).entries;

        expect(mergeDiscoverEntries(first, second).map((entry) => entry.id))
            .toEqual(['a.plugin', 'b.plugin', 'c.plugin']);
    });

    it('keeps the same plugin listed once per marketplace source it was discovered through', () => {
        const curated = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ pluginId: 'shared.plugin' })],
        })).entries;
        const community = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({
                pluginId: 'shared.plugin',
                review: { status: 'unreviewed', reviewedAt: null },
                source: {
                    id: 'marketplace:community-npm',
                    title: 'Community npm',
                    kind: 'community-npm',
                    sourceUrl: 'https://registry.npmjs.org/-/v1/search?text=keywords:happier-plugin',
                },
            })],
        })).entries;

        expect(mergeDiscoverEntries(curated, community).map((entry) => entry.sourceId))
            .toEqual(['marketplace:curated', 'marketplace:community-npm']);
    });

    it('returns the previous list unchanged when a following page adds nothing new', () => {
        const first = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ pluginId: 'a.plugin' })],
        })).entries;

        expect(mergeDiscoverEntries(first, first)).toBe(first);
    });
});

describe('mergeDiscoverNonInstallableListings', () => {
    it('deduplicates continuation pages by the same source and plugin identity as installable entries', () => {
        const first = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ freshness: { state: 'stale', fetchedAtMs: 1 } })],
        })).nonInstallable;
        const duplicate = projectDaemonMarketplaceIndexPage(createPage({
            items: [createIndexItem({ freshness: { state: 'stale', fetchedAtMs: 2 } })],
        })).nonInstallable;

        expect(mergeDiscoverNonInstallableListings(first, duplicate)).toBe(first);
    });
});
