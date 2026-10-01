import { describe, expect, it } from 'vitest';

import { presentAccountSubscription } from './presentAccountSubscription';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 10, 40);

function subscription(fields: Partial<Parameters<typeof presentAccountSubscription>[0] & object> = {}) {
    return {
        status: 'subscribed' as const,
        renewal: 'on' as const,
        observedAtMs: NOW - 2 * 60 * 1000,
        staleAfterMs: DAY,
        currentPeriodEndAtMs: NOW + 17 * DAY,
        ...fields,
    };
}

describe('presentAccountSubscription (lab csvc C1/D1: renews, not renewing, checked)', () => {
    it('says when a renewing plan renews, in whole days', () => {
        expect(presentAccountSubscription(subscription(), NOW)).toMatchObject({
            state: 'renews', days: 17, endsAtMs: NOW + 17 * DAY, stale: false,
        });
    });

    it('warns when the plan will not renew, with the days until it ends', () => {
        expect(presentAccountSubscription(subscription({ renewal: 'off', currentPeriodEndAtMs: NOW + 4.2 * DAY }), NOW)).toMatchObject({
            state: 'ends', days: 5,
        });
    });

    it('marks the fact stale once it is older than the producer says it stays fresh', () => {
        expect(presentAccountSubscription(subscription({ observedAtMs: NOW - 3 * DAY }), NOW)).toMatchObject({
            state: 'renews', stale: true, checkedAtMs: NOW - 3 * DAY,
        });
    });

    it('claims nothing it was not told: unavailable, or a subscription without a period end', () => {
        expect(presentAccountSubscription(subscription({ status: 'unavailable' }), NOW)).toBeNull();
        expect(presentAccountSubscription(subscription({ currentPeriodEndAtMs: undefined }), NOW)).toBeNull();
        expect(presentAccountSubscription(null, NOW)).toBeNull();
        expect(presentAccountSubscription(subscription({ status: 'none' }), NOW)).toMatchObject({ state: 'none' });
    });
});
