import { describe, expect, it } from 'vitest';
import { applyReducedMessages, type Message, type OrderedTranscript } from '../index.js';

function message(id: string, seq: number, text = id): Message {
    return { kind: 'agent-text', id, seq, createdAt: seq, localId: null, text };
}

describe('ordered transcript', () => {
    it('retains unchanged rows and order references and returns the previous transcript for no-op output', () => {
        const first = message('first', 1);
        const previous: OrderedTranscript = { messageIdsOldestFirst: ['first'], messagesById: { first } };
        expect(applyReducedMessages(previous, [])).toBe(previous);
        expect(applyReducedMessages(previous, [first])).toBe(previous);
        const appended = applyReducedMessages(previous, [message('next', 2)]);
        expect(appended.messageIdsOldestFirst).toEqual(['first', 'next']);
        expect(appended.messagesById.first).toBe(first);
        expect(appended.messagesById).not.toBe(previous.messagesById);
        expect(previous.messagesById).toEqual({ first });
        const next = appended.messagesById.next;
        const revised = applyReducedMessages(appended, [message('next', 2, 'revised')]);
        expect(revised.messageIdsOldestFirst).toBe(appended.messageIdsOldestFirst);
        expect(revised.messagesById).not.toBe(appended.messagesById);
        expect(appended.messagesById.next).toBe(next);
        expect(appended.messagesById.next?.kind === 'agent-text' && appended.messagesById.next.text).toBe('next');
        expect(revised.messagesById.first).toBe(first);
        expect(revised.messagesById.next?.kind === 'agent-text' && revised.messagesById.next.text).toBe('revised');
    });

    it('merges older pages and repositions rows when durable ordering arrives', () => {
        const previous: OrderedTranscript = { messageIdsOldestFirst: [], messagesById: {} };
        const initial = applyReducedMessages(previous, [message('tail', 4), message('middle', 2)]);
        const revised = applyReducedMessages(initial, [message('first', 1), message('middle', 5)]);
        expect(revised.messageIdsOldestFirst).toEqual(['first', 'tail', 'middle']);
        expect(Object.keys(revised.messagesById)).toHaveLength(3);
    });
});
