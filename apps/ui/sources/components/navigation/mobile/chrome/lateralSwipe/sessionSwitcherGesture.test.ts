import { describe, expect, it } from 'vitest';

import {
    SESSION_SWITCHER_LOCK_PX,
    SESSION_SWITCHER_STEP_PX,
    resolveSessionSwitcherAutoScrollRate,
    resolveSessionSwitcherLift,
    resolveSessionSwitcherRelease,
    resolveSessionSwitcherScrub,
    resolveSessionSwitcherStart,
    type SessionSwitcherGestureSettings,
} from './sessionSwitcherGesture';

const ALL_ON: SessionSwitcherGestureSettings = { sideways: true, dragUp: true, flick: true, holdToDock: true };

describe('session switcher gesture', () => {
    describe('start: which gesture a movement on the bar becomes', () => {
        it('left → right is NEXT and right → left is PREVIOUS (user decision 2026-10-01)', () => {
            expect(resolveSessionSwitcherStart({ translationX: 14, translationY: 2, held: false, settings: ALL_ON, barScrolls: false }))
                .toEqual({ phase: 'side', direction: 'next' });
            expect(resolveSessionSwitcherStart({ translationX: -14, translationY: 2, held: false, settings: ALL_ON, barScrolls: false }))
                .toEqual({ phase: 'side', direction: 'previous' });
        });

        it('a scrolling bar owns the sideways axis, and so does a disabled sideways setting', () => {
            expect(resolveSessionSwitcherStart({ translationX: 14, translationY: 0, held: false, settings: ALL_ON, barScrolls: true }).phase)
                .toBe('none');
            expect(resolveSessionSwitcherStart({ translationX: 14, translationY: 0, held: false, settings: { ...ALL_ON, sideways: false }, barScrolls: false }).phase)
                .toBe('none');
        });

        it('up opens the ghost; with drag-up off it is a flick; down is always a flick, never after a hold', () => {
            const up = { translationX: 1, translationY: -14, barScrolls: false } as const;
            expect(resolveSessionSwitcherStart({ ...up, held: false, settings: ALL_ON }).phase).toBe('lift');
            expect(resolveSessionSwitcherStart({ ...up, held: false, settings: { ...ALL_ON, dragUp: false } }).phase).toBe('flick');
            expect(resolveSessionSwitcherStart({ ...up, held: true, settings: { ...ALL_ON, dragUp: false } }).phase).toBe('none');
            const down = { translationX: 0, translationY: 14, barScrolls: false } as const;
            expect(resolveSessionSwitcherStart({ ...down, held: false, settings: ALL_ON }).phase).toBe('flick');
            expect(resolveSessionSwitcherStart({ ...down, held: true, settings: ALL_ON }).phase).toBe('none');
            expect(resolveSessionSwitcherStart({ ...down, held: false, settings: { ...ALL_ON, flick: false } }).phase).toBe('none');
        });
    });

    it('lift: the bar rises at .6 of the finger and locks at 120 pt', () => {
        expect(resolveSessionSwitcherLift(60)).toEqual({ progress: 0.5, lift: 36, locked: false });
        expect(resolveSessionSwitcherLift(SESSION_SWITCHER_LOCK_PX + 40)).toEqual({ progress: 1, lift: 72, locked: true });
        expect(resolveSessionSwitcherLift(-10).progress).toBe(0);
    });

    describe('relative scrub', () => {
        const base = { anchorY: 500, anchorIndex: 0, count: 5, minIndex: -1 } as const;
        it('every 22 pt of thumb travel moves one row, from wherever the thumb is', () => {
            expect(resolveSessionSwitcherScrub({ ...base, y: 500 - SESSION_SWITCHER_STEP_PX * 2 }).index).toBe(2);
            expect(resolveSessionSwitcherScrub({ ...base, y: 500 + SESSION_SWITCHER_STEP_PX }).index).toBe(-1);
        });

        it('past either end it re-anchors, so moving back answers at once', () => {
            const far = resolveSessionSwitcherScrub({ ...base, y: 500 - SESSION_SWITCHER_STEP_PX * 12 });
            expect(far.index).toBe(4);
            // One step back down from the far point lands one row nearer, not eight.
            const back = resolveSessionSwitcherScrub({ ...base, anchorY: far.anchorY, y: 500 - SESSION_SWITCHER_STEP_PX * 11 });
            expect(back.index).toBe(3);
            const below = resolveSessionSwitcherScrub({ ...base, y: 500 + SESSION_SWITCHER_STEP_PX * 6 });
            expect(below.index).toBe(-1);
            expect(resolveSessionSwitcherScrub({ ...base, anchorY: below.anchorY, y: 500 + SESSION_SWITCHER_STEP_PX * 5 }).index).toBe(0);
        });
    });

    it('edge auto-scroll: holding near the top keeps stepping, faster nearer the edge; nothing in the middle', () => {
        const at = (y: number) => resolveSessionSwitcherAutoScrollRate({ y, listTop: 200, listBottom: 600, index: 3, minIndex: -1, scrolled: true });
        expect(at(400)).toBe(0);
        expect(at(200 + 63)).toBeGreaterThan(0);
        expect(at(200)).toBeGreaterThan(at(240));
        expect(at(150)).toBeLessThanOrEqual(18);
        // The bottom zone only scrolls back once the list has scrolled.
        expect(resolveSessionSwitcherAutoScrollRate({ y: 600, listTop: 200, listBottom: 600, index: 3, minIndex: -1, scrolled: false })).toBe(0);
        expect(at(600)).toBeLessThan(0);
    });

    describe('release', () => {
        const still = { translationX: 0, translationY: 0, velocityX: 0, velocityY: 0, cancelled: false } as const;

        it('a hold that never moved docks the switcher', () => {
            expect(resolveSessionSwitcherRelease({ ...still, phase: 'held', index: 0, scrubbed: false, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'dock' });
        });

        it('before the lock a quick flick up jumps to the next; anything slower was a look', () => {
            expect(resolveSessionSwitcherRelease({ ...still, phase: 'lift', translationY: -40, velocityY: -700, index: 0, scrubbed: false, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'flick', direction: 'next' });
            expect(resolveSessionSwitcherRelease({ ...still, phase: 'lift', translationY: -90, velocityY: -100, index: 0, scrubbed: false, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'cancel' });
        });

        it('after the lock it opens the row under the thumb, and the bar (index -1) stays', () => {
            expect(resolveSessionSwitcherRelease({ ...still, phase: 'scrub', index: 2, scrubbed: true, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'open', index: 2 });
            expect(resolveSessionSwitcherRelease({ ...still, phase: 'scrub', index: -1, scrubbed: true, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'cancel' });
        });

        it('sideways keeps today’s quick swipe: 72 pt or 520 pt/s opens the raised one; a nudge springs back', () => {
            const side = { ...still, phase: 'side', index: 0, scrubbed: false, flickEnabled: true } as const;
            expect(resolveSessionSwitcherRelease({ ...side, translationX: 80, maxAbsTranslationX: 80 })).toEqual({ kind: 'open', index: 0 });
            expect(resolveSessionSwitcherRelease({ ...side, translationX: 20, velocityX: 600, maxAbsTranslationX: 20 })).toEqual({ kind: 'open', index: 0 });
            expect(resolveSessionSwitcherRelease({ ...side, translationX: 20, velocityX: 100, maxAbsTranslationX: 20 })).toEqual({ kind: 'cancel' });
            // Keep holding and move: the selection the person can see lands without a distance requirement.
            expect(resolveSessionSwitcherRelease({ ...side, index: 2, scrubbed: true, translationX: 20, maxAbsTranslationX: 20 })).toEqual({ kind: 'open', index: 2 });
            expect(resolveSessionSwitcherRelease({ ...side, index: -1, scrubbed: true, translationX: 90, maxAbsTranslationX: 90 })).toEqual({ kind: 'cancel' });
        });

        it('flicks: up needs 72 pt or the velocity, down only 36 pt (there is no room below the bar)', () => {
            const flick = { ...still, phase: 'flick', index: 0, scrubbed: false, maxAbsTranslationX: 0, flickEnabled: true } as const;
            expect(resolveSessionSwitcherRelease({ ...flick, translationY: 40 })).toEqual({ kind: 'flick', direction: 'previous' });
            expect(resolveSessionSwitcherRelease({ ...flick, translationY: -40 })).toEqual({ kind: 'cancel' });
            expect(resolveSessionSwitcherRelease({ ...flick, translationY: -75 })).toEqual({ kind: 'flick', direction: 'next' });
        });

        it('a gesture the system took away never lands', () => {
            expect(resolveSessionSwitcherRelease({ ...still, cancelled: true, phase: 'scrub', index: 1, scrubbed: true, maxAbsTranslationX: 0, flickEnabled: true }))
                .toEqual({ kind: 'cancel' });
        });
    });
});
