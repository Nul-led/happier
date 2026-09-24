import type { AttentionDeviceOverridesV1 } from '@/sync/domains/settings/attentionDeviceOverridesV1';

export type ResolvedDeviceQuietHoursOverride = Readonly<
    | { mode: 'account' }
    | { mode: 'disabled' }
    | {
        mode: 'custom';
        timezone: string;
        windows: readonly {
            startLocalTime: string;
            endLocalTime: string;
            days?: readonly ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
        }[];
    }
>;

export function resolveDeviceQuietHoursOverride(
    overrides: AttentionDeviceOverridesV1,
): ResolvedDeviceQuietHoursOverride {
    return overrides.quietHoursOverride;
}

/** The one nightly schedule the settings presets offer, on the Account and on a device. */
export const NIGHTLY_QUIET_HOURS_WINDOW = Object.freeze({
    startLocalTime: '22:00',
    endLocalTime: '07:00',
});

type QuietHoursWindow = Readonly<{
    startLocalTime: string;
    endLocalTime: string;
    days?: readonly string[];
}>;

/**
 * Whether a configured schedule IS the nightly preset — not merely whether it contains it, and not
 * merely whether some override exists. A presenter that answers this loosely labels a foreign
 * schedule (an extra window, weekday-scoped hours, a schedule another device wrote) as the preset,
 * and pressing that row then silently replaces the real schedule with 22:00–07:00.
 */
export function isNightlyQuietHoursWindowSet(windows: readonly QuietHoursWindow[]): boolean {
    if (windows.length !== 1) return false;
    const [window] = windows;
    return window.startLocalTime === NIGHTLY_QUIET_HOURS_WINDOW.startLocalTime
        && window.endLocalTime === NIGHTLY_QUIET_HOURS_WINDOW.endLocalTime
        && (window.days === undefined || window.days.length === 0);
}
