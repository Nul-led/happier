import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderScreen, standardCleanup } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import type {
    WorkflowDefinitionGetResultV1,
    WorkflowDefinitionListResultV1,
} from '@happier-dev/protocol';
import type { WorkflowRunListPage } from '@/sync/domains/workflows/workflowRunListActions';

type WorkflowsScreenProps = React.ComponentProps<typeof import('./WorkflowsScreen').WorkflowsScreen>;
type ListWorkflowDefinitions = typeof import('@/sync/domains/workflows/workflowDefinitionActions').listWorkflowDefinitions;
type GetWorkflowDefinition = typeof import('@/sync/domains/workflows/workflowDefinitionActions').getWorkflowDefinition;
type DeleteWorkflowDefinition = typeof import('@/sync/domains/workflows/workflowDefinitionActions').deleteWorkflowDefinition;
type ListWorkflowRuns = typeof import('@/sync/domains/workflows/workflowRunListActions').listWorkflowRuns;

const navigation = vi.hoisted(() => ({
    push: vi.fn(),
}));

const modalBoundary = vi.hoisted(() => ({
    confirm: vi.fn(async () => true),
}));

const fileBoundary = vi.hoisted(() => ({
    save: vi.fn(async () => {}),
}));

const storageState = vi.hoisted(() => ({
    workflowRunListWindows: {
        attention: { loaded: true, runIds: [], nextCursor: null },
    } as Partial<Record<'all' | 'active' | 'attention', {
        loaded: boolean;
        runIds: string[];
        nextCursor: string | null;
    }>>,
    workflowRunsById: {} as Record<string, { summary: ReturnType<typeof createWorkflowRunSummaryFixture> }>,
    applyWorkflowRunListPage: vi.fn(),
}));

const screenBoundary = vi.hoisted(() => ({
    props: null as WorkflowsScreenProps | null,
}));

/** The Account's own Automation projection: the one safe name a Run row has. */
const automationsState = vi.hoisted(() => ({
    value: [] as Array<{
        id: string;
        name: string;
        detail: { kind: 'unloaded' | 'available' | 'unavailable' };
    }>,
}));

const accountScope = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const state = {
        current: { serverId: 'server-a', accountId: 'account-a' } as { serverId: string; accountId: string } | null,
    };
    return {
        state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        switchTo(next: { serverId: string; accountId: string } | null) {
            state.current = next;
            for (const listener of listeners) listener();
        },
    };
});

const workflowActions = vi.hoisted(() => ({
    listDefinitions: vi.fn<ListWorkflowDefinitions>(async () => ({ definitions: [], nextCursor: undefined })),
    listRuns: vi.fn<ListWorkflowRuns>(async () => ({ runs: [], nextCursor: undefined })),
    getDefinition: vi.fn<GetWorkflowDefinition>(),
    deleteDefinition: vi.fn<DeleteWorkflowDefinition>(async (params) => ({ deleted: true, definitionId: params.definitionId })),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: modalBoundary.confirm } }).module;
});

vi.mock('@/sync/domains/workflows/workflowDocumentFile', () => ({
    saveWorkflowDocument: fileBoundary.save,
    workflowDocumentFileName: (name: string) => `${name}.workflow.json`,
}));

vi.mock('expo-router', () => ({
    useRouter: () => navigation,
}));

vi.mock('@/sync/domains/state/storage', () => ({
    getStorage: () => Object.assign(
        (selector: (state: typeof storageState) => unknown) => selector(storageState),
        { getState: () => storageState },
    ),
    // The collection reads only the visible window's rows, never the Account's
    // whole Run map.
    useWorkflowRunRows: (runIds: readonly string[]) => runIds.flatMap((runId) => {
        const row = storageState.workflowRunsById[runId];
        // A real row carries its own id; this fake keeps bodies by key.
        return row ? [{ ...row, id: runId }] : [];
    }),
    useAllMachines: () => [],
    useAutomations: () => automationsState.value,
    useActiveServerAccountScope: () => React.useSyncExternalStore(
        accountScope.subscribe,
        () => accountScope.state.current,
        () => accountScope.state.current,
    ),
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => {
        const captured = accountScope.state.current;
        return captured === null ? null : {
            scope: captured,
            isCurrent: () => accountScope.state.current?.serverId === captured.serverId
                && accountScope.state.current?.accountId === captured.accountId,
            onRetire: () => ({ dispose() {} }),
        };
    },
}));

