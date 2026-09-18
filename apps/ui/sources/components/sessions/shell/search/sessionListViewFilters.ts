import type {
    SessionAttentionFilterV1,
    SessionAudienceSelectionV1,
    SessionListQueryV1,
    SessionListScopeV1,
} from '@happier-dev/protocol';
import { buildSessionListQueryKey } from '@/sync/domains/session/listing/sessionListQueryKey';
import {
    canSessionListOrdinaryPageAnswerQuery,
    type SessionListOrdinaryPageAdapter,
} from '@/sync/domains/session/listing/sessionListQueryController';
import {
    createTeamAddress,
    teamAddressKey,
    type TeamAddress,
} from '@/sync/domains/teams/teamAddress';

export type SessionListViewContext =
    | Readonly<{ kind: 'global' }>
    | Readonly<{
        kind: 'team';
        team: TeamAddress;
        /**
         * The Team's loaded name, from the existing Team directory/detail
         * projection. Display metadata only: it never enters query, cache,
         * selection or context identity, and it is absent until the Home answers
         * so chrome can fall back to the immutable id truthfully.
         */
        teamDisplayName?: string | null;
    }>;

export type QualifiedAudienceSelection = Readonly<{
    serverId: string;
}> & SessionAudienceSelectionV1;

export type QualifiedTagAddress = Readonly<{
    serverId: string;
    tagId: string;
}>;

export type SessionListViewFilters = Readonly<{
    scope: SessionListScopeV1;
    attention: SessionAttentionFilterV1;
    homeServerIds: readonly string[];
    audiences: readonly QualifiedAudienceSelection[];
    tagIds: readonly QualifiedTagAddress[];
    source: 'all' | 'persisted' | 'direct';
    searchQuery: string;
}>;

export type SessionListViewFilterDefaultsInput = Readonly<{
    scope?: SessionListScopeV1;
    attention?: SessionAttentionFilterV1;
    homeServerIds?: readonly string[];
    audiences?: readonly QualifiedAudienceSelection[];
    tagIds?: readonly QualifiedTagAddress[];
    source?: SessionListViewFilters['source'];
    searchQuery?: string;
}>;

export type SessionListFilterDeletedSelections = Readonly<{
    deletedHomeServerIds?: readonly string[];
    deletedAudiences?: readonly QualifiedAudienceSelection[];
    deletedTagIds?: readonly QualifiedTagAddress[];
}>;

export type SessionListSelectionScopeEligibility = Readonly<{
    eligibleHomeServerIds: readonly string[];
    eligibleAudiences: readonly QualifiedAudienceSelection[];
    eligibleTagIds: readonly QualifiedTagAddress[];
}>;

export type SessionListFilterQueryHome = Readonly<{
    serverId: string;
    queryKey: string;
    query: SessionListQueryV1;
}>;

function normalizeId(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

function dedupeIds(values: readonly string[] | undefined): string[] {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const raw of values ?? []) {
        const value = normalizeId(raw);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        next.push(value);
    }
    return next;
}

function normalizeAudience(
    audience: QualifiedAudienceSelection,
): QualifiedAudienceSelection | null {
    const serverId = normalizeId(audience.serverId);
    if (!serverId) return null;
    if (audience.kind === 'outside_teams') {
        return { serverId, kind: 'outside_teams' };
    }
    const teamId = normalizeId(audience.teamId);
    if (!teamId) return null;
    if (audience.kind === 'team') {
        return { serverId, kind: 'team', teamId };
    }
    const groupId = normalizeId(audience.groupId);
    return groupId ? { serverId, kind: 'group', teamId, groupId } : null;
}

export function buildQualifiedAudienceSelectionKey(audience: QualifiedAudienceSelection): string {
    if (audience.kind === 'outside_teams') {
        return JSON.stringify([normalizeId(audience.serverId), audience.kind]);
    }
    if (audience.kind === 'team') {
        return JSON.stringify([
            normalizeId(audience.serverId),
            audience.kind,
            normalizeId(audience.teamId),
        ]);
    }
    return JSON.stringify([
        normalizeId(audience.serverId),
        audience.kind,
        normalizeId(audience.teamId),
        normalizeId(audience.groupId),
    ]);
}

export function buildQualifiedTagAddressKey(address: QualifiedTagAddress): string {
    return JSON.stringify([normalizeId(address.serverId), normalizeId(address.tagId)]);
}

function dedupeAudiences(
    values: readonly QualifiedAudienceSelection[] | undefined,
): QualifiedAudienceSelection[] {
    const seen = new Set<string>();
    const next: QualifiedAudienceSelection[] = [];
    for (const value of values ?? []) {
        const normalized = normalizeAudience(value);
        if (!normalized) continue;
        const key = buildQualifiedAudienceSelectionKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(normalized);
    }
    return next;
}

