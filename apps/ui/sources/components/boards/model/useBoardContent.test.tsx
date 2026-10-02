import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorkBoardItemKeyV1, createWorkBoardV1, normalizeSessionListFilterV1 } from '@happier-dev/protocol';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { storage } from '@/sync/domains/state/storageStore';
import { useBoardMembership, type BoardHomes } from './useBoardContent';
import { resolveBoardPruneMembership } from './boardMembership';

const execute = vi.hoisted(() => vi.fn());
// The Action executor is the transport boundary. The list client, window, shared Run store,
// normalization, predicate and Board projection all execute their real implementations.
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({ createFrontDoorActionExecute: () => execute }));
vi.mock('@/sync/runtime/orchestration/connectionManager', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/connectionManager')>(),
    getAppliedActiveServerSnapshot: () => appliedSnapshot(),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));
// Markdown is a third-party rendering boundary; membership never renders it.
vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({ splitStreamingRevealTextParts: () => [] }));

let appliedSnapshot: typeof import('@/sync/domains/server/serverRuntime')['getActiveServerSnapshot'];
let previousState = storage.getState();
let homes: BoardHomes;
beforeEach(async () => {
    previousState = storage.getState();
    const runtime = await import('@/sync/domains/server/serverRuntime');
    appliedSnapshot = runtime.getActiveServerSnapshot;
    const profile = await runtime.upsertAndActivateServer({ serverUrl: 'http://board-runs.test', name: 'Board Home' });
    storage.setState({ profileScope: { serverId: profile.id, accountId: 'account-a' },
        workflowRunsById: {}, workflowRunListWindows: {} });
    homes = { activeServerId: profile.id, mountedServerIds: [profile.id], isHomeMounted: (id) => id === profile.id };
});
afterEach(async () => {
    standardCleanup();
    (await import('@/components/workflows/library/workflowLibraryReads')).resetWorkflowLibraryReadsForTests();
    (await import('@/sync/domains/scope/activeServerAccountScope')).retireActiveServerAccountScopeLifetime();
    execute.mockReset();
    storage.setState(previousState);
});

function runsBoard(startedBy: readonly ('you' | 'agents' | 'triggers')[] = []) {
    return { ...createWorkBoardV1({ id: 'board-runs', name: 'Runs' }), source: { picked: [],
        filter: normalizeSessionListFilterV1({ show: 'runs', startedBy, homeServerIds: homes.mountedServerIds }),
    } };
}

describe('Board shared Run filter membership', () => {
    it('treats an answered empty Run window as complete', async () => {
        execute.mockResolvedValue({ ok: true, result: { runs: [], metadataByRunId: {} } });
        const board = runsBoard(['you']);
        const hook = await renderHook(() => useBoardMembership(board, homes));
        expect(hook.getCurrent().members).toEqual([]);
        expect(hook.getCurrent().complete).toBe(true);
    });

    it('uses the shared starter and attention rule, deduplicates picks, and retains membership identity on unrelated writes', async () => {
        const waiting = createWorkflowRunSummaryFixture({ id: 'waiting', startedBy: 'trigger', attentionRequired: true });
        const user = createWorkflowRunSummaryFixture({ id: 'user', startedBy: 'user' });
        const agent = createWorkflowRunSummaryFixture({ id: 'agent', startedBy: 'agent' });
        execute.mockResolvedValue({ ok: true, result: { runs: [waiting, user, agent], metadataByRunId: {} } });
        const initial = runsBoard(['you']);
        const board = { ...initial, source: { ...initial.source, picked: [
            { kind: 'workflow_run', qualifiedId: { serverId: homes.activeServerId!, id: 'waiting' } } as const,
        ] } };
        const hook = await renderHook(() => useBoardMembership(board, homes));
        expect(hook.getCurrent().members.map((member) => member.ref.qualifiedId.id)).toEqual(['waiting', 'user']);
        expect(hook.getCurrent().members[0]?.picked).toBe(true);
        expect(hook.getCurrent().complete).toBe(true);
        const membership = hook.getCurrent();
        act(() => { storage.setState({ workflowRunsById: { ...storage.getState().workflowRunsById,
            unrelated: { ...storage.getState().workflowRunsById.user!, id: 'unrelated' },
        } }); });
        expect(hook.getCurrent()).toBe(membership);
    });

    it('preserves partial Run membership and refuses to certify a paged window as complete', async () => {
        const first = createWorkflowRunSummaryFixture({ id: 'first', startedBy: 'user' });
        execute.mockResolvedValue({ ok: true, result: { runs: [first], metadataByRunId: {}, nextCursor: 'page-two' } });
        const board = runsBoard(['you']);
        const hook = await renderHook(() => useBoardMembership(board, homes));
        expect(hook.getCurrent().members.map((member) => member.ref.qualifiedId.id)).toEqual(['first']);
        expect(hook.getCurrent().complete).toBe(false);
        expect(execute.mock.calls.filter(([id]) => id === 'workflow.run.list')).toHaveLength(1);
    });

    it('preserves placed Runs from a mounted Home not served by the active Home window', async () => {
        const { upsertServerProfileOnly } = await import('@/sync/domains/server/serverRuntime');
        const other = await upsertServerProfileOnly({ serverUrl: 'http://board-runs-second.test', name: 'Second Board Home' });
        const mountedServerIds = [homes.activeServerId!, other.id];
        homes = { ...homes, mountedServerIds, isHomeMounted: (id) => mountedServerIds.includes(id) };
        const inactiveKey = buildWorkBoardItemKeyV1({
            kind: 'workflow_run', qualifiedId: { serverId: other.id, id: 'inactive-run' },
        });
        const board = { ...runsBoard(['you']), positionsByItemRef: { [inactiveKey]: { x: 12, y: 34 } } };
        execute.mockResolvedValue({ ok: true, result: {
            runs: [createWorkflowRunSummaryFixture({ id: 'active-run', startedBy: 'user' })], metadataByRunId: {},
        } });
        const hook = await renderHook(() => useBoardMembership(board, homes));
        const membership = hook.getCurrent();
        expect(membership.members.map((member) => member.ref.qualifiedId.id)).toEqual(['active-run']);
        expect(resolveBoardPruneMembership(board, membership, homes.isHomeMounted).liveItemKeys).toContain(inactiveKey);
        expect(membership.complete).toBe(false);
    });

    it('retires Account-A membership while Account B loads through the same window owner', async () => {
        const old = createWorkflowRunSummaryFixture({ id: 'old', startedBy: 'user' });
        execute.mockResolvedValueOnce({ ok: true, result: { runs: [old], metadataByRunId: {} } });
        const board = runsBoard(['you']);
        const hook = await renderHook(() => useBoardMembership(board, homes));
        expect(hook.getCurrent().members.map((member) => member.ref.qualifiedId.id)).toEqual(['old']);
        const pending = createDeferred<unknown>();
        execute.mockReturnValueOnce(pending.promise);
        act(() => { storage.setState({ profileScope: { serverId: homes.activeServerId!, accountId: 'account-b' },
            workflowRunListWindows: {}, workflowRunsById: {} }); });
        expect(hook.getCurrent().members).toEqual([]);
        expect(hook.getCurrent().complete).toBe(false);
        await act(async () => { pending.resolve({ ok: true, result: { runs: [], metadataByRunId: {} } }); await pending.promise; });
        expect(hook.getCurrent().complete).toBe(true);
    });
});
