import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ActionListItem } from '@/components/ui/lists/ActionListSection';
import { createTemporaryComputerTeamAccessActionChip } from './createTemporaryComputerTeamAccessActionChip';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));
vi.mock('react-native-svg', () => ({
    default: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('Svg', props, props.children),
    Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('Svg', props, props.children),
    Path: (props: Record<string, unknown>) => React.createElement('Path', props),
}));

function expectSingleAction(action: ActionListItem | readonly ActionListItem[] | undefined): ActionListItem {
    expect(Array.isArray(action)).toBe(false);
    if (!action || Array.isArray(action)) throw new Error('Expected one collapsed Team-access action');
    return action as ActionListItem;
}

describe('Temporary computer Team-access consent chip', () => {
    it('is off by default at its owner and changes only after an explicit press', async () => {
        const onChange = vi.fn();
        const chip = createTemporaryComputerTeamAccessActionChip({ authorized: false, onChange });
        const screen = await renderScreen(<>{chip.render({
            chipStyle: () => ({}),
            iconColor: '#000',
            showLabel: true,
            textStyle: {},
            chipAnchorRef: { current: null },
        } as never)}</>);

        const control = screen.findByTestId('new-session-temporary-computer-team-access');
        expect(control).toBeTruthy();
        expect(control?.props.accessibilityState).toEqual({ checked: false });
        await screen.pressByTestIdAsync('new-session-temporary-computer-team-access');
        expect(onChange).toHaveBeenCalledWith(true);

        const dismiss = vi.fn();
        const collapsedAction = expectSingleAction(chip.collapsedAction?.({
            tint: '#000',
            dismiss,
            blurInput: vi.fn(),
            openCollapsedPopover: vi.fn(),
        }));
        collapsedAction.onPress?.();
        expect(dismiss).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenLastCalledWith(true);
    });
});
