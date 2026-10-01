import { describe, expect, it } from 'vitest';

import { formatRelayAccountIdentity } from './formatRelayAccountIdentity';

describe('formatRelayAccountIdentity', () => {
  it('names the relay host and the readable account label', () => {
    expect(formatRelayAccountIdentity({
      serverUrl: 'http://127.0.0.1:3005/',
      accountLabel: 'alice',
      accountId: 'cm0123456789abcdef',
    })).toBe('127.0.0.1:3005 as alice');
  });

  it('falls back to a short account id when the account has no readable label', () => {
    const text = formatRelayAccountIdentity({
      serverUrl: 'https://api.happier.dev',
      accountLabel: null,
      accountId: 'cm0123456789abcdef',
    });
    expect(text.startsWith('api.happier.dev as ')).toBe(true);
    expect(text).toContain('cm012345');
    expect(text).not.toContain('cm0123456789abcdef');
  });

  it('names only the relay host when no account is known', () => {
    expect(formatRelayAccountIdentity({ serverUrl: 'https://api.happier.dev', accountLabel: null, accountId: null }))
      .toBe('api.happier.dev');
  });
});
