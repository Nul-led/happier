/**
 * Canvas geometry for Boards: where a card lands when dropped or moved by keyboard, and how many
 * card columns the unplaced cards flow into. Positions are logical pixels from the canvas origin and
 * are the user's data (`positionsByItemRef`); they are kept on phones, which show By status only.
 */
export const BOARD_CANVAS_METRICS = Object.freeze({
    /** The snap grid, and the keyboard's move step. */
    gridStepPx: 24,
    cardWidthPx: 400,
    gapPx: 24,
    /** The canvas's inner margin, so a card at the origin does not touch the page edge. */
    paddingPx: 24,
});

export type BoardCanvasPoint = Readonly<{ x: number; y: number }>;
export type BoardCanvasDirection = 'up' | 'down' | 'left' | 'right';

function snapValue(value: number): number {
    const step = BOARD_CANVAS_METRICS.gridStepPx;
    return Math.round(value / step) * step;
}

function clampToCanvas(point: BoardCanvasPoint): BoardCanvasPoint {
    return { x: Math.max(0, Math.round(point.x)), y: Math.max(0, Math.round(point.y)) };
}

/**
 * Snapping on: the nearest grid point. Off: exactly where it was released, unless ⇧ was held for this
 * drop (`snapOnce`). Never off the canvas.
 */
export function resolveBoardCardDrop(input: Readonly<{
    origin: BoardCanvasPoint;
    translation: BoardCanvasPoint;
    snap: boolean;
    snapOnce?: boolean;
}>): BoardCanvasPoint {
    const x = input.origin.x + input.translation.x;
    const y = input.origin.y + input.translation.y;
    return clampToCanvas(input.snap || input.snapOnce === true ? { x: snapValue(x), y: snapValue(y) } : { x, y });
}

/** An arrow key moves a focused card one grid step, first settling a free position onto the grid. */
export function moveBoardCardByKeyboard(position: BoardCanvasPoint, direction: BoardCanvasDirection): BoardCanvasPoint {
    const step = BOARD_CANVAS_METRICS.gridStepPx;
    const x = snapValue(position.x);
    const y = snapValue(position.y);
    switch (direction) {
        case 'up': return clampToCanvas({ x, y: y - step });
        case 'down': return clampToCanvas({ x, y: y + step });
        case 'left': return clampToCanvas({ x: x - step, y });
        case 'right': return clampToCanvas({ x: x + step, y });
    }
}

/** How many card columns fit in the canvas width; unplaced cards flow into them. */
export function resolveBoardCanvasColumnCount(widthPx: number): number {
    const { cardWidthPx, gapPx } = BOARD_CANVAS_METRICS;
    return Math.max(1, Math.floor((widthPx + gapPx) / (cardWidthPx + gapPx)));
}
