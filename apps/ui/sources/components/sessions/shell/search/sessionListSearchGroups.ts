import type {
    SessionListContextualSearchReason,
    SessionListIndexItem,
} from '@/sync/domains/sessionList/sessionListIndex';

export const SESSION_LIST_SEARCH_IN_THIS_VIEW_GROUP_KEY = 'search:in-this-view';
export const SESSION_LIST_SEARCH_OTHER_MATCHES_GROUP_KEY = 'search:other-matches';

export type SessionListSearchOutsideMatch = Readonly<{
    sessionKey: string;
    serverId: string;
    sessionId: string;
    reasons: readonly SessionListContextualSearchReason[];
    sourceMachineId?: string | null;
}>;

/**
 * Resolves transcript matches that are valid but absent from the current filtered
 * view (archived, inactive, unloaded, external, or filter-hidden sessions).
 *
 * A hit is never dropped because its session was not already rendered. A hit that
 * belongs to the underlying list but is excluded by current filters receives that
 * host-known reason here; the caller materializes every returned identity through
 * the canonical session row pipeline.
 */
export function resolveSessionListSearchOutsideMatches(params: Readonly<{
    candidateSessionKeys: ReadonlySet<string>;
    currentViewSessionKeys?: ReadonlySet<string>;
    matchedSessionTargets: ReadonlyArray<SessionListSearchOutsideMatch>;
}>): ReadonlyArray<SessionListSearchOutsideMatch> {
    if (params.matchedSessionTargets.length === 0) return [];
    const currentViewSessionKeys = params.currentViewSessionKeys ?? params.candidateSessionKeys;
    const outside: SessionListSearchOutsideMatch[] = [];
    for (const target of params.matchedSessionTargets) {
        if (currentViewSessionKeys.has(target.sessionKey)) continue;
        if (
            params.candidateSessionKeys.has(target.sessionKey)
            && !target.reasons.includes('hidden-by-filters')
        ) {
            outside.push({
                ...target,
                reasons: [...target.reasons, 'hidden-by-filters'],
            });
            continue;
        }
        outside.push(target);
    }
    return outside;
}

/**
 * Appends an `Other matches` group of outside-view session identities after the
 * in-view results, labelling the in-view region only when both regions exist.
 *
 * This groups; it never mutates the user's list filters and never sorts transcript
 * relevance against canonical metadata results.
 */
export function appendSessionListSearchOtherMatches(params: Readonly<{
    filteredItems: ReadonlyArray<SessionListIndexItem>;
    outsideMatches: ReadonlyArray<SessionListSearchOutsideMatch>;
    inThisViewTitle: string;
    otherMatchesTitle: string;
}>): SessionListIndexItem[] {
    const filtered = params.filteredItems as SessionListIndexItem[];
    if (params.outsideMatches.length === 0) return filtered;

    const hasInViewSessions = filtered.some((item) => item.type === 'session');
    const next: SessionListIndexItem[] = [];
    if (hasInViewSessions) {
        next.push({
            type: 'header',
            title: params.inThisViewTitle,
            headerKind: 'sessions',
            groupKey: SESSION_LIST_SEARCH_IN_THIS_VIEW_GROUP_KEY,
        });
    }
    next.push(...filtered);
    next.push({
        type: 'header',
        title: params.otherMatchesTitle,
        headerKind: 'sessions',
        groupKey: SESSION_LIST_SEARCH_OTHER_MATCHES_GROUP_KEY,
    });
    for (const match of params.outsideMatches) {
        next.push({
            type: 'session',
            sessionId: match.sessionId,
            serverId: match.serverId,
            groupKey: SESSION_LIST_SEARCH_OTHER_MATCHES_GROUP_KEY,
            groupKind: 'active',
            variant: 'no-path',
            contextualSearchReasons: match.reasons,
            contextualSearchSourceMachineId: match.sourceMachineId ?? null,
        });
    }
    return next;
}
