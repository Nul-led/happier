import { describe, expect, it } from 'vitest';
import {
    normalizeRawMessageInSequence, createRawMessageNormalizationSequenceState, createReducer, reducer,
    advanceSessionReceivedMessageCurrentness, isSessionMessageRowCurrent, applyReducedMessages, type OrderedTranscript,
} from '../index.js';
import type { SessionReceivedMessages } from './currentness.js';

describe('revised durable row currentness', () => {
    it('applies a newer authoritative row at the same seq and rejects stale delivery from another transport', () => {
        const currentness: SessionReceivedMessages = new Map();
        const sequence = createRawMessageNormalizationSequenceState();
        const state = createReducer();
        let transcript: OrderedTranscript = { messageIdsOldestFirst: [], messagesById: {} };
        const feed = (text: string, updatedAt: number, authoritative: boolean) => {
            if (!isSessionMessageRowCurrent({ existingUpdatedAt: currentness.get('session')?.get('stored-id'), incomingUpdatedAt: updatedAt, isAuthoritativeUpdate: authoritative })) return;
            const normalized = normalizeRawMessageInSequence({ id: 'stored-id', localId: null, seq: 4, createdAt: 1_000, raw: { role: 'agent', content: { type: 'acp', agentId: 'codex', data: { type: 'message', message: text } } } }, sequence);
            expect(normalized).not.toBeNull();
            if (normalized) {
                const row = authoritative ? { ...normalized, isAuthoritativeUpdate: true as const } : normalized;
                transcript = applyReducedMessages(transcript, reducer(state, [row], null).messages);
            }
            advanceSessionReceivedMessageCurrentness(currentness, 'session', 'stored-id', updatedAt);
        };
        feed('initial', 10, false);
        feed('revised', 12, true);
        const revised = transcript.messagesById[transcript.messageIdsOldestFirst[0]!];
        expect(revised?.kind === 'agent-text' && revised.text).toBe('revised');
        feed('stale', 11, true);
        expect(transcript.messagesById[transcript.messageIdsOldestFirst[0]!]).toBe(revised);
        expect(transcript.messageIdsOldestFirst).toHaveLength(1);
        advanceSessionReceivedMessageCurrentness(currentness, 'session', 'stored-id', 9);
        expect(currentness.get('session')?.get('stored-id')).toBe(12);
    });
});
