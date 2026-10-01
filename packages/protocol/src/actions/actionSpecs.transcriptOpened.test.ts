import { describe, expect, it } from 'vitest';

import { getActionSpec } from './actionSpecs.js';

describe('opened transcript follow shared metadata', () => {
  it('admits explicit failed-content witnesses but rejects failed rows carrying plaintext', () => {
    const spec = getActionSpec('transcript.follow');
    const item = { id: 'bad-row', seq: 1, createdAt: 1, content: { t: 'plain', v: null }, openFailure: 'corrupt_or_unopenable' };
    const output = { ok: true, leaseId: 'lease', projection: 'openedMessagesV1', items: [item], nextCursor: '1',
      truncated: false, agentState: null, sharedMetadata: null };
    expect(spec.outputSchema.parse(output)).toEqual(output);
    expect(spec.outputSchema.safeParse({ ...output, items: [{ ...item, content: { t: 'plain', v: { private: true } } }] }).success).toBe(false);
    expect(spec.outputSchema.safeParse({ ...output, items: [{ ...item, openFailure: 'unknown' }] }).success).toBe(false);
  });
  it('accepts versioned recipient-safe metadata and rejects owner fields in that projection', () => {
    const spec = getActionSpec('transcript.follow');
    expect(spec.inputSchema.safeParse({ cursor: '0', projection: 'openedMessagesV1', sharedMetadataVersion: -1 }).success).toBe(true);
    expect(spec.inputSchema.safeParse({ cursor: '0', projection: 'openedMessagesV1', sharedMetadataVersion: 1.5 }).success).toBe(false);
    const result = { ok: true, leaseId: 'lease', projection: 'openedMessagesV1', items: [], nextCursor: '0',
      truncated: false, agentState: null, sharedMetadata: { version: 2, value: {
        v: 1, summary: { text: 'Recipient-safe summary', updatedAt: 1 },
        publicAgentState: { completedRequests: { native: { tool: 'Bash', createdAt: 1, completedAt: 2, status: 'approved' } } },
      } } };
    expect(spec.outputSchema.parse(result)).toEqual(result);
    expect(spec.outputSchema.safeParse({ ...result, sharedMetadata: { version: 2,
      value: { ...result.sharedMetadata.value, path: '/private', ownerMetadata: { v: 1 } },
    } }).success).toBe(false);
    expect(spec.outputSchema.safeParse({ ...result, sharedMetadata: { ...result.sharedMetadata, ownerMetadata: {} } }).success).toBe(false);
  });
});
