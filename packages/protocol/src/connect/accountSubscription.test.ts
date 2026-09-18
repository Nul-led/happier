import { describe, expect, it } from 'vitest';
import { ProviderAccountSubscriptionV1Schema, mergeProviderAccountSubscription } from './accountSubscription.js';

describe('ProviderAccountSubscriptionV1', () => {
  it('keeps newer successful observations independent from older failures', () => {
    const previous = ProviderAccountSubscriptionV1Schema.parse({
      status: 'subscribed', renewal: 'on', observedAtMs: 2_000, staleAfterMs: 60_000,
    });
    const incoming = ProviderAccountSubscriptionV1Schema.parse({
      status: 'unavailable', renewal: 'unknown', observedAtMs: 1_000, staleAfterMs: 60_000,
      lastRefreshError: { observedAtMs: 3_000, code: 'network' },
    });
    expect(mergeProviderAccountSubscription(previous, incoming)).toEqual({
      ...previous, lastRefreshError: incoming.lastRefreshError,
    });
  });
});
