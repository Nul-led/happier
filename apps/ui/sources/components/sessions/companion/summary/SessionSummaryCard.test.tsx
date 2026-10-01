import * as React from 'react';
import { I18nManager } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { SessionPendingPermission } from '@/sync/ops/sessionPendingPermissions';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { SessionSummaryCard } from './SessionSummaryCard';
import type { SessionSummaryCardModel } from './sessionSummaryProjection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ASK: SessionPendingPermission = {
    requestId: 'req-1',
    toolName: 'Bash',
    summary: 'Run yarn test:ui',
    command: 'yarn test:ui',
    createdAtMs: 1_000,
    policy: { protocol: 'standard', usePermissionUpdates: false },
    answers: ['allowOnce', 'allowForSession', 'deny'],
};

function model(overrides: Partial<SessionSummaryCardModel> = {}): SessionSummaryCardModel {
    return {
        scope: 'exact',
        title: 'Fix settings modal remount',
        agentLabel: 'Claude',
        agentId: null,
        status: { state: 'thinking', statusText: 'Working', quiet: false },
        stale: false,
        availability: 'complete',
        encryption: 'plain',
        identityDestination: 'sessionInfo',
        rows: [],
        needsYou: null,
        sinceMs: null,
        progress: null,
        plan: null,
        facts: [],
        ...overrides,
    };
}

