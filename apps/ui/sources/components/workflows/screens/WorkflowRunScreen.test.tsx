import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createDeferred, renderScreen, standardCleanup } from '@/dev/testkit';
import {
    createWorkflowDefinitionFixture,
    createWorkflowInvocationIndexFixture,
    createWorkflowRunSummaryFixture,
} from '@/dev/testkit/fixtures/workflowRunFixtures';
import type { WorkflowRunNowRequest } from '../run/useWorkflowRunNowController';

type WorkflowRunContentProps = React.ComponentProps<
    typeof import('../run/WorkflowRunContent').WorkflowRunContent
>;

/**
 * Host-level Run detail contracts.
 *
 * These deliberately start from what the screen really builds — a paged public
 * invocation index plus the frozen definition — instead of a hand-injected
 * progress map. A component test that is handed complete private progress
 * cannot decide whether the host can ever produce it.
 */

let latestContentProps: WorkflowRunContentProps | null = null;

const runNowSpy = vi.hoisted(() => vi.fn<(request: WorkflowRunNowRequest) => Promise<unknown>>(async () => null));
const routerSpy = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
const routeState = vi.hoisted(() => ({ runId: 'run-1' }));
const detailActions = vi.hoisted(() => ({
    getRun: vi.fn(),
    listInvocations: vi.fn(),
    getInvocation: vi.fn(),
    resumeRun: vi.fn(),
    restoreWorkspace: vi.fn(),
    retryInvocation: vi.fn(),
    pauseRun: vi.fn(),
    cancelRun: vi.fn(),
    deleteRun: vi.fn(),
}));
const storeState = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const state = {
        workflowRunsById: {} as Record<string, unknown>,
        workflowRunInvocationsByRunId: {} as Record<string, unknown>,
    };
    return {
        state,
        listeners,
        emit(): void { for (const listener of listeners) listener(); },
        reset(): void {
            state.workflowRunsById = {};
            state.workflowRunInvocationsByRunId = {};
        },
    };
});
const reviewedSeedSpy = vi.hoisted(() => vi.fn(() => 'reviewed-seed-id'));
const createWorkflowDefinitionSpy = vi.hoisted(() => vi.fn());
type MachineRpcCall = Readonly<{
    onIssued?: () => void;
    signal?: AbortSignal;
    [key: string]: unknown;
}>;
const machineRpcSpy = vi.hoisted(() => vi.fn<(params: MachineRpcCall) => Promise<unknown>>());
const accountScopeHarness = vi.hoisted(() => {
    type Scope = Readonly<{ serverId: string; accountId: string }>;
    type Retirement = Readonly<{ dispose: () => void }>;
    type Lifetime = Readonly<{
        scope: Scope;
        isCurrent: () => boolean;
        onRetire: (listener: () => void) => Retirement;
    }>;

    let current: Lifetime & { retire: () => void };
    const createLifetime = (scope: Scope): Lifetime & { retire: () => void } => {
        const listeners = new Set<() => void>();
        const lifetime = {
            scope,
            isCurrent: () => current === lifetime,
            onRetire: (listener: () => void) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
            retire: () => {
                for (const listener of listeners) listener();
                listeners.clear();
            },
        };
        return lifetime;
    };
    current = createLifetime({ serverId: 'server-a', accountId: 'account-a' });

    return {
        capture: () => current,
        scope: () => current.scope,
        switchTo(scope: Scope): void {
            current.retire();
            current = createLifetime(scope);
        },
        reset(): void {
            current.retire();
            current = createLifetime({ serverId: 'server-a', accountId: 'account-a' });
        },
    };
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    // Run again really does repeat effects, so it is confirmed. These cases are
    // about what the confirmed repeat carries, not about the gate itself.
    return createModalModuleMock({ confirmResult: true }).module;
});
vi.mock('expo-router', () => ({
    useRouter: () => routerSpy,
    useLocalSearchParams: () => ({ runId: routeState.runId }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'next-run-id' }));
vi.mock('@/sync/domains/workflows/workflowRunDetailActions', () => ({
    workflowRunDetailActions: detailActions,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => accountScopeHarness.capture(),
}));
vi.mock('@/sync/domains/state/storage', async () => {
    // The shared row owner's merge is pure and is what decides that a settled
    // control's newer revision is not undone by a delayed read of an older one;
    // the fake keeps that rule rather than overwriting rows.
    const { mergeWorkflowRunBodies } = await import('@/sync/store/domains/workflowRuns');
    const api = {
        getState: () => ({
            upsertWorkflowRuns: (rows: ReadonlyArray<{ id: string }>) => {
                storeState.state.workflowRunsById = mergeWorkflowRunBodies(
                    storeState.state.workflowRunsById as never,
                    rows as never,
                );
                storeState.emit();
            },
            removeWorkflowRun: (runId: string) => {
                delete storeState.state.workflowRunsById[runId];
                storeState.emit();
            },
            applyWorkflowRunInvocationPage: (input: Record<string, any>) => {
                const existing = (storeState.state.workflowRunInvocationsByRunId[input.runId] as any)?.invocations ?? [];
                storeState.state.workflowRunInvocationsByRunId[input.runId] = {
                    invocations: input.mode === 'append' ? [...existing, ...input.invocations] : input.invocations,
                    nextCursor: input.nextCursor,
                    parentRevision: input.parentRevision,
                    loaded: true,
                };
                storeState.emit();
            },
            upsertWorkflowRunInvocation: () => {},
        }),
    };
    const useStore = (selector: (state: unknown) => unknown) => React.useSyncExternalStore(
        (listener: () => void) => {
            storeState.listeners.add(listener);
            return () => storeState.listeners.delete(listener);
        },
        () => selector(storeState.state),
        () => selector(storeState.state),
    );
    return {
        getStorage: () => Object.assign(useStore, api),
        useActiveServerAccountScope: () => accountScopeHarness.scope(),
        useMachine: () => ({ id: 'machine-1', metadata: { homeDir: '/Users/me' } }),
        useWorkflowRun: (runId: string | null) => React.useSyncExternalStore(
            (listener: () => void) => {
                storeState.listeners.add(listener);
                return () => storeState.listeners.delete(listener);
            },
            () => (runId === null ? null : storeState.state.workflowRunsById[runId] ?? null),
            () => (runId === null ? null : storeState.state.workflowRunsById[runId] ?? null),
        ),
    };
});
vi.mock('@/utils/runtime/useHostActivelyViewed', () => ({ useHostActivelyViewed: () => true }));
vi.mock('@/components/ui/layout/layout', () => ({ useLayoutMaxWidthStyle: () => ({ maxWidth: 960 }) }));
vi.mock('@/components/projects/useOpenProject', () => ({ useOpenProject: () => () => true }));
vi.mock('@/utils/ui/clipboard', () => ({ setClipboardStringSafe: async () => true }));
vi.mock('@/sync/domains/workflows/workflowDefinitionActions', () => ({
    createWorkflowDefinition: createWorkflowDefinitionSpy,
}));
vi.mock('@/hooks/session/sessionRouteServerScope', () => ({
    buildScopedSessionRouteHref: () => '/session/s-1',
}));
// The machine transport is a real system boundary; everything below it — the
// screen's own in-flight bookkeeping and staleness guards — stays real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcSpy,
}));
vi.mock('../run/useWorkflowRunNowController', () => ({
    useWorkflowRunNowController: () => ({ runNow: runNowSpy, stateFor: () => 'idle' }),
}));
vi.mock('../run/useWorkflowRunInputModal', () => ({ useWorkflowRunInputModal: () => {} }));
vi.mock('../run/useWorkflowCompletionMoment', () => ({ useWorkflowCompletionMoment: () => false }));
vi.mock('../accessibility/useWorkflowAnnouncements', () => ({ useWorkflowAnnouncements: () => {} }));
vi.mock('@/sync/domains/workflows/workflowReviewedRunSeed', () => ({
    buildWorkflowReviewedRunSeed: (input: unknown) => input,
    storeWorkflowReviewedRunSeed: reviewedSeedSpy,
}));
vi.mock('../run/WorkflowRunContent', () => ({
    WorkflowRunContent: (props: WorkflowRunContentProps) => {
        latestContentProps = props;
        return React.createElement('WorkflowRunContent', { testID: 'workflow-run-content' });
    },
}));

