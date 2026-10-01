import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SelectionListProps, SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const rootStep: SelectionListStep = {
    id: 'root',
    inputPlaceholder: 'Search',
    sections: [{
        kind: 'static',
        id: 'commands',
        title: 'COMMANDS',
        options: [
            { id: 'alpha', label: 'Alpha' },
            { id: 'beta', label: 'Beta' },
        ],
    }],
};

function defaultProps(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep,
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        keyboardHintsEnabled: false,
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** Document order of the two framed zones, deduped for repeated wrappers. */
function readZoneOrder(screen: Screen): string[] {
    const container = screen.findByTestId('sl');
    expect(container).not.toBeNull();
    const zones = ['sl:headerFrame', 'sl:content'];
    const seen: string[] = [];
    for (const node of container!.findAll(
        (candidate) => zones.includes(String(candidate.props?.testID ?? '')),
    )) {
        const testID = String(node.props.testID);
        if (seen[seen.length - 1] !== testID) seen.push(testID);
    }
    return seen;
}

describe('SelectionList inputPlacement', () => {
    it('renders the canonical input above the results by default', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);
        expect(readZoneOrder(screen)).toEqual(['sl:headerFrame', 'sl:content']);
    });

    it('seats the same canonical input below the results when placement is bottom', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList {...defaultProps({ inputPlacement: 'bottom' })} />,
        );
        expect(readZoneOrder(screen)).toEqual(['sl:content', 'sl:headerFrame']);
    });

    it('keeps one input owning the query in bottom placement', async () => {
        const { act } = await import('react-test-renderer');
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList {...defaultProps({ inputPlacement: 'bottom' })} />,
        );
        expect(screen.findByTestId('sl:header:input')).not.toBeNull();
        await act(async () => {
            screen.changeTextByTestId('sl:header:input', 'alph');
            await Promise.resolve();
        });
        expect(screen.findByTestId('sl:root:option:alpha')).not.toBeNull();
        expect(screen.findByTestId('sl:root:option:beta')).toBeNull();
    });

    // B1 phone: filter chips that do not fit beside the field sit on their own row beneath it, part
    // of the header (so they stay on screen in every state), above the results.
    it('renders an input accessory row beneath the field and above the results', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps({
            inputAccessoryRow: React.createElement('ChipRow', { testID: 'chip-row' }),
        })} />);
        const header = screen.findByTestId('sl:headerFrame');
        expect(header?.findAll((node) => node.props?.testID === 'chip-row').length).toBeGreaterThan(0);
        const content = screen.findByTestId('sl:content');
        expect(content?.findAll((node) => node.props?.testID === 'chip-row')).toHaveLength(0);
        const headerChildren = header!.findAll((node) => node.props?.testID === 'sl:header' || node.props?.testID === 'chip-row')
            .map((node) => String(node.props.testID));
        expect(headerChildren.indexOf('sl:header')).toBeLessThan(headerChildren.indexOf('chip-row'));
    });
});
