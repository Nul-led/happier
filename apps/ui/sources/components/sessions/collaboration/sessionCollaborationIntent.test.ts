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

    it('carries the compact editor\'s query across the handoff, including a deliberately emptied field', () => {
        // The compact composer editor and the full Collaboration surface mount
        // separate controllers, so the only thing lost across the handoff is
        // what the administrator had already typed. It rides the same one-shot
        // mailbox as the focus request rather than a second channel.
        const target = { serverId: 'home-a', sessionId: 'session-1' };

        publishSessionCollaborationIntent(target, 'access', 'ada');
        expect(consumeSessionCollaborationIntent(target)?.query).toBe('ada');

        // The compact editor always hands over its field, and the full destination
        // may be a retained mount still showing an earlier search: an emptied
        // field is an explicit clear. Only an ordinary entry, which hands over no
        // field at all, leaves the destination's search untouched.
        publishSessionCollaborationIntent(target, 'access', '');
        expect(consumeSessionCollaborationIntent(target)).toHaveProperty('query', '');
        publishSessionCollaborationIntent(target, 'access');
        expect(consumeSessionCollaborationIntent(target)).not.toHaveProperty('query');
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
