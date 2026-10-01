import { describe, expect, it } from 'vitest';
import { SessionExternalShareableMessagesPageV1Schema } from './sessionMessagesPageV1.js';

describe('external-shareable message page', () => {
  it('preserves an opaque cursor witness without disclosing Account identity or admission receipts', () => {
    const page = SessionExternalShareableMessagesPageV1Schema.parse({
      messages: [{
        id: 'm1', seq: 1, createdAt: 1,
        content: { t: 'encrypted' },
        accountActor: { accountId: 'private-account' },
        inputAdmissionReceipt: { issuer: 'authenticatedMachine' },
        externalShareableActor: 'machine',
      }],
      hasMore: false, nextAfterSeq: null,
      externalShareableSnapshot: { turns: [] },
    });
    expect(page.messages[0]).toMatchObject({ id: 'm1', seq: 1, externalShareableActor: 'machine' });
    expect(page.messages[0]?.content).toBeUndefined();
    expect(page.messages[0]).not.toHaveProperty('accountActor');
    expect(page.messages[0]).not.toHaveProperty('inputAdmissionReceipt');
  });
});
