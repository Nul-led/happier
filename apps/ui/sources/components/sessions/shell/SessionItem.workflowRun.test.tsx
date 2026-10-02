import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { storage } from '@/sync/domains/state/storageStore';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

const push = vi.hoisted(() => vi.fn());
// Third-party rendering boundary; this row does not render Markdown.
vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({ splitStreamingRevealTextParts: () => [] }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/workflows/runs', router: { push } }).module;
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const { SessionItem } = await import('./SessionItem');
afterEach(async () => { await standardCleanup(); push.mockReset(); });

describe('SessionItem workflow body', () => {
    it('does not retain another Run when a hidden recycled cell changes identity', async () => {
        const previous = storage.getState();
        try {
            storage.setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
            for (const [id, title] of [['run-first', 'First Run'], ['run-second', 'Second Run']]) {
                storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                    createWorkflowRunSummaryFixture({ id, startedBy: 'user' }),
                    { kind: 'available', value: { title } },
                )]);
            }
            const row = (id: string) => <SessionItem kind="workflow_run" runId={id} serverId="server-a" dataActive={false} />;
            const screen = await renderScreen(row('run-first'));
            expect(screen.findByTestId('workflow-run-row:run-first')?.props.accessibilityLabel).toContain('First Run');
            await act(async () => screen.tree.update(row('run-second')));
            expect(screen.findByTestId('workflow-run-row:run-second')?.props.accessibilityLabel).toContain('Second Run');
            expect(screen.findByTestId('workflow-run-row:run-second')?.props.accessibilityLabel).not.toContain('First Run');
        } finally { act(() => storage.setState(previous)); }
    });

    it('opens its Run and freezes its exact reader while inactive, then resumes current progress', async () => {
        const previous = storage.getState();
        const seed = (completed: number) => storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
            createWorkflowRunSummaryFixture({ id: 'run-row', state: 'failed', startedBy: 'trigger',
                revision: completed + 1, stepProgress: { completed, total: 5 } }),
            { kind: 'available', value: { title: 'Prepare the release' } },
        )]);
        try {
            storage.setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
            seed(2);
            // The new kind is the missing observable row behavior, not a mocked row.
            const row = (active: boolean) => <SessionItem kind="workflow_run" runId="run-row" serverId="server-a" dataActive={active} density="default" />;
            const screen = await renderScreen(row(true));
            expect(screen.findByTestId('workflow-run-row:run-row')?.props.accessibilityLabel).toContain('Prepare the release');
            expect(screen.findByTestId('workflow-run-row:run-row')?.props.accessibilityLabel).toContain('workflows.runState.failed');
            await screen.pressByTestIdAsync('workflow-run-row:run-row');
            expect(push).toHaveBeenCalledWith('/workflows/runs/run-row');
            const before = screen.findByTestId('workflow-run-row:run-row')!.props.accessibilityLabel;
            await act(async () => screen.tree.update(row(false)));
            act(() => seed(3));
            expect(screen.findByTestId('workflow-run-row:run-row')!.props.accessibilityLabel).toEqual(before);
            await act(async () => screen.tree.update(row(true)));
            expect(screen.findByTestId('workflow-run-row:run-row')!.props.accessibilityLabel).toContain('completed=3');
        } finally { act(() => storage.setState(previous)); }
    });
});
