import type {
    MarketplaceIndexItemV1,
    MarketplaceIndexQueryResultV1,
    PluginUpdatePolicyV1,
} from '@happier-dev/protocol/marketplace';
import {
    decideMarketplaceListingInstallV1,
    type MarketplaceListingInstallBlockV1,
} from '@happier-dev/protocol/marketplace';

export type PluginMarketplaceCatalogSourceKind = 'curated' | 'community-npm' | 'user';

/** The freshness the daemon actually had for a source when it served this page. */
export type PluginMarketplaceSourceFreshness = MarketplaceIndexItemV1['freshness']['state'];

export type PluginMarketplaceCatalogEntry = Readonly<{
    id: string;
    sourceId: string;
    sourceKind: PluginMarketplaceCatalogSourceKind;
    sourceTitle: string;
    reviewStatus: 'approved' | 'withdrawn' | 'blocked' | 'unreviewed';
    updatePolicy: PluginUpdatePolicyV1;
    /** Catalog-supplied publisher label. It is presentation, not verified identity. */
    publisher: MarketplaceIndexItemV1['publisher'];
    categories: MarketplaceIndexItemV1['categories'];
    executableRealms: MarketplaceIndexItemV1['summary']['executableRealms'];
    platforms: MarketplaceIndexItemV1['compatibility']['platforms'];
    title: string;
    description: string | null;
    version: string | null;
    /**
     * The npm coordinate this listing publishes. It is not derivable from the
     * manifest plugin id, so the install action carries it rather than letting
     * a later owner guess the package from the id.
     */
    packageName: string;
    installable: boolean;
    warning?: 'withdrawn' | 'unreviewed';
}>;

/**
 * One daemon-reported diagnostic, carried with the source it belongs to.
 *
 * A Discover page is an aggregate over several independent indexes, so a
 * failure is normally partial: collapsing every diagnostic into one "catalog
 * error" would tell the reader that Discover is broken when in fact one
 * internal index is offline and everything else is current.
 */
export type PluginMarketplaceDiscoverDiagnostic = Readonly<{
    /** Source-qualified and collision-free even when one code repeats. */
    id: string;
    sourceId: string | null;
    sourceTitle: string | null;
    code: string;
    message: string;
}>;

export type PluginMarketplaceDiscoverSourceStatus = Readonly<{
    id: string;
    title: string;
    kind: PluginMarketplaceCatalogSourceKind;
    freshness: PluginMarketplaceSourceFreshness;
    diagnostics: readonly PluginMarketplaceDiscoverDiagnostic[];
}>;

/**
 * Why a listing the daemon returned cannot be installed on this machine now.
 *
 * These are kept rather than dropped: "no results" and "eleven results this
 * machine cannot reach right now" are different facts, and only the second one
 * tells the user to fix a registry profile or come back online.
 */
export type PluginMarketplaceNonInstallableListing = Readonly<{
    pluginId: string;
    title: string;
    sourceId: string;
    sourceTitle: string;
    reason: 'sourceStale' | 'artifactUnavailable' | 'notApproved' | 'unsupportedSourceKind';
}>;

export type PluginMarketplaceDiscoverPage = Readonly<{
    /** Index revision this page was served from; a change invalidates a cursor chain. */
    revision: number;
    nextCursor: string | null;
    entries: readonly PluginMarketplaceCatalogEntry[];
    sources: readonly PluginMarketplaceDiscoverSourceStatus[];
    diagnostics: readonly PluginMarketplaceDiscoverDiagnostic[];
    nonInstallable: readonly PluginMarketplaceNonInstallableListing[];
}>;

function isProjectedSourceKind(kind: string): kind is PluginMarketplaceCatalogSourceKind {
    return kind === 'curated' || kind === 'community-npm' || kind === 'user';
}

function discoverDiagnosticId(sourceId: string | null, code: string, occurrence: number): string {
    const scope = sourceId === null ? 'index' : `source:${encodeURIComponent(sourceId)}`;
    return `${scope}:${encodeURIComponent(code)}:${occurrence}`;
}

/**
 * Maps a shared Protocol install block to this projection's reason label.
 * The decision order (durable review trust before transient machine
 * reachability) comes from `decideMarketplaceListingInstallV1`; only the
 * user-facing label stays presentation-owned here. Withdrawn curated
 * listings never reach this mapper — they remain visible as warned entries.
 */
function resolveNonInstallableReason(
    block: MarketplaceListingInstallBlockV1,
): PluginMarketplaceNonInstallableListing['reason'] {
    switch (block) {
        case 'unsupported-source-kind':
            return 'unsupportedSourceKind';
        case 'curated-review-withdrawn':
        case 'curated-review-not-approved':
        case 'full-review-unavailable':
            return 'notApproved';
        case 'source-not-fresh':
            return 'sourceStale';
        case 'artifact-unavailable':
            return 'artifactUnavailable';
    }
}

/**
 * Projects one aggregate index page for Discover.
 *
 * Source disclosure is a first-class fact: every entry names the marketplace
 * source it was discovered through. Curation recommends discovery only — a
 * curated approval never becomes install authorization (every install is the
 * full Install and Trust review), and a withdrawal is a warning, never a
 * decision that disables installed code.
 *
 * This is a projection of one page, not a catalog: the caller owns the cursor
 * chain and the accumulated list, so nothing here builds a second index.
 */
