import type { SessionBoardItemWidth } from '@happier-dev/protocol/sessions/board';

/**
 * The Board grid's one responsive decision.
 *
 * The shared layout stores a semantic width per placement; this resolves what
 * that intent is worth at the container's real measured width. It recomposes in
 * whole tiers rather than shrinking each item on its own, because a per-item
 * fallback can invert the person's intent: a `compact` card whose share fell
 * below the readable floor would jump to the full row while the `medium` beside
 * it stayed at half, so the item the person made smaller ends up drawn larger.
 */

/** The gutter between cards and the grid's own inset. One rhythm, one number. */
export const SESSION_BOARD_GRID_GAP_PX = 12;

/** Below this a semantic span stops carrying readable content. */
export const SESSION_BOARD_MIN_ITEM_WIDTH_PX = 240;

/** Twelve columns, then halves, then one column. Never a per-item exception. */
export type SessionBoardGridTier = 'twelve' | 'halves' | 'single';

const TWELFTHS: Readonly<Record<SessionBoardItemWidth, number>> = Object.freeze({
    compact: 4,
    medium: 6,
    wide: 8,
    full: 12,
});

const HALVES: Readonly<Record<SessionBoardItemWidth, number>> = Object.freeze({
    compact: 1,
    medium: 1,
    wide: 2,
    full: 2,
});

/** The width of `columns` of `total` inside `availableWidthPx`, gutters solved in. */
function spanWidthPx(availableWidthPx: number, columns: number, total: number): number {
    return (((availableWidthPx + SESSION_BOARD_GRID_GAP_PX) * columns) / total) - SESSION_BOARD_GRID_GAP_PX;
}

/**
 * @param availableWidthPx content width inside the grid's own padding.
 */
export function resolveSessionBoardGridTier(availableWidthPx: number): SessionBoardGridTier {
    if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return 'single';
    if (spanWidthPx(availableWidthPx, 4, 12) >= SESSION_BOARD_MIN_ITEM_WIDTH_PX) return 'twelve';
    if (spanWidthPx(availableWidthPx, 1, 2) >= SESSION_BOARD_MIN_ITEM_WIDTH_PX) return 'halves';
    return 'single';
}

/**
 * The measured width for one placement, or `null` when the host linearizes and
 * the item should simply fill its column.
 */
export function resolveSessionBoardItemWidthPx(input: Readonly<{
    width: SessionBoardItemWidth;
    availableWidthPx: number;
    tier: SessionBoardGridTier;
}>): number | null {
    if (input.tier === 'single') return null;
    if (!Number.isFinite(input.availableWidthPx) || input.availableWidthPx <= 0) return null;
    if (input.tier === 'halves') {
        return HALVES[input.width] === 2
            ? input.availableWidthPx
            : spanWidthPx(input.availableWidthPx, 1, 2);
    }
    return TWELFTHS[input.width] === 12
        ? input.availableWidthPx
        : spanWidthPx(input.availableWidthPx, TWELFTHS[input.width], 12);
}
