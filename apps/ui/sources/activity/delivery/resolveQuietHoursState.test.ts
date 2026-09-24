import { describe, expect, it } from 'vitest';

import { isNightlyQuietHoursWindowSet, NIGHTLY_QUIET_HOURS_WINDOW } from './resolveQuietHoursState';

describe('isNightlyQuietHoursWindowSet', () => {
    it('recognises exactly the nightly preset', () => {
        expect(isNightlyQuietHoursWindowSet([{ ...NIGHTLY_QUIET_HOURS_WINDOW }])).toBe(true);
        expect(isNightlyQuietHoursWindowSet([{ ...NIGHTLY_QUIET_HOURS_WINDOW, days: [] }])).toBe(true);
    });

    it('refuses a schedule that merely contains the nightly window or narrows it', () => {
        // The settings row that answers this loosely labels a foreign schedule as the preset and
        // then replaces it on press, silently discarding the windows the user actually configured.
        expect(isNightlyQuietHoursWindowSet([
            { ...NIGHTLY_QUIET_HOURS_WINDOW },
            { startLocalTime: '12:00', endLocalTime: '13:00' },
        ])).toBe(false);
        expect(isNightlyQuietHoursWindowSet([
            { ...NIGHTLY_QUIET_HOURS_WINDOW, days: ['mon', 'tue'] },
        ])).toBe(false);
        expect(isNightlyQuietHoursWindowSet([{ startLocalTime: '09:00', endLocalTime: '17:00' }])).toBe(false);
        expect(isNightlyQuietHoursWindowSet([])).toBe(false);
    });
});
