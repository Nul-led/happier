import { describe, expect, it } from 'vitest';
import {
    createRawMessageNormalizationSequenceState, normalizeRawMessageInSequence,
    createReducer, reducer, applyReducedMessages, createTranscriptStreamSegmentAssembler,
    interpretTranscriptStreamSegment, type NormalizedMessage, type RawRecord, type OrderedTranscript,
} from '../index.js';

function record(text: string, updatedAtMs = 1_010, state: 'streaming' | 'complete' = 'streaming'): RawRecord {
    return {
        role: 'agent',
        content: { type: 'acp', agentId: 'codex', data: { type: 'message', message: text } },
        meta: { happierStreamSegmentV1: { v: 1, segmentKind: 'assistant', segmentLocalId: 'segment', segmentState: state, startedAtMs: 1_000, updatedAtMs } },
    };
}

describe('live interpretation', () => {
    it('converges snapshot, chained delta and durable delivery into one canonical row', () => {
        const assembler = createTranscriptStreamSegmentAssembler();
        const rawMessageNormalizationState = createRawMessageNormalizationSequenceState();
        const state = createReducer();
        let transcript: OrderedTranscript = { messageIdsOldestFirst: [], messagesById: {} };
        const feed = (normalized: NormalizedMessage | null) => {
            expect(normalized).not.toBeNull();
            if (normalized) transcript = applyReducedMessages(transcript, reducer(state, [normalized], null).messages);
        };
        const base = { assembler, sessionId: 'session', message: { localId: 'segment', createdAt: 1_000 }, rawMessageNormalizationState };
        feed(interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', tick: 1, record: record('Hello') }));
        const firstId = transcript.messageIdsOldestFirst[0];
        feed(interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment-delta', tick: 2, baseLength: 5, record: record(' world', 1_040) }));
        const durable = normalizeRawMessageInSequence({ id: 'stored-message', localId: 'segment', createdAt: 1_000, seq: 7, raw: record('Hello world', 1_050, 'complete') }, rawMessageNormalizationState);
        feed(durable);
        expect(transcript.messageIdsOldestFirst).toEqual([firstId]);
        expect(Object.keys(transcript.messagesById)).toHaveLength(1);
        const message = transcript.messagesById[firstId!];
        expect(message?.kind === 'agent-text' && message.text).toBe('Hello world');
        expect(message?.seq).toBe(7);
        const beforeReplay = transcript;
        if (durable) transcript = applyReducedMessages(transcript, reducer(state, [durable], null).messages);
        expect(transcript).toBe(beforeReplay);
    });

    it('drops unknown, tick-gap and mismatched-length deltas until a snapshot resynchronizes', () => {
        const assembler = createTranscriptStreamSegmentAssembler();
        const base = { assembler, sessionId: 'session', message: { localId: 'segment', createdAt: 1_000 } };
        const delta = (tick: number, baseLength: number) => interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment-delta', tick, baseLength, record: record('!') });
        expect(delta(2, 5)).toBeNull();
        interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', tick: 1, record: record('Hello') });
        expect(delta(3, 5)).toBeNull();
        expect(delta(2, 5)).toBeNull();
        interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', tick: 4, record: record('Hello') });
        expect(delta(5, 4)).toBeNull();
        interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', tick: 6, record: record('Hello') });
        const normalized = delta(7, 5);
        expect(normalized?.role === 'agent' && normalized.content[0]?.type === 'text' && normalized.content[0].text).toBe('Hello!');
        interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', tick: 8, record: record('Hello!', 1_050, 'complete') });
        expect(delta(9, 6)).toBeNull();
    });

    it('chains the first delta by length when a supported server omitted the snapshot tick', () => {
        const assembler = createTranscriptStreamSegmentAssembler();
        const base = { assembler, sessionId: 'session', message: { localId: 'segment', createdAt: 1_000 } };
        interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment', record: record('Hello') });
        const normalized = interpretTranscriptStreamSegment({ ...base, type: 'transcript-stream-segment-delta', tick: 9, baseLength: 5, record: record(' world') });
        expect(normalized?.role === 'agent' && normalized.content[0]?.type === 'text' && normalized.content[0].text).toBe('Hello world');
    });
});
