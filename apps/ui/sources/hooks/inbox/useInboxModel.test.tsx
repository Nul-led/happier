import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { storage } from '@/sync/domains/state/storageStore';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { WorkflowRunListPage } from '@/sync/domains/workflows/workflowRunListActions';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import { InboxModelProvider, useInboxModel, type InboxModel } from './useInboxModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Inbox model groups by work root over the real classifier and the real workflow window.
 * Boundaries: the Run-list Action (network) and the Action front door (host executor).
 */
const listRuns = vi.hoisted(() => vi.fn<(params: { filter?: Record<string, unknown> }) => Promise<WorkflowRunListPage>>());
const executed = vi.hoisted(() => [] as Array<{ actionId: string; input: unknown }>);

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => (featureId === 'workflows' ? { state: 'enabled' } : null),
}));
vi.mock('@/sync/domains/workflows/workflowRunListActions', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/workflows/workflowRunListActions')>(),
    listWorkflowRuns: listRuns,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => ({
        scope: { serverId: 'home-a', accountId: 'account-a' },
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => {} }),
    }),
}));
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => async (actionId: string, input: unknown) => {
        executed.push({ actionId, input });
        return { ok: true, result: {} };
    },
}));
vi.mock('@/hooks/server/useFriendsEnabled', () => ({ useFriendsEnabled: () => false }));
vi.mock('@/hooks/server/useFriendsIdentityReadiness', () => ({ useFriendsIdentityReadiness: () => ({ isReady: false }) }));

function page(runs: ReturnType<typeof createWorkflowRunSummaryFixture>[]): WorkflowRunListPage {
    return { runs, metadataByRunId: {}, nextCursor: undefined };
}

let model: InboxModel | null = null;
function Probe(): null {
    model = useInboxModel();
    return null;
}

async function renderModel() {
    const screen = await renderScreen(<InboxModelProvider><Probe /></InboxModelProvider>);
    await act(async () => {});
    return screen;
}

describe('useInboxModel work groups (ORC R-10)', () => {
    beforeEach(() => {
        model = null;
        executed.length = 0;
        listRuns.mockReset();
        storage.setState({
            friends: {},
            sessions: {},
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
            artifacts: {},
            isDataReady: true,
            workflowRunsById: {},
            workflowRunListWindows: {},
            sessionOrganizationAttentionStandingsBySessionKey: {},
        } as never);
    });

    it('lists an off-page hold once as its own work root, and lets it recede when it leaves the window', async () => {
        listRuns
            .mockResolvedValueOnce(page([createWorkflowRunSummaryFixture({ id: 'run-held', state: 'interrupted' })]))
            .mockResolvedValueOnce(page([]));

        await renderModel();

        expect(model?.workGroups.map((group) => group.key)).toEqual(['run:run-held']);
        expect(model?.workGroups[0]?.items.map((item) => item.key)).toEqual(['run:run-held']);
        expect(model?.hasPrimaryAttention).toBe(true);

        await act(async () => {
            publishHomeAccountChange('home-a', ['workflow-run:run-held']);
        });
        await act(async () => {});

        expect(model?.workGroups).toEqual([]);
    });

    it('settles through the one attention Action and the read-state Action, in that order', async () => {
        listRuns.mockResolvedValue(page([]));
        await renderModel();

        await act(async () => {
            await model?.settle({ id: 'session-1', serverId: 'home-a' } as Session);
        });

        expect(executed).toEqual([
            { actionId: 'session.attention.set', input: { sessionId: 'session-1', standing: false } },
            { actionId: 'session.read_state.set', input: { sessionId: 'session-1', state: 'read' } },
        ]);
    });

    it('snoozes with remindAt and clears it with null through the same Action', async () => {
        listRuns.mockResolvedValue(page([]));
        await renderModel();

        await act(async () => {
            await model?.setReminder({ id: 'session-1', serverId: 'home-a' } as Session, 9_000);
            await model?.setReminder({ id: 'session-1', serverId: 'home-a' } as Session, null);
        });

        expect(executed).toEqual([
            { actionId: 'session.attention.set', input: { sessionId: 'session-1', remindAt: 9_000 } },
            { actionId: 'session.attention.set', input: { sessionId: 'session-1', remindAt: null } },
        ]);
    });
});
