import { describe, expect, it } from 'vitest';

import { resolveSessionAuthSurfaceState } from './sessionAuthSurfaceState';

describe('Session auth surface', () => {
    it.each(['unauthorized', 'auth_unavailable'] as const)(
        'shows Account recovery for a %s route even before endpoint state catches up',
        (cause) => {
            const input = {
                endpointStatus: 'online',
                syncError: null,
                routeHydrationState: { kind: 'missing' as const, sessionId: 's1', cause },
            };

            expect(resolveSessionAuthSurfaceState(input)).not.toBeNull();
        },
    );

    it.each(['forbidden', 'not_found'] as const)(
        'does not reinterpret %s as an Account authentication failure',
        (cause) => {
            const input = {
                endpointStatus: 'online',
                syncError: null,
                routeHydrationState: { kind: 'missing' as const, sessionId: 's1', cause },
            };

            expect(resolveSessionAuthSurfaceState(input)).toBeNull();
        },
    );
});
