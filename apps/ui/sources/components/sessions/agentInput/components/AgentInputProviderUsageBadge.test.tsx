import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { computeConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import type { ConnectedServiceQuotaGaugeLabelFormatter, ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { renderScreen } from '@/dev/testkit';

import { AgentInputProviderUsageBadge } from './AgentInputProviderUsageBadge';

// SVG is a native rendering boundary; the usage and capacity rings remain real.
vi.mock('react-native-svg', () => ({
    Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement('Svg', props, props.children),
    Circle: (props: Record<string, unknown>) => React.createElement('Circle', props),
}));

const fixtureFormatter: ConnectedServiceQuotaGaugeLabelFormatter = {
    remaining: ({ percent }) => `${percent} left`,
    remainingWithReset: ({ percent, reset }) => `${percent} left · resets in ${reset}`,
    used: ({ used, limit }) => `${used}/${limit} used`,
    durationNow: () => 'now',
    durationOutdated: () => 'outdated',
    durationDaysHours: ({ days, hours }) => `${days}d ${hours}h`,
    durationHoursMinutes: ({ hours, minutes }) => `${hours}h ${minutes}m`,
    durationHours: ({ hours }) => `${hours}h`,
    durationMinutes: ({ minutes }) => `${minutes}m`,
    subscriptionEnds: ({ date }) => `Ends ${date}`,
    subscriptionEndsInDays: ({ days }) => `Ends in ${days} day${days === 1 ? '' : 's'}`,
    subscriptionRenews: ({ date }) => `Renews ${date}`,
    subscriptionRenewsInDays: ({ days }) => `Renews in ${days} day${days === 1 ? '' : 's'}`,
};

function viewModel(): ConnectedServiceQuotaGaugeViewModel {
    return {
        serviceId: 'openai-codex',
        providerDisplayName: 'Codex',
        activeAccountDisplayLabel: 'Work account',
        remainingPct: 18,
        usedPct: 82,
        valueLabel: '18% left',
        ringValueLabel: '82',
        badgeLabel: '18% left',
        scopePrefix: null,
        primaryValueSemantics: 'remaining',
        detailRightLabel: '18% left · resets in 2h',
        usedLimitLabel: '82/100 used',
        resetLabel: '2h',
        tone: 'warning',
        isStale: false,
        recoveryCreditSummary: {
            availableCount: 1,
            nextExpiresAtMs: null,
            providerCreditId: null,
        },
        effectiveMeter: {
            meterId: 'weekly',
            label: 'Weekly',
            used: 82,
            limit: 100,
            unit: 'count',
            utilizationPct: null,
            resetsAt: 0,
            status: 'ok',
            details: {},
        },
        allMeterRows: [{
            meterId: 'weekly',
            label: 'Weekly',
            remainingPct: 18,
            usedPct: 82,
            detailRightSemantics: 'remaining',
            detailRightLabel: '18% left · resets in 2h',
            usedLimitSemantics: 'used',
            usedLimitLabel: '82/100 used',
            resetLabel: '2h',
            tone: 'warning',
        }],
        usageRings: [],
    };
}

describe('AgentInputProviderUsageBadge', () => {
    it('places the final selected meter in the shared popover scroller and updates rendered edge indicators', async () => {
        const meters = Array.from({ length: 24 }, (_, index) => ({
            meterId: `reported_${index}`, label: `Reported ${index}`, used: index, limit: 100,
            unit: 'count' as const, utilizationPct: null, resetsAt: null, status: 'ok' as const,
            details: { limitCategory: 'usage_limit' as const },
        }));
        const vm = computeConnectedServiceQuotaGaugeViewModel({
            snapshot: { v: 1, serviceId: 'openai-codex', profileId: 'work', fetchedAt: 1_000,
                staleAfterMs: 60_000, planLabel: null, accountLabel: null, meters: [...meters, {
                    meterId: 'requests', label: 'Requests', used: 99, limit: 100, unit: 'requests',
                    utilizationPct: null, resetsAt: null, status: 'ok', details: { limitCategory: 'rate_limit' as const },
                }] },
            windowMode: 'most_constrained', additionalMeterIds: ['requests'], nowMs: 2_000,
            formatter: fixtureFormatter,
        });
        if (!vm) throw new Error('Expected reported quota');
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={vm} />);
        act(() => { screen.findByTestId('agent-input-provider-usage-badge')?.props.onPress?.(); });
        const scroll = screen.findAll((node) => typeof node.type === 'string'
            && String(node.type).includes('ScrollView')
            && node.findAll((child) => child.props.testID === 'agent-input-provider-usage-meter:requests').length > 0);
        expect(scroll).toHaveLength(1);
        // Native I/O is supplied at the test boundary; this proves rendered edge behavior, not a physical gesture.
        act(() => {
            scroll[0]!.props.onLayout({ nativeEvent: { layout: { width: 280, height: 200 } } });
            scroll[0]!.props.onContentSizeChange(280, 1_400);
        });
        expect(screen.findAll((node) => node.props.name === 'caret-down').length).toBeGreaterThan(0);
        act(() => { scroll[0]!.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 1_200 } } }); });
        expect(screen.findAll((node) => node.props.name === 'caret-down')).toHaveLength(0);
        expect(screen.findAll((node) => node.props.name === 'caret-up').length).toBeGreaterThan(0);
        expect(screen.findByTestId('agent-input-provider-usage-meter:requests')).toBeTruthy();
    });

    it('includes every visible extra meter in the actual usage popover across comparison families', async () => {
        const vm = computeConnectedServiceQuotaGaugeViewModel({
            snapshot: {
                v: 1, serviceId: 'openai-codex', profileId: 'work', fetchedAt: 1_000, staleAfterMs: 60_000,
                planLabel: null, accountLabel: null, meters: [
                    { meterId: 'weekly', label: 'Weekly', used: 82, limit: 100, unit: 'count', utilizationPct: null,
                        resetsAt: null, status: 'ok', details: { limitCategory: 'usage_limit' } },
                    { meterId: 'requests', label: 'Requests', used: 99, limit: 100, unit: 'requests', utilizationPct: null,
                        resetsAt: null, status: 'ok', details: { limitCategory: 'rate_limit' } },
                ],
            },
            windowMode: 'most_constrained', additionalMeterIds: ['requests'], nowMs: 2_000,
            formatter: fixtureFormatter,
        });
        if (!vm) throw new Error('Expected a reported quota gauge');
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={vm} />);
        expect(screen.findByTestId('agent-input-provider-usage-value:requests')).toBeTruthy();
        act(() => { screen.findByTestId('agent-input-provider-usage-badge')?.props.onPress?.(); });
        expect(screen.findByTestId('agent-input-provider-usage-meter:requests')).toBeTruthy();
    });

    it('keeps meter labels off by default and honors explicit label intent', async () => {
        const vm = { ...viewModel(), usageRings: [
            { window: 'session' as const, meterId: 'five_hour', label: '5-hour', usedPct: 10, ringValueLabel: '10', tone: 'neutral' as const },
        ] };
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={vm} />);
        expect(screen.findByTestId('agent-input-provider-usage-meter-label')).toBeNull();
        await screen.update(<AgentInputProviderUsageBadge viewModel={vm} showLabels />);
        expect(screen.findByTestId('agent-input-provider-usage-meter-label')).toBeTruthy();
    });

    it('announces the single ring without window meters as the used percent it shows', async () => {
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={viewModel()} />);

        expect(screen.findByTestId('agent-input-provider-usage-value')?.props.children).toBe('82');
        const label = String(screen.findByTestId('agent-input-provider-usage-badge')?.props.accessibilityLabel);
        expect(label).toContain('82% used');
        expect(label).not.toContain('left');
    });

    it('announces each real ring only by its own meter and used percent while the button retains the aggregate', async () => {
        const vm = { ...viewModel(), usageRings: [
            { window: 'weekly' as const, meterId: 'weekly', label: 'Weekly', usedPct: 82, ringValueLabel: '82', tone: 'warning' as const },
            { window: 'session' as const, meterId: 'five_hour', label: '5-hour', usedPct: 20, ringValueLabel: '20', tone: 'neutral' as const },
        ] };
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={vm} />);
        const imageLabels = screen.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'image')
            .map((node) => node.props.accessibilityLabel);
        expect(imageLabels).toEqual(['Weekly 82% used', '5-hour 20% used']);
        const aggregate = String(screen.findByTestId('agent-input-provider-usage-badge')?.props.accessibilityLabel);
        expect(aggregate).toContain('Weekly 82% used');
        expect(aggregate).toContain('5-hour 20% used');
    });

    it('keeps subscription details live while the usage popover remains open', async () => {
        const firstViewModel = {
            ...viewModel(),
            subscription: {
                summary: 'Renews 15 September',
                period: '15 August – 15 September',
                renewal: 'on' as const,
                renewalLabel: 'On',
                checkedLabel: 'Checked 1 minute ago',
                notice: null,
                accessUntilLabel: null,
                isLastKnown: false,
            },
        };
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={firstViewModel} />);
        act(() => screen.findByTestId('agent-input-provider-usage-badge')?.props.onPress?.());
        expect(screen.findByTestId('agent-input-provider-usage-subscription:renewal')?.props.children).toContain('On');
        await screen.update(<AgentInputProviderUsageBadge viewModel={{
            ...firstViewModel,
            subscription: { ...firstViewModel.subscription, renewal: 'off', renewalLabel: 'Off', summary: 'Ends 15 September' },
        }} />);
        expect(screen.findByTestId('agent-input-provider-usage-subscription:renewal')?.props.children).toContain('Off');
        await screen.update(<AgentInputProviderUsageBadge viewModel={viewModel()} />);
        expect(screen.findByTestId('agent-input-provider-usage-subscription')).toBeNull();
    });

    it('removes the duplicated top quota summary and keeps consistent group spacing', async () => {
        const firstViewModel = {
            ...viewModel(),
            subscription: {
                summary: 'Ends 15 September',
                period: null,
                renewal: 'off' as const,
                renewalLabel: 'Off',
                checkedLabel: 'Checked 1 minute ago',
                notice: null,
                accessUntilLabel: null,
                isLastKnown: false,
            },
        };
        const screen = await renderScreen(<AgentInputProviderUsageBadge viewModel={firstViewModel} />);
        act(() => screen.findByTestId('agent-input-provider-usage-badge')?.props.onPress?.());

        const quotaSummaryOccurrences = screen.getTextContent().split(firstViewModel.detailRightLabel).length - 1;
        expect(quotaSummaryOccurrences).toBe(1);
        expect(flattenStyle(screen.findByTestId('agent-input-provider-usage-subscription')?.props.style).gap).toBe(0);
        expect(flattenStyle(screen.findByTestId('agent-input-provider-usage-meter:weekly')?.props.style).marginTop).toBe(12);
    });

    it('keeps the real ring progress stable when parent supplies unchanged gauge display data', async () => {
        const firstViewModel = viewModel();
        const screen = await renderScreen(
            <AgentInputProviderUsageBadge viewModel={firstViewModel} />,
        );

        const progressBefore = screen.findByTestId('agent-input-provider-usage-ring')?.findAll((node) => String(node.type) === 'Circle' && typeof node.props.strokeDashoffset === 'number')[0]?.props.strokeDashoffset;
        expect(progressBefore).toBeTypeOf('number');
        await screen.update(
            <AgentInputProviderUsageBadge viewModel={{ ...firstViewModel }} />,
        );
        expect(screen.findByTestId('agent-input-provider-usage-ring')?.findAll((node) => String(node.type) === 'Circle' && typeof node.props.strokeDashoffset === 'number')[0]?.props.strokeDashoffset).toBe(progressBefore);
        act(() => screen.tree.unmount());
    });

    it('shows recovery credits in the popover and applies them through the provided action', async () => {
        const onRecoveryCreditPress = vi.fn();
        const screen = await renderScreen(
            <AgentInputProviderUsageBadge
                viewModel={viewModel()}
                onRecoveryCreditPress={onRecoveryCreditPress}
            />,
        );

        act(() => {
            screen.findByTestId('agent-input-provider-usage-badge')?.props.onPress?.();
        });

        const meterFill = screen.findByTestId('agent-input-provider-usage-meter-bar:weekly:fill');
        // Remaining-first fill: the row label says "18% left", so the bar fills 18% (battery model;
        // user decision 2026-07-10 reverting the consumption-fill flip in 5ad4d06be).
        expect(flattenStyle(meterFill?.props.style).width).toBe('18%');

        expect(screen.getTextContent()).toContain('1 reset available');
        const action = screen.tree.root.findAll((node) => node.props?.testID === 'agent-input-provider-usage-recovery-credit-action')[0] ?? null;
        expect(action).toBeTruthy();

        act(() => {
            action?.props.onPress?.();
        });

        expect(onRecoveryCreditPress).toHaveBeenCalledTimes(1);
        act(() => screen.tree.unmount());
    });
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flattenStyle(entry) }), {});
    }
    return typeof style === 'object' ? style as Record<string, unknown> : {};
}
