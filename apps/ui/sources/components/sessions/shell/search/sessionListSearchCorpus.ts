import type { SessionListQueryHomeState } from '@/sync/domains/session/listing/sessionListQueryController';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

import { sessionTagKey } from '../sessionTagUtils';

/**
 * Structural admission for contextual Session search.
 *
 * A filter reduces the accessible corpus; it never grants access, and cache
 * presence is not membership. The canonical row cache is a union of every row
 * this Account has ever loaded — earlier queries, archived pages, metadata
 * inventories — so enumerating it would let a Session that only satisfied an
 * older structural query appear under the current one. Membership therefore
 * comes from the current per-Home paging owner's applied addresses (or, when no
 * structural query is mounted, from the canonical ordinary list membership),
 * and the row cache is used only to resolve an admitted address into a row.
 *
 * A Session that would satisfy the current query but has not been paged in is
 * deliberately *not* admitted: the surface says "No matches in loaded sessions"
 * and offers the bounded next structural page instead of guessing.
 */
export type SessionListSearchCorpusHome = Readonly<{
    serverId: string;
    sessionIds: readonly string[];
}>;

export type SessionListSearchCorpus = Readonly<{
    /** Homes whose structural membership is currently authoritative, in selection order. */
    homes: readonly SessionListSearchCorpusHome[];
    /** Admitted `serverId:sessionId` keys across those Homes. */
    sessionKeys: ReadonlySet<string>;
}>;

export type SessionListSearchCorpusQueryInput = Readonly<{
    /** Selected Homes and the exact corpus identity each one was requested with. */
    homes: readonly Readonly<{ serverId: string; queryKey: string }>[];
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>;
}>;

export type SessionListSearchCorpusOrdinaryInput = Readonly<{
    serverIds: readonly string[];
    membershipByServerId: Readonly<Record<string, readonly string[] | undefined>>;
}>;

const EMPTY_SESSION_KEYS: ReadonlySet<string> = Object.freeze(new Set<string>());
const EMPTY_HOMES: readonly SessionListSearchCorpusHome[] = Object.freeze([]);

export const EMPTY_SESSION_LIST_SEARCH_CORPUS: SessionListSearchCorpus = Object.freeze({
    homes: EMPTY_HOMES,
    sessionKeys: EMPTY_SESSION_KEYS,
});

function normalizeId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildCorpus(homes: readonly SessionListSearchCorpusHome[]): SessionListSearchCorpus {
    const sessionKeys = new Set<string>();
    for (const home of homes) {
        for (const sessionId of home.sessionIds) sessionKeys.add(sessionTagKey(home.serverId, sessionId));
    }
    if (sessionKeys.size === 0) return EMPTY_SESSION_LIST_SEARCH_CORPUS;
    return { homes, sessionKeys };
}

export function resolveSessionListSearchCorpus(input: Readonly<{
    /** Present when the per-Home paging owner is mounted for this surface. */
    query?: SessionListSearchCorpusQueryInput;
    /** Canonical ordinary listing corpus, used when no paging owner is mounted. */
    ordinary?: SessionListSearchCorpusOrdinaryInput;
}>): SessionListSearchCorpus {
    if (input.query) {
        const homes: SessionListSearchCorpusHome[] = [];
        for (const home of input.query.homes) {
            const serverId = normalizeId(home.serverId);
            if (!serverId) continue;
            const state = input.query.statesByServerId[serverId];
            // A Home whose applied corpus is not the requested one is stale: its
            // retained addresses describe another query and cannot admit a match.
            if (!state || state.appliedQueryKey === null || state.appliedQueryKey !== home.queryKey) continue;
            const sessionIds: string[] = [];
            const seen = new Set<string>();
            for (const address of state.addresses) {
                if (!areServerProfileIdentifiersEquivalent(address.serverId, serverId)) continue;
                const sessionId = normalizeId(address.sessionId);
                if (!sessionId || seen.has(sessionId)) continue;
                seen.add(sessionId);
                sessionIds.push(sessionId);
            }
            if (sessionIds.length > 0) homes.push({ serverId, sessionIds });
        }
        return buildCorpus(homes);
    }

    if (!input.ordinary) return EMPTY_SESSION_LIST_SEARCH_CORPUS;
    const homes: SessionListSearchCorpusHome[] = [];
    const seenServerIds = new Set<string>();
    for (const serverIdRaw of input.ordinary.serverIds) {
        const serverId = normalizeId(serverIdRaw);
        if (!serverId || seenServerIds.has(serverId)) continue;
        seenServerIds.add(serverId);
        const membership = input.ordinary.membershipByServerId[serverId];
        if (!membership || membership.length === 0) continue;
        const sessionIds: string[] = [];
        const seen = new Set<string>();
        for (const sessionIdRaw of membership) {
            const sessionId = normalizeId(sessionIdRaw);
            if (!sessionId || seen.has(sessionId)) continue;
            seen.add(sessionId);
            sessionIds.push(sessionId);
        }
        if (sessionIds.length > 0) homes.push({ serverId, sessionIds });
    }
    return buildCorpus(homes);
}

/**
 * Content-stable reuse for one surface's corpus.
 *
 * The per-Home paging owner republishes on every phase/freshness transition, so a
 * fresh corpus object per publication would re-key the debounced transcript request
 * and rebuild the searchable-text projection for rows that did not change.
 */
export function reuseSessionListSearchCorpus(
    previous: SessionListSearchCorpus | null,
    next: SessionListSearchCorpus,
): SessionListSearchCorpus {
    if (!previous || previous === next) return next;
    if (previous.homes.length !== next.homes.length) return next;
    for (let index = 0; index < next.homes.length; index += 1) {
        const previousHome = previous.homes[index]!;
        const nextHome = next.homes[index]!;
        if (previousHome.serverId !== nextHome.serverId) return next;
        if (previousHome.sessionIds.length !== nextHome.sessionIds.length) return next;
        for (let idIndex = 0; idIndex < nextHome.sessionIds.length; idIndex += 1) {
            if (previousHome.sessionIds[idIndex] !== nextHome.sessionIds[idIndex]) return next;
        }
    }
    return previous;
}

/**
 * Exact Session ids the contextual transcript provider may return for one Home.
 *
 * The provider request is per exact Home, so an unknown or unselected Home
 * resolves to the empty set rather than to an unrestricted search: an explicit
 * empty eligibility means "nothing here", while `undefined` would mean "no
 * restriction" at the canonical provider adapter.
 */
export function readSessionListSearchCorpusSessionIdsForHome(
    corpus: SessionListSearchCorpus,
    serverIdRaw: string | null | undefined,
): readonly string[] {
    const serverId = normalizeId(serverIdRaw);
    if (!serverId) return [];
    for (const home of corpus.homes) {
        if (areServerProfileIdentifiersEquivalent(home.serverId, serverId)) return home.sessionIds;
    }
    return [];
}
