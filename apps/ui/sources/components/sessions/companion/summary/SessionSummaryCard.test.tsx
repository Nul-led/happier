import * as React from 'react';
import { I18nManager, Platform } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { SessionSummaryCard } from './SessionSummaryCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SessionSummaryCard', () => {
    it('names an unproven Home as unavailable and does not present an invented operational state', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'realm_unavailable',
                    title: null,
                    agentLabel: null,
                    operational: null,
                    stale: false,
                    availability: 'locked',
                    encryption: 'unknown',
                    identityDestination: 'sessionInfo',
                    rows: [],
                }}
                density="compact"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-availability')?.props.children)
            .toBe('sessionBoard.board.unavailable.reason');
        expect(screen.findByTestId('session-companion-summary-status')).toBeNull();
    });

    it('explains canonical locked content instead of silently looking complete', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'exact',
                    title: null,
                    agentLabel: null,
                    operational: 'none',
                    stale: false,
                    availability: 'locked',
                    encryption: 'locked',
                    identityDestination: 'sessionInfo',
                    rows: [],
                }}
                density="compact"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-availability')?.props.children)
            .toBe('status.encryptedUnavailable');
        expect(screen.findByTestId('session-companion-summary-status')).toBeNull();
    });

    it('keeps each visible row and compact overflow independently actionable', async () => {
        const openInfo = vi.fn();
        const openApprovals = vi.fn();
        const openWorkflow = vi.fn();
        const openFull = vi.fn();
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'exact',
                    title: 'Session',
                    agentLabel: 'Claude',
                    operational: 'working',
                    stale: false,
                    availability: 'complete',
                    encryption: 'plain',
                    identityDestination: 'sessionInfo',
                    rows: [
                        { kind: 'approvals', count: 1, destination: 'approvals' },
                        {
                            kind: 'activity',
                            liveCount: 1,
                            totalCount: 2,
                            title: 'Reviewing access',
                            statusLabel: 'Running',
                            destination: 'workflow',
                        },
                        { kind: 'usage', tokens: 1_000, contextPercent: 25, stale: false, destination: 'usage' },
                    ],
                }}
                density="compact"
                destinations={{
                    sessionInfo: openInfo,
                    approvals: openApprovals,
                    workflow: openWorkflow,
                }}
                onOpenFullSurface={openFull}
            />,
        );

        screen.findByTestId('session-companion-summary-identity')?.props.onPress();
        screen.findByTestId('session-companion-summary-row-approvals')?.props.onPress();
        screen.findByTestId('session-companion-summary-row-activity')?.props.onPress();
        screen.findByTestId('session-companion-summary-more')?.props.onPress();

        expect(openInfo).toHaveBeenCalledTimes(1);
        expect(openApprovals).toHaveBeenCalledTimes(1);
        expect(openWorkflow).toHaveBeenCalledTimes(1);
        expect(openFull).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('session-companion-summary-more')?.props.accessibilityLabel)
            .toBe('sessionBoard.companion.summary.moreDetailsA11y(count=1)');
        expect(screen.findByTestId('session-companion-summary-row-usage')).toBeNull();
    });

    it('keeps the interactive identity line at the canonical platform target with centered large text', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'exact',
                    title: 'A long Session title that can grow with Dynamic Type',
                    agentLabel: null,
                    operational: 'ready',
                    stale: false,
                    availability: 'complete',
                    encryption: 'plain',
                    identityDestination: 'sessionInfo',
                    rows: [],
                }}
                density="compact"
                destinations={{ sessionInfo: () => undefined }}
            />,
        );

        const identity = screen.findByTestId('session-companion-summary-identity');
        const style = flattenTestStyle(identity?.props.style);
        expect(style.minHeight).toBe(resolveMinimumInteractiveTargetSize(Platform.OS));
        expect(style.justifyContent).toBe('center');
    });

    // Marking the card's heading `disabled` announces the Session's own name as
    // dimmed/unavailable. A heading with nowhere to go is simply a heading.
    it('presents the identity line as a plain heading when it has no destination', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'exact',
                    title: 'Session',
                    agentLabel: 'Claude',
                    operational: 'ready',
                    stale: false,
                    availability: 'complete',
                    encryption: 'plain',
                    identityDestination: 'sessionInfo',
                    rows: [],
                }}
                density="compact"
            />,
        );

        const identity = screen.findByTestId('session-companion-summary-identity');

        expect(identity?.props.accessibilityRole).toBe('header');
        expect(identity?.props.disabled).not.toBe(true);
        expect(identity?.props.accessibilityState?.disabled).not.toBe(true);
    });

    it('does not make compact rows inaccessible when no full-surface destination exists', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={{
                    scope: 'exact',
                    title: 'Session',
                    agentLabel: null,
                    operational: 'ready',
                    stale: false,
                    availability: 'complete',
                    encryption: 'plain',
                    identityDestination: 'sessionInfo',
                    rows: [
                        { kind: 'approvals', count: 1, destination: 'approvals' },
                        {
                            kind: 'activity',
                            liveCount: 1,
                            totalCount: 2,
                            title: 'Reviewing access',
                            statusLabel: 'Running',
                            destination: 'workflow',
                        },
                        { kind: 'usage', tokens: 1_000, contextPercent: 25, stale: false, destination: 'usage' },
                    ],
                }}
                density="compact"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-row-usage')).not.toBeNull();
        expect(screen.findByTestId('session-companion-summary-more')).toBeNull();
    });

    it('mirrors every directional disclosure caret in RTL', async () => {
        const previousIsRTL = I18nManager.isRTL;
        (I18nManager as { isRTL: boolean }).isRTL = true;
        try {
            const screen = await renderScreen(
                <SessionSummaryCard
                    model={{
                        scope: 'exact',
                        title: 'Session',
                        agentLabel: null,
                        operational: 'ready',
                        stale: false,
                        availability: 'complete',
                        encryption: 'plain',
                        identityDestination: 'sessionInfo',
                        rows: [
                            { kind: 'approvals', count: 1, destination: 'approvals' },
                            {
                                kind: 'activity',
                                liveCount: 1,
                                totalCount: 1,
                                title: 'Reviewing',
                                statusLabel: 'Running',
                                destination: 'workflow',
                            },
                            { kind: 'usage', tokens: 1_000, contextPercent: 25, stale: false, destination: 'usage' },
                        ],
                    }}
                    density="compact"
                    destinations={{ approvals: () => undefined, workflow: () => undefined }}
                    onOpenFullSurface={() => undefined}
                />,
            );

            const carets = screen.findAllByProps({ name: 'caret-right' });
            expect(carets).toHaveLength(3);
            for (const caret of carets) {
                expect(caret.props.mirrored).toBe(true);
            }
        } finally {
            (I18nManager as { isRTL: boolean }).isRTL = previousIsRTL;
        }
    });
});
