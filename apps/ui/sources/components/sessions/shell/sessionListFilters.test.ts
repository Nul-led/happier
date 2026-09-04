import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';

import { filterSessionListItemsForHeaderControls } from './sessionListFilters';

const activeHeader: Extract<SessionListIndexItem, { type: 'header' }> = {
    type: 'header',
    title: 'Active',
    headerKind: 'active',
    groupKey: 'active',
    serverId: 'server-a',
};

function sessionItem(
    sessionId: string,
    overrides: Partial<Pick<Extract<SessionListIndexItem, { type: 'session' }>, 'groupKey' | 'groupKind' | 'section'>> = {},
): Extract<SessionListIndexItem, { type: 'session' }> {
    return {
        type: 'session',
        sessionId,
        serverId: 'server-a',
        section: overrides.section ?? 'active',
        groupKey: overrides.groupKey ?? 'active',
        groupKind: overrides.groupKind ?? 'active',
    };
}

const inactiveHeader: Extract<SessionListIndexItem, { type: 'header' }> = {
    type: 'header',
    title: 'Inactive',
    headerKind: 'inactive',
    groupKey: 'inactive',
    serverId: 'server-a',
};

describe('filterSessionListItemsForHeaderControls', () => {
    it('filters sessions by indexed search text and prunes empty headers', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
            sessionItem('beta'),
        ], {
            searchQuery: 'invoice parser',
            selectedTags: [],
            sessionTags: {},
            searchableTextBySessionKey: {
                'server-a:beta': 'Please repair the invoice parser regression.',
            },
        });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Active',
            'beta',
        ]);
    });

    it('keeps a memory-matched session when local searchable text does not match', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
            sessionItem('beta'),
        ], {
            searchQuery: 'vector cache',
            selectedTags: [],
            sessionTags: {},
            searchableTextBySessionKey: {},
            memoryMatchedSessionKeys: new Set(['server-a:beta']),
        });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Active',
            'beta',
        ]);
    });

    it('stable-partitions a grouped session run into exact, metadata, then provider-ordered transcript bands', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('transcript-second'),
            sessionItem('metadata'),
            sessionItem('exact'),
            sessionItem('transcript-first'),
        ], {
            searchQuery: 'payments',
            selectedTags: [],
            sessionTags: {},
            searchableTextBySessionKey: {
                'server-a:metadata': 'release payments migration',
                'server-a:exact': 'exact\nPayments',
            },
            primarySearchableTextBySessionKey: {
                'server-a:exact': 'Payments',
            },
            memoryMatchedSessionKeys: new Set([
                'server-a:transcript-first',
                'server-a:transcript-second',
            ]),
        });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Active',
            'exact',
            'metadata',
            'transcript-first',
            'transcript-second',
        ]);
    });

    it('keeps selected tag filters conjunctive for memory-matched sessions', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
            sessionItem('beta'),
        ], {
            searchQuery: 'vector cache',
            selectedTags: ['release'],
            sessionTags: {
                'server-a:alpha': ['release'],
                'server-a:beta': ['later'],
            },
            searchableTextBySessionKey: {},
            memoryMatchedSessionKeys: new Set(['server-a:beta']),
        });

        expect(result).toEqual([]);
    });

    it('keeps sessions matching any selected tag', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
            sessionItem('beta'),
        ], {
            searchQuery: '',
            selectedTags: ['release', 'billing'],
            sessionTags: {
                'server-a:alpha': ['ops'],
                'server-a:beta': ['billing'],
            },
            searchableTextBySessionKey: {},
        });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Active',
            'beta',
        ]);
    });

    it('prunes a primary header when active filters match no sessions', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
        ], {
            searchQuery: '',
            selectedTags: ['missing'],
            sessionTags: {
                'server-a:alpha': ['release'],
            },
            searchableTextBySessionKey: {},
        });

        expect(result).toEqual([]);
    });

    it('filters across groups without preserving an empty controls-anchor header', () => {
        const result = filterSessionListItemsForHeaderControls([
            activeHeader,
            sessionItem('alpha'),
            inactiveHeader,
            sessionItem('beta', {
                section: 'inactive',
                groupKey: 'inactive',
            }),
        ], {
            searchQuery: '',
            selectedTags: ['later'],
            sessionTags: {
                'server-a:alpha': ['release'],
                'server-a:beta': ['later'],
            },
            searchableTextBySessionKey: {},
        });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Inactive',
            'beta',
        ]);
    });

    it('returns no header-only remainder when nothing matches', () => {
        const pinnedHeader: Extract<SessionListIndexItem, { type: 'header' }> = {
            type: 'header',
            title: 'Pinned',
            headerKind: 'pinned',
            groupKey: 'pinned',
            serverId: 'server-a',
        };
        const result = filterSessionListItemsForHeaderControls([
            pinnedHeader,
            sessionItem('alpha', {
                groupKey: 'pinned',
                groupKind: 'pinned',
            }),
            activeHeader,
            sessionItem('beta'),
        ], {
            searchQuery: 'nothing matches',
            selectedTags: [],
            sessionTags: {},
            searchableTextBySessionKey: {},
        });

        // The stable search chrome owns the field's lifetime, so no header is kept
        // alive purely to host it; the list-level no-results message reports zero hits.
        expect(result).toEqual([]);
    });
});
