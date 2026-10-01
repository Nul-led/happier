import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { View } from 'react-native';

import { renderScreen } from '@/dev/testkit';

import { SelectionList } from '../SelectionList';
import type { SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const step = (options: ReadonlyArray<{ id: string; label: string }>): SelectionListStep => ({
    id: 'root',
    inputPlaceholder: 'Search models',
    emptyStateLabel: 'No matches',
    sections: [{ kind: 'static', id: 'models', options }],
});

// Content a picker shows above and below its rows (a pane title, a notice, a "Custom…" entry)
// scrolls with the rows inside the list's one scroll owner, and stays mounted when a search
// empties the list.
describe('SelectionList body slots', () => {
    it('renders the body header and footer inside the body scroll owner, around the rows', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={step([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])}
                bodyHeader={<View testID="slot-header" />}
                bodyFooter={<View testID="slot-footer" />}
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        const scroll = screen.findByTestId('sl:bodyScroll');
        expect(scroll).toBeTruthy();
        const count = (testID: string) => scroll?.findAll((node) => node.props?.testID === testID).length ?? 0;
        expect(count('slot-header')).toBeGreaterThan(0);
        expect(count('slot-footer')).toBeGreaterThan(0);
        expect(count('sl:root:option:a')).toBeGreaterThan(0);
    });

    it('keeps the body header and footer when the list has no rows', async () => {
        const screen = await renderScreen(
            <SelectionList
                rootStep={step([])}
                bodyHeader={<View testID="slot-header" />}
                bodyFooter={<View testID="slot-footer" />}
                onSelect={vi.fn()}
                onRequestClose={vi.fn()}
                disableTransitions
                testID="sl"
            />,
        );

        expect(screen.findByTestId('slot-header')).toBeTruthy();
        expect(screen.findByTestId('slot-footer')).toBeTruthy();
        expect(screen.findByTestId('sl:empty')).toBeTruthy();
    });
});
