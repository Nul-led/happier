import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionWorkflowRunSnapshotV1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import {
    createWorkflowDefinitionFixture,
    createWorkflowInvocationIndexFixture,
    createWorkflowRunSummaryFixture,
} from '@/dev/testkit/fixtures/workflowRunFixtures';
import { installSessionSubagentCommonModuleMocks } from '@/components/sessions/agents/sessionSubagentTestHelpers';
import type { SessionWorkSources } from './sessionWorkSources';

import type { WorkItem } from './workProjection';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = { serverId: 'server-1', accountId: 'account-1' };

/** The exact-Run reader's Action client is the network boundary (as in the Run screen's tests). */
const detailActions = vi.hoisted(() => ({
    getRun: vi.fn(),
    listInvocations: vi.fn(),
}));
vi.mock('@/sync/domains/workflows/workflowRunDetailActions', () => ({
    workflowRunDetailActions: detailActions,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => ({
        scope: SCOPE,
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => undefined }),
    }),
}));

// Only the storage environment is replaced: the Run invocation window is the real canonical domain.
installSessionSubagentCommonModuleMocks({
    storage: async () => {
        const { create } = await import('zustand');
        const { createWorkflowRunsDomain } = await import('@/sync/store/domains/workflowRuns');
        type Domain = import('@/sync/store/domains/workflowRuns').WorkflowRunsDomain;
        const store = create<Domain>()((set, get) => createWorkflowRunsDomain<Domain>({ set, get }));
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({ storage: store, useActiveServerAccountScope: () => SCOPE });
    },
});

function needsYouSession(): WorkItem {
    return {
        key: 'session:checkout',
        kind: 'session',
        title: 'Checkout UI retry states',
        agentId: 'claude',
        facts: ['Claude'],
        parentKey: null,
        level: 0,
        status: { bucket: 'needs_you', tone: 'attention', word: 'Needs your permission' },
        progress: null,
        open: { kind: 'session', sessionId: 'checkout' },
    };
}

describe('WorkItemRow', () => {
    it('states where the work stands and opens it, with no answer controls on the row (S-1)', async () => {
        const { WorkItemRow } = await import('./WorkItemRow');
        const onOpen = vi.fn();
        const item = needsYouSession();
        const screen = await renderScreen(<WorkItemRow item={item} onOpen={onOpen} />);

        expect(screen.getTextContent()).toContain('Needs your permission');
        expect(screen.getTextContent()).toContain('Checkout UI retry states');
        // One pressable: the row itself. Allow / Deny live on the transcript card, the peek and the Inbox.
        const pressables = screen.findAll((node) => typeof node.props.onPress === 'function' && node.props.testID?.startsWith('session-work-row'));
        expect(pressables.length).toBeGreaterThan(0);
        expect(screen.getTextContent()).not.toMatch(/Allow|Deny/);

        await act(async () => {
            screen.pressByTestId('session-work-row:session:checkout');
        });
        expect(onOpen).toHaveBeenCalledWith(item);
    });

    it('says what kind of work each row is first in its subtitle, since the list groups by state', async () => {
        const { presentWorkItem } = await import('./WorkItemRow');
        const session = needsYouSession();
        const run: WorkItem = {
            ...session,
            key: 'run:review',
            kind: 'workflow_run',
            agentId: null,
            facts: ['7 of 12'],
            open: { kind: 'workflow_run', runId: 'review' },
        };

        expect(presentWorkItem(session).facts).toEqual(['sessionWork.kinds.session', 'Claude']);
        expect(presentWorkItem(run).facts).toEqual(['sessionWork.kinds.workflowRun', '7 of 12']);
    });
});

function workingRun(runId: string): WorkItem {
    return {
        key: `run:${runId}`,
        kind: 'workflow_run',
        title: 'Review each changed file',
        agentId: null,
        facts: [],
        parentKey: null,
        level: 0,
        status: { bucket: 'working', tone: 'neutral', word: 'Running' },
        progress: null,
        open: { kind: 'workflow_run', runId },
    };
}

function observedSnapshot(runId: string): SessionWorkflowRunSnapshotV1 {
    return {
        v: 1,
        projectionVersion: 1,
        runId,
        backendId: 'claude',
        title: 'Review each changed file',
        status: 'active',
        recordRevision: '1',
        updatedAt: 1,
        totalAgents: 2,
        completedAgents: 1,
        phases: [{ id: 'review', title: 'Review the files', order: 0, agentIds: ['a1', 'a2'] }],
        agents: [
            { id: 'a1', title: 'Review payments.ts', status: 'complete', updatedAt: 1 },
            { id: 'a2', title: 'Review ledger.ts', status: 'active', updatedAt: 1 },
        ],
    };
}

