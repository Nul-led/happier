import { describe, expect, it } from 'vitest';

import {
    ARROW_PAD_METRICS as M,
    resolveArrowPadCenter,
    resolveArrowPadDirection,
    resolveArrowPadRelease,
    resolveArrowPadCursorOverlap,
} from './terminalArrowPadGeometry';

const area = { width: 390, height: 500 };

describe('arrow pad geometry', () => {
    it('dims only for a cursor row crossing the visible cross at its current placement', () => {
        const center = resolveArrowPadCenter(null, area);
        expect(resolveArrowPadCursorOverlap(center, { top: center.y - 8, height: 16 })).toBe(true);
        expect(resolveArrowPadCursorOverlap(center, { top: center.y - M.crossPx / 2 - 20, height: 16 })).toBe(false);
        expect(resolveArrowPadCursorOverlap(center, null)).toBe(false);
        const moved = resolveArrowPadCenter({ side: 'left', y: 0.3, tucked: false }, area);
        expect(resolveArrowPadCursorOverlap(moved, { top: center.y - 8, height: 16 })).toBe(false);
    });
    it('gives each arrow one diagonal wedge of the touch square', () => {
        const c = M.touchPx / 2;
        expect(resolveArrowPadDirection(c, 4)).toBe('up');
        expect(resolveArrowPadDirection(c, M.touchPx - 4)).toBe('down');
        expect(resolveArrowPadDirection(4, c)).toBe('left');
        expect(resolveArrowPadDirection(M.touchPx - 4, c)).toBe('right');
        // A corner of the square still belongs to the arrow whose wedge holds it.
        expect(resolveArrowPadDirection(c + 30, 10)).toBe('up');
        expect(resolveArrowPadDirection(M.touchPx - 10, c - 30)).toBe('right');
    });

    it('rests in the lower-right corner until the person moves it', () => {
        const center = resolveArrowPadCenter(null, area);
        expect(center.x).toBe(area.width - M.edgeInsetPx - M.crossPx / 2);
        expect(center.y).toBe(area.height - M.edgeInsetPx - M.crossPx / 2);
    });

    it('lands on the nearest side at the height it was let go', () => {
        const left = resolveArrowPadRelease({ x: 120, y: 200 }, area);
        expect(left).toEqual({ side: 'left', y: 200 / area.height, tucked: false });
        const right = resolveArrowPadRelease({ x: 260, y: 300 }, area);
        expect(right.side).toBe('right');
        expect(resolveArrowPadCenter(right, area).x).toBe(area.width - M.edgeInsetPx - M.crossPx / 2);
    });

    it('never lands under the key rail or above the top of the terminal', () => {
        const low = resolveArrowPadRelease({ x: 300, y: area.height + 80 }, area);
        expect(resolveArrowPadCenter(low, area).y).toBe(area.height - M.edgeInsetPx - M.crossPx / 2);
        const high = resolveArrowPadRelease({ x: 300, y: -40 }, area);
        expect(resolveArrowPadCenter(high, area).y).toBe(M.edgeInsetPx + M.crossPx / 2);
    });

    it('tucks into a dot when dragged past a side edge', () => {
        expect(resolveArrowPadRelease({ x: area.width - 4, y: 240 }, area)).toEqual({ side: 'right', y: 240 / area.height, tucked: true });
        expect(resolveArrowPadRelease({ x: 6, y: 240 }, area).tucked).toBe(true);
        expect(resolveArrowPadRelease({ x: 60, y: 240 }, area).tucked).toBe(false);
    });
});
