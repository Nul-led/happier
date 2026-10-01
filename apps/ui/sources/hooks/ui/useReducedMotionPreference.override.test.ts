import { afterEach, describe, expect, it } from 'vitest';

import { readReducedMotionPreference, setReducedMotionPreferenceOverride } from './useReducedMotionPreference';

describe('reduced motion preference override', () => {
    afterEach(() => {
        setReducedMotionPreferenceOverride(null);
    });

    it('lets one surface (the embed preview) force its own value, and clearing it restores the host value', () => {
        const host = readReducedMotionPreference();

        setReducedMotionPreferenceOverride(!host);
        expect(readReducedMotionPreference()).toBe(!host);

        setReducedMotionPreferenceOverride(null);
        expect(readReducedMotionPreference()).toBe(host);
    });
});
