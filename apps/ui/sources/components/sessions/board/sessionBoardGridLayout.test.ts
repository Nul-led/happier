import { describe, expect, it } from 'vitest';

import type { SessionBoardItemWidth } from '@happier-dev/protocol/sessions/board';

import {
    SESSION_BOARD_GRID_GAP_PX,
    SESSION_BOARD_MIN_ITEM_WIDTH_PX,
    resolveSessionBoardGridRowIndexes,
    resolveSessionBoardGridTier,
    resolveSessionBoardItemWidthPx,
} from './sessionBoardGridLayout';

const ORDER: readonly SessionBoardItemWidth[] = ['compact', 'medium', 'wide', 'full'];

function widths(availableWidthPx: number): number[] {
    const tier = resolveSessionBoardGridTier(availableWidthPx);
    return ORDER.map((width) => resolveSessionBoardItemWidthPx({ width, availableWidthPx, tier })
        ?? availableWidthPx);
}

describe('session board grid layout', () => {
    it('never draws a narrower semantic width wider than a broader one', () => {
        // Sweep the whole responsive range rather than the two comfortable ends:
        // the inversion this protects against only appears in the middle, where
        // one span falls under the readable floor and the next does not.
        for (let available = 120; available <= 1600; available += 7) {
            const [compact, medium, wide, full] = widths(available);
            expect(compact).toBeLessThanOrEqual(medium!);
            expect(medium!).toBeLessThanOrEqual(wide!);
            expect(wide!).toBeLessThanOrEqual(full!);
        }
    });

    it('tiles a row exactly, so a full item and two halves both end at the content edge', () => {
        const available = 900;
        const tier = resolveSessionBoardGridTier(available);
        expect(tier).toBe('twelve');

        const full = resolveSessionBoardItemWidthPx({ width: 'full', availableWidthPx: available, tier });
        expect(full).toBeCloseTo(available, 5);

        const medium = resolveSessionBoardItemWidthPx({ width: 'medium', availableWidthPx: available, tier })!;
        expect((medium * 2) + SESSION_BOARD_GRID_GAP_PX).toBeCloseTo(available, 5);

        const compact = resolveSessionBoardItemWidthPx({ width: 'compact', availableWidthPx: available, tier })!;
        expect((compact * 3) + (SESSION_BOARD_GRID_GAP_PX * 2)).toBeCloseTo(available, 5);
    });

    it('recomposes to halves before it gives up on side-by-side reading', () => {
        // 640 cannot hold three readable thirds but holds two halves comfortably.
        const tier = resolveSessionBoardGridTier(640);
        expect(tier).toBe('halves');

        const compact = resolveSessionBoardItemWidthPx({ width: 'compact', availableWidthPx: 640, tier })!;
        const wide = resolveSessionBoardItemWidthPx({ width: 'wide', availableWidthPx: 640, tier })!;
        expect(compact).toBeGreaterThanOrEqual(SESSION_BOARD_MIN_ITEM_WIDTH_PX);
        expect(wide).toBe(640);
    });

    it('linearizes once even a half stops being readable', () => {
        expect(resolveSessionBoardGridTier(400)).toBe('single');
        expect(resolveSessionBoardItemWidthPx({
            width: 'compact',
            availableWidthPx: 400,
            tier: 'single',
        })).toBeNull();
    });

    it('treats an unmeasured container as unresolved rather than guessing a width', () => {
        expect(resolveSessionBoardGridTier(0)).toBe('single');
        expect(resolveSessionBoardItemWidthPx({
            width: 'full',
            availableWidthPx: Number.NaN,
            tier: 'twelve',
        })).toBeNull();
    });
});

describe('session Board grid rows', () => {
    it('packs a row until the next card no longer fits', () => {
        expect(resolveSessionBoardGridRowIndexes({
            widths: ['compact', 'compact', 'compact', 'compact', 'medium', 'wide'],
            tier: 'twelve',
        })).toEqual([0, 0, 0, 1, 1, 2]);
    });

    it('breaks the row for a card the remaining columns cannot hold', () => {
        expect(resolveSessionBoardGridRowIndexes({
            widths: ['compact', 'full', 'compact'],
            tier: 'twelve',
        })).toEqual([0, 1, 2]);
    });

    it('gives every card its own row once the grid linearizes', () => {
        expect(resolveSessionBoardGridRowIndexes({
            widths: ['compact', 'compact', 'wide'],
            tier: 'single',
        })).toEqual([0, 1, 2]);
        expect(resolveSessionBoardGridRowIndexes({
            widths: ['compact', 'compact', 'wide', 'compact'],
            tier: 'halves',
        })).toEqual([0, 0, 1, 2]);
    });
});
