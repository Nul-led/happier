const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * When a usage limit comes back, as a person reads it at a glance: the time when it is within the
 * next day ("14:20"), the weekday within the week ("Mon"), else the date ("20 Oct"). The future
 * counterpart of `formatAsOfTime`; the countdown ("in 2 h 15 min") is `formatResetCountdown`.
 */
export function formatResetAtTime(at: number, now: number = Date.now()): string {
    const delta = at - now;
    const when = new Date(at);
    if (delta < 24 * HOUR_MS) return when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (delta < WEEK_MS - HOUR_MS * 24) return when.toLocaleDateString([], { weekday: 'short' });
    return when.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
