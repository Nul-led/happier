import { describe, expect, it } from 'vitest';

import { isSessionRoutePathActive } from '@/sync/domains/session/sessionSurfaceVisibility';

describe('isSessionRoutePathActive', () => {
    it('returns true for the active session route and nested session paths', () => {
        expect(isSessionRoutePathActive('/session/s1', 's1')).toBe(true);
        expect(isSessionRoutePathActive('/session/s1/sharing', 's1')).toBe(true);
        expect(isSessionRoutePathActive('/embed/session/s1', 's1')).toBe(true);
        expect(isSessionRoutePathActive('/embed/session/s%201?i=frame', 's 1')).toBe(true);
        expect(isSessionRoutePathActive('/embed/new', 's1')).toBe(false);
    });

    it('returns false once the pathname leaves the session route', () => {
        expect(isSessionRoutePathActive('/', 's1')).toBe(false);
        expect(isSessionRoutePathActive('/settings', 's1')).toBe(false);
        expect(isSessionRoutePathActive('/session/s2', 's1')).toBe(false);
    });
});