const DEFINITION = createWorkflowDefinitionFixture({
    blocks: [
        {
            kind: 'step',
            id: 'analyze',
            document: { text: 'Analyze the repository', references: [], attachments: [] },
            input: [],
            result: { kind: 'text' },
        },
    ] as never,
});

const ACCEPTED_CONTEXT = {
    source: { kind: 'inline' as const },
    inputs: {},
    machineId: 'machine-1',
    executionTarget: { kind: 'attached_run' as const },
    workspaceTarget: {
        project: { machineId: 'machine-1', directory: '/Users/me/project' },
    },
    origin: { kind: 'direct' as const },
};

function invocationPage(invocations: readonly unknown[]) {
    return { invocations, parentRevision: 1 };
}

function permissionInvocationResponse(params: Readonly<{
    index: ReturnType<typeof createWorkflowInvocationIndexFixture>;
    requestIds: readonly string[];
    executionRunId?: string;
}>) {
    return {
        invocation: {
            index: params.index,
            parentRevision: 1,
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step',
                attempt: '0',
                logicalInvocationRecordId: 'analyze-row',
                execution: { kind: 'detached_run', runId: params.executionRunId ?? 'exec-1' },
                interaction: {
                    requests: Object.fromEntries(params.requestIds.map((requestId, index) => [
                        requestId,
                        { tool: index === 0 ? 'Write' : 'Read', createdAt: index + 1 },
                    ])),
                },
            },
        },
    };
}

/**
 * A selected detached-run attempt holding two open permission requests.
 *
 * Two are needed because the contract is per-request: a decision in flight for
 * one request may not disable — or settle — the other.
 */
async function renderSelectedPermissionRequests() {
    const invocations = [
        createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
        createWorkflowInvocationIndexFixture({
            id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'waiting_for_approval',
        }),
    ];
    detailActions.getInvocation.mockResolvedValue(permissionInvocationResponse({
        index: invocations[1],
        requestIds: ['permission-1', 'permission-2'],
    }));
    const screen = await renderRunScreen({
        run: createWorkflowRunSummaryFixture({
            id: 'run-1', state: 'running', machineId: 'machine-1', origin: { kind: 'direct' },
        }),
        invocations,
    });
    await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
    await act(async () => {});
    return screen;
}

async function renderRunScreen(overrides: Readonly<{
    run?: ReturnType<typeof createWorkflowRunSummaryFixture>;
    invocations?: readonly unknown[];
    failedInvocation?: unknown;
    definition?: unknown;
    result?: unknown;
    usage?: Readonly<{ inputTokens?: number; outputTokens?: number; costUsd?: number }>;
    finalOutputInvocationId?: string;
    historyNextCursor?: string;
    acceptedContext?: unknown;
    invocationListFailure?: Error;
}> = {}) {
    const run = overrides.run ?? createWorkflowRunSummaryFixture({
        id: 'run-1',
        state: 'succeeded',
        origin: { kind: 'direct' },
        availability: { cancel: false, pause: false },
    });
    const invocations = overrides.invocations ?? [];
    detailActions.getRun.mockResolvedValue({
        run,
        definition: overrides.definition ?? DEFINITION,
        acceptedContext: overrides.acceptedContext ?? ACCEPTED_CONTEXT,
        checkpoint: null,
        ...(Object.prototype.hasOwnProperty.call(overrides, 'result') ? { result: overrides.result } : {}),
        ...(overrides.usage === undefined ? {} : { usage: overrides.usage }),
        ...(overrides.finalOutputInvocationId === undefined
            ? {}
            : { finalOutputInvocationId: overrides.finalOutputInvocationId }),
        availability: run.availability,
    });
    if (overrides.invocationListFailure === undefined) {
        detailActions.listInvocations.mockImplementation(async (input: Readonly<{ lifecycles?: readonly string[] }>) => (
            input.lifecycles?.length === 1 && input.lifecycles[0] === 'failed'
                ? invocationPage(overrides.failedInvocation === undefined ? [] : [overrides.failedInvocation])
                : {
                    ...invocationPage(invocations),
                    ...(input.lifecycles === undefined && overrides.historyNextCursor !== undefined
                        ? { nextCursor: overrides.historyNextCursor }
                        : {}),
                }
        ));
    } else {
        detailActions.listInvocations.mockRejectedValue(overrides.invocationListFailure);
    }
    const { WorkflowRunScreen } = await import('./WorkflowRunScreen');
    const screen = await renderScreen(React.createElement(WorkflowRunScreen));
    await act(async () => {});
    return screen;
}

