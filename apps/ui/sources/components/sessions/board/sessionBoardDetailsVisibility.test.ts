import { describe, expect, it } from 'vitest';

import { createSessionBoardDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';

import { isSessionBoardVisibleInDetails } from './sessionBoardDetailsVisibility';

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
