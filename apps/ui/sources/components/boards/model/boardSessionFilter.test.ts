import { describe, expect, it } from 'vitest';
import { normalizeSessionListFilterV1 } from '@happier-dev/protocol';

import { fromBoardSessionFilter, toBoardSessionFilter } from './boardSessionFilter';

describe('board Sessions filter', () => {
    it('opens the shared editor with every mounted Home selected when the board names none', () => {
        expect(fromBoardSessionFilter(normalizeSessionListFilterV1(), ['home-a', 'home-b'])).toMatchObject({
            homeServerIds: ['home-a', 'home-b'],
            searchQuery: '',
        });
        const narrowed = normalizeSessionListFilterV1({ homeServerIds: ['home-b'], scope: 'following' });
        expect(fromBoardSessionFilter(narrowed, ['home-a', 'home-b'])).toMatchObject({ homeServerIds: ['home-b'], scope: 'following' });
    });

    it('stores the editor result as the board filter: the selection only, never UI search text', () => {
        const stored = toBoardSessionFilter({
            ...normalizeSessionListFilterV1({ scope: 'all_accessible', attention: 'needs_my_attention', homeServerIds: ['home-a', 'home-a'] }),
            searchQuery: 'draft',
        });
        expect(stored).toEqual(normalizeSessionListFilterV1({
            scope: 'all_accessible', attention: 'needs_my_attention', homeServerIds: ['home-a'],
        }));
        expect(stored).not.toHaveProperty('searchQuery');
    });
});
