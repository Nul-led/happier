import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

const executeMock = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

// The Action front door is the transport boundary; the list clients, parsers, Run store and
// projections below it stay real.
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => executeMock,
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/workflows', router: { push: routerPush } }).module;
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const enabledDecision = vi.hoisted(() => ({
    state: 'enabled', blockedBy: null, blockerCode: 'none', diagnostics: [], evaluatedAt: 0, scope: { scopeKind: 'runtime' },
}));
vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => enabledDecision,
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeLifetime: () => ({
        scope: { serverId: 'server-a', accountId: 'account-a' },
        isCurrent: () => true,
        onRetire: () => ({ dispose() {} }),
    }),
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/state/storage')>()),
    useActiveServerAccountScope: () => ({ serverId: 'server-a', accountId: 'account-a' }),
    useAutomations: () => [],
    useSocketStatus: () => ({ status: 'connected', lastConnectedAt: 1, lastDisconnectedAt: null, lastError: null, lastErrorAt: null }),
}));

vi.mock('@/sync/sync', () => ({ sync: { refreshAutomations: async () => undefined } }));

const waiting = createWorkflowRunSummaryFixture({ id: 'run-waiting', state: 'running' });
const running = createWorkflowRunSummaryFixture({ id: 'run-live', state: 'running' });

function answerLists() {
    executeMock.mockImplementation(async (actionId: string, input: Record<string, unknown>) => {
        if (actionId === 'workflow.definition.list') return { ok: true, result: { definitions: [] } };
        if (actionId !== 'workflow.run.list') return { ok: false, error: 'unexpected', errorCode: 'unexpected' };
        if (input.attention === 'required') {
            return { ok: true, result: { runs: [waiting], metadataByRunId: { [waiting.id]: { kind: 'available', value: { title: 'Prepare the release' } } } } };
        }
        if (Array.isArray(input.states)) {
            return { ok: true, result: { runs: [running], metadataByRunId: { [running.id]: { kind: 'available', value: { title: 'Fix a failing test' } } } } };
        }
        return { ok: true, result: { runs: [], metadataByRunId: {} } };
    });
}

afterEach(async () => {
    const { resetWorkflowLibraryReadsForTests } = await import('@/components/workflows/library/workflowLibraryReads');
    resetWorkflowLibraryReadsForTests();
    executeMock.mockReset();
    routerPush.mockReset();
});

describe('WorkflowsColumn', () => {
    it('lists what needs you as navigation to the exact run, never as an answer', async () => {
        answerLists();
        const { WorkflowsColumn } = await import('./WorkflowsColumn');
        const screen = await renderScreen(<WorkflowsColumn />);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const needsYou = screen.tree.root.findAll((node) => node.props?.testID === 'workflows-column:needsYou:run-waiting' && typeof node.props.onPress === 'function')[0]!;
        expect(needsYou.props.title).toBe('Prepare the release');
        await act(async () => { needsYou.props.onPress(); });
        expect(routerPush).toHaveBeenCalledWith('/workflows/runs/run-waiting');
        // No approval or answer control is rendered anywhere in the column.
        expect(screen.tree.root.findAll((node) => /allow|deny|approve/i.test(String(node.props?.testID ?? '')))).toHaveLength(0);
    });

    it('says a running run is running without inventing progress, and hides empty sections', async () => {
        answerLists();
        const { WorkflowsColumn } = await import('./WorkflowsColumn');
        const screen = await renderScreen(<WorkflowsColumn />);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const row = screen.tree.root.findAll((node) => node.props?.testID === 'workflows-column:running:run-live' && typeof node.props.onPress === 'function')[0]!;
        expect(String(row.props.subtitle)).not.toMatch(/%/);
        // No Account trigger holds its own step here, so there is no Triggers section.
        expect(screen.tree.root.findAll((node) => node.props?.testID === 'workflows-column:group:triggers')).toHaveLength(0);
    });
});
