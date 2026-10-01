import { describe, expect, it, vi } from 'vitest';

import {
    beginSessionCompanionDrag,
    endSessionCompanionDrag,
    hasSessionCompanionDropTarget,
    moveSessionCompanionDrag,
    registerSessionCompanionDropTarget,
} from './sessionCompanionDropStore';

const RAIL = { x: 800, y: 60, width: 320, height: 700 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('dragging a Board card onto the Companion', () => {
    it('hands the Board item to the Companion only when it is dropped on the rail', async () => {
        const accept = vi.fn();
        const unregister = registerSessionCompanionDropTarget('s1', { measure: async () => RAIL, accept });

        beginSessionCompanionDrag('s1', 'item-a');
        await flush();
        moveSessionCompanionDrag('s1', 900, 300);
        expect(endSessionCompanionDrag('s1', { x: 900, y: 300 })).toBe(true);
        expect(accept).toHaveBeenCalledWith('item-a');

        beginSessionCompanionDrag('s1', 'item-b');
        await flush();
        expect(endSessionCompanionDrag('s1', { x: 200, y: 300 })).toBe(false);
        expect(accept).toHaveBeenCalledTimes(1);
        unregister();
    });

    it('offers no drag when no Companion rail is there to catch it', () => {
        expect(hasSessionCompanionDropTarget('s2')).toBe(false);
        beginSessionCompanionDrag('s2', 'item-a');
        expect(endSessionCompanionDrag('s2', { x: 900, y: 300 })).toBe(false);
    });

    it('never drops a cancelled drag', async () => {
        const accept = vi.fn();
        const unregister = registerSessionCompanionDropTarget('s3', { measure: async () => RAIL, accept });
        beginSessionCompanionDrag('s3', 'item-a');
        await flush();
        expect(endSessionCompanionDrag('s3', null)).toBe(false);
        expect(accept).not.toHaveBeenCalled();
        unregister();
    });
});