function workSources(input: Readonly<{
    snapshots?: readonly SessionWorkflowRunSnapshotV1[];
    managedRunIds?: readonly string[];
}>): SessionWorkSources {
    return {
        sessionId: 'lead',
        serverId: 'server-1',
        workflowActivity: {
            headline: null,
            activeRuns: [],
            runDetailById: new Map(),
            loadedRunsById: new Map((input.snapshots ?? []).map((snapshot) => [snapshot.runId, snapshot])),
        },
        managedRuns: {
            phase: 'loaded',
            runs: (input.managedRunIds ?? []).map((id) => createWorkflowRunSummaryFixture({ id })),
            attentionRunIds: new Set(),
            refreshFailed: false,
        },
        // Neither is read by a row's map.
        agentActivity: {} as SessionWorkSources['agentActivity'],
        projection: {} as SessionWorkSources['projection'],
    };
}

/** A scroll owner whose on-screen answer the test decides, as the Work pane's ScrollView does. */
function createTestViewport(initiallyVisible: boolean) {
    let visible = initiallyVisible;
    const observers = new Set<(next: boolean) => void>();
    return {
        viewport: {
            observe: (_target: unknown, onChange: (next: boolean) => void) => {
                observers.add(onChange);
                onChange(visible);
                return () => { observers.delete(onChange); };
            },
        },
        setVisible(next: boolean) {
            visible = next;
            for (const observer of observers) observer(next);
        },
    };
}

const MANAGED_DEFINITION = createWorkflowDefinitionFixture({
    blocks: [
        {
            kind: 'step',
            id: 'analyze',
            document: { text: 'Analyze the repository', references: [], attachments: [] },
            input: [],
            result: { kind: 'text' },
        },
        {
            kind: 'step',
            id: 'report',
            document: { text: 'Write the report', references: [], attachments: [] },
            input: [],
            result: { kind: 'text' },
        },
    ] as never,
});

