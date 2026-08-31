import {
    MemorySearchQueryV1Schema,
    MemorySearchResultV1Schema,
    type MemorySearchMode,
    type MemorySearchResultV1,
    type MemorySearchScope,
} from '@happier-dev/protocol';

import { serverFetch } from '@/sync/http/client';

/**
 * Home-local memory search adapter for the plain Personal Home derived index.
 * Transport and auth stay in the canonical `serverFetch`; requests and responses
 * reuse the shared memory-search protocol schemas so daemon and Home results stay
 * interchangeable for presentation.
 */
export async function searchHomeMemory(args: Readonly<{
    query: string;
    scope: MemorySearchScope;
    mode: MemorySearchMode;
    maxResults?: number;
    minScore?: number;
}>): Promise<MemorySearchResultV1> {
    const parsedQuery = MemorySearchQueryV1Schema.safeParse({
        v: 1,
        query: args.query.trim(),
        scope: args.scope,
        mode: args.mode,
        ...(typeof args.maxResults === 'number' ? { maxResults: args.maxResults } : {}),
        ...(typeof args.minScore === 'number' ? { minScore: args.minScore } : {}),
    });
    if (!parsedQuery.success) {
        return {
            v: 1,
            ok: false,
            errorCode: 'memory_invalid_query',
            error: 'Memory search requires a non-empty query within supported limits.',
        };
    }

    try {
        const response = await serverFetch('/v1/home/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsedQuery.data),
        });
        if (response.status === 404) {
            return {
                v: 1,
                ok: false,
                errorCode: 'memory_index_missing',
                error: 'Personal Home search is not available on this server.',
            };
        }
        if (!response.ok) {
            return {
                v: 1,
                ok: false,
                errorCode: 'memory_failed',
                error: `Personal Home search failed with status ${response.status}.`,
            };
        }
        return MemorySearchResultV1Schema.parse(await response.json());
    } catch {
        return {
            v: 1,
            ok: false,
            errorCode: 'memory_failed',
            error: 'Personal Home search failed.',
        };
    }
}