describe('SessionSummaryCard (the Companion hero)', () => {
    it('names an unproven Home as unavailable and presents no invented status line', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({ scope: 'realm_unavailable', status: null, availability: 'locked', encryption: 'unknown' })}
                density="compact"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-availability')?.props.children)
            .toBe('sessionBoard.board.unavailable.reason');
        expect(screen.findByTestId('session-companion-summary-status')).toBeNull();
    });

    it('explains canonical locked content instead of silently looking complete', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard model={model({ availability: 'locked', encryption: 'locked' })} density="compact" />,
        );

        expect(screen.findByTestId('session-companion-summary-availability')?.props.children)
            .toBe('status.encryptedUnavailable');
        expect(screen.findByTestId('session-companion-summary-status')).toBeNull();
    });

    it('says the present in words: waiting for you, and the plan step the agent paused before', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({ needsYou: { request: ASK, moreCount: 0 }, sinceMs: Date.now(), progress: { step: 4, total: 5 } })}
                density="compact"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-status')?.props.children)
            .toBe('sessionCompanion.status.waitingForYou');
        expect(screen.findByTestId('session-companion-summary-what')?.props.children)
            .toBe('sessionCompanion.status.pausedBeforeStep(agent=Claude,step=4,total=5)');
        expect(screen.findByTestId('session-companion-summary-timer')).not.toBeNull();
    });

    it('answers the ask in place through the shared answer owner, then folds into one confirmation', async () => {
        let resolveAnswer: () => void = () => {};
        const answerPermission = vi.fn(() => new Promise<void>((resolve) => { resolveAnswer = resolve; }));
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({ needsYou: { request: ASK, moreCount: 0 } })}
                density="compact"
                answerPermission={answerPermission}
            />,
        );

        await act(async () => { screen.findByTestId('session-companion-summary-allow')?.props.onPress(); });
        expect(answerPermission).toHaveBeenCalledWith(ASK, 'allowOnce');
        // One answer at a time: the ask cannot be answered twice while the first is in flight.
        expect(screen.findByTestId('session-companion-summary-deny')?.props.disabled).toBe(true);

        await act(async () => { resolveAnswer(); });
        // The Session state the chat card reads drops the answered ask.
        await act(async () => {
            screen.tree.update(<SessionSummaryCard model={model()} density="compact" answerPermission={answerPermission} />);
        });
        expect(screen.findByTestId('session-companion-summary-ask')).toBeNull();
        expect(screen.findByTestId('session-companion-summary-answered')).not.toBeNull();
    });

    it('keeps the ask when the answer does not reach the session, and says so', async () => {
        const answerPermission = vi.fn(async () => { throw new Error('offline'); });
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({ needsYou: { request: ASK, moreCount: 0 } })}
                density="compact"
                answerPermission={answerPermission}
            />,
        );

        await act(async () => { screen.findByTestId('session-companion-summary-deny')?.props.onPress(); });
        expect(screen.findByTestId('session-companion-summary-ask-reason')?.props.children).toBe('sessionCompanion.ask.failed');
        expect(screen.findByTestId('session-companion-summary-allow')?.props.disabled).toBe(false);
    });

    it('shows an ask it cannot answer disabled, with when it can be answered', async () => {
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({
                    status: { state: 'disconnected', statusText: 'Disconnected', quiet: false },
                    needsYou: { request: { ...ASK, answers: [] }, moreCount: 0 },
                })}
                density="compact"
                answerPermission={vi.fn(async () => {})}
                machineName="MacBook Pro"
            />,
        );

        expect(screen.findByTestId('session-companion-summary-allow')?.props.disabled).toBe(true);
        expect(screen.findByTestId('session-companion-summary-ask-reason')?.props.children)
            .toBe('sessionCompanion.ask.answerWhenBack(machine=MacBook Pro)');
    });

    it('opens each fact and each remaining row at its existing owner, with a compact overflow', async () => {
        const openWorkTab = vi.fn();
        const openGit = vi.fn();
        const openApprovals = vi.fn();
        const openFull = vi.fn();
        const screen = await renderScreen(
            <SessionSummaryCard
                model={model({
                    rows: [
                        { kind: 'approvals', count: 1, destination: 'approvals' },
                        { kind: 'workflow', runCount: 2, destination: 'workTab' },
                        { kind: 'recap', text: 'Wrapped up the resize test', source: 'synopsis', destination: 'workTab' },
                    ],
                    facts: [
                        { kind: 'subagents', live: 2, total: 3, destination: 'workTab' },
                        { kind: 'changes', count: 14, destination: 'git' },
                        { kind: 'context', percent: 62, stale: false, destination: 'usage' },
                    ],
                })}
                density="compact"
                destinations={{ workTab: openWorkTab, git: openGit, approvals: openApprovals }}
                onOpenFullSurface={openFull}
            />,
        );

        screen.findByTestId('session-companion-summary-fact-subagents')?.props.onPress();
        screen.findByTestId('session-companion-summary-fact-changes')?.props.onPress();
        screen.findByTestId('session-companion-summary-row-approvals')?.props.onPress();
        expect(openWorkTab).toHaveBeenCalledTimes(1);
        expect(openGit).toHaveBeenCalledTimes(1);
        expect(openApprovals).toHaveBeenCalledTimes(1);
        // A fact with no handler is quiet text, never a dead button.
        expect(screen.findByTestId('session-companion-summary-fact-context')?.props.onPress).toBeUndefined();
        // Recap became the status line's "what", not a row.
        expect(screen.findByTestId('session-companion-summary-row-recap')).toBeNull();
        expect(screen.findByTestId('session-companion-summary-more')).toBeNull();
    });

    it('mirrors every directional disclosure caret in RTL', async () => {
        const previousIsRTL = I18nManager.isRTL;
        (I18nManager as { isRTL: boolean }).isRTL = true;
        try {
            const screen = await renderScreen(
                <SessionSummaryCard
                    model={model({
                        rows: [
                            { kind: 'approvals', count: 1, destination: 'approvals' },
                            { kind: 'workflow', runCount: 1, destination: 'workTab' },
                        ],
                    })}
                    density="compact"
                    destinations={{ approvals: () => undefined, workTab: () => undefined }}
                    onOpenFullSurface={() => undefined}
                />,
            );

            const carets = screen.findAllByProps({ name: 'caret-right' });
            expect(carets.length).toBeGreaterThan(0);
            for (const caret of carets) {
                expect(caret.props.mirrored).toBe(true);
            }
        } finally {
            (I18nManager as { isRTL: boolean }).isRTL = previousIsRTL;
        }
    });
});
