import { describe, expect, it } from 'vitest';

import {
    SessionReminderPresetsV1Schema,
    applySessionReminderPresetIntentToAccountSettings,
    formatSessionReminderPresetRuleLabel,
    inferSessionReminderPresetRule,
    resolveSessionReminderPresetRule,
    upsertSessionReminderPreset,
} from './sessionReminderPreset';

describe('sessionReminderPreset', () => {
    const now = new Date(2026, 8, 8, 14, 30, 0, 0);

    it('infers semantic local-calendar rules instead of persisting timestamps', () => {
        expect(inferSessionReminderPresetRule(new Date(2026, 8, 9, 14).getTime(), now.getTime())).toEqual({ kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 });
        expect(inferSessionReminderPresetRule(new Date(2026, 8, 11, 14).getTime(), now.getTime())).toEqual({ kind: 'next_weekday', weekday: 5, minuteOfDay: 840 });
        expect(inferSessionReminderPresetRule(new Date(2026, 8, 15, 16).getTime(), now.getTime())).toEqual({ kind: 'next_calendar_weekday', weekday: 2, minuteOfDay: 960 });
        expect(inferSessionReminderPresetRule(new Date(2026, 8, 27, 9, 15).getTime(), now.getTime())).toEqual({ kind: 'next_calendar_weekday', weekday: 0, weeksAhead: 2, minuteOfDay: 555 });
    });

    it('resolves rules to their next future local occurrence', () => {
        expect(resolveSessionReminderPresetRule({ kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 }, now.getTime())).toBe(new Date(2026, 8, 9, 14).getTime());
        expect(resolveSessionReminderPresetRule({ kind: 'next_weekday', weekday: 2, minuteOfDay: 960 }, now.getTime())).toBe(new Date(2026, 8, 8, 16).getTime());
        expect(resolveSessionReminderPresetRule({ kind: 'next_weekday', weekday: 2, minuteOfDay: 540 }, now.getTime())).toBe(new Date(2026, 8, 15, 9).getTime());
        expect(resolveSessionReminderPresetRule({ kind: 'next_calendar_weekday', weekday: 2, minuteOfDay: 960 }, now.getTime())).toBe(new Date(2026, 8, 15, 16).getTime());
        expect(resolveSessionReminderPresetRule({ kind: 'next_calendar_weekday', weekday: 0, weeksAhead: 2, minuteOfDay: 540 }, now.getTime())).toBe(new Date(2026, 8, 27, 9).getTime());
    });

    it('applies a preset change to the Account value that is current at write time', () => {
        const kept = { rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 540 } } as const;
        // A preset another consumer added while a modal and a network call were outstanding.
        const concurrent = { rule: { kind: 'next_weekday', weekday: 5, minuteOfDay: 600 } } as const;
        const added = { rule: { kind: 'relative_day', daysAhead: 2, minuteOfDay: 480 } } as const;

        expect(applySessionReminderPresetIntentToAccountSettings(
            { sessionReminderPresetsV1: [kept, concurrent], viewInline: true },
            { kind: 'upsert', preset: added },
        )).toEqual({ sessionReminderPresetsV1: [kept, concurrent, added], viewInline: true });

        // An unreadable stored value is treated as no presets, never as a reason to skip the write.
        expect(applySessionReminderPresetIntentToAccountSettings(
            { sessionReminderPresetsV1: 'corrupt' },
            { kind: 'upsert', preset: added },
        )).toEqual({ sessionReminderPresetsV1: [added] });

        expect(applySessionReminderPresetIntentToAccountSettings(
            { sessionReminderPresetsV1: [kept, concurrent] },
            { kind: 'replace', presets: [concurrent] },
        )).toEqual({ sessionReminderPresetsV1: [concurrent] });
    });

    it('describes reusable weekday rules instead of formatting their first absolute date', () => {
        expect(formatSessionReminderPresetRuleLabel({ kind: 'next_weekday', weekday: 5, minuteOfDay: 840 }, now.getTime(), 'en-US'))
            .toBe('Friday · 2:00 PM');
        expect(formatSessionReminderPresetRuleLabel({ kind: 'next_calendar_weekday', weekday: 2, minuteOfDay: 960 }, now.getTime(), 'en-US'))
            .toBe('Next Tuesday · 4:00 PM');
        expect(formatSessionReminderPresetRuleLabel({ kind: 'next_calendar_weekday', weekday: 0, weeksAhead: 2, minuteOfDay: 540 }, now.getTime(), 'en-US'))
            .toBe('Sunday in 2 weeks · 9:00 AM');
    });

    it('drops malformed synced entries and upserts duplicate semantic rules in place', () => {
        expect(SessionReminderPresetsV1Schema.parse([
            { rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 } },
            { rule: { kind: 'next_weekday', weekday: 9, minuteOfDay: 840 } },
        ])).toHaveLength(1);
        expect(upsertSessionReminderPreset([
            { rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 } },
        ], {
            rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 }, label: 'Focus',
        })).toEqual([{ rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 840 }, label: 'Focus' }]);
    });
});