function managedInvocations(analyzeLifecycle: 'running' | 'completed') {
    return {
        invocations: [
            createWorkflowInvocationIndexFixture({ id: 'root', runId: 'run-1', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({
                id: 'analyze-row',
                runId: 'run-1',
                parentRecordId: 'root',
                memberOrdinal: '0',
                sequence: '1',
                lifecycle: analyzeLifecycle,
                // A lifecycle change is a new fact about the row.
                contentRevision: analyzeLifecycle === 'running' ? '0' : '1',
            }),
        ],
        parentRevision: 1,
    };
}

/** Lets the reads a render started settle and render (the Action client resolves asynchronously). */
async function settleReads(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('WorkItemRow compact live map (INT §6 I4: workflow runs keep their mini-map)', () => {
    beforeEach(() => {
        detailActions.getRun.mockReset();
        detailActions.listInvocations.mockReset();
        detailActions.getRun.mockResolvedValue({ run: createWorkflowRunSummaryFixture({ id: 'run-1' }), definition: MANAGED_DEFINITION });
        detailActions.listInvocations.mockResolvedValue(managedInvocations('running'));
    });

    it("draws a working run's map from the Session's already-loaded activity, with no read of its own", async () => {
        const { WorkItemRow, WorkViewportContext } = await import('./WorkItemRow');
        const { SessionWorkSourcesProvider } = await import('./sessionWorkSources');
        const viewport = createTestViewport(true);
        const screen = await renderScreen(
            <SessionWorkSourcesProvider value={workSources({ snapshots: [observedSnapshot('wf-1')] })}>
                <WorkViewportContext.Provider value={viewport.viewport}>
                    <WorkItemRow item={workingRun('wf-1')} onOpen={vi.fn()} />
                </WorkViewportContext.Provider>
            </SessionWorkSourcesProvider>,
        );

        expect(screen.findAllHostsByTestId('session-work-minimap:run:wf-1').length).toBeGreaterThan(0);
        expect(screen.getTextContent()).toContain('Review payments.ts');
        expect(screen.getTextContent()).toContain('Review ledger.ts');
        expect(detailActions.getRun).not.toHaveBeenCalled();
    });

    it('mounts the map, and its reads, only while the row is on screen', async () => {
        const { WorkItemRow, WorkViewportContext } = await import('./WorkItemRow');
        const { SessionWorkSourcesProvider } = await import('./sessionWorkSources');
        const viewport = createTestViewport(false);
        const screen = await renderScreen(
            <SessionWorkSourcesProvider value={workSources({ managedRunIds: ['run-1'] })}>
                <WorkViewportContext.Provider value={viewport.viewport}>
                    <WorkItemRow item={workingRun('run-1')} onOpen={vi.fn()} />
                </WorkViewportContext.Provider>
            </SessionWorkSourcesProvider>,
        );
        expect(screen.findAllHostsByTestId('session-work-minimap:run:run-1')).toHaveLength(0);
        expect(detailActions.getRun).not.toHaveBeenCalled();
        expect(detailActions.listInvocations).not.toHaveBeenCalled();

        await act(async () => { viewport.setVisible(true); });
        await settleReads();
        expect(detailActions.getRun).toHaveBeenCalledTimes(1);
        expect(detailActions.listInvocations).toHaveBeenCalledTimes(1);
        expect(screen.findAllHostsByTestId('session-work-minimap:run:run-1').length).toBeGreaterThan(0);
        expect(screen.getTextContent()).toContain('Analyze the repository');
        expect(screen.getTextContent()).toContain('Write the report');
        expect(screen.findAllHostsByTestId('session-work-minimap:run:run-1-node-analyze-state').length).toBeGreaterThan(0);
        expect(screen.findAllHostsByTestId('session-work-minimap:run:run-1-node-report-state')).toHaveLength(0);

        await act(async () => { viewport.setVisible(false); });
        expect(screen.findAllHostsByTestId('session-work-minimap:run:run-1')).toHaveLength(0);
    });

    it("keeps a managed run's map live on the Run's Account-change wake without re-reading its frozen definition", async () => {
        const { WorkItemRow, WorkViewportContext } = await import('./WorkItemRow');
        const { SessionWorkSourcesProvider } = await import('./sessionWorkSources');
        const { publishHomeAccountChange } = await import('@/sync/runtime/orchestration/homeAccountChange');
        const viewport = createTestViewport(true);
        const screen = await renderScreen(
            <SessionWorkSourcesProvider value={workSources({ managedRunIds: ['run-1'] })}>
                <WorkViewportContext.Provider value={viewport.viewport}>
                    <WorkItemRow item={workingRun('run-1')} onOpen={vi.fn()} />
                </WorkViewportContext.Provider>
            </SessionWorkSourcesProvider>,
        );
        const stateText = () => screen
            .findAllByTestId('session-work-minimap:run:run-1-node-analyze-state')
            .map((node) => node.props.lifecycle)
            .filter(Boolean)
            .join('|');
        await settleReads();
        expect(stateText()).toBe('running');
        expect(detailActions.getRun).toHaveBeenCalledTimes(1);

        detailActions.listInvocations.mockResolvedValue(managedInvocations('completed'));
        await act(async () => { publishHomeAccountChange('server-1', ['workflow-run:run-1']); });
        await settleReads();

        expect(detailActions.listInvocations).toHaveBeenCalledTimes(2);
        expect(detailActions.getRun).toHaveBeenCalledTimes(1);
        expect(stateText()).toBe('completed');
    });

    it('measures rows against the Work scroll viewport: a hidden pane or a row scrolled away is off screen', async () => {
        const { useWorkScrollViewport } = await import('./WorkItemRow');
        type Rect = readonly [number, number, number, number];
        const measurable = (rect: Rect) => ({
            measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(...rect),
        });
        const scrollRect: { current: Rect } = { current: [0, 100, 320, 400] };
        const scrollRef = { current: { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(...scrollRect.current) } };
        let api: ReturnType<typeof useWorkScrollViewport> | null = null;
        function Harness() {
            api = useWorkScrollViewport(scrollRef as never);
            return null;
        }
        await renderScreen(<Harness />);
        const seen: Record<string, boolean[]> = { inside: [], below: [] };
        api!.viewport.observe({ current: measurable([0, 150, 320, 52]) } as never, (visible) => seen.inside.push(visible));
        api!.viewport.observe({ current: measurable([0, 900, 320, 52]) } as never, (visible) => seen.below.push(visible));
        expect(seen.inside.at(-1)).toBe(true);
        expect(seen.below.at(-1)).toBe(false);

        // The retained pane is hidden: it lays out at zero size.
        scrollRect.current = [0, 0, 0, 0];
        act(() => { api!.onLayout(); });
        expect(seen.inside.at(-1)).toBe(false);
    });

    it('does not admit live map work when its row or viewport cannot be measured', async () => {
        const { useWorkScrollViewport } = await import('./WorkItemRow');
        const scrollRef = { current: null };
        let api: ReturnType<typeof useWorkScrollViewport> | null = null;
        function Harness() {
            api = useWorkScrollViewport(scrollRef);
            return null;
        }
        await renderScreen(<Harness />);
        const seen: boolean[] = [];
        api!.viewport.observe({ current: null }, (visible) => seen.push(visible));
        expect(seen).toEqual([false]);
    });
});
