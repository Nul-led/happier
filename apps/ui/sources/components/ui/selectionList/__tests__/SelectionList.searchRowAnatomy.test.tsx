import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SelectionListProps, SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function makeStep(overrides: Partial<SelectionListStep> = {}): SelectionListStep {
    return {
        id: 'root',
        title: 'Worktrees',
        inputPlaceholder: 'Search worktrees',
        sections: [{
            kind: 'static',
            id: 'recent',
            title: 'Recent',
            options: [{ id: 'main', label: 'main' }],
        }],
        ...overrides,
    };
}

function defaultProps(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep: makeStep(),
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

function flattenDeep(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenDeep));
    return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

/**
 * Every SelectionList consumer — ⌘K, Browse, and the popover pickers (path, worktree, machine,
 * model search) — draws its search row with one anatomy: the full-width band at the top of the
 * surface, a hairline beneath it, and no inset bordered field.
 */
describe('SelectionList search row anatomy', () => {
    function expectBand(header: { props: { style?: unknown } } | null) {
        expect(header).not.toBeNull();
        const style = flattenDeep(header!.props.style);
        expect(style.borderBottomWidth).toBe(1);
        expect(style.borderWidth ?? 0).toBe(0);
        expect(style.borderRadius ?? 0).toBe(0);
        expect(style.marginHorizontal ?? 0).toBe(0);
    }

    it('draws a search picker row as the band', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);

        expectBand(screen.findByTestId('sl:header'));
    });

    it('draws a path-style value row, with its in-row suffix action, as the same band', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList
                {...defaultProps({
                    rootStep: makeStep({ inputPlaceholder: 'Type a path', inputMode: 'value' }),
                    inputValue: '/home/alice',
                    onChangeInputValue: vi.fn(),
                    inputSuffix: <React.Fragment>browse</React.Fragment>,
                })}
            />,
        );

        expectBand(screen.findByTestId('sl:header'));
        expect(screen.findByTestId('sl:header:input-suffix')).not.toBeNull();
    });
});