function dedupeTagIds(values: readonly QualifiedTagAddress[] | undefined): QualifiedTagAddress[] {
    const seen = new Set<string>();
    const next: QualifiedTagAddress[] = [];
    for (const value of values ?? []) {
        const serverId = normalizeId(value.serverId);
        const tagId = normalizeId(value.tagId);
        if (!serverId || !tagId) continue;
        const normalized = { serverId, tagId };
        const key = buildQualifiedTagAddressKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(normalized);
    }
    return next;
}

export function createSessionListViewFilterDefaults(
    input: SessionListViewFilterDefaultsInput = {},
): SessionListViewFilters {
    return {
        scope: input.scope ?? 'my_work',
        attention: input.attention ?? 'any',
        homeServerIds: dedupeIds(input.homeServerIds),
        audiences: dedupeAudiences(input.audiences),
        tagIds: dedupeTagIds(input.tagIds),
        source: input.source ?? 'all',
        searchQuery: input.searchQuery ?? '',
    };
}

export function resolveSessionListViewContextDefaults(
    viewContext: SessionListViewContext,
    mountedHomeServerIds: readonly string[],
    source: SessionListViewFilters['source'],
): Readonly<{
    contextKey: string;
    defaults: SessionListViewFilters;
}> {
    if (viewContext.kind === 'team') {
        const team = createTeamAddress(viewContext.team.serverId, viewContext.team.teamId);
        if (team) {
            return {
                contextKey: `team:${teamAddressKey(team)}`,
                defaults: createSessionListViewFilterDefaults({
                    scope: 'all_accessible',
                    homeServerIds: [team.serverId],
                    audiences: [{ serverId: team.serverId, kind: 'team', teamId: team.teamId }],
                    source,
                }),
            };
        }
    }

    return {
        contextKey: 'global',
        defaults: createSessionListViewFilterDefaults({
            scope: 'my_work',
            homeServerIds: mountedHomeServerIds,
            source,
        }),
    };
}

/**
 * Whether this device has the Team's exact Home mounted, and what to seed the
 * visible Home-group editor with if it does not.
 *
 * This is a mount/selection question only. Whether the Home can serve Team
 * listing at all is the canonical feature owner's decision, projected by
 * `resolveTeamSessionsSurfaceState`; duplicating it here would create a second
 * feature evaluator with its own idea of "unsupported".
 */
export function resolveTeamSessionsHomeSelection(input: Readonly<{
    team: TeamAddress;
    mountedHomeServerIds: readonly string[];
    focusedHomeServerId: string | null | undefined;
}>): Readonly<
    | { kind: 'mounted' }
    | { kind: 'not_mounted'; initialGroupServerIds: readonly string[] }
> {
    const team = createTeamAddress(input.team.serverId, input.team.teamId);
    const mountedHomeServerIds = dedupeIds(input.mountedHomeServerIds);
    if (team && mountedHomeServerIds.includes(team.serverId)) {
        return { kind: 'mounted' };
    }

    return {
        kind: 'not_mounted',
        initialGroupServerIds: dedupeIds([
            ...mountedHomeServerIds,
            normalizeId(input.focusedHomeServerId),
            team?.serverId ?? '',
        ]),
    };
}

/**
 * What the Team Sessions destination should show for one exact Home right now.
 *
 * The four unavailable-looking situations are deliberately distinct: a cold
 * feature probe, a probe that failed, a Home that decided the listing is off, and
 * an enabled Home this device has not mounted are four different problems with
 * four different recoveries. Collapsing them into one "unavailable" screen tells a
 * Team member their Team has no Sessions when the app simply has not asked yet.
 *
 * Feature probing itself is owned by the canonical feature runtime; this resolver
 * only projects that owner's decision plus the incumbent mount/selection helper.
 */
export type TeamSessionsSurfaceState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'probe_failed' }>
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'home_not_mounted'; initialGroupServerIds: readonly string[] }>
    | Readonly<{ kind: 'ready' }>;

export function resolveTeamSessionsSurfaceState(input: Readonly<{
    decision: Readonly<{ state: 'enabled' | 'disabled' | 'unsupported' | 'unknown'; blockerCode: string }> | null;
    homeSelection: ReturnType<typeof resolveTeamSessionsHomeSelection>;
}>): TeamSessionsSurfaceState {
    const decision = input.decision;
    if (!decision) return { kind: 'loading' };
    if (decision.state === 'unknown') {
        return decision.blockerCode === 'probe_failed'
            ? { kind: 'probe_failed' }
            : { kind: 'loading' };
    }
    if (decision.state !== 'enabled') return { kind: 'unavailable' };
    if (input.homeSelection.kind === 'not_mounted') {
        return {
            kind: 'home_not_mounted',
            initialGroupServerIds: input.homeSelection.initialGroupServerIds,
        };
    }
    return { kind: 'ready' };
}

