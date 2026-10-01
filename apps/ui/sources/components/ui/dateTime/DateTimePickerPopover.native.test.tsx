import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { CustomModalInjectedProps } from '@/modal/types';
import { SessionReminderDateTimeModal } from '@/components/sessions/shell/row/actionMenu/SessionReminderDateTimeModal';
import { TemporaryComputerExpiryModal } from '@/components/sessions/new/components/machineSelection/TemporaryComputerExpiryModal';
import { DateTimePickerPopover } from './DateTimePickerPopover.native';

const native = vi.hoisted(() => ({
    platform: 'ios' as 'ios' | 'android',
    components: new Set<string>(),
    modules: new Set<string>(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: native.platform }, {
        Platform: { get OS() { return native.platform; } },
        UIManager: { hasViewManagerConfig: (name: string) => native.components.has(name) },
        TurboModuleRegistry: { get: (name: string) => native.modules.has(name) ? {} : null },
    });
});
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('@/components/ui/text/Text', async () => (await import('@/dev/testkit/mocks/uiText')).createUiTextModuleMock());

// Select the real native adapter as Metro would, without replacing internal capability logic.
vi.mock('./DateTimePickerPopover', () => vi.importActual('./DateTimePickerPopover.native'));

// SDK 9.1.0 eagerly evaluates native bindings when imported. Loading it without
// those installed modules must fail, just as it does on an older native binary.
vi.mock('@react-native-community/datetimepicker', async () => {
    const available = native.platform === 'ios'
        ? native.components.has('RNDateTimePicker')
        : ['RNCDatePicker', 'RNCTimePicker', 'RNCMaterialDatePicker', 'RNCMaterialTimePicker']
            .every((name) => native.modules.has(name));
    if (!available) throw new Error('Picker native module is absent in the installed binary');
    return { default: (props: React.Attributes & Record<string, unknown>) => React.createElement('NativeDateTimePicker', props) };
});

beforeEach(() => {
    native.components.clear();
    native.modules.clear();
});