beforeEach(() => {
    latestContentProps = null;
    routeState.runId = 'run-1';
    accountScopeHarness.reset();
    storeState.reset();
    runNowSpy.mockClear();
    routerSpy.push.mockClear();
    routerSpy.back.mockClear();
    reviewedSeedSpy.mockClear();
    createWorkflowDefinitionSpy.mockReset();
    machineRpcSpy.mockReset();
    machineRpcSpy.mockResolvedValue({ ok: true });
    for (const action of Object.values(detailActions)) action.mockReset();
});

afterEach(async () => {
    await standardCleanup();
});

describe('WorkflowRunScreen', () => {
    it('uses exact terminal queries beyond page one and keeps the bounded authoritative result visible', async () => {
        const failed = createWorkflowInvocationIndexFixture({
            id: 'failed-off-page', sequence: '90', lifecycle: 'failed',
        });
        const definition = createWorkflowDefinitionFixture({
            blocks: [{
                kind: 'step', id: 'publish',
                document: { text: 'Publish', references: [], attachments: [] },
                input: [], result: { kind: 'text' },
            }],
            finalOutput: {
                kind: 'result', producer: { blockId: 'publish', scope: { kind: 'current' } }, path: [],
            },
        });
        const longResult = 'x'.repeat(2_100);
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            definition,
            invocations: [createWorkflowInvocationIndexFixture({ id: 'page-one', sequence: '1' })],
            failedInvocation: failed,
            historyNextCursor: 'more-history',
            result: longResult,
            finalOutputInvocationId: 'final-off-page',
        });

        expect(detailActions.listInvocations).toHaveBeenCalledWith(
            { runId: 'run-1', lifecycles: ['failed'], limit: 1 },
            expect.any(AbortSignal),
        );
        expect(latestContentProps?.invocationHistoryComplete).toBe(false);
        expect(latestContentProps?.finalOutputInvocationId).toBe('final-off-page');
        expect(latestContentProps?.firstFailedInvocationId).toBe('failed-off-page');
        expect(latestContentProps?.resultLabel).toBe(`${'x'.repeat(2_000)}…`);
    });

    it('keeps failure discovery unresolved through loading and error without discarding the result preview', async () => {
        const failedPage = createDeferred<ReturnType<typeof invocationPage>>();
        const run = createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' });
        detailActions.getRun.mockResolvedValue({
            run,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            result: 'Authoritative result preview',
            finalOutputInvocationId: 'inv-final-off-page',
            availability: run.availability,
        });
        detailActions.listInvocations.mockImplementation(async (input: Readonly<{ lifecycles?: readonly string[] }>) => (
            input.lifecycles?.length === 1 && input.lifecycles[0] === 'failed'
                ? failedPage.promise
                : invocationPage([])
        ));

        const { WorkflowRunScreen } = await import('./WorkflowRunScreen');
        await renderScreen(React.createElement(WorkflowRunScreen));
        await act(async () => {});

        expect(latestContentProps?.firstFailedInvocationResolution).toBe('loading');
        expect(latestContentProps?.resultLabel).toBe('Authoritative result preview');

        failedPage.reject(new Error('offline'));
        await act(async () => {});

        expect(latestContentProps?.firstFailedInvocationResolution).toBe('error');
        expect(latestContentProps?.resultLabel).toBe('Authoritative result preview');
    });

    it('keeps an authoritative JSON null result distinct from no result', async () => {
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            result: null,
            finalOutputInvocationId: 'final-null',
        });

        expect(latestContentProps?.resultLabel).toBe('null');
        expect(latestContentProps?.finalOutputInvocationId).toBe('final-null');
    });

    /**
     * A direct Run admitted from an unnamed draft has an opened accepted
     * context with no metadata. That is an untitled Run, not private content
     * this device cannot open; only an unopened context is unavailable.
     */
    it('names an opened untitled Run as a workflow run rather than as unavailable private content', async () => {
        await renderRunScreen({ acceptedContext: ACCEPTED_CONTEXT });
        expect(latestContentProps?.title).toBe('workflows.run.untitled');

        await renderRunScreen({
            acceptedContext: { ...ACCEPTED_CONTEXT, metadata: { title: 'Review 500 files' } },
        });
        expect(latestContentProps?.title).toBe('Review 500 files');
    });

    it('presents aggregate usage through locale-aware token and currency owners', async () => {
        await renderRunScreen({
            usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
        });

        expect(latestContentProps?.usageLabel).toContain('150');
        expect(latestContentProps?.usageLabel).toContain(new Intl.NumberFormat(undefined, {
            style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
        }).format(0.04));
        expect(latestContentProps?.usageLabel).not.toContain(' in');
        expect(latestContentProps?.usageLabel).not.toContain(' out');
    });

    it('keeps a loaded summary visible and exposes the same loader retry when invocation discovery fails', async () => {
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            invocationListFailure: new Error('offline'),
        });

        expect(latestContentProps?.run.id).toBe('run-1');
        expect(latestContentProps?.errorLabel).toBe('workflows.loadFailedBody');
        const reload = latestContentProps?.onReload;
        expect(reload).toBeTypeOf('function');
        const callsBeforeRetry = detailActions.listInvocations.mock.calls.length;

        detailActions.listInvocations.mockResolvedValue(invocationPage([]));
        await act(async () => reload?.());
        await act(async () => {});

        expect(detailActions.listInvocations).toHaveBeenCalledTimes(callsBeforeRetry + 2);
        expect(latestContentProps?.onReload).toBeUndefined();
        expect(latestContentProps?.errorLabel).toBeNull();
        expect(latestContentProps?.invocationsLoaded).toBe(true);
    });

    it('does not let a late Run-again completion navigate after this mounted screen changes Runs', async () => {
        const admission = createDeferred<Readonly<{ run: { id: string } }>>();
        runNowSpy.mockImplementationOnce(async () => admission.promise);
        const screen = await renderRunScreen();
        const runAgain = latestContentProps?.onRunAgain;

        act(() => { runAgain?.(); });
        await Promise.resolve();
        expect(runNowSpy).toHaveBeenCalledTimes(1);

        routeState.runId = 'run-2';
        const runB = createWorkflowRunSummaryFixture({
            id: 'run-2', state: 'running', origin: { kind: 'direct' },
        });
        detailActions.getRun.mockResolvedValue({
            run: runB,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            availability: runB.availability,
        });
        detailActions.listInvocations.mockResolvedValue(invocationPage([]));
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});
        expect(latestContentProps?.run.id).toBe('run-2');

        admission.resolve({ run: { id: 'run-again-from-a' } });
        await act(async () => {});

        expect(routerSpy.push).not.toHaveBeenCalled();
    });

    it('does not let a late Save-as-workflow completion navigate after this mounted screen changes Runs', async () => {
        const save = createDeferred<Readonly<{ definitionId: string }>>();
        createWorkflowDefinitionSpy.mockImplementationOnce(async () => save.promise);
        const screen = await renderRunScreen();
        const saveAsWorkflow = latestContentProps?.onSaveAsWorkflow;

        act(() => { saveAsWorkflow?.(); });
        expect(createWorkflowDefinitionSpy).toHaveBeenCalledTimes(1);

        routeState.runId = 'run-2';
        const runB = createWorkflowRunSummaryFixture({
            id: 'run-2', state: 'running', origin: { kind: 'direct' },
        });
        detailActions.getRun.mockResolvedValue({
            run: runB,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            availability: runB.availability,
        });
        detailActions.listInvocations.mockResolvedValue(invocationPage([]));
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});

        save.resolve({ definitionId: 'saved-from-a' });
        await act(async () => {});

        expect(routerSpy.push).not.toHaveBeenCalled();
        expect(latestContentProps?.run.id).toBe('run-2');
        expect(latestContentProps?.saveAsWorkflowPending).toBe(false);
    });

    /**
     * Leaving the Run detail is the same question as changing Runs on it.
     *
     * The repeat was admitted, so it is never discarded; but this screen is gone
     * and pushing its route would take over whatever the person opened instead.
     */
    it('does not let a late Run-again completion navigate after this screen closes', async () => {
        const admission = createDeferred<Readonly<{ run: { id: string } }>>();
        runNowSpy.mockImplementationOnce(async () => admission.promise);
        const screen = await renderRunScreen();
        const runAgain = latestContentProps?.onRunAgain;

        act(() => { runAgain?.(); });
        await Promise.resolve();
        expect(runNowSpy).toHaveBeenCalledTimes(1);

        await screen.unmount();

        admission.resolve({ run: { id: 'run-again-after-close' } });
        await act(async () => {});

        expect(routerSpy.push).not.toHaveBeenCalled();
    });

    /**
     * A destructive control is held to the same fence as navigation: once the
     * screen is gone, the deletion it was collecting consent for neither retires
     * the shared row nor pops a route this screen no longer owns.
     */
    it('does not let a late delete completion retire the shared row or navigate back after this screen closes', async () => {
        const deletion = createDeferred<Readonly<{ ok: true }>>();
        detailActions.deleteRun.mockImplementationOnce(async () => deletion.promise);
        const screen = await renderRunScreen({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1',
                state: 'succeeded',
                origin: { kind: 'direct' },
                workflowCustodyState: 'settled',
                availability: { cancel: false, pause: false },
            }),
        });
        const onDelete = latestContentProps?.onDelete;
        expect(onDelete).toBeTypeOf('function');

        act(() => { onDelete?.(); });
        await act(async () => {});
        expect(detailActions.deleteRun).toHaveBeenCalledTimes(1);

        await screen.unmount();

        deletion.resolve({ ok: true });
        await act(async () => {});

        expect(routerSpy.back).not.toHaveBeenCalled();
        expect(storeState.state.workflowRunsById['run-1']).toBeDefined();
    });

    it('repeats a Run under exactly the execution target its accepted context froze', async () => {
        await renderRunScreen();
        expect(latestContentProps?.onRunAgain).toBeTypeOf('function');

        await act(async () => latestContentProps?.onRunAgain());
        await act(async () => {});

        expect(runNowSpy).toHaveBeenCalledTimes(1);
        expect(runNowSpy.mock.calls[0]?.[0]).toMatchObject({
            executionTarget: { kind: 'attached_run' },
            project: { machineId: 'machine-1', directory: '/Users/me/project' },
        });
    });

    it('supplies the derived structural identity of unopened rows to the shared Run body', async () => {
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running', origin: { kind: 'direct' } }),
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
                createWorkflowInvocationIndexFixture({ id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
            ],
        });

        expect(latestContentProps?.invocationStructure?.get('analyze-row')).toMatchObject({
            nodeId: 'analyze',
            blockId: 'analyze',
        });
    });

    it.each([
        'workspace_unavailable',
        'conversation_workspace_mismatch',
        'source_workspace_unavailable',
        'committed_revision_unavailable',
        'workspace_conflict',
        'scm_unavailable',
    ] as const)('offers a reviewed new Run — never a silent repeat — for %s', async (code) => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'needs_attention',
            }),
        ];
        detailActions.getInvocation.mockResolvedValue({
            invocation: {
                index: invocations[1],
                parentRevision: 1,
                progress: {
                    kind: 'happier.workflow-progress.v1',
                    invocationPath: { blockId: 'analyze', scope: [] },
                    blockKind: 'step',
                    attempt: '0',
                    logicalInvocationRecordId: 'analyze-row',
                    reason: { code },
                },
            },
        });
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1', state: 'interrupted', origin: { kind: 'direct' },
                // Nothing is waiting for a stop to be confirmed, so the reviewed
                // new Run is genuinely reachable rather than blocked behind
                // `workflow_outcome_unresolved`.
                workflowCustodyState: 'settled',
                availability: { cancel: false, pause: false, retry: true },
            }),
            invocations,
        });
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});

        expect(latestContentProps?.onStartReviewedNewRun).toBeTypeOf('function');
        // Exactly one D4 arm: no restoration producer exists here, so the screen
        // hands down no restore handler either.
        expect(latestContentProps?.onRestoreWorkspace).toBeUndefined();
        await act(async () => latestContentProps?.onStartReviewedNewRun());
        await act(async () => {});

        // When exact restoration is unavailable, D4 opens a reviewed new Run.
        // Nothing may be admitted before the person presses Run there.
        expect(runNowSpy).not.toHaveBeenCalled();
        expect(reviewedSeedSpy).toHaveBeenCalledTimes(1);
        expect(routerSpy.push).toHaveBeenCalledWith(expect.objectContaining({
            pathname: '/workflows/new',
            params: expect.objectContaining({ reviewedRunSeedId: 'reviewed-seed-id' }),
        }));
    });

    it('restores the selected invocation workspace on the Run Machine without silently starting a new Run', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'failed',
            }),
        ];
        detailActions.getInvocation.mockResolvedValue({
            invocation: {
                index: invocations[1],
                parentRevision: 1,
                progress: {
                    kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'analyze', scope: [] },
                    blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'analyze-row',
                    reason: { code: 'workspace_unavailable' },
                    recovery: {
                        conversation: 'fresh_agent',
                        input: {
                            kind: 'replacement',
                            value: {
                                document: { text: 'work', references: [], attachments: [] },
                                input: ['recorded context'],
                            },
                        },
                    },
                    workspace: {
                        creationIntent: {
                            kind: 'git_worktree', sourceDirectory: '/Users/me/project', baseRef: 'a'.repeat(40),
                            displayName: 'workflow-analyze', branchMode: 'new',
                        },
                        descriptor: {
                            machineId: 'machine-1', directory: '/Users/me/project/.worktrees/workflow-analyze',
                            checkoutRootPath: '/Users/me/project/.worktrees/workflow-analyze',
                            checkout: { kind: 'git_worktree', branchName: 'workflow-analyze' },
                        },
                    },
                },
            },
        });
        const run = createWorkflowRunSummaryFixture({
            id: 'run-1', state: 'interrupted', revision: 1, machineId: 'machine-1', origin: { kind: 'direct' },
            workflowCustodyState: 'settled',
            availability: { cancel: false, pause: false, restoreWorkspace: true },
        });
        detailActions.restoreWorkspace.mockResolvedValue({ run: { ...run, state: 'running', revision: 2 }, intent: 'resumed' });
        await renderRunScreen({ run, invocations });
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});

        expect(latestContentProps?.onRestoreWorkspace).toBeTypeOf('function');
        // Restoration resumes this Run, so the arm that would repeat its
        // completed work is not offered beside it.
        expect(latestContentProps?.onStartReviewedNewRun).toBeUndefined();
        await act(async () => latestContentProps?.onRestoreWorkspace?.());
        await act(async () => {});

        expect(detailActions.restoreWorkspace).toHaveBeenCalledWith({
            mode: 'recover', runId: 'run-1', expectedRevision: 1,
            invocations: [{
                kind: 'restore_workspace', invocation: { recordId: 'analyze-row' },
                conversation: 'fresh_agent',
                input: {
                    kind: 'replacement',
                    value: {
                        document: { text: 'work', references: [], attachments: [] },
                        input: ['recorded context'],
                    },
                },
            }],
        }, 'machine-1');
        expect(runNowSpy).not.toHaveBeenCalled();
        expect(reviewedSeedSpy).not.toHaveBeenCalled();
    });

    it('requires acknowledgement of an uncertain prior attempt before it will submit a retry', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'outcome_uncertain',
            }),
        ];
        detailActions.getInvocation.mockResolvedValue({
            invocation: {
                index: invocations[1],
                parentRevision: 1,
                progress: {
                    kind: 'happier.workflow-progress.v1',
                    invocationPath: { blockId: 'analyze', scope: [] },
                    blockKind: 'step',
                    attempt: '0',
                    logicalInvocationRecordId: 'analyze-row',
                },
            },
        });
        detailActions.retryInvocation.mockResolvedValue({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
        });
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1', state: 'interrupted', origin: { kind: 'direct' },
                availability: { cancel: false, pause: false, retry: true },
            }),
            invocations,
        });
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});

        await act(async () => latestContentProps?.onRetrySameConversation());
        await act(async () => {});
        expect(detailActions.retryInvocation).not.toHaveBeenCalled();

        await act(async () => latestContentProps?.onAcknowledgeUncertainPriorEffects());
        await act(async () => latestContentProps?.onRetrySameConversation());
        await act(async () => {});
        expect(detailActions.retryInvocation).toHaveBeenCalledTimes(1);
        expect(detailActions.retryInvocation.mock.calls[0]?.[0]).toMatchObject({
            acknowledgeUncertainPriorEffects: true,
            input: { kind: 'original' },
        });
    });

    it('submits a prepared continuation with the replacement input the person reviewed', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'needs_attention',
            }),
        ];
        detailActions.getInvocation.mockResolvedValue({
            invocation: {
                index: invocations[1],
                parentRevision: 1,
                progress: {
                    kind: 'happier.workflow-progress.v1',
                    invocationPath: { blockId: 'analyze', scope: [] },
                    blockKind: 'step',
                    attempt: '0',
                    logicalInvocationRecordId: 'analyze-row',
                    recovery: {
                        conversation: 'same_conversation',
                        input: {
                            kind: 'replacement',
                            value: {
                                document: { text: 'Continue the prepared objective', references: [], attachments: [] },
                                input: ['recorded context'],
                            },
                        },
                    },
                },
            },
        });
        detailActions.resumeRun.mockResolvedValue({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
        });
        await renderRunScreen({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1', state: 'interrupted', origin: { kind: 'direct' },
                availability: { cancel: false, pause: false, recoverSameConversation: true },
            }),
            invocations,
        });
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});

        expect(latestContentProps?.preparedRecovery).toMatchObject({ conversation: 'same_conversation' });
        await act(async () => latestContentProps?.onContinuePrepared({
            conversation: 'same_conversation',
            document: { text: 'Continue, but skip the migration step', references: [], attachments: [] },
            input: ['recorded context'],
        }));
        await act(async () => {});

        expect(detailActions.resumeRun).toHaveBeenCalledTimes(1);
        expect(detailActions.resumeRun.mock.calls[0]?.[0]).toMatchObject({
            mode: 'recover',
            invocations: [{
                kind: 'continue',
                invocation: { recordId: 'analyze-row' },
                conversation: 'same_conversation',
                input: {
                    document: { text: 'Continue, but skip the migration step' },
                    input: ['recorded context'],
                },
            }],
        });
    });

    /**
     * Every durable Run operation carries `expectedRevision`, so two in flight
     * at once are a currentness race the person did not ask for. One Run-scoped
     * mutex at this command owner admits exactly one at a time; the others are
     * refused at issuance, not merely greyed out after a render.
     */
    it('issues exactly one durable Run operation at a time and refuses the rest until it settles', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'failed',
            }),
        ];
        detailActions.getInvocation.mockResolvedValue({
            invocation: {
                index: invocations[1],
                parentRevision: 1,
                progress: {
                    kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'analyze', scope: [] },
                    blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'analyze-row',
                },
            },
        });
        const run = createWorkflowRunSummaryFixture({
            id: 'run-1', state: 'running', revision: 1, origin: { kind: 'direct' },
            availability: { pause: true, cancel: true, retry: true },
        });
        const pause = createDeferred<Readonly<{ run: typeof run }>>();
        detailActions.pauseRun.mockImplementationOnce(() => pause.promise);
        detailActions.cancelRun.mockResolvedValue({ run: { ...run, state: 'cancelled', revision: 3 } });
        detailActions.retryInvocation.mockResolvedValue({ run: { ...run, revision: 3 } });
        await renderRunScreen({ run, invocations });
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});

        act(() => { latestContentProps?.onPause?.(); });
        expect(detailActions.pauseRun).toHaveBeenCalledTimes(1);
        expect(latestContentProps?.pendingControl).toBe('pause');

        // While Pause is unsettled, Cancel and Retry are conflicting durable
        // operations against the same revision: none may issue.
        act(() => {
            latestContentProps?.onCancel?.();
            latestContentProps?.onCancel?.();
            latestContentProps?.onRetrySameConversation?.();
            latestContentProps?.onRetrySameConversation?.();
        });
        await act(async () => {});
        expect(detailActions.cancelRun).not.toHaveBeenCalled();
        expect(detailActions.retryInvocation).not.toHaveBeenCalled();

        pause.resolve({ run: { ...run, state: 'pause_requested', revision: 2 } });
        await act(async () => {});
        expect(latestContentProps?.pendingControl).toBeNull();
        expect(latestContentProps?.run.revision).toBe(2);

        // Two presses in one frame: the ref, not the rendered state, is the gate.
        act(() => {
            latestContentProps?.onCancel?.();
            latestContentProps?.onCancel?.();
        });
        await act(async () => {});
        expect(detailActions.cancelRun).toHaveBeenCalledTimes(1);
        expect(detailActions.cancelRun.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 2 });
        expect(latestContentProps?.run.revision).toBe(3);
    });

    it('lets a durable operation that outlives a Run change neither settle this screen nor overwrite the new Run', async () => {
        const runA = createWorkflowRunSummaryFixture({
            id: 'run-1', state: 'running', revision: 1, origin: { kind: 'direct' }, availability: { cancel: true },
        });
        const cancel = createDeferred<Readonly<{ run: typeof runA }>>();
        detailActions.cancelRun.mockImplementationOnce(() => cancel.promise);
        const screen = await renderRunScreen({ run: runA });
        act(() => { latestContentProps?.onCancel?.(); });
        expect(latestContentProps?.pendingControl).toBe('cancel');

        routeState.runId = 'run-2';
        const runB = createWorkflowRunSummaryFixture({
            id: 'run-2', state: 'running', revision: 5, origin: { kind: 'direct' }, availability: { cancel: true },
        });
        detailActions.getRun.mockResolvedValue({
            run: runB, definition: DEFINITION, acceptedContext: ACCEPTED_CONTEXT, checkpoint: null, availability: runB.availability,
        });
        detailActions.listInvocations.mockResolvedValue(invocationPage([]));
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});
        expect(latestContentProps?.run.id).toBe('run-2');
        // The new Run starts with no operation in flight; A's cancel is not its business.
        expect(latestContentProps?.pendingControl).toBeNull();

        detailActions.cancelRun.mockResolvedValueOnce({ run: { ...runB, state: 'cancelled', revision: 6 } });
        act(() => { latestContentProps?.onCancel?.(); });
        await act(async () => {});
        expect(detailActions.cancelRun).toHaveBeenCalledTimes(2);
        expect(latestContentProps?.run.revision).toBe(6);

        cancel.resolve({ run: { ...runA, state: 'cancelled', revision: 2 } });
        await act(async () => {});
        expect(latestContentProps?.run.id).toBe('run-2');
        expect(latestContentProps?.run.revision).toBe(6);
        expect(storeState.state.workflowRunsById['run-1']).toMatchObject({ revision: 1 });
    });

    it('keeps both permission controls withdrawn until the exact canonical reread removes the request', async () => {
        const decision = createDeferred<Readonly<{ ok: boolean }>>();
        const reconciliation = createDeferred<ReturnType<typeof permissionInvocationResponse>>();
        machineRpcSpy.mockImplementationOnce(async (params) => {
            params.onIssued?.();
            return decision.promise;
        });
        await renderSelectedPermissionRequests();

        expect(latestContentProps?.onRespondPermission).toBeTypeOf('function');
        const exactReadsBeforeDecision = detailActions.getInvocation.mock.calls.length;
        detailActions.getInvocation.mockImplementationOnce(async () => reconciliation.promise);
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }); });
        await act(async () => {});

        expect(machineRpcSpy).toHaveBeenCalledTimes(1);
        expect(machineRpcSpy.mock.calls[0]?.[0]).toMatchObject({
            machineId: 'machine-1',
            payload: { runId: 'exec-1', requestId: 'permission-1', approved: true },
        });
        // Only the answered request is withdrawn; the other stays decidable.
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);

        // The opposite press must not race a competing response for the same request.
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);

        decision.resolve({ ok: true });
        await act(async () => {});

        expect(detailActions.getInvocation).toHaveBeenCalledTimes(exactReadsBeforeDecision + 1);
        // An acknowledgement is not settlement. The request stays withdrawn
        // while the exact canonical content read is unresolved.
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);

        reconciliation.resolve(permissionInvocationResponse({
            index: createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'running',
            }),
            requestIds: ['permission-2'],
        }));
        await act(async () => {});

        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual([]);
    });

    it('sends structured question answers through the same exact detached-run request response RPC', async () => {
        await renderSelectedPermissionRequests();

        expect(latestContentProps?.onAnswerQuestion).toBeTypeOf('function');
        await act(async () => latestContentProps?.onAnswerQuestion?.({
            requestId: 'permission-1',
            answers: { branch: ['dev'] },
        }));

        expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            method: RPC_METHODS.DAEMON_EXECUTION_RUN_PERMISSION_RESPOND,
            payload: {
                runId: 'exec-1',
                requestId: 'permission-1',
                answers: { branch: ['dev'] },
            },
        }));
    });

    it('reconciles a not-found response and suppresses the opposite answer while canonical content still has the request', async () => {
        machineRpcSpy.mockImplementationOnce(async (params) => {
            params.onIssued?.();
            return { ok: false, errorCode: 'permission_request_not_found' };
        });
        await renderSelectedPermissionRequests();
        const exactReadsBeforeDecision = detailActions.getInvocation.mock.calls.length;

        await act(async () => latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }));
        await act(async () => {});

        expect(detailActions.getInvocation).toHaveBeenCalledTimes(exactReadsBeforeDecision + 1);
        expect(latestContentProps?.errorLabel).toBeTruthy();
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);
    });

    it('reconciles an issued timeout without making the request retryable from an unknown outcome', async () => {
        machineRpcSpy.mockImplementationOnce(async (params) => {
            params.onIssued?.();
            throw new Error('machine timed out');
        });
        await renderSelectedPermissionRequests();
        const exactReadsBeforeDecision = detailActions.getInvocation.mock.calls.length;

        await act(async () => latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }));
        await act(async () => {});

        expect(detailActions.getInvocation).toHaveBeenCalledTimes(exactReadsBeforeDecision + 1);
        expect(latestContentProps?.errorLabel).toBeTruthy();
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);
    });

    it('permits retry after an exact reread confirms a failure happened before transport issuance', async () => {
        const reconciliation = createDeferred<ReturnType<typeof permissionInvocationResponse>>();
        machineRpcSpy.mockRejectedValueOnce(new Error('scope unavailable before emission'));
        await renderSelectedPermissionRequests();
        detailActions.getInvocation.mockImplementationOnce(async () => reconciliation.promise);

        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }); });
        await act(async () => {});

        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);
        reconciliation.resolve(permissionInvocationResponse({
            index: createWorkflowInvocationIndexFixture({
                id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1', lifecycle: 'waiting_for_approval',
            }),
            requestIds: ['permission-1', 'permission-2'],
        }));
        await act(async () => {});

        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual([]);
        await act(async () => latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }));
        expect(machineRpcSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps an unchanged invalid response withdrawn after canonical content confirms the request is still open', async () => {
        machineRpcSpy.mockResolvedValueOnce({
            ok: false,
            errorCode: 'execution_run_invalid_action_input',
        });
        await renderSelectedPermissionRequests();

        await act(async () => latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }));
        await act(async () => {});

        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);
    });

    it('retires the exact Account operation so an A to B to A completion cannot touch the replacement request', async () => {
        const decision = createDeferred<Readonly<{ ok: boolean }>>();
        const replacementDecision = createDeferred<Readonly<{ ok: boolean }>>();
        machineRpcSpy
            .mockImplementationOnce(async (params) => {
                params.onIssued?.();
                return decision.promise;
            })
            .mockImplementationOnce(async (params) => {
                params.onIssued?.();
                return replacementDecision.promise;
            });
        const screen = await renderSelectedPermissionRequests();
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: true }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);
        const firstSignal = machineRpcSpy.mock.calls[0]?.[0].signal;
        expect(firstSignal?.aborted).toBe(false);

        accountScopeHarness.switchTo({ serverId: 'server-b', accountId: 'account-b' });
        const runB = createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running', machineId: 'machine-1' });
        detailActions.getRun.mockResolvedValue({
            run: runB,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            availability: runB.availability,
        });
        detailActions.listInvocations.mockResolvedValue(invocationPage([]));
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});
        expect(firstSignal?.aborted).toBe(true);

        accountScopeHarness.switchTo({ serverId: 'server-a', accountId: 'account-a' });
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});
        await act(async () => latestContentProps?.onSelectInvocation('analyze-row'));
        await act(async () => {});
        act(() => { latestContentProps?.onRespondPermission?.({ requestId: 'permission-1', approved: false }); });
        await act(async () => {});
        expect(machineRpcSpy).toHaveBeenCalledTimes(2);
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);

        decision.reject(new Error('machine unreachable'));
        await act(async () => {});

        expect(latestContentProps?.errorLabel ?? null).toBeNull();
        expect([...(latestContentProps?.pendingPermissionRequestIds ?? [])]).toEqual(['permission-1']);

        replacementDecision.reject(new Error('replacement machine unreachable'));
        await act(async () => {});
    });

    /**
     * A Run whose public history and attention windows each report another page.
     *
     * Both are answered by the same canonical reader the screen really calls,
     * distinguished only by the lifecycle filter the attention query carries, so
     * these cases exercise the real two-window paging the screen owns.
     */
    async function renderPagedRunScreen(overrides: Readonly<{
        history?: readonly unknown[];
        historyNextCursor?: string;
        attention?: readonly unknown[];
        attentionNextCursor?: string;
    }> = {}) {
        const run = createWorkflowRunSummaryFixture({
            id: 'run-1', state: 'running', origin: { kind: 'direct' },
        });
        detailActions.getRun.mockResolvedValue({
            run,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            availability: run.availability,
        });
        detailActions.listInvocations.mockImplementation(async (input: Record<string, unknown>) => (
            input?.lifecycles === undefined
                ? { ...invocationPage(overrides.history ?? []), nextCursor: overrides.historyNextCursor }
                : { ...invocationPage(overrides.attention ?? []), nextCursor: overrides.attentionNextCursor }
        ));
        const { WorkflowRunScreen } = await import('./WorkflowRunScreen');
        const screen = await renderScreen(React.createElement(WorkflowRunScreen));
        await act(async () => {});
        return screen;
    }

    it('keeps the loaded history and its cursor when a continuation fails, and clears that failure only once a retry succeeds', async () => {
        const first = createWorkflowInvocationIndexFixture({ id: 'inv-1', memberOrdinal: '0', sequence: '0' });
        const second = createWorkflowInvocationIndexFixture({ id: 'inv-2', memberOrdinal: '1', sequence: '1' });
        await renderPagedRunScreen({ history: [first], historyNextCursor: 'history-2' });
        expect(latestContentProps?.invocations.map((entry) => entry.id)).toEqual(['inv-1']);

        detailActions.listInvocations.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { latestContentProps?.onLoadMoreInvocations?.(); });
        await act(async () => {});

        // A page that did not arrive is not a durable Run operation failure, so
        // it must not claim the outcome region's error voice.
        expect(latestContentProps?.errorLabel ?? null).toBeNull();
        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(true);
        // The rows already read and the cursor Retry needs both survive.
        expect(latestContentProps?.invocations.map((entry) => entry.id)).toEqual(['inv-1']);
        expect(latestContentProps?.onLoadMoreInvocations).toBeTypeOf('function');

        detailActions.listInvocations.mockRejectedValueOnce(new Error('offline again'));
        await act(async () => { latestContentProps?.onLoadMoreInvocations?.(); });
        await act(async () => {});
        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(true);

        detailActions.listInvocations.mockImplementationOnce(async () => invocationPage([second]));
        await act(async () => { latestContentProps?.onLoadMoreInvocations?.(); });
        await act(async () => {});

        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(false);
        expect(latestContentProps?.invocations.map((entry) => entry.id)).toEqual(['inv-1', 'inv-2']);
        expect(latestContentProps?.onLoadMoreInvocations).toBeUndefined();
        expect(latestContentProps?.errorLabel ?? null).toBeNull();
    });

    it('issues one attention continuation for two presses in the same frame and releases the guard when it settles', async () => {
        const attentionRow = createWorkflowInvocationIndexFixture({
            id: 'inv-attention', memberOrdinal: '0', sequence: '0', lifecycle: 'waiting_for_approval',
        });
        await renderPagedRunScreen({ attention: [attentionRow], attentionNextCursor: 'attention-2' });
        expect(latestContentProps?.onLoadMoreAttention).toBeTypeOf('function');
        const callsBefore = detailActions.listInvocations.mock.calls.length;

        const page = createDeferred<unknown>();
        detailActions.listInvocations.mockImplementationOnce(async () => page.promise);
        act(() => {
            latestContentProps?.onLoadMoreAttention?.();
            latestContentProps?.onLoadMoreAttention?.();
        });
        await act(async () => {});

        expect(detailActions.listInvocations.mock.calls.length).toBe(callsBefore + 1);

        page.resolve({ ...invocationPage([]), nextCursor: 'attention-3' });
        await act(async () => {});
        await act(async () => { latestContentProps?.onLoadMoreAttention?.(); });
        await act(async () => {});

        // The guard withdraws only the duplicate, never the next honest ask.
        expect(detailActions.listInvocations.mock.calls.length).toBe(callsBefore + 2);
    });

    it('retires a continuation failure and its late response when this mounted screen changes Runs', async () => {
        const first = createWorkflowInvocationIndexFixture({ id: 'inv-1', memberOrdinal: '0', sequence: '0' });
        const screen = await renderPagedRunScreen({ history: [first], historyNextCursor: 'history-2' });

        detailActions.listInvocations.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { latestContentProps?.onLoadMoreInvocations?.(); });
        await act(async () => {});
        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(true);

        const stale = createDeferred<unknown>();
        detailActions.listInvocations.mockImplementationOnce(async () => stale.promise);
        act(() => { latestContentProps?.onLoadMoreInvocations?.(); });
        await act(async () => {});

        routeState.runId = 'run-2';
        const runB = createWorkflowRunSummaryFixture({ id: 'run-2', state: 'running', origin: { kind: 'direct' } });
        detailActions.getRun.mockResolvedValue({
            run: runB,
            definition: DEFINITION,
            acceptedContext: ACCEPTED_CONTEXT,
            checkpoint: null,
            availability: runB.availability,
        });
        detailActions.listInvocations.mockImplementation(async () => invocationPage([]));
        await screen.update(React.createElement((await import('./WorkflowRunScreen')).WorkflowRunScreen));
        await act(async () => {});
        expect(latestContentProps?.run.id).toBe('run-2');
        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(false);

        stale.reject(new Error('offline'));
        await act(async () => {});

        // Run A's lost page belongs to nobody on screen once Run B is mounted.
        expect(latestContentProps?.loadMoreInvocationsFailed).toBe(false);
        expect(latestContentProps?.errorLabel ?? null).toBeNull();
    });
});