export function normalizeSessionListViewFilters(
    input: SessionListViewFilters,
): SessionListViewFilters {
    return createSessionListViewFilterDefaults(input);
}

export function removeHomeFromSessionListViewFilters(
    filters: SessionListViewFilters,
    serverIdRaw: string,
): SessionListViewFilters {
    const serverId = normalizeId(serverIdRaw);
    if (!serverId || !filters.homeServerIds.includes(serverId)) return filters;
    return {
        ...filters,
        homeServerIds: filters.homeServerIds.filter((value) => value !== serverId),
        audiences: filters.audiences.filter((value) => value.serverId !== serverId),
        tagIds: filters.tagIds.filter((value) => value.serverId !== serverId),
    };
}

export function removeUnavailableSessionListFilterSelections(
    filters: SessionListViewFilters,
    deleted: SessionListFilterDeletedSelections,
): SessionListViewFilters {
    const deletedHomes = new Set(dedupeIds(deleted.deletedHomeServerIds));
    const deletedAudiences = new Set(dedupeAudiences(deleted.deletedAudiences).map(buildQualifiedAudienceSelectionKey));
    const deletedTags = new Set(dedupeTagIds(deleted.deletedTagIds).map(buildQualifiedTagAddressKey));
    if (deletedHomes.size === 0 && deletedAudiences.size === 0 && deletedTags.size === 0) return filters;

    const homeServerIds = filters.homeServerIds.filter((serverId) => !deletedHomes.has(serverId));
    const audiences = filters.audiences.filter((audience) => (
        !deletedHomes.has(audience.serverId)
        && !deletedAudiences.has(buildQualifiedAudienceSelectionKey(audience))
    ));
    const tagIds = filters.tagIds.filter((tag) => (
        !deletedHomes.has(tag.serverId)
        && !deletedTags.has(buildQualifiedTagAddressKey(tag))
    ));
    if (
        homeServerIds.length === filters.homeServerIds.length
        && audiences.length === filters.audiences.length
        && tagIds.length === filters.tagIds.length
    ) {
        return filters;
    }
    return { ...filters, homeServerIds, audiences, tagIds };
}

function toHomeAudience(audience: QualifiedAudienceSelection): SessionAudienceSelectionV1 {
    if (audience.kind === 'outside_teams') return { kind: 'outside_teams' };
    if (audience.kind === 'team') return { kind: 'team', teamId: audience.teamId };
    return { kind: 'group', teamId: audience.teamId, groupId: audience.groupId };
}

export function buildSessionListFilterQueryHomes(
    filters: SessionListViewFilters,
    options: Readonly<{
        storage: SessionListQueryV1['storage'];
        includeInactive: boolean;
        /** Homes currently mounted by the canonical Home-selection owner. */
        mountedHomeServerIds: readonly string[];
        /** Page policy for this surface. Absent means the Home's released default. */
        limit?: number;
        /**
         * Where the tag predicate is applied. `query` is the structural default.
         * `local` belongs to the legacy owner/direct adapter, whose released GET
         * cannot express tags: the request omits them and the loaded rows are
         * narrowed by the same qualified selection on the client.
         */
        tagFacet?: 'query' | 'local';
    }>,
): SessionListFilterQueryHome[] {
    const normalized = normalizeSessionListViewFilters(filters);
    const mountedHomeServerIds = new Set(dedupeIds(options.mountedHomeServerIds));
    const tagFacetLocal = options.tagFacet === 'local';
    // An active corpus always asks for the attention supplement, exactly like the
    // incumbent active list. It is a property of the corpus, not of the layout or
    // attention-placement preference, so arranging the same corpus issues no request.
    // An archived corpus relies on its explicit storage + attention predicate and
    // has no active supplemental band to request.
    const includeAttention = options.storage === 'active';
    const audienceFacetActive = normalized.audiences.length > 0;
    const tagFacetActive = !tagFacetLocal && normalized.tagIds.length > 0;
    return normalized.homeServerIds
        .filter((serverId) => mountedHomeServerIds.has(serverId))
        // Qualified facet values are Home-local. When a facet is active globally,
        // a Home with no value in that facet cannot match; an empty per-Home array
        // would instead broaden that Home to an unrestricted query.
        .filter((serverId) => (
            (!audienceFacetActive || normalized.audiences.some((audience) => audience.serverId === serverId))
            && (!tagFacetActive || normalized.tagIds.some((tag) => tag.serverId === serverId))
        ))
        .map((serverId) => {
            const query: SessionListQueryV1 = {
                v: 1,
                storage: options.storage,
                includeInactive: options.includeInactive,
                scope: normalized.scope,
                attention: normalized.attention,
                audiences: normalized.audiences
                    .filter((audience) => audience.serverId === serverId)
                    .map(toHomeAudience),
                tagIds: tagFacetLocal
                    ? []
                    : normalized.tagIds
                        .filter((tag) => tag.serverId === serverId)
                        .map((tag) => tag.tagId),
                ...(includeAttention ? { includeAttention: true } : {}),
                ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
            };
            return {
                serverId,
                queryKey: buildSessionListQueryKey(serverId, query),
                query,
            };
        });
}

