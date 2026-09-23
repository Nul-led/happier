import { describe, expect, it } from 'vitest';

import { createSessionBoardDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';

import {
    isSessionBoardVisibleInDetails,
    listVisibleSessionBoardDetailsExpandedItemIds,
} from './sessionBoardDetailsVisibility';

describe('isSessionBoardVisibleInDetails', () => {
    it('only counts the maximized Details group as physically visible', () => {
        const boardTabKey = createSessionBoardDetailsTab().key;
        const boardItemTabKey = createSessionBoardDetailsTab({ kind: 'item', itemId: 'item-1' }).key;
        expect(isSessionBoardVisibleInDetails({
            isOpen: true,
            activeTabKey: boardTabKey,
            maximizedGroupId: 'group:file',
            groups: [
                { id: 'group:board', activeTabKey: boardTabKey },
                { id: 'group:file', activeTabKey: 'file:README.md' },
            ],
        })).toBe(false);

        expect(isSessionBoardVisibleInDetails({
            isOpen: true,
            activeTabKey: 'file:README.md',
            maximizedGroupId: 'group:board',
            groups: [
                { id: 'group:board', activeTabKey: boardItemTabKey },
                { id: 'group:file', activeTabKey: 'file:README.md' },
            ],
        })).toBe(true);
    });
});

describe('listVisibleSessionBoardDetailsExpandedItemIds', () => {
    it('names only the expanded destinations a person can actually see', () => {
        const boardTabKey = createSessionBoardDetailsTab().key;
        const firstItemTabKey = createSessionBoardDetailsTab({ kind: 'item', itemId: 'item-1' }).key;
        const secondItemTabKey = createSessionBoardDetailsTab({ kind: 'item', itemId: 'item-2' }).key;

        expect(listVisibleSessionBoardDetailsExpandedItemIds({
            isOpen: true,
            activeTabKey: boardTabKey,
            groups: [
                { id: 'group:board', activeTabKey: boardTabKey },
                { id: 'group:item', activeTabKey: firstItemTabKey },
                // A background tab in a split group is not on screen.
                { id: 'group:file', activeTabKey: 'file:README.md' },
            ],
        })).toEqual(['item-1']);

        // A maximized group is the only destination presented.
        expect(listVisibleSessionBoardDetailsExpandedItemIds({
            isOpen: true,
            activeTabKey: firstItemTabKey,
            maximizedGroupId: 'group:second',
            groups: [
                { id: 'group:first', activeTabKey: firstItemTabKey },
                { id: 'group:second', activeTabKey: secondItemTabKey },
            ],
        })).toEqual(['item-2']);

        expect(listVisibleSessionBoardDetailsExpandedItemIds({
            isOpen: false,
            activeTabKey: firstItemTabKey,
        })).toEqual([]);
        expect(listVisibleSessionBoardDetailsExpandedItemIds({
            isOpen: true,
            activeTabKey: boardTabKey,
        })).toEqual([]);
    });
});
