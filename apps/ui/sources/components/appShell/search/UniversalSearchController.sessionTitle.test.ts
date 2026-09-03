import { describe, expect, it } from 'vitest';

import { buildUniversalSearchSessionTitleKey } from './universalSearchResult';

describe('UniversalSearchController transcript title identity', () => {
    it('keeps equal session ids on different Homes distinct', () => {
        expect(buildUniversalSearchSessionTitleKey('home-a', 'session-1'))
            .not.toBe(buildUniversalSearchSessionTitleKey('home-b', 'session-1'));
    });
});
