import { afterEach, describe, expect, it } from 'vitest';

import {
    consumeSessionCollaborationIntent,
    publishSessionCollaborationIntent,
    resetSessionCollaborationIntentsForTests,
} from './sessionCollaborationIntent';

describe('Session Collaboration presentation intents', () => {
    afterEach(resetSessionCollaborationIntentsForTests);

    it('isolates duplicate raw Session ids by exact Home', () => {
        const homeA = { serverId: 'home-a', sessionId: 'same-id' };
        const homeB = { serverId: 'home-b', sessionId: 'same-id' };

        publishSessionCollaborationIntent(homeA, 'access');

        expect(consumeSessionCollaborationIntent(homeB)).toBeNull();
        expect(consumeSessionCollaborationIntent(homeA)?.focusTarget).toBe('access');
    });

    it('lets the newest explicit focus win and consumes it only once', () => {
        const target = { serverId: 'home-a', sessionId: 'session-1' };

        const first = publishSessionCollaborationIntent(target, 'top');
        const second = publishSessionCollaborationIntent(target, 'access');

        expect(second.intentId).toBeGreaterThan(first.intentId);
        expect(consumeSessionCollaborationIntent(target)).toEqual(second);
        expect(consumeSessionCollaborationIntent(target)).toBeNull();
    });
});
