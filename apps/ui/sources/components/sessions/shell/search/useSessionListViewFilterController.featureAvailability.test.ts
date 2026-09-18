import { describe, expect, it } from 'vitest';

import { resolveSelectedHomeFeatureAvailability } from './useSessionListViewFilterController';

describe('resolveSelectedHomeFeatureAvailability', () => {
    it('keeps a selected enabled Home reachable when a different active Home is disabled', () => {
        expect(resolveSelectedHomeFeatureAvailability(
            ['home-b'],
            { 'home-a': false, 'home-b': true },
        )).toBe(true);
    });

    it('does not imply selected-Home support from a different active Home', () => {
        expect(resolveSelectedHomeFeatureAvailability(
            ['home-b'],
            { 'home-a': true, 'home-b': false },
        )).toBe(false);
    });

    it('reports selected mixed-Home availability without collapsing the capable Home', () => {
        expect(resolveSelectedHomeFeatureAvailability(
            ['home-a', 'home-b'],
            { 'home-a': false, 'home-b': true },
        )).toBe(true);
    });
});
