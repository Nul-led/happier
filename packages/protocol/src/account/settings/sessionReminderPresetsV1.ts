import { z } from 'zod';

const MinuteOfDaySchema = z.number().int().min(0).max(24 * 60 - 1);
const WeekdaySchema = z.number().int().min(0).max(6);

export const SessionReminderPresetRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('relative_day'), daysAhead: z.number().int().min(1), minuteOfDay: MinuteOfDaySchema }),
  z.object({ kind: z.literal('next_weekday'), weekday: WeekdaySchema, minuteOfDay: MinuteOfDaySchema }),
  z.object({ kind: z.literal('next_calendar_weekday'), weekday: WeekdaySchema, weeksAhead: z.number().int().min(1).optional(), minuteOfDay: MinuteOfDaySchema }),
]);

export const SessionReminderPresetV1Schema = z.object({
  rule: SessionReminderPresetRuleSchema,
  label: z.string().trim().min(1).optional(),
});

export const SessionReminderPresetsV1Schema = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = SessionReminderPresetV1Schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}, z.array(SessionReminderPresetV1Schema));

export type SessionReminderPresetRule = z.infer<typeof SessionReminderPresetRuleSchema>;
export type SessionReminderPresetV1 = z.infer<typeof SessionReminderPresetV1Schema>;
