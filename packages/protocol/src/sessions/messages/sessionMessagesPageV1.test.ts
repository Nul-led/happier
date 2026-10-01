import { expect, it } from 'vitest';
import { SessionMessagesPageV1Schema } from './sessionMessagesPageV1.js';

it('rejects invalid row identities and cursors at the shared wire owner', () => {
  const row = { id: 'm1', seq: 1, content: { t: 'plain', v: {} }, createdAt: 1 };
  expect(SessionMessagesPageV1Schema.safeParse({ messages: [{ ...row, seq: 1.5 }] }).success).toBe(false);
  expect(SessionMessagesPageV1Schema.safeParse({ messages: [{ ...row, id: '' }] }).success).toBe(false);
  expect(SessionMessagesPageV1Schema.safeParse({ messages: [row], nextAfterSeq: -1 }).success).toBe(false);
  expect(SessionMessagesPageV1Schema.safeParse({ messages: [{ ...row, createdAt: Infinity }] }).success).toBe(false);
});
