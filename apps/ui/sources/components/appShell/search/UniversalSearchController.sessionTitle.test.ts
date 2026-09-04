import { describe, expect, it } from 'vitest';

import { buildUniversalSearchSessionTitleKey } from './universalSearchResult';

describe('UniversalSearchController transcript title identity', () => {
    it('keeps equal session ids on different Homes distinct', () => {
        expect(buildUniversalSearchSessionTitleKey('account-a', 'home-a', 'session-1'))
            .not.toBe(buildUniversalSearchSessionTitleKey('account-b', 'home-b', 'session-1'));
    });
});
