import { describe, expect, it } from 'vitest';

import { resolveSessionListSelectionPointerAction } from './sessionListSelectionPointer';

describe('resolveSessionListSelectionPointerAction', () => {
    it('keeps a plain row press as navigation outside selection mode', () => {
        expect(resolveSessionListSelectionPointerAction({
            isSelectionMode: false,
            platform: 'macos',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
        })).toBe('open');
    });

    it('leaves platform command-click to navigation, including modified range clicks', () => {
        expect(resolveSessionListSelectionPointerAction({
            isSelectionMode: false,
            platform: 'macos',
            shiftKey: false,
            ctrlKey: false,
            metaKey: true,
        })).toBe('open');

        expect(resolveSessionListSelectionPointerAction({
            isSelectionMode: false,
            platform: 'windows',
            shiftKey: true,
            ctrlKey: true,
            metaKey: false,
        })).toBe('open');
    });

    it('selects ranges with shift and toggles plain row presses once already in selection mode', () => {
        expect(resolveSessionListSelectionPointerAction({
            isSelectionMode: false,
            platform: 'windows',
            shiftKey: true,
            ctrlKey: false,
            metaKey: false,
        })).toBe('selectRange');

        expect(resolveSessionListSelectionPointerAction({
            isSelectionMode: true,
            platform: 'windows',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
        })).toBe('toggle');
    });
});
