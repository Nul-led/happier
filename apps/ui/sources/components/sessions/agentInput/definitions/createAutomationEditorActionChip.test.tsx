import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

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

const renderContext = () => ({
    chipStyle: () => ({}),
    showLabel: true,
    iconColor: '#000',
    textStyle: {},
    countTextStyle: {},
    chipAnchorRef: { current: null },
    popoverAnchorRef: { current: null },
    toggleCollapsedPopover: vi.fn(),
});

describe('createAutomationEditorActionChip', () => {
    it('opens the shared Automation editor instead of embedding a settings popover', async () => {
        const { createAutomationEditorActionChip } = await import('./createAutomationEditorActionChip');
        const onPress = vi.fn();
        const chip = createAutomationEditorActionChip({ label: 'Automate', onPress });

        // No collapsed popover: the chip is navigation, so the composed draft
        // is authored in one place rather than in a second inline editor.
        expect(chip.collapsedContentPopover).toBeUndefined();
        expect(chip.collapsedAction).toBeUndefined();

        const screen = await renderScreen(
            <>{chip.render(renderContext() as never)}</>,
        );
        const pressable = screen.findByProps({ testID: 'new-session-automation-chip' });
        expect(pressable.props.accessibilityLabel).toBe('Automate');
        await (async () => pressable.props.onPress())();

        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
