import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaSummary } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSummaries';

import { buildConnectedServiceQuotaSummaryCards } from './buildConnectedServiceQuotaSummaryCards';

function summary(meters: ConnectedServiceQuotaSummary['meters']): ConnectedServiceQuotaSummary {
    return {
        key: 'claude:work',
        service: { pluginId: 'anthropic', localId: 'claude' },
        legacyServiceId: 'claude-subscription',
        serviceLabel: 'Claude subscription',
        serviceGroupKey: 'anthropic/claude',
        accountLabel: 'Work',
        profileId: 'work',
        profileLabel: 'Work',
        planLabel: 'Max',
        primaryMeter: meters[0] ?? null,
        meters,
        fetchedAt: 1,
    } as ConnectedServiceQuotaSummary;
}

describe('buildConnectedServiceQuotaSummaryCards', () => {
    it('gives each meter the health tone of the one quota tone owner', () => {
        const meter = (meterId: string, remainingPct: number | null, status: 'ok' | 'unavailable' = 'ok') => ({
            meterId, label: meterId, remainingPct, utilizationPct: null, status, resetsAt: null,
        });
        const [card] = buildConnectedServiceQuotaSummaryCards([summary([
            meter('healthy', 60),
            meter('low', 20),
            meter('critical', 4),
            meter('unavailable', 4, 'unavailable'),
        ])]);
        expect(card!.meters.map((row) => [row.key, row.tone])).toEqual([
            ['healthy', 'success'],
            ['low', 'warning'],
            ['critical', 'danger'],
            ['unavailable', 'neutral'],
        ]);
    });
});
