import { describe, expect, it } from 'vitest';

import {
    UNIVERSAL_SEARCH_ROUTE,
    resolveUniversalSearchRoutePresentation,
} from './universalSearchRoutePresentation';

describe('universal Search route presentation', () => {
    it('keeps one canonical route for deep links, native entry and web access', () => {
        expect(UNIVERSAL_SEARCH_ROUTE).toBe('/search');
    });

    it('presents native Search as a transparent overlay over the screen behind it', () => {
        expect(resolveUniversalSearchRoutePresentation({ platformOs: 'ios' })).toBe('transparentModal');
        expect(resolveUniversalSearchRoutePresentation({ platformOs: 'android' })).toBe('transparentModal');
    });

    it('leaves web/desktop on the ordinary router presentation', () => {
        // The shortcut and the sidebar row open the modal in place there; `/search` stays a direct
        // deep-linkable screen rendering the same controller.
        expect(resolveUniversalSearchRoutePresentation({ platformOs: 'web' })).toBeUndefined();
        expect(resolveUniversalSearchRoutePresentation({ platformOs: 'macos' })).toBeUndefined();
    });
});
