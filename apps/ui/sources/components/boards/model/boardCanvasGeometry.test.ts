import { describe, expect, it } from 'vitest';

import {
    BOARD_CANVAS_METRICS,
    moveBoardCardByKeyboard,
    resolveBoardCanvasColumnCount,
    resolveBoardCardDrop,
} from './boardCanvasGeometry';

const step = BOARD_CANVAS_METRICS.gridStepPx;

describe('board canvas geometry', () => {
    it('lands a dropped card exactly where it was released when snapping is off, and on the grid when on', () => {
        expect(resolveBoardCardDrop({ origin: { x: 10, y: 20 }, translation: { x: 31, y: 7 }, snap: false }))
            .toEqual({ x: 41, y: 27 });
        expect(resolveBoardCardDrop({ origin: { x: 10, y: 20 }, translation: { x: 31, y: 7 }, snap: true }))
            .toEqual({ x: Math.round(41 / step) * step, y: Math.round(27 / step) * step });
    });

    it('with snapping off, holding Shift snaps this one drop to the grid', () => {
        expect(resolveBoardCardDrop({ origin: { x: 10, y: 20 }, translation: { x: 31, y: 7 }, snap: false, snapOnce: true }))
            .toEqual({ x: Math.round(41 / step) * step, y: Math.round(27 / step) * step });
    });

    it('never places a card above or left of the canvas origin', () => {
        expect(resolveBoardCardDrop({ origin: { x: 10, y: 10 }, translation: { x: -400, y: -400 }, snap: true }))
            .toEqual({ x: 0, y: 0 });
    });

    it('moves a focused card one snap-grid step per arrow key, from a free position onto the grid', () => {
        expect(moveBoardCardByKeyboard({ x: 0, y: 0 }, 'right')).toEqual({ x: step, y: 0 });
        expect(moveBoardCardByKeyboard({ x: step * 2, y: step }, 'up')).toEqual({ x: step * 2, y: 0 });
        expect(moveBoardCardByKeyboard({ x: 5, y: 5 }, 'down')).toEqual({ x: 0, y: step });
        expect(moveBoardCardByKeyboard({ x: 0, y: 0 }, 'left')).toEqual({ x: 0, y: 0 });
    });

    it('fits as many card columns as the width allows, at least one', () => {
        const slot = BOARD_CANVAS_METRICS.cardWidthPx + BOARD_CANVAS_METRICS.gapPx;
        expect(resolveBoardCanvasColumnCount(100)).toBe(1);
        expect(resolveBoardCanvasColumnCount(slot * 3)).toBe(3);
    });
});
