import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';
import type { Credentials, StoredCredentials } from '@/persistence';
import { shouldPersistQuotaSnapshot } from './shouldPersistQuotaSnapshot';

const baseSnapshot: ConnectedServiceQuotaSnapshotV1 = {
  v: 1,
  serviceId: 'openai-codex',
  profileId: 'work',
  fetchedAt: 1_000,
  staleAfterMs: 300_000,
  planLabel: 'Pro',
  accountLabel: 'user@example.com',
  meters: [{
    meterId: 'weekly',
    label: 'Weekly',
    used: 1,
    limit: 10,
    remaining: 9,
    remainingPct: 90,
    unit: 'count',
    utilizationPct: 10,
    resetsAt: 10_000,
    status: 'ok',
    details: {},
  }],
};

describe('quotaSnapshotFingerprint', () => {
  it('persists a changed subscription observation while quota material stays fresh', async () => {
    const { computeQuotaSnapshotFingerprint, deriveQuotaSnapshotFingerprintKey } = await import('./quotaSnapshotFingerprint');
    const key = deriveQuotaSnapshotFingerprintKey({
      credentials: { token: 'token', encryption: null }, serverScope: 'server-a', accountScope: 'account-a',
    });
    const previous: ConnectedServiceQuotaSnapshotV1 = {
      ...baseSnapshot,
      subscription: { status: 'subscribed', renewal: 'on', observedAtMs: 1_000, staleAfterMs: 60_000 },
    };
    const incoming: ConnectedServiceQuotaSnapshotV1 = {
      ...previous,
      fetchedAt: 1_001,
      subscription: { ...previous.subscription!, lastRefreshError: { observedAtMs: 1_001, code: 'network' } },
    };
    expect(shouldPersistQuotaSnapshot({
      previous: { fingerprint: computeQuotaSnapshotFingerprint(previous, key), fetchedAt: previous.fetchedAt, staleAfterMs: previous.staleAfterMs, status: 'ok' },
      next: { fingerprint: computeQuotaSnapshotFingerprint(incoming, key), fetchedAt: incoming.fetchedAt, staleAfterMs: incoming.staleAfterMs, status: 'ok' },
      nowMs: 1_001,
      minFreshnessMs: 60_000,
    })).toEqual({ persist: true, reason: 'fingerprint_changed' });
  });

  it('uses a stable account-scoped HMAC for material quota fields', async () => {
    const mod = await import('./quotaSnapshotFingerprint').catch(() => null);
    expect(mod?.deriveQuotaSnapshotFingerprintKey).toBeTypeOf('function');
    expect(mod?.computeQuotaSnapshotFingerprint).toBeTypeOf('function');
    if (!mod) return;

    const credentials: Credentials = {
      token: 'secret-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(7) },
    };
    const key = mod.deriveQuotaSnapshotFingerprintKey({
      credentials,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });

    const sameMaterialDifferentFetchTime = {
      ...baseSnapshot,
      fetchedAt: baseSnapshot.fetchedAt + 1_000,
    };

    const first = mod.computeQuotaSnapshotFingerprint(baseSnapshot, key);
    const second = mod.computeQuotaSnapshotFingerprint(sameMaterialDifferentFetchTime, key);

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
  });

  it('separates fingerprints by material fields and account scope', async () => {
    const mod = await import('./quotaSnapshotFingerprint').catch(() => null);
    expect(mod?.deriveQuotaSnapshotFingerprintKey).toBeTypeOf('function');
    expect(mod?.computeQuotaSnapshotFingerprint).toBeTypeOf('function');
    if (!mod) return;

    const credentials: Credentials = {
      token: 'secret-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(7) },
    };
    const key = mod.deriveQuotaSnapshotFingerprintKey({
      credentials,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });
    const otherAccountKey = mod.deriveQuotaSnapshotFingerprintKey({
      credentials,
      serverScope: 'server-a',
      accountScope: 'account-b',
    });
    const changedSnapshot: ConnectedServiceQuotaSnapshotV1 = {
      ...baseSnapshot,
      meters: [{ ...baseSnapshot.meters[0]!, used: 2, remaining: 8, utilizationPct: 20 }],
    };

    expect(mod.computeQuotaSnapshotFingerprint(changedSnapshot, key)).not.toBe(
      mod.computeQuotaSnapshotFingerprint(baseSnapshot, key),
    );
    expect(mod.computeQuotaSnapshotFingerprint(baseSnapshot, otherAccountKey)).not.toBe(
      mod.computeQuotaSnapshotFingerprint(baseSnapshot, key),
    );
  });

  it('derives stable plaintext dedupe fingerprints without using the bearer token', async () => {
    const mod = await import('./quotaSnapshotFingerprint');
    const firstCredentials: StoredCredentials = {
      token: 'first-bearer-token',
      encryption: null,
    };
    const rotatedCredentials: StoredCredentials = {
      token: 'rotated-bearer-token',
      encryption: null,
    };
    const firstKey = mod.deriveQuotaSnapshotFingerprintKey({
      credentials: firstCredentials,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });
    const rotatedKey = mod.deriveQuotaSnapshotFingerprintKey({
      credentials: rotatedCredentials,
      serverScope: 'server-a',
      accountScope: 'account-a',
    });

    expect(mod.computeQuotaSnapshotFingerprint(baseSnapshot, rotatedKey)).toBe(
      mod.computeQuotaSnapshotFingerprint(baseSnapshot, firstKey),
    );
  });
});
