import { describe, expect, it } from 'vitest';

import { resolveHappierFreshnessText } from './asOfTime.js';

describe('resolveHappierFreshnessText: one text policy for host and plugin freshness lines', () => {
  const formatAsOf = (time: string) => `As of ${time}`;
  const now = new Date(2026, 8, 29, 11, 0).getTime();
  const asOf = new Date(2026, 8, 29, 10, 42).getTime();

  it('says when the retained content was read, then why it may be behind', () => {
    expect(resolveHappierFreshnessText({ asOf, now, reason: 'devbox isn’t answering', formatAsOf }))
      .toMatch(/^As of 10:42.* · devbox isn’t answering$/u);
  });

  it('keeps the read time while a reconnect is in flight, and says the reason alone without one', () => {
    expect(resolveHappierFreshnessText({ asOf, now, reason: 'Reconnecting…', formatAsOf }))
      .toMatch(/^As of 10:42.* · Reconnecting…$/u);
    expect(resolveHappierFreshnessText({ asOf: null, reason: 'Reconnecting…', formatAsOf })).toBe('Reconnecting…');
  });
});
