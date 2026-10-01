import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({ metadata: null as unknown }));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({
        importOriginal,
        overrides: { useSessionMetadata: () => shared.metadata as never },
    });
});

const { SessionGoalValueRow } = await import('./SessionGoalControlContent');

function goalMetadata(title: string) {
    return {
        sessionWorkStateV1: {
            v: 1,
            backendId: 'codex',
            updatedAt: 10,
            primaryItemId: 'goal:1',
            items: [{ id: 'goal:1', kind: 'goal', origin: 'vendor', status: 'active', title, updatedAt: 10 }],
        },
    };
}

describe('Work tab Goal row (lab `convo-W8full`)', () => {
    it('states the goal status and opens the Goal control through its one entry', async () => {
        shared.metadata = goalMetadata('Every retry state has customer copy');
        const open = vi.fn();
        const screen = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: true, open }} testID="session-work-goal" />,
        );

        expect(screen.getTextContent()).toContain('session.workState.goal.statusActive');
        expect(screen.getTextContent()).not.toContain('Every retry state has customer copy');
        await act(async () => { screen.pressByTestId('session-work-goal'); });
        expect(open).toHaveBeenCalledTimes(1);
    });

    it('updates the value when the canonical goal is paused', async () => {
        shared.metadata = goalMetadata('Every retry state has customer copy');
        const entry = { available: true, open: vi.fn() };
        const screen = await renderScreen(<SessionGoalValueRow sessionId="lead" entry={entry} />);
        shared.metadata = {
            sessionWorkStateV1: {
                ...goalMetadata('Every retry state has customer copy').sessionWorkStateV1,
                items: [{ id: 'goal:1', kind: 'goal', origin: 'vendor', status: 'paused', title: 'Every retry state has customer copy', updatedAt: 11 }],
            },
        };
        await act(async () => { screen.update(<SessionGoalValueRow sessionId="lead" entry={{ ...entry }} />); });
        expect(screen.getTextContent()).toContain('session.workState.goal.statusPaused');
        expect(screen.getTextContent()).not.toContain('session.workState.goal.statusActive');
    });

    it('says the goal is not set, and is absent where the session cannot hold a goal', async () => {
        shared.metadata = {};
        const screen = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: true, open: vi.fn() }} testID="session-work-goal" />,
        );
        expect(screen.getTextContent()).toContain('goalControl.row.notSet');

        const unavailable = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: false, open: vi.fn() }} testID="session-work-goal" />,
        );
        expect(unavailable.findAllHostsByTestId('session-work-goal')).toHaveLength(0);
    });
});
