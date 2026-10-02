import type { TerminalArrowDirection } from './terminalKeyInput';
import type { EmbeddedTerminalCursorRow } from '../embeddedTerminalRendererHandle';

/**
 * The phone arrow pad's measures (terminal lab P1, round 2b): four 26 pt keys in an 84 pt cross,
 * an invisible 132 pt touch square split on its diagonals (one ≥44 pt wedge per arrow, no overlap),
 * a 24 pt inset from the terminal's edges, and a 28 pt dot (44 pt hit area) when tucked away.
 */
export const ARROW_PAD_METRICS = Object.freeze({
    keyPx: 26,
    keyGapPx: 3,
    crossPx: 84,
    touchPx: 132,
    edgeInsetPx: 24,
    dotPx: 28,
    dotHitPx: 44,
    dotInsetPx: 12,
    /** Dragging the pad's centre this close to a side edge tucks it into a dot. */
    tuckEdgePx: 24,
    holdToMoveMs: 300,
    /** Movement before the hold fires cancels the press: it was a scroll, not a key. */
    pressSlopPx: 10,
});
const M = ARROW_PAD_METRICS;

/** Device-local placement: the side it rests on, its height as a fraction of the area, tucked or not. */
export type ArrowPadPlacement = Readonly<{ side: 'left' | 'right'; y: number; tucked: boolean }>;
export type ArrowPadArea = Readonly<{ width: number; height: number }>;
export type ArrowPadPoint = Readonly<{ x: number; y: number }>;

export function resolveArrowPadCursorOverlap(center: ArrowPadPoint, row: EmbeddedTerminalCursorRow | null): boolean {
    return row !== null && row.top < center.y + M.crossPx / 2 && row.top + row.height > center.y - M.crossPx / 2;
}

/** Which arrow a press at (x, y) inside the touch square sends: the wedge between its diagonals. */
export function resolveArrowPadDirection(x: number, y: number): TerminalArrowDirection {
    const dx = x - M.touchPx / 2;
    const dy = y - M.touchPx / 2;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
}

function clampCenterY(y: number, area: ArrowPadArea): number {
    const min = M.edgeInsetPx + M.crossPx / 2;
    const max = Math.max(min, area.height - M.edgeInsetPx - M.crossPx / 2);
    return Math.min(max, Math.max(min, y));
}

/** The cross's centre for a placement; no placement rests in the lower-right corner. */
export function resolveArrowPadCenter(placement: ArrowPadPlacement | null, area: ArrowPadArea): ArrowPadPoint {
    const side = placement?.side ?? 'right';
    const x = side === 'right' ? area.width - M.edgeInsetPx - M.crossPx / 2 : M.edgeInsetPx + M.crossPx / 2;
    const y = placement ? clampCenterY(placement.y * area.height, area) : clampCenterY(area.height, area);
    return { x, y };
}

/** The tucked dot's centre: on its side edge, at the cross's height. */
export function resolveArrowPadDotCenter(placement: ArrowPadPlacement, area: ArrowPadArea): ArrowPadPoint {
    const x = placement.side === 'right' ? area.width - M.dotInsetPx - M.dotPx / 2 : M.dotInsetPx + M.dotPx / 2;
    return { x, y: resolveArrowPadCenter(placement, area).y };
}

/**
 * Where a dragged pad lands on release: the nearest side edge at the height it was let go (clamped
 * inside the terminal, so never under the key rail), or tucked into a dot when dragged past an edge.
 */
export function resolveArrowPadRelease(center: ArrowPadPoint, area: ArrowPadArea): ArrowPadPlacement {
    const side = center.x < area.width / 2 ? 'left' : 'right';
    const tucked = center.x < M.tuckEdgePx || center.x > area.width - M.tuckEdgePx;
    const y = area.height > 0 ? clampCenterY(center.y, area) / area.height : 1;
    return { side, y, tucked };
}
