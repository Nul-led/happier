import type { MeterTone } from '@/components/ui/lists/MeterBar';
import { resolveQuotaMeterTone } from '@/sync/domains/connectedServices/resolveQuotaTone';
import { t } from '@/text';

import type { ConnectedServiceQuotaSummary } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSummaries';

export type ConnectedServiceQuotaSummaryCardMeter = Readonly<{
    key: string;
    label: string;
    remainingPct: number | null;
    /** When the window resets (epoch ms), when the provider reports it. */
    resetsAt: number | null;
    valueText: string;
    status: ConnectedServiceQuotaSummary['meters'][number]['status'];
    /** Health colour of the meter, from the one quota tone owner. */
    tone: MeterTone;
}>;

export type ConnectedServiceQuotaSummaryCard = Readonly<{
    key: string;
    title: string;
    value: string;
    subtitle: string;
    meters: ReadonlyArray<ConnectedServiceQuotaSummaryCardMeter>;
}>;

function formatRemainingPct(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
        return t('usage.noData.title');
    }

    return `${Math.round(value)}%`;
}

export function buildConnectedServiceQuotaSummaryCards(
    summaries: ReadonlyArray<ConnectedServiceQuotaSummary>,
): ReadonlyArray<ConnectedServiceQuotaSummaryCard> {
    return summaries.map((summary) => {
        const subtitleParts = [
            summary.primaryMeter?.label ?? null,
            summary.planLabel,
            summary.profileLabel ?? summary.profileId,
        ].filter((value): value is string => Boolean(value && value.trim()));

        return {
            key: summary.key,
            title: summary.serviceLabel,
            value: formatRemainingPct(summary.primaryMeter?.remainingPct ?? null),
            subtitle: subtitleParts.join(' · ') || t('usage.noData.title'),
            meters: summary.meters.map((meter) => ({
                key: meter.meterId,
                label: meter.label,
                remainingPct: meter.remainingPct,
                resetsAt: meter.resetsAt,
                valueText: formatRemainingPct(meter.remainingPct),
                status: meter.status,
                tone: resolveQuotaMeterTone(meter),
            })),
        } satisfies ConnectedServiceQuotaSummaryCard;
    });
}
