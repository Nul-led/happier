import { describe, expect, it } from 'vitest';

import { resolveBrowserChromeControlMetrics } from './browserChromeDensity';

describe('resolveBrowserChromeControlMetrics', () => {
    it('draws the chrome at the lab desktop scale under a precise pointer, with no touch floor', () => {
        const wide = resolveBrowserChromeControlMetrics('wide', { touch: false });
        // Lab `browser` Q: 28 px controls beside a 30 px address field in a 44 px row.
        expect(wide).toMatchObject({ size: 28, addressDensity: 'toolbarPrecise', touchTargetFloorPx: null });
        expect(wide.size + wide.rowPaddingVerticalPx * 2).toBeLessThanOrEqual(44);
        expect(resolveBrowserChromeControlMetrics('pane', { touch: false }).size).toBe(28);
    });

    it('keeps finger-sized targets wherever the primary pointer is touch, and the phone bar at 44', () => {
        const touchPane = resolveBrowserChromeControlMetrics('pane', { touch: true });
        expect(touchPane.size).toBeGreaterThan(28);
        expect(touchPane.touchTargetFloorPx).toBeGreaterThanOrEqual(44);
        expect(touchPane.addressDensity).toBe('toolbar');
        expect(resolveBrowserChromeControlMetrics('phone', { touch: true })).toMatchObject({ size: 44, addressDensity: 'capsule' });
    });
});
