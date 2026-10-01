import { expect, it } from 'vitest';
import type { SessionMessageV1 } from '@happier-dev/protocol';
import { drainSessionMessagesAfter } from './drainSessionMessagesAfter.js';
import { repairSessionMessagesTargets } from './repairSessionMessagesTargets.js';

const row = (seq: number): SessionMessageV1 => ({ id: `m${seq}`, seq, localId: null, content: { t: 'plain', v: { seq } }, createdAt: 1, updatedAt: 1 });
it('drains multiple pages in sequence', async () => {
  const after: number[] = [];
  const rows: number[] = [];
  const result = await drainSessionMessagesAfter({
    afterSeq: 0, signal: new AbortController().signal,
    fetchPage: async (cursor: number) => {
      after.push(cursor);
      return cursor === 0 ? { messages: [row(1), row(2)], nextAfterSeq: 2 } : { messages: [row(3)], nextAfterSeq: null };
    },
    onPage: (messages: readonly SessionMessageV1[]) => { rows.push(...messages.map((message) => message.seq)); },
  });
  expect(result).toEqual({ lastSeq: 3 });
  expect(rows).toEqual([1, 2, 3]);
  expect(after).toEqual([0, 2]);
});
it('rejects inconsistent continuation metadata before publishing the page', async () => {
  const delivered: unknown[] = [];
  await expect(drainSessionMessagesAfter({ afterSeq: 0, signal: new AbortController().signal, fetchPage: async () => ({ messages: [row(1)], nextAfterSeq: 2 }), onPage: (page) => { delivered.push(page); } })).rejects.toMatchObject({ code: 'session_message_gap' });
  expect(delivered).toEqual([]);
});
it('preserves acknowledged repair groups when a later fetch fails', async () => {
  const acknowledged: string[][] = [];
  const calls: Array<{ after: number; ids: string[] }> = [];
  await expect(repairSessionMessagesTargets({
    targets: [{ messageId: 'm1', seq: 1 }, { messageId: 'm2', seq: 2 }, { messageId: 'm9', seq: 9 }], pageSize: 3,
    signal: new AbortController().signal,
    fetchPage: async (after, _signal, ids) => { calls.push({ after, ids: [...ids] }); if (after === 8) throw new Error('offline'); return { messages: [row(1), row(2)], nextAfterSeq: null }; },
    onPage: (_page, ids) => new Set([...ids].filter((id) => id === 'm1')),
    onResolvedMessageIds: (ids) => { acknowledged.push([...ids]); },
  })).rejects.toThrow('offline');
  expect(calls).toEqual([{ after: 0, ids: ['m1', 'm2'] }, { after: 8, ids: ['m9'] }]);
  expect(acknowledged).toEqual([['m1']]);
});
it('accepts authoritative sequence holes left by discarded historical imports', async () => {
  const delivered: number[] = [];
  const result = await drainSessionMessagesAfter({
    afterSeq: 0, signal: new AbortController().signal,
    fetchPage: async (after) => after === 0 ? { messages: [row(7), row(9)], nextAfterSeq: 9 } : { messages: [row(12)], nextAfterSeq: null },
    onPage: (messages) => { delivered.push(...messages.map((message) => message.seq)); },
  });
  expect(result).toEqual({ lastSeq: 12 });
  expect(delivered).toEqual([7, 9, 12]);
});
