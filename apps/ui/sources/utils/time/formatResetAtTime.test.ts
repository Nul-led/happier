import { describe, expect, it } from 'vitest';

import { formatResetAtTime } from './formatResetAtTime';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

describe('formatResetAtTime', () => {
    it('says when a limit comes back the way a person reads it: the time today, the weekday this week, the date later', () => {
        const now = new Date(2026, 8, 29, 10, 40).getTime(); // Tuesday
        const laterToday = new Date(2026, 8, 29, 14, 20).getTime();
        const monday = new Date(2026, 9, 5, 9, 0).getTime();
        const nextMonth = new Date(2026, 9, 20, 9, 0).getTime();

        expect(formatResetAtTime(laterToday, now)).toBe(time(laterToday));
        expect(formatResetAtTime(monday, now)).toBe(new Date(monday).toLocaleDateString([], { weekday: 'short' }));
        expect(formatResetAtTime(nextMonth, now)).toBe(new Date(nextMonth).toLocaleDateString([], { day: 'numeric', month: 'short' }));
    });

    it('shows the time, not a weekday, for a reset early tomorrow', () => {
        const now = new Date(2026, 8, 29, 22, 0).getTime();
        const tomorrowMorning = new Date(2026, 8, 30, 3, 0).getTime();

        expect(formatResetAtTime(tomorrowMorning, now)).toBe(time(tomorrowMorning));
    });
});
