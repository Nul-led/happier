import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { ListPresentationProvider, useListPresentation } from '@/components/ui/lists/listPresentation';

import type { SelectionListProps } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function PresentationProbe() {
    const presentation = useListPresentation();
    return React.createElement('PresentationProbe', { testID: 'presentation-probe', presentation });
}

describe('SelectionList list presentation (I1)', () => {
    it('keeps its rows on the grouped look when it sits inside a page list', async () => {
        const { SelectionList } = await import('../SelectionList');
        const props: SelectionListProps = {
            rootStep: {
                id: 'root',
                inputPlaceholder: 'Search',
                sections: [{
                    kind: 'static',
                    id: 'section-a',
                    options: [{ id: 'opt-a', label: 'Alpha', content: <PresentationProbe /> }],
                }],
            },
            onSelect: vi.fn(),
            onRequestClose: vi.fn(),
            keyboardHintsEnabled: false,
            disableTransitions: true,
            testID: 'sl',
        };

        const screen = await renderScreen(
            <ListPresentationProvider value="page">
                <SelectionList {...props} />
            </ListPresentationProvider>,
        );

        const probe = screen.findByTestId('presentation-probe');
        expect(probe).not.toBeNull();
        expect(probe?.props.presentation).toBe('grouped');
    });
});
