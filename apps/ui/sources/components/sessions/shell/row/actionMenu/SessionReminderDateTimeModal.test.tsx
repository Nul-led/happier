import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { CustomModalInjectedProps } from '@/modal/types';
import { SessionReminderDateTimeModal } from './SessionReminderDateTimeModal';

const chrome: { value: null | { footer?: React.ReactNode; title?: unknown; subtitle?: unknown } } = { value: null };
const setChrome: CustomModalInjectedProps['setChrome'] = (value) => { chrome.value = value?.kind === 'card' ? value : null; };
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());

describe('SessionReminderDateTimeModal', () => {
    beforeEach(() => { chrome.value = null; });

    it('reveals the preset preview only after opt-in and labels the primary action Set reminder', async () => {
        const screen = await renderScreen(<SessionReminderDateTimeModal
            nowMs={Date.UTC(2026, 8, 9, 12)}
            onSubmit={vi.fn()} onSavePreset={vi.fn().mockResolvedValue(undefined)}
            onResolve={vi.fn()}
            onClose={vi.fn()}
            setChrome={setChrome}
        />);

        expect(screen.findByProps({ title: 'sessionsList.reminders.addToPresets' }).props.subtitle).toBeUndefined();
        // The title says what to do; no second line restates it.
        expect(chrome.value).toEqual(expect.objectContaining({ title: 'sessionsList.reminders.customTitle' }));
        expect(chrome.value?.subtitle).toBeUndefined();
        const footer = await renderScreen(<>{chrome.value?.footer}</>);
        expect(footer.findByProps({ title: 'sessionsList.reminders.setReminder' })).toBeTruthy();

        const item = screen.findByProps({ title: 'sessionsList.reminders.addToPresets' });
        expect(item.props.onPress).toBeUndefined();
        expect(item.props.rightElementOutsidePressable).toBe(true);
        expect(item.props.rightElement.props.accessibilityRole).toBe('switch');
        expect(item.props.rightElement.props.accessibilityLabel).toBe('sessionsList.reminders.addToPresets');
        expect(item.props.rightElement.props.accessibilityState).toEqual({ checked: false });

        await act(async () => { item.props.rightElement.props.onValueChange(true); });
        expect(screen.findByProps({ title: 'sessionsList.reminders.addToPresets' }).props.subtitle).toBeTruthy();
        expect(screen.findByProps({ title: 'sessionsList.reminders.addToPresets' }).props.rightElement.props.accessibilityState).toEqual({ checked: true });
    });

    async function pressSetReminder() {
        const footer = await renderScreen(<>{chrome.value?.footer}</>);
        const button = footer.findByProps({ title: 'sessionsList.reminders.setReminder' });
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
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const onSubmit = vi.fn()
            .mockResolvedValueOnce({ success: false, message: 'offline' })
            .mockResolvedValueOnce({ success: true });
        const screen = await renderScreen(<SessionReminderDateTimeModal
            nowMs={Date.now()}
            onSubmit={onSubmit} onSavePreset={vi.fn().mockResolvedValue(undefined)}
            onResolve={onResolve}
            onClose={onClose}
            setChrome={setChrome}
        />);
        const presetItem = screen.findByProps({ title: 'sessionsList.reminders.addToPresets' });
        await act(async () => { presetItem.props.rightElement.props.onValueChange(true); });

        await pressSetReminder();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        // The draft, the Add-to-presets choice and the failure all survive for the retry.
        expect(onResolve).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.findByProps({ title: 'offline' })).toBeTruthy();
        expect(screen.findByProps({ title: 'sessionsList.reminders.addToPresets' }).props.rightElement.props.accessibilityState).toEqual({ checked: true });

        await pressSetReminder();
        expect(onSubmit).toHaveBeenCalledTimes(2);
        expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
        expect(onResolve).toHaveBeenCalledWith(onSubmit.mock.calls[1]?.[0]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps a successful reminder and retries only its failed preset even after the deadline passes', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(Date.UTC(2026, 8, 9, 12));
            const onResolve = vi.fn();
            const onClose = vi.fn();
            const onSubmit = vi.fn().mockResolvedValue({ success: true });
            const onSavePreset = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
            const screen = await renderScreen(<SessionReminderDateTimeModal
                nowMs={Date.now()} onSubmit={onSubmit} onSavePreset={onSavePreset}
                onResolve={onResolve} onClose={onClose} setChrome={setChrome}
            />);
            await act(async () => { screen.findByProps({ title: 'sessionsList.reminders.addToPresets' }).props.rightElement.props.onValueChange(true); });
            await pressSetReminder();
            expect(onClose).not.toHaveBeenCalled();
            expect(screen.findByTestId('session-reminder-error')).not.toBeNull();
            expect(onSavePreset).toHaveBeenCalledTimes(1);
            vi.setSystemTime(Date.UTC(2026, 8, 12, 12));
            const footer = await renderScreen(<>{chrome.value?.footer}</>);
            await act(async () => { footer.tree.root.findAll((node) => typeof node.props.title === 'string' && typeof node.props.onPress === 'function').at(-1)?.props.onPress(); });
            expect(onSubmit).toHaveBeenCalledTimes(1);
            expect(onSavePreset).toHaveBeenCalledTimes(2);
            expect(onSavePreset.mock.calls[1]?.[0]).toEqual(onSavePreset.mock.calls[0]?.[0]);
            expect(onResolve).toHaveBeenCalledWith(onSubmit.mock.calls[0]?.[0]);
            expect(onClose).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses a chosen time that expired while the modal was open', async () => {
        vi.useFakeTimers();
        try {
            const openedAtMs = Date.UTC(2026, 8, 9, 12);
            vi.setSystemTime(openedAtMs);
            const onSubmit = vi.fn().mockResolvedValue({ success: true });
            const onResolve = vi.fn();
            await renderScreen(<SessionReminderDateTimeModal
                nowMs={openedAtMs}
                onSubmit={onSubmit} onSavePreset={vi.fn().mockResolvedValue(undefined)}
                onResolve={onResolve}
                onClose={vi.fn()}
                setChrome={setChrome}
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

    it('keeps manual fields without offering an unavailable default-host picker', async () => {
        const screen = await renderScreen(<SessionReminderDateTimeModal nowMs={Date.UTC(2026, 8, 9, 12)} onSubmit={vi.fn()} onSavePreset={vi.fn().mockResolvedValue(undefined)} onResolve={vi.fn()} onClose={vi.fn()} setChrome={setChrome} />);
        expect(screen.findByTestId('session-reminder-date-picker-button')).toBeNull();
        expect(screen.findByTestId('session-reminder-time-picker-button')).toBeNull();
        expect(screen.findByTestId('session-reminder-date-input')).not.toBeNull();
        expect(screen.findByTestId('session-reminder-time-input')).not.toBeNull();
    });
});
