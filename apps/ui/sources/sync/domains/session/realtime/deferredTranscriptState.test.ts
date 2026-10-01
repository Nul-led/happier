import { describe, expect, it } from 'vitest';

import {
    clearResolvedStaleTranscriptMessageIds,
    clearDeferredTranscriptStateForSession,
    createDeferredTranscriptState,
    hasStaleTranscriptMarkers,
    markDeferredTranscriptRemoteSeq,
    markTranscriptDeferred,
    markTranscriptStale,
    readStaleTranscriptMessageIds,
    readStaleTranscriptMessageSeqs,
    readStaleTranscriptMinSeq,
} from './deferredTranscriptState';

describe('deferred transcript state', () => {
    it('tracks known remote seq separately from deferred durable seq', () => {
        const state = markDeferredTranscriptRemoteSeq(createDeferredTranscriptState(), 's1', 5);

        expect(state.knownRemoteSeqBySessionId.s1).toBe(5);
        expect(state.deferredDurableSeqBySessionId.s1).toBeUndefined();
    });

    it('marks deferred transcript seq without moving stale markers', () => {
        const state = markTranscriptDeferred(createDeferredTranscriptState(), 's1', {
            updateType: 'new-message',
            seq: 7,
            messageId: 'm7',
        });

        expect(state.knownRemoteSeqBySessionId.s1).toBe(7);
        expect(state.deferredDurableSeqBySessionId.s1).toBe(7);
        expect(hasStaleTranscriptMarkers(state, 's1')).toBe(false);
    });

    it('dedupes stale message markers and clears reveal state only', () => {
        const first = markTranscriptStale(createDeferredTranscriptState(), 's1', {
            updateType: 'message-updated',
            seq: 2,
            messageId: 'm2',
        });
        const second = markTranscriptStale(first, 's1', {
            updateType: 'message-updated',
            seq: 2,
            messageId: 'm2',
        });
        const cleared = clearDeferredTranscriptStateForSession(second, 's1');

        expect(second.staleMessageIdsBySessionId.s1).toEqual(['m2']);
        expect(readStaleTranscriptMessageSeqs(second, 's1')).toEqual({ m2: 2 });
        expect(hasStaleTranscriptMarkers(second, 's1')).toBe(true);
        expect(cleared.staleMessageIdsBySessionId.s1).toBeUndefined();
        expect(readStaleTranscriptMessageSeqs(cleared, 's1')).toEqual({});
        expect(cleared.deferredDurableSeqBySessionId.s1).toBeUndefined();
        expect(cleared.knownRemoteSeqBySessionId.s1).toBe(2);
    });

    it('clears only exact stale rows resolved by a paged targeted refetch', () => {
        const first = markTranscriptStale(createDeferredTranscriptState(), 's1', {
            updateType: 'message-updated',
            seq: 2,
            messageId: 'm2',
        });
        const second = markTranscriptStale(first, 's1', {
            updateType: 'message-updated',
            seq: 200,
            messageId: 'm200',
        });

        const partiallyResolved = clearResolvedStaleTranscriptMessageIds(
            second, 's1', new Set(['m2']), readStaleTranscriptMessageSeqs(second, 's1'),
        );
        expect(readStaleTranscriptMessageIds(partiallyResolved, 's1')).toEqual(['m200']);
        expect(readStaleTranscriptMessageSeqs(partiallyResolved, 's1')).toEqual({ m200: 200 });
        // Keep the original lower bound rather than silently skipping any
        // unresolved rows that were delivered concurrently with the first page.
        expect(readStaleTranscriptMinSeq(partiallyResolved, 's1')).toBe(2);
        expect(partiallyResolved.deferredDurableSeqBySessionId.s1).toBe(200);

        const fullyResolved = clearResolvedStaleTranscriptMessageIds(
            partiallyResolved, 's1', new Set(['m200']), readStaleTranscriptMessageSeqs(partiallyResolved, 's1'),
        );
        expect(hasStaleTranscriptMarkers(fullyResolved, 's1')).toBe(false);
        expect(readStaleTranscriptMessageSeqs(fullyResolved, 's1')).toEqual({});
        expect(readStaleTranscriptMinSeq(fullyResolved, 's1')).toBeNull();
        // The generic deferred-newer marker remains independently owned.
        expect(fullyResolved.deferredDurableSeqBySessionId.s1).toBe(200);
    });

    it.each(['repeated mark', 'clear and recreate', 'reset and recreate'] as const)(
        'retains a newer same-row stale marker after %s while an old repair remains in flight',
        (sequence) => {
            const marker = { updateType: 'message-updated' as const, seq: 15, messageId: 'm15' };
            const first = markTranscriptStale(createDeferredTranscriptState(), 's1', marker);
            const capturedSeqs = readStaleTranscriptMessageSeqs(first, 's1');
            const beforeNewEdit = sequence === 'clear and recreate'
                ? clearResolvedStaleTranscriptMessageIds(first, 's1', new Set(['m15']), capturedSeqs)
                : sequence === 'reset and recreate' ? clearDeferredTranscriptStateForSession(first, 's1')
                : first;
            const editedAgain = markTranscriptStale(beforeNewEdit, 's1', marker);

            const afterOldRepair = clearResolvedStaleTranscriptMessageIds(
                editedAgain, 's1', new Set(['m15']), capturedSeqs,
            );

            expect(readStaleTranscriptMessageIds(afterOldRepair, 's1')).toEqual(['m15']);
            expect(afterOldRepair).toBe(editedAgain);
        },
    );
});
