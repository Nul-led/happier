import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { SelectionList } from '../SelectionList';
import type { SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const rootStep: SelectionListStep = {
    id: 'root',
    inputPlaceholder: 'Search machines',
    sections: [{
        kind: 'static',
        id: 'machines',
        title: 'This Home',
        options: [
            { id: 'macbook', label: 'MacBook Pro', subtitle: 'Online · this computer' },
            { id: 'devbox', label: 'devbox', subtitle: 'Offline · 4 days ago' },
        ],
    }],
};

// K1 picker anatomy: the current choice of a single-choice picker carries a check, drawn once by the
// row owner so every picker (machine, path, profile, resume, server, …) marks it the same way.
describe('SelectionList current-choice mark', () => {
    it('marks only the current choice of a single-choice list', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={rootStep}
                selectedOptionId="macbook"
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        expect(screen.findByTestId('sl:root:option-selected-mark:macbook')).toBeTruthy();
        expect(screen.findByTestId('sl:root:option-selected-mark:devbox')).toBeFalsy();
    });

    it('leaves multiple-choice lists to their own checkbox semantics', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={rootStep}
                selection={{ kind: 'multiple', selectedIds: new Set(['macbook']) }}
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        expect(screen.findByTestId('sl:root:option-selected-mark:macbook')).toBeFalsy();
    });

    it('leaves lists whose rows draw their own selection state unmarked', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={rootStep}
                selectedOptionId="macbook"
                selectionMark="none"
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        expect(screen.findByTestId('sl:root:option-selected-mark:macbook')).toBeFalsy();
    });

    it('leaves card presentation to its corner overlay', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={rootStep}
                selectedOptionId="macbook"
                optionPresentation="card"
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        expect(screen.findByTestId('sl:root:option-selected-mark:macbook')).toBeFalsy();
    });

    // P1 command palette: rows are commands, not choices. The row the keyboard is on shows the ↵ it
    // would run with, and only when there is a hardware keyboard to press it.
    it('marks the keyboard row with ↵ instead of a check when the list asks for the enter mark', async () => {
        const render = (keyboardHintsEnabled: boolean) => renderScreen(
            <SelectionList
                rootStep={rootStep}
                selectionMark="enter"
                keyboardHintsEnabled={keyboardHintsEnabled}
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );
        const withKeyboard = await render(true);
        expect(withKeyboard.findByTestId('sl:root:option-enter-mark:macbook')).toBeTruthy();
        expect(withKeyboard.findByTestId('sl:root:option-enter-mark:devbox')).toBeFalsy();
        expect(withKeyboard.findByTestId('sl:root:option-selected-mark:macbook')).toBeFalsy();

        const touch = await render(false);
        expect(touch.findByTestId('sl:root:option-enter-mark:macbook')).toBeFalsy();
    });
});
