import { expect, it } from 'vitest';
import { applyReducedMessages, createRawMessageNormalizationSequenceState, createReducer,
  normalizeRawMessageInSequence, reducer, type OrderedTranscript } from './index.js';
import { multiAgentPage } from './raw/__fixtures__/multiAgentPage.js';

it('normalizes a persisted multi-agent page and ignores redelivery of canonical normalization inputs', () => {
  const sequence = createRawMessageNormalizationSequenceState();
  const state = createReducer();
  let transcript: OrderedTranscript = { messageIdsOldestFirst: [], messagesById: {} };
  const fold = (rows: typeof multiAgentPage) => {
    const normalized = rows.flatMap((row) => {
      const message = normalizeRawMessageInSequence(row, sequence);
      return message ? [message] : [];
    });
    transcript = applyReducedMessages(transcript, reducer(state, normalized, null).messages);
  };
  fold(multiAgentPage);
  const before = transcript;
  const messages = transcript.messageIdsOldestFirst.map((id) => transcript.messagesById[id]);
  expect(messages.map((message) => 'text' in message ? message.text : null))
    .toEqual(['Question', 'Claude answer', 'ACP answer']);

  // This is the core's idempotent input contract, not an adapter test. The SDK's
  // real HTTP/Socket.IO controller tests verify stored row identity at transport ingress.
  fold(multiAgentPage.map((row) => ({ ...row, id: row.id, seq: row.seq })));
  expect(transcript).toBe(before);
  expect(transcript.messageIdsOldestFirst.map((id) => transcript.messagesById[id])).toEqual(messages);
});
