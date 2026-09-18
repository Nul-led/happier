import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectHostText, createDeferred, flushHookEffects, makeToolCall, renderScreen, standardCleanup } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { storage } from '@/sync/domains/state/storage';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

/**
 * The agent-origin managed workflow card at the real transcript row.
 *
 * `workflow.run.start` already reached agents through the Action front door and
 * its result reference parser already existed in Protocol, but no transcript
 * row consumed it: an Agent that started a workflow produced a JSON blob in the
 * transcript and the Account Run store learned about the Run only when the
 * change stream or a list page happened to mention it.
 *
 * These tests mount the REAL tool rows and the REAL Account-scoped Run store.
 * Only the Action transport (`createFrontDoorActionExecute`) and the Account
 * lifetime capture are replaced, exactly as the Run-now controller tests do.
 */

const RUN_ID = '0f2cf13d-4ad7-4f4b-b5e0-cc3b7dce7f11';
const ACTIVE_SCOPE = { serverId: 'home-a', accountId: 'account-a' } as const;

const executeMock = vi.hoisted(() => vi.fn());
const pushSpy = vi.hoisted(() => vi.fn());
const accountLifetime = vi.hoisted(() => ({
    value: null as null | Readonly<{
        scope: { serverId: string; accountId: string };
        isCurrent: () => boolean;
        onRetire: (cancel: () => void) => Readonly<{ dispose(): void }>;
    }>,
    retire: null as null | (() => void),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: pushSpy } }).module;
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: vi.fn(async () => undefined) }),
}));
vi.mock('@/sync/sync', () => ({
    sync: { ensureSidechainMessagesLoaded: vi.fn() },
}));
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => ({ kind: 'appExact', readFile: vi.fn(async () => null) }),
}));
vi.mock('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts', () => ({
    BUNDLED_PLUGIN_UI_APP_ARTIFACTS: [],
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(() => null),
    createPluginAccountAvailabilityReaderStore: vi.fn(() => ({ get: vi.fn(() => null), subscribe: vi.fn(() => () => {}) })),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(() => null),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => true }));
vi.mock('@/components/ui/code/editor/CodeEditor', () => ({ CodeEditor: () => null }));
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => executeMock,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => accountLifetime.value,
}));

import { ToolTimelineRow } from '@/components/tools/shell/views/ToolTimelineRow';
import { ToolView } from '@/components/tools/shell/views/ToolView';

function installAccountLifetime(scope: { serverId: string; accountId: string }): void {
    let retired = false;
    const cancellations = new Set<() => void>();
    accountLifetime.value = Object.freeze({
        scope,
        isCurrent: () => !retired,
        onRetire: (cancel: () => void) => {
            cancellations.add(cancel);
            return { dispose: () => { cancellations.delete(cancel); } };
        },
    });
    accountLifetime.retire = () => {
        retired = true;
        for (const cancel of cancellations) cancel();
    };
}

function startResult(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
        run: createWorkflowRunSummaryFixture({
            id: RUN_ID,
            origin: { kind: 'direct', originSessionId: 'session-1' },
        }),
        admission: 'created',
        ...overrides,
    });
}

function startToolCall(overrides: Record<string, unknown> = {}) {
    return makeToolCall({
        name: 'mcp__happier__workflow_run_start',
        state: 'completed',
        input: { runId: RUN_ID, source: { kind: 'inline', definition: { blocks: ['Analyze the repository'] } } },
        result: startResult(),
        ...overrides,
    });
}

function getResult(
    state: 'running' | 'succeeded' | 'interrupted',
    revision = 2,
    metadata: Readonly<{ title: string }> | null = { title: 'Release audit' },
) {
    return {
        ok: true,
        result: {
            run: createWorkflowRunSummaryFixture({
                id: RUN_ID,
                origin: { kind: 'direct', originSessionId: 'session-1' },
                state,
                revision,
            }),
            definition: { version: 1, inputs: [], defaults: {}, blocks: [{
                kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' },
            }] },
            acceptedContext: {
                source: { kind: 'inline' },
                ...(metadata === null ? {} : { metadata }),
                inputs: {},
                machineId: 'machine-1',
                executionTarget: { kind: 'session' },
                workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
                origin: { kind: 'direct', originSessionId: 'session-1' },
            },
            checkpoint: null,
            availability: createWorkflowRunSummaryFixture().availability,
        },
    };
}

async function renderCardRow(
    tool = startToolCall(),
    serverId: string | null = 'home-a',
) {
    return renderScreen(
        <ToolView
            tool={tool}
            metadata={null}
            messages={[]}
            sessionId="session-1"
            {...(serverId === null ? {} : { serverId })}
            messageId="message-1"
        />,
    );
}

async function renderTimelineRow(tool = startToolCall()) {
    return renderScreen(
        <ToolTimelineRow
            tool={tool}
            metadata={null}
            messages={[]}
            sessionId="session-1"
            serverId="home-a"
            messageId="message-1"
        />,
    );
}

async function settle(): Promise<void> {
    await act(async () => {
        await flushHookEffects();
    });
}

beforeEach(() => {
    standardCleanup();
    executeMock.mockReset();
    pushSpy.mockReset();
    installAccountLifetime(ACTIVE_SCOPE);
    storage.setState((state) => ({
        ...state,
        profileScope: ACTIVE_SCOPE,
        workflowRunsById: {},
    }));
});

