import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { TextInput } from '@/components/ui/text/Text';
import type { CustomModalInjectedProps } from '@/modal/types';

const chrome: { value: null | { footer?: React.ReactNode } } = { value: null };
const setChrome: CustomModalInjectedProps['setChrome'] = (value) => { chrome.value = value?.kind === 'card' ? value : null; };
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({ translate: (key, params) => params?.preset ? `${key}:${params.preset}` : key }));

describe('SessionReminderPresetManagerModal', () => {
    it('retains edits on failed persistence and closes only after a successful retry', async () => {
        const { SessionReminderPresetManagerModal } = await import('./SessionReminderPresetManagerModal');
        const onSubmit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
        const onClose = vi.fn();
        const onResolve = vi.fn();
        const screen = await renderScreen(<SessionReminderPresetManagerModal
            presets={[{ label: 'Morning', rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 540 } }]}
            onSubmit={onSubmit} onClose={onClose} onResolve={onResolve} setChrome={setChrome}
        />);
        await act(async () => { screen.findByType(TextInput).props.onChangeText('Focus'); });
        const pressSave = async () => {
            const footer = await renderScreen(<>{chrome.value?.footer}</>);
            await act(async () => { footer.findByProps({ title: 'common.save' }).props.onPress(); });
        };
        await pressSave();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.findByType(TextInput).props.value).toBe('Focus');
        expect(screen.findByTestId('session-reminder-presets-error')).not.toBeNull();
        await pressSave();
        expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
        expect(onResolve).toHaveBeenCalledWith(onSubmit.mock.calls[0]?.[0]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('names rename, move, and delete controls with each effective preset label', async () => {
        const { SessionReminderPresetManagerModal } = await import('./SessionReminderPresetManagerModal');
        const screen = await renderScreen(<SessionReminderPresetManagerModal
            presets={[
                { label: 'Morning focus', rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 540 } },
                { label: 'Weekly review', rule: { kind: 'next_calendar_weekday', weekday: 5, minuteOfDay: 960 } },
            ]}
            onSubmit={vi.fn().mockResolvedValue(undefined)}
            onResolve={vi.fn()}
            onClose={vi.fn()}
            setChrome={setChrome}
        />);

        const labels = screen.tree.root.findAll((node) => typeof node.props.accessibilityLabel === 'string')
            .map((node) => node.props.accessibilityLabel);
        for (const preset of ['Morning focus', 'Weekly review']) {
            expect(labels).toContain(`sessionsList.reminders.renamePresetLabel:${preset}`);
            expect(labels).toContain(`sessionsList.reminders.movePresetUpLabel:${preset}`);
            expect(labels).toContain(`sessionsList.reminders.movePresetDownLabel:${preset}`);
            expect(labels).toContain(`sessionsList.reminders.deletePresetLabel:${preset}`);
        }
    });
});
