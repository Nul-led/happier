import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { ConnectedServiceQuotaSummaryCardSection } from './ConnectedServiceQuotaSummaryCardSection';

function card(remainingPct: number) {
    return {
        key: 'service-a',
        title: 'Service A',
        value: `${remainingPct}%`,
        subtitle: 'Primary',
        meters: [{
            key: 'weekly',
            label: 'Weekly',
            remainingPct,
            resetsAt: null,
            valueText: `${remainingPct}%`,
            status: 'ok' as const,
            tone: 'danger' as const,
        }],
    };
}

function fillWidth(screen: Awaited<ReturnType<typeof renderScreen>>): unknown {
    const fill = screen.findByTestId('connected-service-quota-meter-service-a-weekly:bar:fill');
    expect(fill).toBeTruthy();
    const styles = Array.isArray(fill!.props.style) ? fill!.props.style.flat() : [fill!.props.style];
    return (styles.find((style: unknown) => style && typeof style === 'object' && 'width' in style) as { width?: unknown } | undefined)?.width;
}

describe('ConnectedServiceQuotaSummaryCardSection', () => {
    it('fills each quota meter to exactly what is left: empty when exhausted, never a minimum sliver', async () => {
        const exhausted = await renderScreen(<ConnectedServiceQuotaSummaryCardSection title="Quotas" cards={[card(0)]} />);
        expect(fillWidth(exhausted)).toBe('0%');

        const nearlyOut = await renderScreen(<ConnectedServiceQuotaSummaryCardSection title="Quotas" cards={[card(3)]} />);
        expect(fillWidth(nearlyOut)).toBe('3%');
    });

    it('says the quotas are loading, or that there is nothing yet, through the shared state card', async () => {
        const loading = await renderScreen(<ConnectedServiceQuotaSummaryCardSection title="Quotas" cards={[]} isRefreshing />);
        expect(loading.findByTestId('usage-connected-services-quotas-loading-loading-spinner')).toBeTruthy();

        const empty = await renderScreen(<ConnectedServiceQuotaSummaryCardSection title="Quotas" cards={[]} showWhenEmpty />);
        expect(empty.findByTestId('usage-connected-services-quotas-empty')).toBeTruthy();
    });
});
