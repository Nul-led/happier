import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen, withPopoverWebGlobals } from '@/dev/testkit';

import type { SelectionListFilter, SelectionListProps, SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const rootStep: SelectionListStep = {
    id: 'root',
    inputPlaceholder: 'Search Codex sessions…',
    sections: [{ kind: 'static', id: 'rows', options: [{ id: 'row-a', label: 'Row A' }] }],
};

function agentFilter(overrides: Partial<SelectionListFilter> = {}): SelectionListFilter {
    return {
        id: 'agent',
        label: 'Agent',
        options: [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude' }],
        selectedId: 'codex',
        onChange: vi.fn(),
        testID: 'filter.agent',
        ...overrides,
    };
}

function props(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
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

function isExpanded(screen: Screen, testID: string): boolean | undefined {
    const chip = screen.findHostByTestId(testID);
    return chip?.props.accessibilityState?.expanded ?? chip?.props['aria-expanded'];
}

async function layoutRoot(screen: Screen, width: number) {
    const root = screen.findByTestId('sl');
    await act(async () => {
        root?.props.onLayout?.({ nativeEvent: { layout: { width, height: 600, x: 0, y: 0 } } });
    });
}

// Filters are a SelectionList feature: one chip per filter beside the field, a small popover to
// change it, and a row of their own beneath the field when the list is too narrow for both.
describe('SelectionList filters', () => {
    it('shows each filter as a chip naming its value, and a chosen option reaches the consumer', () => withPopoverWebGlobals(async () => {
        const { SelectionList } = await import('../SelectionList');
        const onChange = vi.fn();
        const screen = await renderScreen(<SelectionList {...props({ filters: [agentFilter({ onChange })] })} />);

        const chip = screen.findHostByTestId('filter.agent');
        expect(chip).not.toBeNull();
        expect(chip?.props.accessibilityLabel ?? chip?.props['aria-label']).toBe('Agent: Codex');
        expect(screen.findHostByTestId('filter.agent.list')).toBeNull();

        await screen.pressByTestIdAsync('filter.agent');
        expect(screen.findHostByTestId('filter.agent.list')).not.toBeNull();

        await screen.pressByTestIdAsync('filter.agent:claude');
        expect(onChange).toHaveBeenCalledWith('claude');
        // Choosing closes the popover.
        expect(isExpanded(screen, 'filter.agent')).toBe(false);
    }));

    it('keeps chips beside the field when wide and moves them to their own row beneath it when narrow', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...props({ filters: [agentFilter()] })} />);
        const inRow = () => screen.findByTestId('sl:filters-row')?.findAll((node) => node.props?.testID === 'filter.agent').length ?? 0;

        await layoutRoot(screen, 900);
        expect(screen.findHostByTestId('filter.agent')).not.toBeNull();
        expect(inRow()).toBe(0);

        await layoutRoot(screen, 390);
        expect(inRow()).toBeGreaterThan(0);
        // The row is part of the header zone, never the scrolling results.
        const header = screen.findByTestId('sl:headerFrame');
        expect(header?.findAll((node) => node.props?.testID === 'sl:filters-row').length).toBeGreaterThan(0);
    });

    it('closes an open filter popover on Escape before the list itself closes', () => withPopoverWebGlobals(async () => {
        const { SelectionList } = await import('../SelectionList');
        const onRequestClose = vi.fn();
        const screen = await renderScreen(<SelectionList {...props({ onRequestClose, filters: [agentFilter()] })} />);

        await screen.pressByTestIdAsync('filter.agent');
        // The popover's own SelectionList (the composite that owns its keyboard and Escape).
        const popoverList = screen.findAll((node) => node.props?.testID === 'filter.agent.list'
            && typeof node.props?.onRequestClose === 'function')[0];
        expect(popoverList).toBeDefined();
        // Escape inside the popover's list reaches that list's close, not the outer list's.
        await act(async () => {
            popoverList?.props.onRequestClose?.();
        });
        expect(isExpanded(screen, 'filter.agent')).toBe(false);
        expect(onRequestClose).not.toHaveBeenCalled();
    }));

    it('lets a filter owner draw its own chooser, and shows a fixed scope that does not open', () => withPopoverWebGlobals(async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...props({
            filters: [
                {
                    id: 'machine',
                    label: 'Machine',
                    valueLabel: 'MacBook Pro',
                    presence: 'online',
                    testID: 'filter.machine',
                    renderPopoverContent: ({ close }) => React.createElement('MachineList', { testID: 'machine-list', onPick: close }),
                },
                { id: 'source', label: 'Source', valueLabel: 'Personal', testID: 'filter.source' },
            ],
        })} />);

        await screen.pressByTestIdAsync('filter.machine');
        const list = screen.findByTestId('machine-list');
        expect(list).not.toBeNull();
        expect(isExpanded(screen, 'filter.machine')).toBe(true);
        await act(async () => { list?.props.onPick(); });
        expect(isExpanded(screen, 'filter.machine')).toBe(false);

        const fixed = screen.findHostByTestId('filter.source');
        expect(fixed?.props.disabled ?? fixed?.props.accessibilityState?.disabled ?? fixed?.props['aria-disabled']).toBe(true);
    }));
});
