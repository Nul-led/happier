import { describe, expect, it } from 'vitest';

import { buildSessionNearLimitPresentation } from './sessionNearLimitPresentation';

const base = {
    accountKey: 'claude/work',
    accountLabel: 'Personal',
    remainingPct: 6,
    meter: { meterId: 'five_hour', label: '5-hour', resetsAt: 1_000_000 },
    resetAvailable: true,
    limitReached: false,
    dismissedKeys: new Set<string>(),
};

describe('buildSessionNearLimitPresentation (G1)', () => {
    it('speaks only at danger (10% or less left) and only when a real action exists', () => {
        expect(buildSessionNearLimitPresentation(base)).toMatchObject({ remainingPct: 6, windowLabel: '5-hour', resetsAt: 1_000_000 });
        expect(buildSessionNearLimitPresentation({ ...base, remainingPct: 10 })).not.toBeNull();
        // Warning is the composer ring's job, not a banner.
        expect(buildSessionNearLimitPresentation({ ...base, remainingPct: 11 })).toBeNull();
        // Nothing to do about it: the ring colour is enough.
        expect(buildSessionNearLimitPresentation({ ...base, resetAvailable: false })).toBeNull();
    });

    it('steps aside once the limit is reached (the recovery banner owns that), and after a dismissal for this window', () => {
        expect(buildSessionNearLimitPresentation({ ...base, remainingPct: 0 })).toBeNull();
        expect(buildSessionNearLimitPresentation({ ...base, limitReached: true })).toBeNull();
        const shown = buildSessionNearLimitPresentation(base)!;
        expect(buildSessionNearLimitPresentation({ ...base, dismissedKeys: new Set([shown.key]) })).toBeNull();
        // A new window (a later reset) may speak again.
        expect(buildSessionNearLimitPresentation({
            ...base,
            meter: { ...base.meter, resetsAt: 2_000_000 },
            dismissedKeys: new Set([shown.key]),
        })).not.toBeNull();
    });
});
