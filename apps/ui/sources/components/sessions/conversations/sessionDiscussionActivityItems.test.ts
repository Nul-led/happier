import { describe, expect, it } from 'vitest';

import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

import {
    buildSessionDiscussionActivityItems,
    sessionDiscussionActivityItemKey,
} from './sessionDiscussionActivityItems';

function discussion(id: string): SessionDiscussionOpenedSummaryV1 {
    return {
        id,
        sessionId: 'session-1',
        creationLocalId: null,
        title: `Discussion ${id}`,
        latestMessage: {
            id: `${id}-m1`,
            localId: null,
            seq: 1,
            authorAccountId: 'account-1',
            accountActor: { v: 1, accountId: 'account-1', profile: null },
            producerV1: null,
            createdAt: 1_700_000_000_000,
        },
        messageSeq: 1,
        lastReadSeq: null,
        unreadCount: 0,
        unreadMentionCount: 0,
        recentAuthorAccountIds: ['account-1'],
        archivedAt: null,
        capabilities: {
            postMessages: true,
            rename: true,
            archive: true,
            restore: false,
            askAgent: true,
            sendToSession: true,
        },
    };
}

describe('buildSessionDiscussionActivityItems', () => {
    it('lists only conversations with people: Agent conversations live in the Agents tab (A3)', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [discussion('d1'), discussion('d2')],
            humanListPending: false,
        });

        expect(items.map((item) => item.kind)).toEqual([
            'human_section',
            'human_discussion',
            'human_discussion',
        ]);
    });

    it('reserves the rows while the first read is pending and invites only once it settled empty', () => {
        const pending = buildSessionDiscussionActivityItems({ discussions: [], humanListPending: true });
        expect(pending.map((item) => item.kind)).toEqual(['human_section', 'human_pending']);

        const settled = buildSessionDiscussionActivityItems({ discussions: [], humanListPending: false });
        expect(settled.map((item) => item.kind)).toEqual(['human_section', 'human_empty']);
    });

    it('gives every item a stable distinct list key', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [discussion('d1'), discussion('d2')],
            humanListPending: false,
        });
        const keys = items.map(sessionDiscussionActivityItemKey);

        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toContain('discussion:d1');
    });
});
