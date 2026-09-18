import { describe, expect, it } from 'vitest';

import {
    SESSION_BOARD_DRAG_EDGE_RESISTANCE_PX,
    SESSION_BOARD_VIEW_DROP_DWELL_MS,
    advanceSessionBoardViewDropDwell,
    resolveSessionBoardAnchoredPointerDrop,
    resolveSessionBoardDragMove,
    resolveSessionBoardDragOffset,
} from './SessionBoardItemMoveHandle';

describe('resolveSessionBoardDragMove', () => {
    it('uses the dominant pointer axis so grid neighbors can be moved horizontally or vertically', () => {
        expect(resolveSessionBoardDragMove({ translationX: -50, translationY: 8, canMoveBefore: true, canMoveAfter: true })).toBe('before');
        expect(resolveSessionBoardDragMove({ translationX: 6, translationY: 50, canMoveBefore: true, canMoveAfter: true })).toBe('after');
    });

    it('produces no write intent for cancellation-sized movement or an unavailable direction', () => {
        expect(resolveSessionBoardDragMove({ translationX: 12, translationY: 9, canMoveBefore: true, canMoveAfter: true })).toBeNull();
        expect(resolveSessionBoardDragMove({ translationX: -50, translationY: 0, canMoveBefore: false, canMoveAfter: true })).toBeNull();
    });

    it('writes nothing when the system took the pointer away instead of the person dropping the card', () => {
        expect(resolveSessionBoardDragMove({
            translationX: 0,
            translationY: -120,
            canMoveBefore: true,
            canMoveAfter: true,
            succeeded: false,
        })).toBeNull();
        expect(resolveSessionBoardDragMove({
            translationX: 120,
            translationY: 0,
            canMoveBefore: true,
            canMoveAfter: true,
            succeeded: true,
        })).toBe('after');
    });
});

describe('resolveSessionBoardDragOffset', () => {
    it('stays attached 1:1 to the pointer inside the movable range', () => {
        expect(resolveSessionBoardDragOffset({
            translation: 73,
            canMoveBefore: true,
            canMoveAfter: true,
        })).toBe(73);
        expect(resolveSessionBoardDragOffset({
            translation: -73,
            canMoveBefore: true,
            canMoveAfter: true,
        })).toBe(-73);
    });

    it('resists progressively past an end of the view instead of running free', () => {
        const near = resolveSessionBoardDragOffset({
            translation: -20,
            canMoveBefore: false,
            canMoveAfter: true,
        });
        const far = resolveSessionBoardDragOffset({
            translation: -400,
            canMoveBefore: false,
            canMoveAfter: true,
        });

        // It still moves, so the gesture is visibly alive…
        expect(near).toBeLessThan(0);
        // …it keeps giving a little as the finger travels…
        expect(far).toBeLessThan(near);
        // …and it never wanders away from the item's real place.
        expect(Math.abs(far)).toBeLessThan(SESSION_BOARD_DRAG_EDGE_RESISTANCE_PX);
    });

    it('only resists the direction that has no neighbour', () => {
        expect(resolveSessionBoardDragOffset({
            translation: 60,
            canMoveBefore: false,
            canMoveAfter: true,
        })).toBe(60);
    });
});

describe('resolveSessionBoardAnchoredPointerDrop', () => {
    const itemRects = new Map([
        ['one', { x: 0, y: 0, width: 100, height: 80 }],
        ['two', { x: 116, y: 0, width: 100, height: 80 }],
        ['three', { x: 0, y: 96, width: 100, height: 80 }],
        ['four', { x: 116, y: 96, width: 100, height: 80 }],
    ]);

    it('resolves an arbitrary grid jump to one semantic anchor', () => {
        expect(resolveSessionBoardAnchoredPointerDrop({
            draggedId: 'one',
            orderedIds: ['one', 'two', 'three', 'four'],
            itemRects,
            translationX: 140,
            translationY: 125,
            droppedInside: true,
        })).toEqual({ side: 'after', itemId: 'four' });
    });

    it('returns no write for an unchanged slot or a drop outside the Board', () => {
        expect(resolveSessionBoardAnchoredPointerDrop({
            draggedId: 'two',
            orderedIds: ['one', 'two', 'three', 'four'],
            itemRects,
            translationX: 0,
            translationY: 0,
            droppedInside: true,
        })).toBeNull();
        expect(resolveSessionBoardAnchoredPointerDrop({
            draggedId: 'two',
            orderedIds: ['one', 'two', 'three', 'four'],
            itemRects,
            translationX: 500,
            translationY: 500,
            droppedInside: false,
        })).toBeNull();
    });
});

describe('advanceSessionBoardViewDropDwell', () => {
    it('arms a cross-view target only after one uninterrupted deliberate dwell', () => {
        const entered = advanceSessionBoardViewDropDwell(null, 'research', 1_000);
        expect(entered).toEqual({ viewId: 'research', enteredAt: 1_000, armed: false });
        expect(advanceSessionBoardViewDropDwell(entered, 'research', 1_000 + SESSION_BOARD_VIEW_DROP_DWELL_MS - 1)?.armed).toBe(false);
        expect(advanceSessionBoardViewDropDwell(entered, 'research', 1_000 + SESSION_BOARD_VIEW_DROP_DWELL_MS)?.armed).toBe(true);
    });

    it('cancels the dwell when the pointer leaves or crosses to another view', () => {
        const entered = advanceSessionBoardViewDropDwell(null, 'research', 1_000);
        expect(advanceSessionBoardViewDropDwell(entered, null, 1_100)).toBeNull();
        expect(advanceSessionBoardViewDropDwell(entered, 'ship', 1_100)).toEqual({
            viewId: 'ship',
            enteredAt: 1_100,
            armed: false,
        });
    });
});
