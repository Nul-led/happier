import { describe, expect, it, vi } from 'vitest';

import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import {
    invalidateSessionListQueryHome,
    subscribeSessionListQueryHomeInvalidation,
} from './sessionListQueryInvalidation';

describe('filtered-list Account-change invalidation', () => {
    it('invalidates only the mounted controller for an exact local deadline Home', () => {
        const invalidateA = vi.fn();
        const invalidateB = vi.fn();
        const dispose = subscribeSessionListQueryHomeInvalidation(() => new Map([
            ['home-a', { invalidate: invalidateA }],
            ['home-b', { invalidate: invalidateB }],
        ]));

        invalidateSessionListQueryHome('home-b');

        expect(invalidateA).not.toHaveBeenCalled();
        expect(invalidateB).toHaveBeenCalledTimes(1);
        dispose();
    });

    it('invalidates only the mounted controller for the exact changed Home', () => {
        const invalidateA = vi.fn();
        const invalidateB = vi.fn();
        const dispose = subscribeSessionListQueryHomeInvalidation(() => new Map([
            ['home-a', { invalidate: invalidateA }],
            ['home-b', { invalidate: invalidateB }],
        ]));

        publishHomeAccountChange('home-b', ['session-1']);
        expect(invalidateA).not.toHaveBeenCalled();
        expect(invalidateB).toHaveBeenCalledTimes(1);

        dispose();
        publishHomeAccountChange('home-b', ['session-2']);
        expect(invalidateB).toHaveBeenCalledTimes(1);
    });

    it('obeys the canonical detailed decision and retains unknown conservative wakes', () => {
        const invalidate = vi.fn();
        const dispose = subscribeSessionListQueryHomeInvalidation(() => new Map([
            ['home-a', { invalidate }],
        ]));

        publishHomeAccountChange('home-a', ['self'], { sessionListQueryAffects: false });
        expect(invalidate).not.toHaveBeenCalled();

        publishHomeAccountChange('home-a', ['self'], { sessionListQueryAffects: true });
        expect(invalidate).toHaveBeenCalledTimes(1);

        publishHomeAccountChange('home-a');
        expect(invalidate).toHaveBeenCalledTimes(2);

        dispose();
    });
});