describe('DateTimePickerPopover on installed native binaries', () => {
    it.each(['ios', 'android'] as const)('keeps manual reminder submission usable on an older %s app', async (platform) => {
        native.platform = platform;
        const chrome: { footer?: React.ReactNode } = {};
        const setChrome: CustomModalInjectedProps['setChrome'] = (value) => { chrome.footer = value?.kind === 'card' ? value.footer : undefined; };
        const onSubmit = vi.fn().mockResolvedValue({ success: true });
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const screen = await renderScreen(<SessionReminderDateTimeModal nowMs={Date.now()}
            onSubmit={onSubmit} onSavePreset={vi.fn().mockResolvedValue(undefined)}
            onResolve={onResolve} onClose={onClose} setChrome={setChrome} />);
        expect(screen.findByTestId('session-reminder-date-picker-button')).toBeNull();
        expect(screen.findByTestId('session-reminder-time-picker-button')).toBeNull();
        await act(async () => {
            screen.changeTextByTestId('session-reminder-date-input', '2035-10-01');
        });
        await act(async () => {
            screen.changeTextByTestId('session-reminder-time-input', '14:25');
        });
        const footer = await renderScreen(<>{chrome.footer}</>);
        await act(async () => { await footer.findByProps({ title: 'sessionsList.reminders.setReminder' }).props.onPress(); });
        const result = { remindAt: new Date(2035, 9, 1, 14, 25).getTime() };
        expect(onSubmit).toHaveBeenCalledWith(result);
        expect(onResolve).toHaveBeenCalledWith(result);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it.each(['ios', 'android'] as const)('keeps manual temporary-computer expiry usable on an older %s app', async (platform) => {
        native.platform = platform;
        const chrome: { footer?: React.ReactNode } = {};
        const setChrome: CustomModalInjectedProps['setChrome'] = (value) => { chrome.footer = value?.kind === 'card' ? value.footer : undefined; };
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const screen = await renderScreen(<TemporaryComputerExpiryModal nowMs={Date.now()}
            onResolve={onResolve} onClose={onClose} setChrome={setChrome} />);
        expect(screen.findByTestId('temporary-computer-expiry-date-picker-button')).toBeNull();
        expect(screen.findByTestId('temporary-computer-expiry-time-picker-button')).toBeNull();
        await act(async () => {
            screen.changeTextByTestId('temporary-computer-expiry-date-input', '2035-10-01');
        });
        await act(async () => {
            screen.changeTextByTestId('temporary-computer-expiry-time-input', '14:25');
        });
        const footer = await renderScreen(<>{chrome.footer}</>);
        await footer.pressByTestIdAsync('temporary-computer-expiry-confirm');
        expect(onResolve).toHaveBeenCalledWith(new Date(2035, 9, 1, 14, 25).getTime());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it.each(['ios', 'android'] as const)('does not load the unavailable SDK on an older %s binary', async (platform) => {
        native.platform = platform;
        const screen = await renderScreen(<DateTimePickerPopover mode="date" anchorRef={{ current: null }}
            value={new Date()} minimumDate={new Date()} accentColor="test-accent" onChange={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.tree.toJSON()).toBeNull();
    });

    it('does not load Android SDK 9.1.0 when its eagerly required material modules are missing', async () => {
        native.platform = 'android';
        native.modules.add('RNCDatePicker');
        native.modules.add('RNCTimePicker');
        const screen = await renderScreen(<DateTimePickerPopover mode="date" anchorRef={{ current: null }}
            value={new Date()} minimumDate={new Date()} accentColor="test-accent" onChange={vi.fn()} onDismiss={vi.fn()} />);
        expect(screen.tree.toJSON()).toBeNull();
    });

    it('preserves Android selection and dismissal when all native modules are installed', async () => {
        native.platform = 'android';
        for (const name of ['RNCDatePicker', 'RNCTimePicker', 'RNCMaterialDatePicker', 'RNCMaterialTimePicker']) native.modules.add(name);
        const onChange = vi.fn();
        const onDismiss = vi.fn();
        const screen = await renderScreen(<DateTimePickerPopover mode="time" anchorRef={{ current: null }}
            value={new Date()} minimumDate={new Date()} accentColor="test-accent" onChange={onChange} onDismiss={onDismiss} />);
        await act(async () => { await import('@react-native-community/datetimepicker'); });
        const selected = new Date(2035, 9, 1, 14, 25);
        await act(async () => screen.findByType('NativeDateTimePicker').props.onChange({ type: 'set' }, selected));
        expect(onChange).toHaveBeenCalledWith(selected);
        expect(onDismiss).toHaveBeenCalledOnce();
        onChange.mockClear();
        onDismiss.mockClear();
        await act(async () => screen.findByType('NativeDateTimePicker').props.onChange({ type: 'dismissed' }));
        expect(onChange).not.toHaveBeenCalled();
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('opens the iOS picker through the real reminder editor and keeps it open after selection', async () => {
        native.platform = 'ios';
        native.components.add('RNDateTimePicker');
        const screen = await renderScreen(<SessionReminderDateTimeModal nowMs={Date.now()}
            onSubmit={vi.fn()} onSavePreset={vi.fn().mockResolvedValue(undefined)}
            onResolve={vi.fn()} onClose={vi.fn()} setChrome={vi.fn()} />);
        await screen.pressByTestIdAsync('session-reminder-date-picker-button');
        await act(async () => { await import('@react-native-community/datetimepicker'); });
        const picker = screen.findByType('NativeDateTimePicker');
        expect(picker.props.display).toBe('inline');
        await act(async () => picker.props.onChange({ type: 'set' }, new Date(2035, 9, 2, 9)));
        expect(screen.findByTestId('session-reminder-date-input')?.props.value).toBe('2035-10-02');
        expect(screen.findAllByType('NativeDateTimePicker')).toHaveLength(1);
    });
});
