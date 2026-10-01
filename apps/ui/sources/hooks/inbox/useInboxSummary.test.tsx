import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { storage } from '@/sync/domains/state/storageStore';
import type { WorkflowRunListPage } from '@/sync/domains/workflows/workflowRunListActions';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import { InboxSummaryProvider, useSharedInboxSummary, type InboxSummary } from './useInboxSummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The rail badge counts 03's workflow attention window (ORC R-10, FIN 03 §6.4): the server's
 * `attention: 'required'` predicate, held in the canonical `attention` window the Workflows
 * column reads. The Run-list Action is the network boundary; the store, the loader and the
 * Account-change wake are real.
 */
const listRuns = vi.hoisted(() => vi.fn<(params: { filter?: Record<string, unknown> }) => Promise<WorkflowRunListPage>>());
const featureDecisions = vi.hoisted(() => ({ workflows: { state: 'enabled' } as Record<string, unknown> | null }));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => (featureId === 'workflows' ? featureDecisions.workflows : null),
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
vi.mock('@/hooks/server/useFriendsEnabled', () => ({ useFriendsEnabled: () => false }));
vi.mock('@/hooks/server/useFriendsIdentityReadiness', () => ({ useFriendsIdentityReadiness: () => ({ isReady: false }) }));

function page(runIds: readonly string[]): WorkflowRunListPage {
    return {
        runs: runIds.map((id) => createWorkflowRunSummaryFixture({ id, state: 'interrupted' })),
        metadataByRunId: {},
        nextCursor: undefined,
    };
}

let latest: InboxSummary | null = null;
function Probe(): null {
    latest = useSharedInboxSummary();
    return null;
}

async function renderSummary() {
    const screen = await renderScreen(<InboxSummaryProvider><Probe /></InboxSummaryProvider>);
    await act(async () => {});
    return screen;
}

describe('useInboxSummary workflow source', () => {
    beforeEach(() => {
        latest = null;
        listRuns.mockReset();
        featureDecisions.workflows = { state: 'enabled' };
        storage.setState({
            friends: {},
            sessions: {},
            sessionListRowsByServerId: {},
            ordinarySessionListMembershipByServerId: {},
            artifacts: {},
            isDataReady: true,
            workflowRunsById: {},
            workflowRunListWindows: {},
        } as never);
    });
    afterEach(() => {
        storage.setState({ workflowRunsById: {}, workflowRunListWindows: {} } as never);
    });

    it("counts the server's attention window in the badge, in the window the Workflows column reads", async () => {
        listRuns.mockResolvedValueOnce(page(['run-held', 'run-interrupted']));

        await renderSummary();

        expect(listRuns).toHaveBeenCalledTimes(1);
        expect(listRuns.mock.calls[0]?.[0].filter).toEqual({ attention: 'required' });
        expect(latest).toEqual({ count: 2, hasContent: true });
        expect(storage.getState().workflowRunListWindows.attention?.runIds).toEqual(['run-held', 'run-interrupted']);
    });

    it('lets an answered off-page hold recede on the next Account-change wake', async () => {
        listRuns.mockResolvedValueOnce(page(['run-held'])).mockResolvedValueOnce(page([]));

        await renderSummary();
        expect(latest?.count).toBe(1);

        await act(async () => {
            publishHomeAccountChange('home-a', ['workflow-run:run-held']);
        });
        await act(async () => {});

        expect(listRuns).toHaveBeenCalledTimes(2);
        expect(latest).toEqual({ count: 0, hasContent: false });
    });

    it('reads nothing and counts nothing when the Home does not offer Workflows', async () => {
        featureDecisions.workflows = { state: 'disabled' };

        await renderSummary();

        expect(listRuns).not.toHaveBeenCalled();
        expect(latest).toEqual({ count: 0, hasContent: false });
    });
});