vi.mock('@/sync/domains/workflows/workflowDefinitionActions', () => ({
    listWorkflowDefinitions: workflowActions.listDefinitions,
    getWorkflowDefinition: workflowActions.getDefinition,
    deleteWorkflowDefinition: workflowActions.deleteDefinition,
}));

vi.mock('@/sync/domains/workflows/workflowRunListActions', () => ({
    WORKFLOW_RUN_LIST_FILTERS: [],
    buildWorkflowRunListFilter: (filter: string) => ({ filter }),
    listWorkflowRuns: workflowActions.listRuns,
}));

vi.mock('@/sync/domains/workflows/workflowRunListInvalidation', () => ({
    subscribeVisibleWorkflowRunListInvalidation: vi.fn(),
}));

vi.mock('./WorkflowsScreen', () => ({
    WorkflowsScreen: (props: WorkflowsScreenProps) => {
        screenBoundary.props = props;
        return React.createElement('WorkflowsScreen', props);
    },
}));

afterEach(async () => {
    await standardCleanup();
    navigation.push.mockClear();
    screenBoundary.props = null;
    accountScope.switchTo({ serverId: 'server-a', accountId: 'account-a' });
    storageState.workflowRunListWindows = {
        attention: { loaded: true, runIds: [], nextCursor: null },
    };
    storageState.workflowRunsById = {};
    automationsState.value = [];
    storageState.applyWorkflowRunListPage.mockReset();
    workflowActions.listDefinitions.mockReset();
    workflowActions.listDefinitions.mockResolvedValue({ definitions: [], nextCursor: undefined });
    workflowActions.listRuns.mockReset();
    workflowActions.listRuns.mockResolvedValue({ runs: [], nextCursor: undefined });
    workflowActions.getDefinition.mockReset();
    workflowActions.deleteDefinition.mockClear();
    modalBoundary.confirm.mockClear();
    modalBoundary.confirm.mockResolvedValue(true);
    fileBoundary.save.mockClear();
});

