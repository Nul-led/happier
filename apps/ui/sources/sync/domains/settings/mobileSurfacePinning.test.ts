import { describe, expect, it } from 'vitest';

import { toggleSessionCockpitBarSurface } from './mobileSurfacePinning';

describe('session cockpit bar pins', () => {
    const defaults = ['browse', 'git', 'companion', 'terminal'];

    it('starts from the host defaults the first time the person changes the bar', () => {
        expect(toggleSessionCockpitBarSurface(null, 'tabs', defaults)).toEqual([...defaults, 'tabs']);
        expect(toggleSessionCockpitBarSurface(null, 'git', defaults)).toEqual(['browse', 'companion', 'terminal']);
    });

    it('has no pin cap: the bar width decides what fits, not a count', () => {
        let bar: readonly string[] | null = null;
        for (const id of ['tabs', 'navigation', 'board', 'browser', 'services']) {
            bar = toggleSessionCockpitBarSurface(bar, id, defaults);
        }
        expect(bar).toEqual([...defaults, 'tabs', 'navigation', 'board', 'browser', 'services']);
    });

    it('keeps an emptied bar empty rather than restoring the defaults', () => {
        expect(toggleSessionCockpitBarSurface(['git'], 'git', defaults)).toEqual([]);
    });
});
