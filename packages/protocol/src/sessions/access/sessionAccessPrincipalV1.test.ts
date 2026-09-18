import { describe, expect, it } from 'vitest';
import * as access from './index.js';

describe('Session access Account summary', () => {
  const account = {
    kind: 'account', accountId: 'alice', firstName: 'Alice', lastName: null,
    username: 'alice', avatarUrl: null,
  };

  it('admits neutral Account display identity and rejects private or unrelated authority fields', () => {
    expect(access.SessionAccessAccountSummaryV1Schema?.safeParse(account).success).toBe(true);
    expect(access.SessionAccessAccountSummaryV1Schema.safeParse({ ...account, email: 'alice@example.test' }).success).toBe(false);
    expect(access.SessionAccessAccountSummaryV1Schema.safeParse({ ...account, teamId: 'private-team' }).success).toBe(false);
    expect(access.SessionAccessAccountSummaryV1Schema.safeParse({ ...account, accountId: '' }).success).toBe(false);
  });
});
