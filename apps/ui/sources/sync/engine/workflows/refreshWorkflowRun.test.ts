import { describe, expect, it, vi } from 'vitest';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

const upsertWorkflowRuns = vi.hoisted(() => vi.fn());
const removeWorkflowRun = vi.hoisted(() => vi.fn());
const getWorkflowRunSummary = vi.hoisted(() => vi.fn());
const getRun = vi.hoisted(() => vi.fn());

vi.mock('@/sync/domains/state/storage', () => ({
    storage: { getState: () => ({ upsertWorkflowRuns, removeWorkflowRun }) },
}));
vi.mock('@/sync/domains/workflows/workflowRunListActions', () => ({
    getWorkflowRunSummary: (...args: readonly unknown[]) => getWorkflowRunSummary(...args),
}));
vi.mock('@/sync/domains/workflows/workflowRunDetailActions', () => ({
    workflowRunDetailActions: { getRun: (...args: readonly unknown[]) => getRun(...args) },
}));

const { refreshWorkflowRunById } = await import('./refreshWorkflowRun');

describe('refreshWorkflowRunById lean background refresh', () => {
    it('reads the exact Run through the lean summary projection, never full detail', async () => {
        upsertWorkflowRuns.mockClear();
        getRun.mockClear();
        getWorkflowRunSummary.mockClear();
        getWorkflowRunSummary.mockResolvedValue({
            run: createWorkflowRunSummaryFixture({ id: 'run-1' }),
            metadata: { kind: 'available', value: { title: 'Review 500 files' } },
        });

        await refreshWorkflowRunById('run-1');

        expect(getWorkflowRunSummary).toHaveBeenCalledWith('run-1', undefined);
        // Full `workflow.run.get` pages invocations and opens every progress
        // envelope to recompute usage. Background invalidation must never pay
        // that history-proportional cost; explicit Run detail keeps it.
        expect(getRun).not.toHaveBeenCalled();
        expect(upsertWorkflowRuns.mock.calls[0]?.[0]?.[0]?.metadata)
            .toEqual({ kind: 'available', value: { title: 'Review 500 files' } });
    });

    it('keeps a readable but unnamed Run unnamed rather than claiming it cannot be opened', async () => {
        upsertWorkflowRuns.mockClear();
        getWorkflowRunSummary.mockClear();
        // The sparse sidecar omits the key when the snapshot opened cleanly and
        // simply carries no authored title. Projecting that as `unavailable`
        // locked the row in the collection and in every Session card.
        getWorkflowRunSummary.mockResolvedValue({
            run: createWorkflowRunSummaryFixture({ id: 'run-1' }),
            metadata: null,
        });

        await refreshWorkflowRunById('run-1');

        expect(upsertWorkflowRuns.mock.calls[0]?.[0]?.[0]?.metadata).toBeNull();
    });

    it('reports genuinely unopened accepted content as unavailable', async () => {
        upsertWorkflowRuns.mockClear();
        getWorkflowRunSummary.mockClear();
        getWorkflowRunSummary.mockResolvedValue({
            run: createWorkflowRunSummaryFixture({ id: 'run-1' }),
            metadata: { kind: 'unavailable' },
        });

        await refreshWorkflowRunById('run-1');

        expect(upsertWorkflowRuns.mock.calls[0]?.[0]?.[0]?.metadata).toEqual({ kind: 'unavailable' });
    });

    it('removes the row when the lean read reports the Run deleted', async () => {
        upsertWorkflowRuns.mockClear();
        removeWorkflowRun.mockClear();
        getWorkflowRunSummary.mockClear();
        const { WorkflowActionError } = await import('@/sync/domains/workflows/workflowActionError');
        getWorkflowRunSummary.mockRejectedValue(
            new WorkflowActionError({ message: 'Missing', rawCode: 'run_not_found' }),
        );

        await refreshWorkflowRunById('run-1');

        expect(removeWorkflowRun).toHaveBeenCalledWith('run-1');
        expect(upsertWorkflowRuns).not.toHaveBeenCalled();
    });
});