describe('WorkflowsHostScreen navigation continuity', () => {
    it('treats route intent as initial state and keeps view/filter state in the mounted stack entry', async () => {
        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        const screen = await renderScreen(React.createElement(WorkflowsHostScreen, { initialView: 'runs' }));

        expect(screenBoundary.props).toMatchObject({ view: 'runs', runsFilter: 'all' });

        await act(async () => {
            (screenBoundary.props?.onChangeRunsFilter as (filter: string) => void)('attention');
        });
        await act(async () => {
            (screenBoundary.props?.onOpenRun as (runId: string) => void)('run-exact');
        });

        expect(navigation.push).toHaveBeenCalledWith({
            pathname: '/workflows/runs/[runId]',
            params: { runId: 'run-exact' },
        });

        // A stack push does not remount the previous entry. Updating route intent
        // therefore must not overwrite the user's transient collection state when
        // that entry becomes visible again after Back.
        await screen.update(React.createElement(WorkflowsHostScreen, { initialView: 'saved' }));
        expect(screenBoundary.props).toMatchObject({ view: 'runs', runsFilter: 'attention' });
    });

    it('opens an exact saved definition without encoding collection state in the URL', async () => {
        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen));

        await act(async () => {
            (screenBoundary.props?.onOpenDefinition as (definitionId: string) => void)('definition-exact');
        });

        expect(navigation.push).toHaveBeenCalledWith({
            pathname: '/workflows/[id]',
            params: { id: 'definition-exact' },
        });
    });

    it('preserves Edit, Run now and Schedule as three distinct intents on one saved row', async () => {
        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen));

        for (const action of ['onEditDefinition', 'onRunDefinition', 'onScheduleDefinition'] as const) {
            await act(async () => {
                (screenBoundary.props?.[action] as (definitionId: string) => void)('definition-exact');
            });
        }

        // Edit opens the definition editor at that revision and nothing else.
        expect(navigation.push).toHaveBeenNthCalledWith(1, {
            pathname: '/workflows/[id]',
            params: { id: 'definition-exact' },
        });
        // Run now and Schedule carry their own intent to the one editor owner,
        // which reviews the exact revision and then presses its own canonical
        // Run-now / Schedule action. The collection itself neither admits a Run
        // nor writes an Automation, and the three intents are never one route.
        expect(navigation.push).toHaveBeenNthCalledWith(2, {
            pathname: '/workflows/[id]',
            params: { id: 'definition-exact', intent: 'run' },
        });
        expect(navigation.push).toHaveBeenNthCalledWith(3, {
            pathname: '/workflows/[id]',
            params: { id: 'definition-exact', intent: 'schedule' },
        });
    });

    it('synchronously retires saved content and refetches on a same-server Account switch', async () => {
        const accountB = createDeferred<WorkflowDefinitionListResultV1>();
        workflowActions.listDefinitions
            .mockResolvedValueOnce({
                definitions: [{
                    kind: 'workflow-definition.v1',
                    definitionId: 'shared-id',
                    revision: { headerVersion: 1, bodyVersion: 1 },
                    metadata: { title: 'Account A private title' },
                }],
                nextCursor: 'account-a-private-cursor',
            })
            .mockImplementationOnce(() => accountB.promise);

        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        const screen = await renderScreen(React.createElement(WorkflowsHostScreen));
        await act(async () => {});
        expect(screenBoundary.props?.savedDefinitions).toEqual([
            expect.objectContaining({ metadata: { title: 'Account A private title' } }),
        ]);
        expect(screenBoundary.props?.hasMoreSaved).toBe(true);

        await act(async () => {
            accountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
        });

        expect(screenBoundary.props?.savedDefinitions).toEqual([]);
        expect(screenBoundary.props?.hasMoreSaved).toBe(false);
        expect(workflowActions.listDefinitions).toHaveBeenCalledTimes(2);

        accountB.resolve({
            definitions: [{
                kind: 'workflow-definition.v1',
                definitionId: 'shared-id',
                revision: { headerVersion: 1, bodyVersion: 1 },
                metadata: { title: 'Account B private title' },
            }],
            nextCursor: undefined,
        });
        await act(async () => {});
        expect(screenBoundary.props?.savedDefinitions).toEqual([
            expect.objectContaining({ metadata: { title: 'Account B private title' } }),
        ]);
    });

    it('names Run rows from the Account projection instead of calling every row unavailable', async () => {
        const automationRun = createWorkflowRunSummaryFixture({
            id: 'run-scheduled', state: 'running', origin: { kind: 'automation', automationId: 'automation-1' },
        });
        const lockedRun = createWorkflowRunSummaryFixture({
            id: 'run-locked', state: 'running', origin: { kind: 'automation', automationId: 'automation-locked' },
        });
        const directRun = createWorkflowRunSummaryFixture({
            id: 'run-direct', state: 'running', origin: { kind: 'direct' },
        });
        workflowActions.listRuns.mockResolvedValue({
            runs: [automationRun, lockedRun, directRun],
            metadataByRunId: {
                'run-scheduled': { kind: 'available', value: { title: 'Release check' } },
                'run-locked': { kind: 'unavailable' },
            },
            nextCursor: undefined,
        });
        storageState.applyWorkflowRunListPage.mockImplementation((page: {
            windowId: 'all' | 'active' | 'attention';
            runs: readonly ReturnType<typeof createWorkflowRunSummaryFixture>[];
            metadataByRunId?: Readonly<Record<string, unknown>>;
            nextCursor: string | null;
        }) => {
            storageState.workflowRunListWindows[page.windowId] = {
                loaded: true, runIds: page.runs.map((run) => run.id), nextCursor: page.nextCursor,
            };
            for (const run of page.runs) storageState.workflowRunsById[run.id] = {
                summary: run,
                metadata: page.metadataByRunId?.[run.id] ?? null,
            };
        });

        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen, { initialView: 'runs' }));
        await act(async () => {});

        const resolve = screenBoundary.props?.resolveRunDisplayName as (runId: string) => unknown;
        expect(resolve).toBeTypeOf('function');
        expect(resolve('run-scheduled')).toEqual({ kind: 'name', value: 'Release check' });
        // Only a genuinely unopenable accepted envelope is unavailable.
        expect(resolve('run-locked')).toEqual({ kind: 'unavailable' });
        // A legacy result without a projection remains unknown to this store.
        expect(resolve('run-direct')).toEqual({ kind: 'unknown' });
    });

    it('synchronously retires Run rows and cursors before the new Account page resolves', async () => {
        const runB = createDeferred<WorkflowRunListPage>();
        const summaryA = createWorkflowRunSummaryFixture({ id: 'same-run-id', state: 'running' });
        const summaryB = createWorkflowRunSummaryFixture({ id: 'same-run-id', state: 'succeeded' });
        workflowActions.listRuns
            .mockResolvedValueOnce({ runs: [summaryA], nextCursor: 'account-a-run-cursor' })
            .mockImplementationOnce(() => runB.promise);
        storageState.applyWorkflowRunListPage.mockImplementation((page: {
            windowId: 'all' | 'active' | 'attention';
            runs: readonly ReturnType<typeof createWorkflowRunSummaryFixture>[];
            nextCursor: string | null;
        }) => {
            storageState.workflowRunListWindows[page.windowId] = {
                loaded: true,
                runIds: page.runs.map((run) => run.id),
                nextCursor: page.nextCursor,
            };
            for (const run of page.runs) {
                storageState.workflowRunsById[run.id] = { summary: run };
            }
        });

        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        const screen = await renderScreen(React.createElement(WorkflowsHostScreen, { initialView: 'runs' }));
        await act(async () => {});
        expect(screenBoundary.props?.runs).toEqual([summaryA]);
        expect(screenBoundary.props?.hasMoreRuns).toBe(true);

        await act(async () => {
            accountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
        });
        expect(screenBoundary.props?.runs).toEqual([]);
        expect(screenBoundary.props?.hasMoreRuns).toBe(false);

        runB.resolve({ runs: [summaryB], nextCursor: undefined });
        await act(async () => {});
        expect(screenBoundary.props?.runs).toEqual([summaryB]);
    });

    /**
     * A second page failing must not cost the first page, and the person must
     * be able to ask again. The window keeps its rows and cursor; the failure
     * is a local presentation fact for this Account and filter, and Retry
     * repeats exactly one append.
     */
    it('keeps page one when page two fails and appends it once on Retry', async () => {
        const first = createWorkflowRunSummaryFixture({ id: 'run-first', state: 'running' });
        const second = createWorkflowRunSummaryFixture({ id: 'run-second', state: 'succeeded' });
        workflowActions.listRuns
            .mockResolvedValueOnce({ runs: [first], nextCursor: 'page-two' })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ runs: [second], nextCursor: undefined });
        storageState.applyWorkflowRunListPage.mockImplementation((page: {
            windowId: 'all' | 'active' | 'attention';
            runs: readonly ReturnType<typeof createWorkflowRunSummaryFixture>[];
            nextCursor: string | null;
            mode: 'replace' | 'append';
        }) => {
            const previous = storageState.workflowRunListWindows[page.windowId];
            storageState.workflowRunListWindows[page.windowId] = {
                loaded: true,
                runIds: page.mode === 'append'
                    ? [...(previous?.runIds ?? []), ...page.runs.map((run) => run.id)]
                    : page.runs.map((run) => run.id),
                nextCursor: page.nextCursor,
            };
            for (const run of page.runs) storageState.workflowRunsById[run.id] = { summary: run };
        });

        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen, { initialView: 'runs' }));
        await act(async () => {});
        expect(screenBoundary.props?.runs).toEqual([first]);
        expect(screenBoundary.props?.loadMoreFailed).toBe(false);

        await act(async () => { screenBoundary.props?.onLoadMoreRuns?.(); });
        await act(async () => {});
        expect(screenBoundary.props?.runs).toEqual([first]);
        expect(screenBoundary.props?.hasMoreRuns).toBe(true);
        expect(screenBoundary.props?.loadingMoreRuns).toBe(false);
        expect(screenBoundary.props?.loadMoreFailed).toBe(true);
        expect(screenBoundary.props?.runsState).toBe('loaded');

        await act(async () => { screenBoundary.props?.onRetryLoadMore?.(); });
        await act(async () => {});
        expect(workflowActions.listRuns).toHaveBeenCalledTimes(3);
        expect(workflowActions.listRuns.mock.calls[2]?.[0]).toMatchObject({ cursor: 'page-two' });
        expect(storageState.applyWorkflowRunListPage.mock.calls.filter(([page]) => page.mode === 'append')).toHaveLength(1);
        expect(screenBoundary.props?.runs).toEqual([first, second]);
        expect(screenBoundary.props?.loadMoreFailed).toBe(false);
    });

    it('scopes a paging failure to its window and retires it with the Account', async () => {
        const first = createWorkflowRunSummaryFixture({ id: 'run-first', state: 'running' });
        // Every first page keeps a continuation; only the appends fail.
        workflowActions.listRuns.mockResolvedValue({ runs: [first], nextCursor: 'page-two' });
        storageState.applyWorkflowRunListPage.mockImplementation((page: {
            windowId: 'all' | 'active' | 'attention';
            runs: readonly ReturnType<typeof createWorkflowRunSummaryFixture>[];
            nextCursor: string | null;
        }) => {
            storageState.workflowRunListWindows[page.windowId] = {
                loaded: true, runIds: page.runs.map((run) => run.id), nextCursor: page.nextCursor,
            };
            for (const run of page.runs) storageState.workflowRunsById[run.id] = { summary: run };
        });

        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen, { initialView: 'runs' }));
        await act(async () => {});
        workflowActions.listRuns.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { screenBoundary.props?.onLoadMoreRuns?.(); });
        await act(async () => {});
        expect(screenBoundary.props?.loadMoreFailed).toBe(true);

        // Another filter is another window: its rows are fine.
        await act(async () => {
            (screenBoundary.props?.onChangeRunsFilter as (filter: string) => void)('active');
        });
        await act(async () => {});
        expect(screenBoundary.props?.loadMoreFailed).toBe(false);

        // Coming back reloads the window's first page, which supersedes the
        // failed continuation of the old one.
        await act(async () => {
            (screenBoundary.props?.onChangeRunsFilter as (filter: string) => void)('all');
        });
        await act(async () => {});
        expect(screenBoundary.props?.loadMoreFailed).toBe(false);

        // A failure that is never superseded still belongs to its Account only.
        workflowActions.listRuns.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { screenBoundary.props?.onLoadMoreRuns?.(); });
        await act(async () => {});
        expect(screenBoundary.props?.loadMoreFailed).toBe(true);
        await act(async () => {
            accountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
        });
        expect(screenBoundary.props?.loadMoreFailed).toBe(false);
    });

    it('exports opened Artifact content through the canonical private preview and platform file boundary', async () => {
        const openedDefinition: WorkflowDefinitionGetResultV1 = {
            definitionId: 'definition-exact',
            revision: { headerVersion: 1, bodyVersion: 2 },
            metadata: { title: 'Release check' },
            definition: {
                version: 1,
                inputs: [],
                // A saved Artifact always carries an effective Agent: a definition
                // without one is rejected by the canonical validator, so exporting
                // it could never reach the privacy confirmation.
                defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
                blocks: [{
                    kind: 'step', id: 'review',
                    document: { text: 'Review release', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                }],
            },
        };
        workflowActions.getDefinition.mockResolvedValue(openedDefinition);
        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen));

        await act(async () => {
            await (screenBoundary.props?.onExportDefinition as (definitionId: string) => Promise<void>)('definition-exact');
        });

        expect(workflowActions.getDefinition).toHaveBeenCalledWith({ definitionId: 'definition-exact' });
        expect(modalBoundary.confirm).toHaveBeenCalledTimes(1);
        expect(fileBoundary.save).toHaveBeenCalledWith(expect.objectContaining({
            fileName: 'Release check.workflow.json',
        }));
    });

    it('deletes only the exact saved Artifact after explicit confirmation', async () => {
        workflowActions.listDefinitions.mockResolvedValueOnce({
            definitions: [{
                kind: 'workflow-definition.v1', definitionId: 'definition-exact',
                revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Release check' },
            }],
            nextCursor: undefined,
        });
        const { WorkflowsHostScreen } = await import('./WorkflowsHostScreen');
        await renderScreen(React.createElement(WorkflowsHostScreen));
        await act(async () => {});

        await act(async () => {
            await (screenBoundary.props?.onDeleteDefinition as (definitionId: string) => Promise<void>)('definition-exact');
        });

        expect(modalBoundary.confirm).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ destructive: true }),
        );
        expect(workflowActions.deleteDefinition).toHaveBeenCalledWith({ definitionId: 'definition-exact' });
        expect(screenBoundary.props?.savedDefinitions).toEqual([]);
    });
});
