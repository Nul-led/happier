/** The mint owner's UTC monthly grant and daily usage windows. */
export function resolveVoiceQuotaWindow(now: Date) {
    return {
        periodKey: now.toISOString().slice(0, 7),
        dayStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    };
}
