import { describe, expect, it } from 'vitest';

import { SessionDiscussionMessageContentV1Schema } from '@happier-dev/protocol';

import {
    buildSessionDiscussionContent,
    buildSessionDiscussionContentFromPendingText,
    discussionComposerMentionsFromSpans,
    discussionMentionSpansFromComposerMentions,
    parseDiscussionMentionSpans,
    reconcileDiscussionMentionSpans,
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

    it('carries Account mentions between the one composer and the discussion draft unchanged', () => {
        const text = 'Hi @Alice Ng and @bob!';
        const spans = [
            { start: 3, end: 12, accountId: 'account-a' },
            { start: 17, end: 21, accountId: 'account-b' },
        ];

        const mentions = discussionComposerMentionsFromSpans(text, spans);

        expect(mentions).toEqual([
            { kind: 'happier.account', ref: 'account:account-a', tokenText: '@Alice Ng', start: 3, end: 12 },
            { kind: 'happier.account', ref: 'account:account-b', tokenText: '@bob', start: 17, end: 21 },
        ]);
        expect(discussionMentionSpansFromComposerMentions(mentions)).toEqual(spans);
        expect(buildSessionDiscussionContent(text, discussionMentionSpansFromComposerMentions(mentions)).parts).toEqual([
            { t: 'text', text: 'Hi ' },
            { t: 'mention', accountId: 'account-a' },
            { t: 'text', text: ' and ' },
            { t: 'mention', accountId: 'account-b' },
            { t: 'text', text: '!' },
        ]);
    });

    it('never reads an Account out of another mention kind or a malformed Account reference', () => {
        expect(discussionMentionSpansFromComposerMentions([
            { kind: 'happier.file', ref: 'file:account-a', tokenText: '@a', start: 0, end: 2 },
            { kind: 'happier.account', ref: 'session:account-a', tokenText: '@b', start: 3, end: 5 },
            { kind: 'happier.account', ref: 'account: account-spoof ', tokenText: '@c', start: 6, end: 8 },
        ])).toEqual([]);
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
