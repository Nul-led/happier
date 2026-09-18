import { describe, expect, it } from 'vitest';

import {
    createAutomationRunFixture,
    createWorkflowInvocationIndexFixture,
    createWorkflowRunSummaryFixture,
} from '@/dev/testkit/fixtures/workflowRunFixtures';
import type { AutomationDefinitionRun } from '@/sync/domains/automations/automationTypes';

import {
    createWorkflowRunsDomain,
    mergeWorkflowRunBodies,
    releaseWorkflowRunBodies,
    resolveAutomationRunProjections,
    resolveWorkflowRunRows,
    workflowRunRowFromAutomationRun,
    workflowRunRowFromSummary,
} from './workflowRuns';

type State = ReturnType<typeof createWorkflowRunsDomain>;

function createHarness(): { state: State; get: () => State } {
    let state = {} as State;
    const get = () => state;
    const set = (updater: (draft: State) => State) => {
        state = updater(state);
    };
    state = createWorkflowRunsDomain({ get, set } as never);
    return { state, get };
}

function automationRun(input: Readonly<{
    id: string;
    automationId?: string;
    revision?: number;
    state?: AutomationDefinitionRun['state'];
    updatedAt?: number;
}>): AutomationDefinitionRun {
    return createAutomationRunFixture({
        id: input.id,
        ...(input.automationId === undefined ? {} : { automationId: input.automationId }),
        ...(input.revision === undefined ? {} : { revision: input.revision }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
}

function summary(input: Readonly<{
    id: string;
    revision?: number;
    state?: 'queued' | 'running' | 'succeeded' | 'failed' | 'paused' | 'interrupted';
    origin?: 'automation' | 'direct';
    updatedAt?: string;
}>) {
    return createWorkflowRunSummaryFixture({
        id: input.id,
        ...(input.revision === undefined ? {} : { revision: input.revision }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
        ...(input.origin === 'direct'
            ? { origin: { kind: 'direct' as const } }
            : {}),
    });
}

describe('workflow run body store', () => {
    it('starts empty', () => {
        expect(createHarness().get().workflowRunsById).toEqual({});
        expect(createHarness().get().workflowRunListWindows).toEqual({});
    });

    it('keeps paged collection membership as ids beside the shared bodies', () => {
        const harness = createHarness();
        const first = summary({ id: 'run-1' });
        const second = summary({ id: 'run-2' });

        harness.get().applyWorkflowRunListPage({
            windowId: 'attention', runs: [first], nextCursor: 'next', mode: 'replace',
        });
        harness.get().applyWorkflowRunListPage({
            windowId: 'attention', runs: [second, first], nextCursor: null, mode: 'append',
        });

        expect(harness.get().workflowRunListWindows.attention).toEqual({
            runIds: ['run-1', 'run-2'], nextCursor: null, loaded: true,
        });
        expect(resolveWorkflowRunRows(
            harness.get().workflowRunsById,
            harness.get().workflowRunListWindows.attention!.runIds,
        ).map((row) => row.id)).toEqual(['run-1', 'run-2']);
    });

    it('upserts an exact off-page invocation without replacing loaded history', () => {
        const harness = createHarness();
        const first = createWorkflowInvocationIndexFixture({ id: 'invocation-1', sequence: '1' });
        const second = createWorkflowInvocationIndexFixture({ id: 'invocation-2', sequence: '2' });
        const exact = createWorkflowInvocationIndexFixture({
            id: 'invocation-off-page',
            sequence: '99',
            lifecycle: 'waiting_for_approval',
        });

        harness.get().applyWorkflowRunInvocationPage({
            runId: 'run-1',
            invocations: [first, second],
            nextCursor: 'page-2',
            parentRevision: 4,
            mode: 'replace',
        });
        harness.get().upsertWorkflowRunInvocation({
            runId: 'run-1',
            invocation: exact,
            parentRevision: 7,
        });

        expect(harness.get().workflowRunInvocationsByRunId['run-1']).toEqual({
            invocations: [first, second, exact],
            nextCursor: 'page-2',
            parentRevision: 7,
            loaded: true,
        });
    });

    it('retains a 500-row paged history without introducing a UI product limit', () => {
        const harness = createHarness();
        for (let page = 0; page < 5; page += 1) {
            harness.get().applyWorkflowRunListPage({
                windowId: 'all',
                runs: Array.from({ length: 100 }, (_unused, offset) => summary({ id: `run-${page * 100 + offset}` })),
                nextCursor: page === 4 ? null : `page-${page + 1}`,
                mode: page === 0 ? 'replace' : 'append',
            });
        }
        expect(harness.get().workflowRunListWindows.all?.runIds).toHaveLength(500);
        expect(Object.keys(harness.get().workflowRunsById)).toHaveLength(500);
    });

    it('resolves an exact Run by runId alone, with no origin window loaded', () => {
        const harness = createHarness();
        // A Run whose origin Automation this client has never listed. The row
        // owner is keyed by `runId`, so an exact read reaches it without the
        // caller supplying (or knowing) an `automationId`.
        const row = workflowRunRowFromSummary(summary({ id: 'run-exact', origin: 'direct' }));

        harness.get().upsertWorkflowRuns([row]);

        expect(harness.get().workflowRunsById['run-exact']).toBe(row);
        expect(resolveWorkflowRunRows(harness.get().workflowRunsById, ['run-exact'])).toEqual([row]);
    });

    it('keeps both transport projections on one row instead of overwriting one with the other', () => {
        const harness = createHarness();
        const rest = automationRun({ id: 'run-1', revision: 2, state: 'running' });
        const action = summary({ id: 'run-1', revision: 3, state: 'interrupted' });

        harness.get().upsertWorkflowRuns([workflowRunRowFromAutomationRun(rest)]);
        harness.get().upsertWorkflowRuns([workflowRunRowFromSummary(action)]);

        const row = harness.get().workflowRunsById['run-1']!;
        // The workflow Action carries `interrupted`, which the Automation state
        // vocabulary cannot express, and the Automation projection carries
        // trigger/dispatch facts the Action does not. Neither is discarded.
        expect(row.summary).toBe(action);
        expect(row.automation).toBe(rest);
        expect(row.revision).toBe(3);
    });

    it('advances each projection independently by its own revision', () => {
        const harness = createHarness();
        const staleRest = automationRun({ id: 'run-1', revision: 5, state: 'running' });
        harness.get().upsertWorkflowRuns([
            workflowRunRowFromAutomationRun(staleRest),
            workflowRunRowFromSummary(summary({ id: 'run-1', revision: 5 })),
        ]);

        // A delayed Automation page at an older revision must not regress the
        // stored projection, and must not touch the workflow projection at all.
        harness.get().upsertWorkflowRuns([
            workflowRunRowFromAutomationRun(automationRun({ id: 'run-1', revision: 4, state: 'queued' })),
        ]);
        expect(harness.get().workflowRunsById['run-1']?.automation).toBe(staleRest);

        const fresherRest = automationRun({ id: 'run-1', revision: 6, state: 'succeeded' });
        harness.get().upsertWorkflowRuns([workflowRunRowFromAutomationRun(fresherRest)]);
        const row = harness.get().workflowRunsById['run-1']!;
        expect(row.automation).toBe(fresherRest);
        expect(row.summary?.revision).toBe(5);
        expect(row.revision).toBe(6);
    });

    it('retains the stored row when a refresh restates the same revision', () => {
        const harness = createHarness();
        const row = workflowRunRowFromSummary(summary({ id: 'run-1', revision: 4 }));
        harness.get().upsertWorkflowRuns([row]);

        harness.get().upsertWorkflowRuns([workflowRunRowFromSummary(summary({ id: 'run-1', revision: 4 }))]);

        expect(harness.get().workflowRunsById['run-1']).toBe(row);
    });

    it('does not let an older delayed list replace newer exact private metadata', () => {
        const harness = createHarness();
        const exact = summary({ id: 'run-1', revision: 5, updatedAt: '2026-09-08T10:00:05.000Z' });
        const delayed = summary({ id: 'run-1', revision: 4, updatedAt: '2026-09-08T10:00:04.000Z' });
        const available = { kind: 'available' as const, value: { title: 'Frozen exact title' } };

        harness.get().upsertWorkflowRuns([workflowRunRowFromSummary(exact, available)]);
        harness.get().applyWorkflowRunListPage({
            windowId: 'all',
            runs: [delayed],
            metadataByRunId: { 'run-1': { kind: 'unavailable' } },
            nextCursor: null,
            mode: 'replace',
        });

        expect(harness.get().workflowRunsById['run-1']?.summary).toBe(exact);
        expect(harness.get().workflowRunsById['run-1']?.metadata).toBe(available);
    });

    it('upgrades unavailable private metadata when an equal-revision read can open it', () => {
        const harness = createHarness();
        const listed = summary({ id: 'run-1', revision: 5, updatedAt: '2026-09-08T10:00:05.000Z' });
        const exact = summary({ id: 'run-1', revision: 5, updatedAt: '2026-09-08T10:00:04.000Z' });
        const available = { kind: 'available' as const, value: { title: 'Frozen exact title' } };

        harness.get().upsertWorkflowRuns([
            workflowRunRowFromSummary(listed, { kind: 'unavailable' }),
        ]);
        harness.get().upsertWorkflowRuns([workflowRunRowFromSummary(exact, available)]);

        expect(harness.get().workflowRunsById['run-1']?.summary).toBe(listed);
        expect(harness.get().workflowRunsById['run-1']?.metadata).toBe(available);
    });

    it('keeps private metadata when a newer control summary does not carry that projection', () => {
        const harness = createHarness();
        const available = { kind: 'available' as const, value: { title: 'Frozen exact title' } };

        harness.get().upsertWorkflowRuns([
            workflowRunRowFromSummary(summary({ id: 'run-1', revision: 5 }), available),
        ]);
        harness.get().upsertWorkflowRuns([
            workflowRunRowFromSummary(summary({ id: 'run-1', revision: 6, state: 'paused' })),
        ]);

        expect(harness.get().workflowRunsById['run-1']?.summary?.revision).toBe(6);
        expect(harness.get().workflowRunsById['run-1']?.metadata).toBe(available);
    });

    it('preserves the map identity when nothing changed', () => {
        const previous = { 'run-1': workflowRunRowFromSummary(summary({ id: 'run-1', revision: 2 })) };

        const next = mergeWorkflowRunBodies(previous, [
            workflowRunRowFromSummary(summary({ id: 'run-1', revision: 2 })),
        ]);

        expect(next).toBe(previous);
    });

    it('orders by the projection carrying the newest revision', () => {
        const harness = createHarness();
        harness.get().upsertWorkflowRuns([
            workflowRunRowFromAutomationRun(automationRun({ id: 'run-1', revision: 1, updatedAt: 10 })),
        ]);
        harness.get().upsertWorkflowRuns([
            workflowRunRowFromSummary(summary({ id: 'run-1', revision: 2, updatedAt: '2026-09-08T10:00:05.000Z' })),
        ]);

        expect(harness.get().workflowRunsById['run-1']?.updatedAt).toBe(Date.parse('2026-09-08T10:00:05.000Z'));
    });

    it('releases only the released rows no other window still references', () => {
        const previous = {
            'run-a': workflowRunRowFromAutomationRun(automationRun({ id: 'run-a' })),
            'run-b': workflowRunRowFromAutomationRun(automationRun({ id: 'run-b' })),
            // Held by an exact read rather than the released window.
            'run-exact': workflowRunRowFromSummary(summary({ id: 'run-exact', origin: 'direct' })),
        };

        const next = releaseWorkflowRunBodies({
            runsById: previous,
            releasedRunIds: ['run-a', 'run-b'],
            retainedRunIds: new Set(['run-b']),
        });

        expect(Object.keys(next).sort()).toEqual(['run-b', 'run-exact']);
    });

    it('releases an Automation projection without deleting the same Run read through workflow Actions', () => {
        const metadata = { kind: 'available' as const, value: { title: 'Frozen shared title' } };
        const exact = workflowRunRowFromSummary(
            summary({ id: 'run-shared', origin: 'direct', revision: 3 }),
            metadata,
        );
        const automation = workflowRunRowFromAutomationRun(automationRun({ id: 'run-shared', revision: 2 }));
        const previous = mergeWorkflowRunBodies(
            mergeWorkflowRunBodies({}, [exact]),
            [automation],
        );

        const next = releaseWorkflowRunBodies({
            runsById: previous,
            releasedRunIds: ['run-shared'],
            retainedRunIds: new Set(),
        });

        expect(next['run-shared']?.summary).toBe(exact.summary);
        expect(next['run-shared']?.metadata).toBe(metadata);
        expect(next['run-shared']?.automation).toBeNull();
        expect(next['run-shared']?.revision).toBe(3);
    });

    it('projects only Automation-backed rows into an Automation window', () => {
        const runsById = {
            'run-a': workflowRunRowFromAutomationRun(automationRun({ id: 'run-a' })),
            // Seen only through a workflow Action: it has no Automation
            // projection, so it must not appear in an Automation history with
            // half its fields missing.
            'run-b': workflowRunRowFromSummary(summary({ id: 'run-b' })),
        };

        expect(resolveAutomationRunProjections(runsById, ['run-a', 'run-b', 'missing']))
            .toEqual([runsById['run-a']!.automation]);
    });
});
