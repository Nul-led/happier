import { describe, expect, it } from 'vitest';

import { SessionDiscussionMessageContentV1Schema } from '@happier-dev/protocol';

import {
    buildSessionDiscussionContent,
    buildSessionDiscussionContentFromPendingText,
    insertDiscussionMention,
    parseDiscussionMentionSpans,
    reconcileDiscussionMentionSpans,
    readActiveDiscussionMentionQuery,
    resolveSessionDiscussionCreationTitle,
} from './discussionComposerDocument';

describe('discussion composer document', () => {
    it('uses a manual title override when present', () => {
        expect(resolveSessionDiscussionCreationTitle({
            title: '  Release review  ',
            text: '\nFirst message',
        })).toBe('Release review');
    });

    it('derives an omitted title from the first nonempty message line without inventing a UI limit', () => {
        const firstLine = 'A deliberately long title remains owned by the protocol request boundary';
        expect(resolveSessionDiscussionCreationTitle({
            title: '   ',
            text: `\n  ${firstLine}  \nSecond line`,
        })).toBe(firstLine);
    });

    it('requires an explicit title when the first message contains only structured mentions', () => {
        expect(resolveSessionDiscussionCreationTitle({
            title: '   ',
            text: '@Alex',
            mentions: [{ start: 0, end: 5, accountId: 'account-a' }],
        })).toBeNull();
    });

    it('recognizes only the active mention token at the cursor', () => {
        expect(readActiveDiscussionMentionQuery('hello @bo later', 9)).toEqual({ start: 6, query: 'bo' });
        expect(readActiveDiscussionMentionQuery('email@example.com', 17)).toBeNull();
        expect(readActiveDiscussionMentionQuery('hello @bo later', 15)).toBeNull();
    });

    it('preserves and shifts exact mention spans around an ordinary edit', () => {
        const mentions = [
            { start: 3, end: 8, accountId: 'account-a' },
            { start: 13, end: 17, accountId: 'account-b' },
        ] as const;

        expect(reconcileDiscussionMentionSpans({
            previousText: 'Hi @Alex and @Bob!',
            nextText: 'Well, Hi @Alex and @Bob!',
            mentions,
        })).toEqual([
            { start: 9, end: 14, accountId: 'account-a' },
            { start: 19, end: 23, accountId: 'account-b' },
        ]);

        expect(reconcileDiscussionMentionSpans({
            previousText: 'Hi @Alex and @Bob!',
            nextText: 'Hi @Alex and @Bob! Later',
            mentions,
        })).toEqual(mentions);
    });

    it('drops only a mention whose visible token was edited', () => {
        expect(reconcileDiscussionMentionSpans({
            previousText: 'Hi @Alex and @Bob!',
            nextText: 'Hi @Alexa and @Bob!',
            mentions: [
                { start: 3, end: 8, accountId: 'account-a' },
                { start: 13, end: 17, accountId: 'account-b' },
            ],
        })).toEqual([{ start: 14, end: 18, accountId: 'account-b' }]);
    });

    it('replaces the selected mention query and shifts later structured mentions', () => {
        expect(insertDiscussionMention({
            text: 'Ask @al then @Bob!',
            mentions: [{ start: 13, end: 17, accountId: 'account-b' }],
            queryStart: 4,
            selectionEnd: 7,
            visibleToken: '@Alex',
            accountId: 'account-a',
        })).toEqual({
            text: 'Ask @Alex then @Bob!',
            selection: { start: 10, end: 10 },
            mentions: [
                { start: 4, end: 9, accountId: 'account-a' },
                { start: 15, end: 19, accountId: 'account-b' },
            ],
        });
    });

    it('builds strict authored content in visible order', () => {
        const content = buildSessionDiscussionContent('Hi @Alex and @Bob!', [
            { start: 3, end: 8, accountId: 'account-a' },
            { start: 13, end: 17, accountId: 'account-b' },
        ]);

        expect(SessionDiscussionMessageContentV1Schema.parse(content)).toEqual({
            v: 1,
            parts: [
                { t: 'text', text: 'Hi ' },
                { t: 'mention', accountId: 'account-a' },
                { t: 'text', text: ' and ' },
                { t: 'mention', accountId: 'account-b' },
                { t: 'text', text: '!' },
            ],
        });
    });

    it('normalizes authored text to the strict Protocol NFC form before transport', () => {
        const content = buildSessionDiscussionContent('Cafe\u0301 @Alex', [
            { start: 6, end: 11, accountId: 'account-a' },
        ]);

        expect(SessionDiscussionMessageContentV1Schema.parse(content)).toEqual({
            v: 1,
            parts: [
                { t: 'text', text: 'Café ' },
                { t: 'mention', accountId: 'account-a' },
            ],
        });
    });

    it('reconciles structured mentions against the flushed editor text before sending', () => {
        expect(buildSessionDiscussionContentFromPendingText({
            previousText: 'Hi @Alex',
            pendingText: 'Well, Hi @Alex',
            mentions: [{ start: 3, end: 8, accountId: 'account-a' }],
        })).toEqual({
            v: 1,
            parts: [
                { t: 'text', text: 'Well, Hi ' },
                { t: 'mention', accountId: 'account-a' },
            ],
        });
    });

    it('admits only exact, non-overlapping structured mention spans bound to visible mention text', () => {
        expect(parseDiscussionMentionSpans([
            { start: 3, end: 8, accountId: 'account-a' },
            { start: 3, end: 8, accountId: ' account-spoof ' },
            { start: 13, end: 17, accountId: 'account-b', authority: true },
            { start: 13, end: 17, accountId: 'account-b' },
            { start: 99, end: 100, accountId: 'account-outside' },
        ], 'Hi @Alex and @Bob!')).toEqual([
            { start: 3, end: 8, accountId: 'account-a' },
            { start: 13, end: 17, accountId: 'account-b' },
        ]);
        expect(parseDiscussionMentionSpans([
            { start: 3, end: 7, accountId: 'account-a' },
        ], 'Hi Alex')).toEqual([]);
        expect(parseDiscussionMentionSpans([
            { start: 3, end: 8, accountId: 'account-a' },
            { start: 3, end: 8, accountId: 'account-b' },
        ], 'Hi @Alex')).toEqual([]);
    });
});