export function projectDaemonMarketplaceIndexPage(
    result: MarketplaceIndexQueryResultV1,
): PluginMarketplaceDiscoverPage {
    const entries: PluginMarketplaceCatalogEntry[] = [];
    const nonInstallable: PluginMarketplaceNonInstallableListing[] = [];

    for (const item of result.items) {
        const sourceKind = item.source.kind;
        // Installability is the one shared Protocol decision beside
        // `MarketplaceIndexAdmissionV1`; this projection owns only
        // presentation (entry shape, warnings, non-installable labels).
        const decision = decideMarketplaceListingInstallV1(item);
        // A withdrawal is a discovery warning the reader must see, never an
        // authority decision over installed code.
        const withdrawn = !decision.installable && decision.block === 'curated-review-withdrawn';

        if (!decision.installable && !withdrawn) {
            nonInstallable.push({
                pluginId: item.pluginId,
                title: item.display.title,
                sourceId: item.source.id,
                sourceTitle: item.source.title,
                reason: resolveNonInstallableReason(decision.block),
            });
            continue;
        }

        entries.push({
            id: item.pluginId,
            sourceId: item.source.id,
            sourceKind,
            sourceTitle: item.source.title,
            reviewStatus: item.review.status,
            updatePolicy: item.updatePolicy,
            publisher: item.publisher,
            categories: item.categories,
            executableRealms: item.summary.executableRealms,
            platforms: item.compatibility.platforms,
            title: item.display.title,
            description: item.display.description,
            version: item.distribution.version,
            packageName: item.distribution.packageName,
            installable: decision.installable,
            ...(withdrawn
                ? { warning: 'withdrawn' as const }
                : sourceKind !== 'curated' && item.review.status === 'unreviewed'
                    ? { warning: 'unreviewed' as const }
                    : {}),
        });
    }

    return {
        revision: result.revision,
        nextCursor: result.nextCursor,
        entries,
        sources: result.sources.flatMap((snapshot) => {
            if (!isProjectedSourceKind(snapshot.source.kind)) return [];
            return [{
                id: snapshot.source.id,
                title: snapshot.source.title,
                kind: snapshot.source.kind,
                freshness: snapshot.freshness.state,
                diagnostics: snapshot.diagnostics.map((diagnostic, occurrence) => ({
                    id: discoverDiagnosticId(snapshot.source.id, diagnostic.code, occurrence),
                    sourceId: snapshot.source.id,
                    sourceTitle: snapshot.source.title,
                    code: diagnostic.code,
                    message: diagnostic.message,
                })),
            }];
        }),
        diagnostics: result.diagnostics.map((diagnostic, occurrence) => ({
            id: discoverDiagnosticId(null, diagnostic.code, occurrence),
            sourceId: null,
            sourceTitle: null,
            code: diagnostic.code,
            message: diagnostic.message,
        })),
        nonInstallable,
    };
}

/** One listing's identity for the paged list: a plugin per source it was found in. */
function discoverListingKey(sourceId: string, pluginId: string): string {
    // Length-prefixed so the pair is unambiguous whatever characters a
    // source id or listing id contains, without an unprintable separator.
    return `${sourceId.length}:${sourceId}:${pluginId}`;
}

function discoverEntryKey(entry: PluginMarketplaceCatalogEntry): string {
    return discoverListingKey(entry.sourceId, entry.id);
}

function discoverNonInstallableKey(entry: PluginMarketplaceNonInstallableListing): string {
    return discoverListingKey(entry.sourceId, entry.pluginId);
}

function mergeDiscoverListings<T>(
    previous: readonly T[],
    next: readonly T[],
    keyOf: (entry: T) => string,
): readonly T[] {
    const seen = new Set(previous.map(keyOf));
    const added = next.filter((entry) => {
        const key = keyOf(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return added.length === 0 ? previous : [...previous, ...added];
}

/**
 * Appends the next cursor page to the list already on screen.
 *
 * Aggregate paging over several indexes can legitimately repeat a listing
 * across page boundaries, so the merge is idempotent on the listing identity
 * and preserves first-seen order. It returns the previous array unchanged when
 * a page adds nothing, so an unchanged list keeps its reference.
 */
export function mergeDiscoverEntries(
    previous: readonly PluginMarketplaceCatalogEntry[],
    next: readonly PluginMarketplaceCatalogEntry[],
): readonly PluginMarketplaceCatalogEntry[] {
    return mergeDiscoverListings(previous, next, discoverEntryKey);
}

/** Deduplicates one freshly acquired page against itself. */
export function dedupeDiscoverEntries(
    entries: readonly PluginMarketplaceCatalogEntry[],
): readonly PluginMarketplaceCatalogEntry[] {
    return mergeDiscoverEntries([], entries);
}

export function mergeDiscoverNonInstallableListings(
    previous: readonly PluginMarketplaceNonInstallableListing[],
    next: readonly PluginMarketplaceNonInstallableListing[],
): readonly PluginMarketplaceNonInstallableListing[] {
    return mergeDiscoverListings(previous, next, discoverNonInstallableKey);
}
