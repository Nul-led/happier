import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { storage } from '@/sync/domains/state/storageStore';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';
import { useWorkflowRunRows } from '@/sync/store/hooks';

/**
 * The ordered window reader for the one Account-scoped Run row owner.
 *
 * Every Run this Account has ever read shares one map, so a surface that
 * subscribes to the map rerenders for every exact refresh of every other Run —
 * including the ones a Run screen is settling controls on. This reader
 * subscribes to the rows of its own window, which is what keeps an unrelated
 * refresh out of a mounted collection or Session section while a referenced row
 * still updates immediately.
 */

afterEach(async () => {
    await standardCleanup();
});

function seedRuns(): void {
    act(() => {
        storage.getState().upsertWorkflowRuns([
            workflowRunRowFromSummary(
                createWorkflowRunSummaryFixture({ id: 'run-a', state: 'running', revision: 1 }),
                { kind: 'available', value: { title: 'Nightly release' } },
            ),
            workflowRunRowFromSummary(
                createWorkflowRunSummaryFixture({ id: 'run-b', state: 'running', revision: 1 }),
            ),
        ]);
    });
}

describe('useWorkflowRunRows', () => {
    it('keeps an unrelated Run refresh out of a mounted window while a referenced row still updates', async () => {
        const previousState = storage.getState();
        try {
            seedRuns();
            let renders = 0;
            const hook = await renderHook(() => {
                renders += 1;
                return useWorkflowRunRows(['run-a']);
            });
            expect(hook.getCurrent().map((row) => row.id)).toEqual(['run-a']);
            const rendersAfterMount = renders;

            act(() => {
                storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                    createWorkflowRunSummaryFixture({ id: 'run-b', state: 'succeeded', revision: 2 }),
                )]);
            });

            expect(renders).toBe(rendersAfterMount);
            expect(hook.getCurrent().map((row) => row.id)).toEqual(['run-a']);

            act(() => {
                storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                    createWorkflowRunSummaryFixture({ id: 'run-a', state: 'succeeded', revision: 2 }),
                    { kind: 'available', value: { title: 'Nightly release (renamed)' } },
                )]);
            });

            expect(renders).toBe(rendersAfterMount + 1);
            const [row] = hook.getCurrent();
            expect(row?.summary?.state).toBe('succeeded');
            expect(row?.metadata).toEqual({
                kind: 'available',
                value: { title: 'Nightly release (renamed)' },
            });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('skips a window id with no loaded body rather than rendering a placeholder row', async () => {
        const previousState = storage.getState();
        try {
            seedRuns();
            const hook = await renderHook(() => useWorkflowRunRows(['run-a', 'run-never-read']));

            expect(hook.getCurrent().map((row) => row.id)).toEqual(['run-a']);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
