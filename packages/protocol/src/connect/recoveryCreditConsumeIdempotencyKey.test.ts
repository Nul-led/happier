import { describe, expect, it } from 'vitest';
import { buildRecoveryCreditConsumeIdempotencyKey } from './recoveryCreditConsumeIdempotencyKey.js';

describe('recovery credit consume identity', () => {
    it('shares selected-credit identity and distinguishes aggregate snapshot inventories', () => {
        const account = { serviceId: 'happier.agent.codex/openai-codex', profileId: 'work' };
        const key = buildRecoveryCreditConsumeIdempotencyKey({ ...account, providerCreditId: ' credit-1 ' });
        expect(key).toBe(buildRecoveryCreditConsumeIdempotencyKey({ ...account, providerCreditId: 'credit-1', sourceSnapshotFetchedAtMs: 123 }));
        expect(buildRecoveryCreditConsumeIdempotencyKey(account)).toMatch(/aggregate:unknown$/);
        expect(buildRecoveryCreditConsumeIdempotencyKey({ ...account, sourceSnapshotFetchedAtMs: 123 })).not.toBe(buildRecoveryCreditConsumeIdempotencyKey({ ...account, sourceSnapshotFetchedAtMs: 124 }));
        expect(buildRecoveryCreditConsumeIdempotencyKey({ ...account, providerCreditId: 'x'.repeat(400) }).length).toBeLessThanOrEqual(256);
    });
});
