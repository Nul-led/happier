import { beforeEach, describe, expect, it } from 'vitest';

import {
    consumeInteractiveExecutionRunDraftNavigationIntent,
    publishInteractiveExecutionRunDraftNavigationIntent,
    resetInteractiveExecutionRunDraftNavigationIntentsForTests,
} from './interactiveExecutionRunDraftNavigationIntent';

const address = { serverId: 'server-a', sessionId: 'session-a' } as const;
const source = {
    kind: 'session_discussion' as const,
    sessionId: 'session-a',
    discussionId: 'discussion-a',
    messageIds: ['message-a'],
    draftCorrelationId: 'correlation-a',
};

describe('interactive execution Run draft navigation intent', () => {
    beforeEach(() => resetInteractiveExecutionRunDraftNavigationIntentsForTests());

    it('keeps selected content process-local and exposes only correlation in the qualified route', () => {
        const published = publishInteractiveExecutionRunDraftNavigationIntent({ address, source, initialText: 'private selected text' });

        expect(published).toEqual({
            correlationId: 'correlation-a',
            href: '/session/session-a/runs/new?serverId=server-a&draftCorrelationId=correlation-a',
        });
        expect(published.href).not.toContain('private');
        expect(consumeInteractiveExecutionRunDraftNavigationIntent({ address, correlationId: published.correlationId })).toEqual({ source, initialText: 'private selected text' });
        expect(consumeInteractiveExecutionRunDraftNavigationIntent({ address, correlationId: published.correlationId })).toBeNull();
    });

    it('does not consume an intent from another Home or Session', () => {
        publishInteractiveExecutionRunDraftNavigationIntent({ address, source, initialText: 'private selected text' });

        expect(consumeInteractiveExecutionRunDraftNavigationIntent({
            address: { serverId: 'server-b', sessionId: 'session-a' },
            correlationId: 'correlation-a',
        })).toBeNull();
        expect(consumeInteractiveExecutionRunDraftNavigationIntent({ address, correlationId: 'correlation-a' })).not.toBeNull();
    });

    it('rejects a Discussion handoff without the stable draft correlation identity', () => {
        expect(() => publishInteractiveExecutionRunDraftNavigationIntent({
            address,
            source: { ...source, draftCorrelationId: undefined } as unknown as typeof source,
            initialText: 'private selected text',
        })).toThrow();
    });
});
