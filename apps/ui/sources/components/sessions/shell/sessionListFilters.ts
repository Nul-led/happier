import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';

import { sessionTagKey } from './sessionTagUtils';
import { isSessionListPrimaryHeaderKind } from './sessionListPrimaryHeader';

export type SessionListHeaderFilterInput = Readonly<{
    searchQuery: string;
    selectedTags: ReadonlyArray<string>;
    searchableTextBySessionKey: Readonly<Record<string, string>>;
    primarySearchableTextBySessionKey?: Readonly<Record<string, string>>;
    memoryMatchedSessionKeys?: ReadonlySet<string>;
}>;

export type SessionListHeaderFilterState = SessionListHeaderFilterInput & Readonly<{
    sessionTags: Readonly<Record<string, readonly string[]>>;
}>;

function normalizeSearchTokens(query: string): string[] {
    return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
}

function buildSessionKey(item: Extract<SessionListIndexItem, { type: 'session' }>): string | null {
    const serverId = String(item.serverId ?? '').trim();
    const sessionId = String(item.sessionId ?? '').trim();
    if (!serverId || !sessionId) return null;
    return sessionTagKey(serverId, sessionId);
}

function sessionMatchesSelectedTags(
    sessionKey: string | null,
    selectedTags: ReadonlySet<string>,
    sessionTags: Readonly<Record<string, readonly string[]>>,
): boolean {
    if (selectedTags.size === 0) return true;
    if (!sessionKey) return false;
    const tags = sessionTags[sessionKey] ?? [];
    return tags.some((tag) => selectedTags.has(tag));
}

export type SessionListSearchMatchClass = 'exact' | 'metadata' | 'transcript';

function resolveSessionSearchMatchClass(
    sessionKey: string | null,
    normalizedQuery: string,
    searchTokens: ReadonlyArray<string>,
    searchableTextBySessionKey: Readonly<Record<string, string>>,
    primarySearchableTextBySessionKey: Readonly<Record<string, string>> | null | undefined,
    memoryMatchedSessionKeys: ReadonlySet<string> | null | undefined,
): SessionListSearchMatchClass | null {
    if (searchTokens.length === 0) return 'metadata';
    if (!sessionKey) return null;
    const primaryLines = primarySearchableTextBySessionKey?.[sessionKey]
        ?.split('\n')
        .map((value) => value.trim().toLocaleLowerCase())
        .filter(Boolean) ?? [];
    if (primaryLines.includes(normalizedQuery)) return 'exact';
    const haystack = searchableTextBySessionKey[sessionKey]?.toLocaleLowerCase() ?? '';
    if (haystack && searchTokens.every((token) => haystack.includes(token))) return 'metadata';
    if (memoryMatchedSessionKeys?.has(sessionKey)) return 'transcript';
    return null;
}

function rankContiguousSessionRuns(
    items: SessionListIndexItem[],
    input: SessionListHeaderFilterState,
    normalizedQuery: string,
    searchTokens: ReadonlyArray<string>,
): SessionListIndexItem[] {
    if (searchTokens.length === 0) return items;
    const providerRank = new Map<string, number>();
    let nextProviderRank = 0;
    for (const sessionKey of input.memoryMatchedSessionKeys ?? []) {
        providerRank.set(sessionKey, nextProviderRank);
        nextProviderRank += 1;
    }
    const bandRank: Record<SessionListSearchMatchClass, number> = {
        exact: 0,
        metadata: 1,
        transcript: 2,
    };
    const next = items.slice();
    let runStart = 0;
    while (runStart < next.length) {
        if (next[runStart]?.type !== 'session') {
            runStart += 1;
            continue;
        }
        let runEnd = runStart + 1;
        while (runEnd < next.length && next[runEnd]?.type === 'session') runEnd += 1;
        const ranked = next.slice(runStart, runEnd).map((item, index) => {
            const session = item as Extract<SessionListIndexItem, { type: 'session' }>;
            const sessionKey = buildSessionKey(session);
            const matchClass = resolveSessionSearchMatchClass(
                sessionKey,
                normalizedQuery,
                searchTokens,
                input.searchableTextBySessionKey,
                input.primarySearchableTextBySessionKey,
                input.memoryMatchedSessionKeys,
            ) ?? 'transcript';
            return {
                item,
                index,
                band: bandRank[matchClass],
                provider: matchClass === 'transcript' && sessionKey
                    ? providerRank.get(sessionKey) ?? Number.MAX_SAFE_INTEGER
                    : index,
            };
        }).sort((left, right) => (
            left.band - right.band
            || left.provider - right.provider
            || left.index - right.index
        ));
        for (let index = 0; index < ranked.length; index += 1) {
            next[runStart + index] = ranked[index]!.item;
        }
        runStart = runEnd;
    }
    return next;
}

export function hasActiveSessionListHeaderFilters(input: Pick<SessionListHeaderFilterInput, 'searchQuery' | 'selectedTags'> | null | undefined): boolean {
    if (!input) return false;
    return input.searchQuery.trim().length > 0 || input.selectedTags.length > 0;
}

export function filterSessionListItemsForHeaderControls(
    items: ReadonlyArray<SessionListIndexItem>,
    input: SessionListHeaderFilterState,
): SessionListIndexItem[] {
    if (!hasActiveSessionListHeaderFilters(input)) return items as SessionListIndexItem[];

    const searchTokens = normalizeSearchTokens(input.searchQuery);
    const normalizedQuery = input.searchQuery.trim().toLocaleLowerCase();
    const selectedTags = new Set(input.selectedTags);
    const result: SessionListIndexItem[] = [];
    let pendingHeaders: Extract<SessionListIndexItem, { type: 'header' }>[] = [];

    for (const item of items) {
        if (item.type === 'header') {
            if (isSessionListPrimaryHeaderKind(item.headerKind)) {
                pendingHeaders = [item];
            } else {
                pendingHeaders.push(item);
            }
            continue;
        }

        const key = buildSessionKey(item);
        if (
            !sessionMatchesSelectedTags(key, selectedTags, input.sessionTags)
            || resolveSessionSearchMatchClass(
                key,
                normalizedQuery,
                searchTokens,
                input.searchableTextBySessionKey,
                input.primarySearchableTextBySessionKey,
                input.memoryMatchedSessionKeys,
            ) === null
        ) {
            continue;
        }

        if (pendingHeaders.length > 0) {
            result.push(...pendingHeaders);
            pendingHeaders = [];
        }
        result.push(item);
    }

    // No header is preserved for an empty result: the stable search chrome owns the
    // field's lifetime, and the list-level no-results message reports the outcome.
    return rankContiguousSessionRuns(result, input, normalizedQuery, searchTokens);
}