/**
 * Source and text search are local projections over canonical Session rows. When
 * a Home cannot serve filtered listing, the existing ordinary per-Home page
 * adapter can still advance that corpus so either projection does not silently
 * stop at the active Home's first page. Structural Team/Group/tag/attention
 * queries never receive this adapter: the released GET does not answer those
 * predicates and must not broaden them.
 */
export function resolveSessionListFilterOrdinaryPageAdapter(
    filters: SessionListViewFilters,
    query: SessionListQueryV1,
): SessionListOrdinaryPageAdapter | null {
    if (!canSessionListOrdinaryPageAnswerQuery(query)) return null;
    if (query.storage === 'archived') {
        return { path: '/v2/sessions/archived', allowV1Fallback: false, membership: 'archived' };
    }
    if (
        (
            filters.source !== 'all'
            || filters.searchQuery.trim().length > 0
            // A tag selection the request does not carry is a local projection over
            // this corpus, exactly like Source and text search.
            || filters.tagIds.length > 0
        )
        && query.storage === 'active'
    ) {
        return { path: '/v2/sessions', allowV1Fallback: true, membership: 'ordinary' };
    }
    return null;
}

export function shouldUseSessionListFilterQuerySource(
    filters: SessionListViewFilters,
    options: Readonly<{
        mountedHomeServerIds: readonly string[];
        queryEnabled: boolean;
        hasOrdinaryAdapter: boolean;
    }>,
): boolean {
    if (options.queryEnabled || options.hasOrdinaryAdapter) return true;
    const normalized = normalizeSessionListViewFilters(filters);
    const mountedHomeServerIds = dedupeIds(options.mountedHomeServerIds);
    const selectedMountedHomeServerIds = normalized.homeServerIds
        .filter((serverId) => mountedHomeServerIds.includes(serverId));
    return normalized.homeServerIds.length === 0
        || selectedMountedHomeServerIds.length !== mountedHomeServerIds.length
        || normalized.audiences.length > 0
        || normalized.tagIds.length > 0
        || normalized.attention !== 'any'
        || normalized.scope !== 'my_work';
}

/**
 * The filter owner may certify an empty query only after it has a real mounted
 * Home set to filter. The identical `[]` during initial Home discovery remains
 * non-authoritative and must not turn Search into a permanent empty result.
 */
export function isSessionListEmptyQuerySelectionComplete(input: Readonly<{
    useQuerySource: boolean;
    mountedHomeCount: number;
    queryHomeCount: number;
}>): boolean {
    return input.useQuerySource && input.mountedHomeCount > 0 && input.queryHomeCount === 0;
}

function normalizeSearchQueryIdentity(query: string): string {
    return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function buildSessionListSelectionScopeSignature(
    filters: SessionListViewFilters,
    eligibility: SessionListSelectionScopeEligibility,
): string {
    const eligibleHomes = new Set(dedupeIds(eligibility.eligibleHomeServerIds));
    const selectedHomes = filters.homeServerIds.filter((serverId) => eligibleHomes.has(serverId));
    const selectedHomeSet = new Set(selectedHomes);
    const eligibleAudiences = new Set(
        dedupeAudiences(eligibility.eligibleAudiences).map(buildQualifiedAudienceSelectionKey),
    );
    const eligibleTags = new Set(
        dedupeTagIds(eligibility.eligibleTagIds).map(buildQualifiedTagAddressKey),
    );
    const audiences = filters.audiences
        .filter((audience) => (
            selectedHomeSet.has(audience.serverId)
            && eligibleAudiences.has(buildQualifiedAudienceSelectionKey(audience))
        ))
        .map(buildQualifiedAudienceSelectionKey)
        .sort();
    const tagIds = filters.tagIds
        .filter((tag) => (
            selectedHomeSet.has(tag.serverId)
            && eligibleTags.has(buildQualifiedTagAddressKey(tag))
        ))
        .map(buildQualifiedTagAddressKey)
        .sort();
    return JSON.stringify({
        scope: filters.scope,
        attention: filters.attention,
        source: filters.source,
        searchQuery: normalizeSearchQueryIdentity(filters.searchQuery),
        homeServerIds: [...selectedHomes].sort(),
        audiences,
        tagIds,
    });
}