describe('inline transcript workflow Run result', () => {
    it('mounts the exact Run card and refreshes that Run into the Account store once', async () => {
        executeMock.mockResolvedValueOnce(getResult('running'));
        const screen = await renderCardRow();
        await settle();

        expect(screen.findByTestId(`transcript-workflow-run-${RUN_ID}`)).toBeTruthy();
        // One exact read through the Action front door, by `runId` alone.
        expect(executeMock.mock.calls.map(([actionId, input]) => [actionId, input])).toEqual([
            ['workflow.run.get', { runId: RUN_ID }],
        ]);
        expect(storage.getState().workflowRunsById[RUN_ID]?.summary?.state).toBe('running');
        expect(screen.findByTestId(`transcript-workflow-run-${RUN_ID}-state`)).toBeTruthy();
        const text = collectHostText(screen.tree);
        expect(text).toContain('workflows.runState.running');
        // The accepted private title, read from the same exact Run detail.
        expect(text).toContain('Release audit');
        expect(text).not.toContain('workflows.run.untitled');
    });

    it('says private content is unavailable only when the owner says so', async () => {
        executeMock.mockResolvedValueOnce(getResult('running', 2, null));
        const screen = await renderCardRow();
        await settle();

        const text = collectHostText(screen.tree);
        expect(text).toContain('workflows.contentUnavailable');
        expect(text).not.toContain('workflows.run.untitled');
    });

    it('reads a Run the store already holds without another request and follows its live updates', async () => {
        storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(createWorkflowRunSummaryFixture({
            id: RUN_ID,
            origin: { kind: 'direct', originSessionId: 'session-1' },
            state: 'running',
            revision: 3,
        }))]);
        const screen = await renderCardRow();
        await settle();

        expect(executeMock).not.toHaveBeenCalled();
        expect(collectHostText(screen.tree)).toContain('workflows.runState.running');

        // The canonical invalidation owner upserts the newer revision; the
        // card follows the one shared row rather than polling.
        await act(async () => {
            storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(createWorkflowRunSummaryFixture({
                id: RUN_ID,
                origin: { kind: 'direct', originSessionId: 'session-1' },
                state: 'succeeded',
                revision: 4,
                updatedAt: '2026-09-08T10:05:00.000Z',
            }))]);
        });
        const text = collectHostText(screen.tree);
        expect(text).toContain('workflows.runState.succeeded');
        expect(text).not.toContain('workflows.runState.running');
    });

    it('opens the exact Run route, never a latest-run lookup', async () => {
        executeMock.mockResolvedValueOnce(getResult('running'));
        const screen = await renderCardRow();
        await settle();

        await screen.pressByTestIdAsync(`transcript-workflow-run-${RUN_ID}-open`);
        expect(pushSpy).toHaveBeenCalledWith(`/workflows/runs/${RUN_ID}`);
    });

    it('mirrors the same row-level outcome in the timeline chrome', async () => {
        executeMock.mockResolvedValueOnce(getResult('running'));
        const screen = await renderTimelineRow();
        await settle();

        expect(screen.findByTestId(`transcript-workflow-run-${RUN_ID}`)).toBeTruthy();
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it('stays truthful when the exact read fails: the link remains, no status is invented', async () => {
        executeMock.mockResolvedValueOnce({ ok: false, errorCode: 'offline', error: 'offline' });
        const screen = await renderCardRow();
        await settle();

        expect(screen.findByTestId(`transcript-workflow-run-${RUN_ID}`)).toBeTruthy();
        expect(screen.findByTestId(`transcript-workflow-run-${RUN_ID}-open`)).toBeTruthy();
        expect(screen.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}-state`)).toHaveLength(0);
        expect(storage.getState().workflowRunsById[RUN_ID]).toBeUndefined();
        // Unknown is not "unavailable": nothing authoritative said the content
        // cannot be read on this device.
        const text = collectHostText(screen.tree);
        expect(text).toContain('workflows.run.untitled');
        expect(text).not.toContain('workflows.contentUnavailable');
    });

    it('never reads or refreshes the active Account store for a row from another Home', async () => {
        const screen = await renderCardRow(startToolCall(), 'home-b');
        await settle();

        expect(executeMock).not.toHaveBeenCalled();
        expect(screen.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}`)).toHaveLength(0);
    });

    it('mounts nothing when the row cannot name its exact Home', async () => {
        const screen = await renderCardRow(startToolCall(), null);
        await settle();

        expect(executeMock).not.toHaveBeenCalled();
        expect(screen.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}`)).toHaveLength(0);
    });

    it('discards an exact read that completes after the Account lifetime retired', async () => {
        const deferred = createDeferred<unknown>();
        executeMock.mockImplementationOnce((_actionId: string, _input: unknown, context?: { signal?: AbortSignal }) => {
            context?.signal?.addEventListener('abort', () => deferred.resolve(getResult('running')));
            return deferred.promise;
        });
        await renderCardRow();
        await settle();
        expect(executeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            accountLifetime.retire?.();
            await deferred.promise;
            await flushHookEffects();
        });
        expect(storage.getState().workflowRunsById[RUN_ID]).toBeUndefined();
    });

    it('mounts nothing for a failed start, a read Action or an unrelated tool', async () => {
        const failed = await renderCardRow(startToolCall({
            result: JSON.stringify({ ok: false, errorCode: 'feature_disabled', error: 'off' }),
        }));
        await settle();
        expect(failed.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}`)).toHaveLength(0);

        standardCleanup();
        const read = await renderCardRow(makeToolCall({
            name: 'mcp__happier__workflow_run_get',
            state: 'completed',
            input: { runId: RUN_ID },
            result: JSON.stringify(getResult('running').result),
        }));
        await settle();
        expect(read.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}`)).toHaveLength(0);

        standardCleanup();
        const unrelated = await renderCardRow(makeToolCall({ name: 'Read', input: { file_path: '/a' }, result: 'ok' }));
        await settle();
        expect(unrelated.findAllHostsByTestId(`transcript-workflow-run-${RUN_ID}`)).toHaveLength(0);
        expect(executeMock).not.toHaveBeenCalled();
    });
});
