import { describe, expect, it } from 'vitest';

import { createSessionPaneScopeId, parseSessionPaneScopeId } from './sessionPaneScopeId';

describe('sessionPaneScopeId', () => {
    it('isolates duplicate destination instances without changing the underlying Session address', () => {
        const first = createSessionPaneScopeId('same:session', 'server:a', 'tab:a#one');
        const second = createSessionPaneScopeId('same:session', 'server:a', 'tab:b');
        expect(first).not.toBe(second);
        expect(first).not.toBe(createSessionPaneScopeId('same:session', 'server:a'));
        expect(parseSessionPaneScopeId(first)).toEqual({ sessionId: 'same:session',
            address: { serverId: 'server:a', sessionId: 'same:session' } });
    });
    it('keeps legacy single-Home scope ids when no server identity is available', () => {
        expect(createSessionPaneScopeId('session-1')).toBe('session:session-1');
        expect(parseSessionPaneScopeId('session:session-1')).toEqual({
            sessionId: 'session-1',
            address: null,
        });
    });

    it('round trips qualified addresses without collisions', () => {
        const first = createSessionPaneScopeId('same:session', 'server:a');
        const second = createSessionPaneScopeId('same:session', 'server:b');

        expect(first).not.toBe(second);
        expect(parseSessionPaneScopeId(first)).toEqual({
            sessionId: 'same:session',
            address: { serverId: 'server:a', sessionId: 'same:session' },
        });
        expect(parseSessionPaneScopeId(second)).toEqual({
            sessionId: 'same:session',
            address: { serverId: 'server:b', sessionId: 'same:session' },
        });
    });
});
