import { describe, expect, it } from 'vitest';
import type { SessionDiscussionOpenedMessageV1 } from '@happier-dev/protocol';

import { prepareDiscussionSelectionHandoff } from './prepareDiscussionSelectionHandoff';

const message = (input: Readonly<{
    id: string;
    seq: number;
    authorAccountId: string | null;
    producerV1?: SessionDiscussionOpenedMessageV1['producerV1'];
    content?: SessionDiscussionOpenedMessageV1['content'];
}>): SessionDiscussionOpenedMessageV1 => ({
    discussionId: 'discussion-a',
    localId: `local-${input.id}`,
    mentionedAccountIds: [],
    createdAt: 1,
    accountActor: input.authorAccountId === null ? null : { v: 1 as const, accountId: input.authorAccountId, profile: null },
    producerV1: input.producerV1 ?? null,
    content: input.content ?? { v: 1 as const, parts: [{ t: 'text' as const, text: input.id }] },
    ...input,
});

describe('prepareDiscussionSelectionHandoff', () => {
    it('uses selected loaded human rows in sequence order and the canonical neutral formatter', () => {
        const labels = new Map([
            ['alice', 'Alice Example'],
            ['bob', 'Bob Example'],
            ['carol', 'Carol Example'],
        ]);
        const result = prepareDiscussionSelectionHandoff({
            sessionId: 'session-a',
            discussionId: 'discussion-a',
            selectedMessageIds: ['m3', 'm1', 'agent', 'unavailable'],
            messages: [
                message({ id: 'm3', seq: 3, authorAccountId: 'bob', content: { v: 1, parts: [{ t: 'text', text: 'Hi ' }, { t: 'mention', accountId: 'carol' }] } }),
                message({ id: 'agent', seq: 2, authorAccountId: 'alice', producerV1: { v: 1, kind: 'agent', sessionId: 'session-a' } }),
                message({ id: 'm1', seq: 1, authorAccountId: 'alice', content: { v: 1, parts: [{ t: 'text', text: 'First' }] } }),
                message({ id: 'unavailable', seq: 4, authorAccountId: 'alice', content: null }),
            ],
            resolveAccountLabel: (accountId) => labels.get(accountId) ?? null,
            format: 'markdown_labeled',
            roleLabels: { user: 'User', assistant: 'Assistant' },
        });

        expect(result).toEqual({
            text: '**Alice Example:**\n\nFirst\n\n**Bob Example:**\n\nHi @Carol Example',
            source: {
                kind: 'session_discussion',
                sessionId: 'session-a',
                discussionId: 'discussion-a',
                messageIds: ['m1', 'm3'],
            },
        });
        expect(result?.source).not.toHaveProperty('draftCorrelationId');
    });

    it('returns null instead of leaking Account ids when an author or mention label is unresolved', () => {
        const base = {
            sessionId: 'session-a',
            discussionId: 'discussion-a',
            selectedMessageIds: ['m1'],
            format: 'plain' as const,
            roleLabels: { user: 'User', assistant: 'Assistant' },
        };
        expect(prepareDiscussionSelectionHandoff({
            ...base,
            messages: [message({ id: 'm1', seq: 1, authorAccountId: 'alice' })],
            resolveAccountLabel: () => null,
        })).toBeNull();
        expect(prepareDiscussionSelectionHandoff({
            ...base,
            messages: [message({ id: 'm1', seq: 1, authorAccountId: 'alice', content: { v: 1, parts: [{ t: 'mention', accountId: 'bob' }] } })],
            resolveAccountLabel: (id) => id === 'alice' ? 'Alice' : null,
        })).toBeNull();
    });
});
