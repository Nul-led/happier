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
            onSubmit={vi.fn()}
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

    async function pressSetReminder() {
        const footer = await renderScreen(<>{chrome.value?.footer}</>);
        const button = footer.findAllByType('RoundButton')
            .find((candidate) => candidate.props.title === 'sessionsList.reminders.setReminder');
        if (!button) throw new Error('Expected the Set reminder action');
        await act(async () => { button.props.onPress(); });
        return button;
    }

    function readSetReminderDisabled(): boolean {
        const footer = chrome.value?.footer as React.ReactElement<{ children?: React.ReactNode }> | undefined;
        const buttons = React.Children.toArray(footer?.props.children) as React.ReactElement<{ title?: string; disabled?: boolean }>[];
        return buttons.find((child) => child.props.title === 'sessionsList.reminders.setReminder')?.props.disabled === true;
    }

    it('keeps the chosen reminder and offers a retry when the save fails', async () => {
        const { SessionReminderDateTimeModal } = await import('./SessionReminderDateTimeModal');
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const onSubmit = vi.fn()
            .mockResolvedValueOnce({ success: false, message: 'offline' })
            .mockResolvedValueOnce({ success: true });
        const screen = await renderScreen(<SessionReminderDateTimeModal
            nowMs={Date.now()}
            onSubmit={onSubmit}
            onResolve={onResolve}
            onClose={onClose}
            setChrome={vi.fn()}
        />);
        const presetItem = screen.findByType('Item');
        await act(async () => { presetItem.props.rightElement.props.onValueChange(true); });

        await pressSetReminder();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        // The draft, the Add-to-presets choice and the failure all survive for the retry.
        expect(onResolve).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-reminder-error')?.props.title).toBe('offline');
        expect(screen.findAllByType('Item')[0]?.props.rightElement.props.accessibilityState).toEqual({ checked: true });

        await pressSetReminder();
        expect(onSubmit).toHaveBeenCalledTimes(2);
        expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
        expect(onResolve).toHaveBeenCalledWith(onSubmit.mock.calls[1]?.[0]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('refuses a chosen time that expired while the modal was open', async () => {
        vi.useFakeTimers();
        try {
            const openedAtMs = Date.UTC(2026, 8, 9, 12);
            vi.setSystemTime(openedAtMs);
            const { SessionReminderDateTimeModal } = await import('./SessionReminderDateTimeModal');
            const onSubmit = vi.fn().mockResolvedValue({ success: true });
            const onResolve = vi.fn();
            await renderScreen(<SessionReminderDateTimeModal
                nowMs={openedAtMs}
                onSubmit={onSubmit}
                onResolve={onResolve}
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />);
            expect(readSetReminderDisabled()).toBe(false);

            vi.setSystemTime(openedAtMs + 3 * 24 * 60 * 60 * 1_000);
            await pressSetReminder();

            expect(onSubmit).not.toHaveBeenCalled();
            expect(onResolve).not.toHaveBeenCalled();
            expect(readSetReminderDisabled()).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('opens the themed platform calendar and time pickers from explicit field icons', async () => {
        const { SessionReminderDateTimeModal } = await import('./SessionReminderDateTimeModal');
        const screen = await renderScreen(<SessionReminderDateTimeModal nowMs={Date.UTC(2026, 8, 9, 12)} onSubmit={vi.fn()} onResolve={vi.fn()} onClose={vi.fn()} setChrome={vi.fn()} />);
        await act(async () => { screen.findByTestId('session-reminder-date-picker-button')?.props.onPress(); });
        expect(screen.findByType('DateTimePickerPopover').props.mode).toBe('date');

        await act(async () => { screen.findByTestId('session-reminder-time-picker-button')?.props.onPress(); });
        expect(screen.findByType('DateTimePickerPopover').props.mode).toBe('time');
    });
});
