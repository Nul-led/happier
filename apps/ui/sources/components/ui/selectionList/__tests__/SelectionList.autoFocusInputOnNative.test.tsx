import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SelectionListProps, SelectionListStep } from '../_types';

const platformState = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'web' }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() {
                return platformState.os;
            },
        },
    });
});

function createInputNodeMock(focus: () => void) {
    return (element: { type: unknown }) => {
        if (element.type !== 'TextInput') return {};
        return { focus, addEventListener: () => {}, removeEventListener: () => {} };
    };
}

const rootStep: SelectionListStep = {
    id: 'root',
    title: 'Search',
    inputPlaceholder: 'Search Happier',
    sections: [{
        kind: 'static',
        id: 'commands',
        options: [{ id: 'alpha', label: 'Alpha' }],
    }],
};

function defaultProps(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep,
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

/**
 * A popover or picker opening on a phone must NOT summon the software keyboard — that is why
 * auto-focus has always been web-only. A Search surface the user explicitly opened is the opposite
 * case: the whole point is to start typing, and the keyboard-seated plane is laid out for it. Each
 * platform therefore states its own intent instead of one flag meaning different things by device.
 */
describe('SelectionList native input auto-focus', () => {
    it('focuses the input on native only when the caller explicitly opts in', async () => {
        platformState.os = 'ios';
        const focus = vi.fn();
        const { SelectionList } = await import('../SelectionList');

        await renderScreen(
            <SelectionList {...defaultProps({ autoFocusInputOnNative: true })} />,
            { createNodeMock: createInputNodeMock(focus) },
        );

        expect(focus).toHaveBeenCalled();
    });

    it('leaves native pickers untouched when only the web opt-in is set', async () => {
        platformState.os = 'ios';
        const focus = vi.fn();
        const { SelectionList } = await import('../SelectionList');

        await renderScreen(
            <SelectionList {...defaultProps({ autoFocusInputOnWeb: true })} />,
            { createNodeMock: createInputNodeMock(focus) },
        );

        expect(focus).not.toHaveBeenCalled();
    });

    it('does not double-claim focus on web from the native opt-in', async () => {
        platformState.os = 'web';
        // The web/native split is read once at module load, so the platform has to be swapped
        // before the module is evaluated.
        vi.resetModules();
        const focus = vi.fn();
        const { SelectionList } = await import('../SelectionList');

        await renderScreen(
            <SelectionList {...defaultProps({ autoFocusInputOnNative: true })} />,
            { createNodeMock: createInputNodeMock(focus) },
        );

        expect(focus).not.toHaveBeenCalled();
    });
});
