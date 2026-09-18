import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const chrome = vi.hoisted(() => ({ value: null as null | { footer?: React.ReactNode } }));
type MockProps = React.Attributes & Record<string, unknown>;

vi.mock('@/modal/components/card/useModalCardChrome', () => ({
    useModalCardChrome: (_setChrome: unknown, value: { footer?: React.ReactNode }) => { chrome.value = value; },
}));
vi.mock('@/components/ui/buttons/RoundButton', () => ({ RoundButton: (props: MockProps) => React.createElement('RoundButton', props) }));
vi.mock('@/components/ui/forms/Switch', () => ({ Switch: (props: MockProps) => React.createElement('Switch', props) }));
vi.mock('@/components/ui/icons/Icon', () => ({ Icon: (props: MockProps) => React.createElement('Icon', props) }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: (props: MockProps) => React.createElement('Item', props) }));
vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: MockProps) => React.createElement('Text', props),
    TextInput: React.forwardRef<unknown, MockProps>((props, ref) => React.createElement('TextInput', { ...props, ref })),
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/components/ui/dateTime/DateTimePickerPopover', () => ({
    DateTimePickerPopover: (props: MockProps) => React.createElement('DateTimePickerPopover', props),
}));

describe('SessionReminderDateTimeModal', () => {
    beforeEach(() => { chrome.value = null; });

    it('reveals the preset preview only after opt-in and labels the primary action Set reminder', async () => {
        const { SessionReminderDateTimeModal } = await import('./SessionReminderDateTimeModal');
        const screen = await renderScreen(<SessionReminderDateTimeModal
            nowMs={Date.UTC(2026, 8, 9, 12)}
            onResolve={vi.fn()}
            onClose={vi.fn()}
            setChrome={vi.fn()}
        />);

        expect(screen.findByType('Item').props.subtitle).toBeUndefined();
        const footer = await renderScreen(<>{chrome.value?.footer}</>);
        expect(footer.findAllByType('RoundButton').some((button) => button.props.title === 'sessionsList.reminders.setReminder')).toBe(true);

        const item = screen.findByType('Item');
        expect(item.props.onPress).toBeUndefined();
        expect(item.props.rightElementOutsidePressable).toBe(true);
        expect(item.props.rightElement.props.accessibilityRole).toBe('switch');
        expect(item.props.rightElement.props.accessibilityLabel).toBe('sessionsList.reminders.addToPresets');
        expect(item.props.rightElement.props.accessibilityState).toEqual({ checked: false });

        await act(async () => { item.props.rightElement.props.onValueChange(true); });
        expect(screen.findByType('Item').props.subtitle).toBeTruthy();
        expect(screen.findByType('Item').props.rightElement.props.accessibilityState).toEqual({ checked: true });
    });

    it('opens the themed platform calendar and time pickers from explicit field icons', async () => {
        const { SessionReminderDateTimeModal } = await import('./SessionReminderDateTimeModal');
        const screen = await renderScreen(<SessionReminderDateTimeModal nowMs={Date.UTC(2026, 8, 9, 12)} onResolve={vi.fn()} onClose={vi.fn()} setChrome={vi.fn()} />);
        await act(async () => { screen.findByTestId('session-reminder-date-picker-button')?.props.onPress(); });
        expect(screen.findByType('DateTimePickerPopover').props.mode).toBe('date');

        await act(async () => { screen.findByTestId('session-reminder-time-picker-button')?.props.onPress(); });
        expect(screen.findByType('DateTimePickerPopover').props.mode).toBe('time');
    });
});
