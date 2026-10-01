import { resolveQuotaTone } from '@/sync/domains/connectedServices/resolveQuotaTone';

export type SessionNearLimitPresentation = Readonly<{
    /** One window of one account: a dismissal holds until this window resets. */
    key: string;
    accountLabel: string | null;
    windowLabel: string;
    remainingPct: number;
    resetsAt: number | null;
}>;

/**
 * The near-limit session banner (lab `csvc` U2, G1): it speaks only at danger (10% or less left,
 * `resolveQuotaTone`), only while the limit is not yet reached (the recovery banner owns that), only
 * when a real action exists (a known usage reset), and once per window: dismissed, it stays quiet
 * until the window resets. Otherwise the composer's quota ring is enough.
 */
export function buildSessionNearLimitPresentation(input: Readonly<{
    accountKey: string | null;
    accountLabel: string | null;
    remainingPct: number | null;
    meter: Readonly<{ meterId: string; label: string; resetsAt: number | null }> | null;
    resetAvailable: boolean;
    limitReached: boolean;
    dismissedKeys: ReadonlySet<string>;
}>): SessionNearLimitPresentation | null {
    if (input.limitReached || !input.meter || input.remainingPct === null) return null;
    if (input.remainingPct <= 0 || resolveQuotaTone(input.remainingPct) !== 'danger') return null;
    if (!input.resetAvailable) return null;
    const key = `${input.accountKey ?? ''}:${input.meter.meterId}:${input.meter.resetsAt ?? ''}`;
    if (input.dismissedKeys.has(key)) return null;
    return {
        key,
        accountLabel: input.accountLabel,
        windowLabel: input.meter.label,
        remainingPct: Math.round(input.remainingPct),
        resetsAt: input.meter.resetsAt,
    };
}

// Dismissed windows for this run of the app: a session re-opened in the same window stays quiet.
const dismissedNearLimitKeys = new Set<string>();

export function readDismissedSessionNearLimitKeys(): ReadonlySet<string> {
    return new Set(dismissedNearLimitKeys);
}

export function dismissSessionNearLimit(key: string): ReadonlySet<string> {
    dismissedNearLimitKeys.add(key);
    return new Set(dismissedNearLimitKeys);
}
