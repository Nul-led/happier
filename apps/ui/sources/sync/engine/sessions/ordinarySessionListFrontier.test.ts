import { describe, expect, it } from 'vitest';

import {
    advanceOrdinarySessionListFrontier,
    resolveOrdinarySessionListContinuation,
} from './ordinarySessionListFrontier';

const currentResult = {
    sessionIds: [],
    nextCursor: null,
    hasNext: false,
    attentionNextCursor: null,
    attentionHasNext: false,
    current: true,
    source: 'v2' as const,
};

describe('ordinary Session-list dual frontier', () => {
    it('advances ordinary pages first without resetting an outstanding attention cursor', () => {
        const previous = {
            nextCursor: 'ordinary-1',
            hasNext: true,
            attentionNextCursor: 'attention-100',
            attentionHasNext: true,
        };
        const continuation = resolveOrdinarySessionListContinuation(previous);

        expect(continuation).toEqual({ kind: 'ordinary', cursor: 'ordinary-1' });
        expect(advanceOrdinarySessionListFrontier({
            previous,
            continuation,
            result: { ...currentResult, nextCursor: 'ordinary-2', hasNext: true },
        })).toEqual({
            nextCursor: 'ordinary-2',
            hasNext: true,
            attentionNextCursor: 'attention-100',
            attentionHasNext: true,
        });
    });

    it('stops a repeated attention cursor instead of scheduling an endless pump', () => {
        const previous = {
            nextCursor: null,
            hasNext: false,
            attentionNextCursor: 'attention-100',
            attentionHasNext: true,
        };
        const continuation = resolveOrdinarySessionListContinuation(previous);

        expect(() => advanceOrdinarySessionListFrontier({
            previous,
            continuation,
            result: {
                ...currentResult,
                attentionNextCursor: 'attention-100',
                attentionHasNext: true,
            },
        })).toThrow('Ordinary Session-list attention cursor did not advance');
    });
});
