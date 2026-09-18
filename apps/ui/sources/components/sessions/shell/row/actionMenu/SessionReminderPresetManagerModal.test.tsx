import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('@/modal/components/card/useModalCardChrome', () => ({ useModalCardChrome: vi.fn() }));
vi.mock('@/components/ui/buttons/RoundButton', () => ({ RoundButton: 'RoundButton' }));
vi.mock('@/components/ui/icons/Icon', () => ({ Icon: 'Icon' }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
vi.mock('@/text', () => ({
    t: (key: string, params?: { preset?: string }) => params?.preset ? `${key}:${params.preset}` : key,
}));

describe('SessionReminderPresetManagerModal', () => {
    it('names rename, move, and delete controls with each effective preset label', async () => {
        const { SessionReminderPresetManagerModal } = await import('./SessionReminderPresetManagerModal');
        const screen = await renderScreen(<SessionReminderPresetManagerModal
            presets={[
                { label: 'Morning focus', rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 540 } },
                { label: 'Weekly review', rule: { kind: 'next_calendar_weekday', weekday: 5, minuteOfDay: 960 } },
            ]}
            onResolve={vi.fn()}
            onClose={vi.fn()}
            setChrome={vi.fn()}
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
