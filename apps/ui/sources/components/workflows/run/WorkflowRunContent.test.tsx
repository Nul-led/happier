import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup, withPopoverWebGlobals } from '@/dev/testkit';
import {
    createWorkflowDefinitionFixture,
    createWorkflowInvocationIndexFixture,
    createWorkflowRunSummaryFixture,
} from '@/dev/testkit/fixtures/workflowRunFixtures';
/**
 * Static on purpose. This module's dependency graph is large and its first
 * load runs to tens of seconds on a loaded host; imported lazily inside
 * `renderContent` that load was charged to whichever case ran first, which
 * could push it past the test timeout and leave every later case asserting
 * against a screen that never mounted. Loading at collection keeps each case's
 * clock for the behaviour it asserts. `vi.mock` is hoisted above this import.
 */
import { WorkflowRunContent } from './WorkflowRunContent';

const virtualizedListState = vi.hoisted(() => ({
    props: null as Record<string, any> | null,
    scrollToOffset: vi.fn(),
}));
const viewport = vi.hoisted(() => ({ window: { width: 1200, height: 800 } }));
const modalSpies = vi.hoisted(() => ({
    show: vi.fn<(config: unknown) => string>(() => 'workflow-detail-modal'),
    update: vi.fn<(id: string, props: unknown) => void>(),
    hide: vi.fn<(id: string) => void>(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => viewport.window });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: modalSpies }).module;
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) });
});
vi.mock('@/components/ui/navigation/SegmentedTabBar', () => ({
    SegmentedTabBar: (props: {
        tabs: ReadonlyArray<{ id: string; label: string }>;
        activeTabId: string;
        onSelectTab: (id: string) => void;
        testIDPrefix?: string;
    }) => React.createElement(
        'SegmentedTabBar',
        { testID: props.testIDPrefix },
        props.tabs.map((tab) => React.createElement('Pressable', {
            key: tab.id,
            testID: `${props.testIDPrefix}:${tab.id}`,
            accessibilityState: { selected: props.activeTabId === tab.id },
            onPress: () => props.onSelectTab(tab.id),
        })),
    ),
}));
vi.mock('@/components/ui/lists/virtualized', () => ({
    VirtualizedList: React.forwardRef((props: Record<string, any>, ref) => {
        virtualizedListState.props = props;
        React.useImperativeHandle(ref, () => ({
            scrollToIndex: vi.fn(),
            scrollToOffset: virtualizedListState.scrollToOffset,
        }));
        const header = React.isValidElement(props.ListHeaderComponent)
            ? props.ListHeaderComponent
            : props.ListHeaderComponent ? React.createElement(props.ListHeaderComponent) : null;
        const footer = React.isValidElement(props.ListFooterComponent)
            ? props.ListFooterComponent
            : props.ListFooterComponent ? React.createElement(props.ListFooterComponent) : null;
        const rows = (props.data as readonly unknown[]).slice(0, 2).map((item, index) => React.createElement(
            'VirtualizedListItem',
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index }),
        ));
        // Same contract as the real list: the empty component stands in for rows only when there are none.
        const empty = rows.length > 0 ? null : React.isValidElement(props.ListEmptyComponent)
            ? props.ListEmptyComponent
            : props.ListEmptyComponent ? React.createElement(props.ListEmptyComponent) : null;
        return React.createElement('VirtualizedList', props, header, ...rows, empty, footer);
    }),
}));

afterEach(async () => {
    await standardCleanup();
    virtualizedListState.props = null;
    virtualizedListState.scrollToOffset.mockReset();
    viewport.window = { width: 1200, height: 800 };
    modalSpies.show.mockClear();
    modalSpies.update.mockClear();
    modalSpies.hide.mockClear();
});

type ContentProps = React.ComponentProps<typeof WorkflowRunContent>;

function flattenTestStyle(style: unknown): Record<string, unknown> {
    if (typeof style === 'function') return flattenTestStyle(style({}));
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flattenTestStyle(entry) }), {});
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

async function renderContent(overrides: Partial<ContentProps> = {}) {
    const props: ContentProps = {
        run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
        definition: createWorkflowDefinitionFixture(),
        invocations: [],
        invocationsLoaded: true,
        invocationHistoryComplete: true,
        selectedInvocationId: null,
        onSelectInvocation: vi.fn(),
        view: 'activity',
        onChangeView: vi.fn(),
        ...overrides,
    };
    return renderScreen(React.createElement(WorkflowRunContent, props));
}

describe('WorkflowRunContent', () => {
    it('keeps a successful outcome outside Needs you while the origin acknowledgement is behind', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded', originDeliveryAckRevision: 0 }),
        });
        expect(screen.getTextContent()).toContain('workflows.runState.succeeded');
        expect(screen.findByTestId('workflow-run-needs-you')).toBeNull();
    });

    it('virtualizes paged Activity rows under one scroll owner while keeping selected and attention content reachable', async () => {
        const onLoadMoreInvocations = vi.fn();
        const invocations = Array.from({ length: 512 }, (_, index) => createWorkflowInvocationIndexFixture({
            id: `inv-${index}`,
            sequence: String(index),
            lifecycle: index === 400 ? 'waiting_for_approval' : 'completed',
        }));
        const screen = await renderContent({
            invocations,
            selectedInvocationId: 'inv-450',
            onLoadMoreInvocations,
        });

        expect(screen.findAllByType('VirtualizedList' as never)).toHaveLength(1);
        // The rows have one scroll owner; the only other one is the neighbouring
        // inspector, which scrolls the selected detail on its own.
        const scrollViews = screen.findAllByType('ScrollView' as never);
        expect(scrollViews.map((node) => node.props.testID)).toEqual(['workflow-run-inspector']);
        expect(screen.findAllByType('VirtualizedListItem' as never)).toHaveLength(2);
        expect(virtualizedListState.props?.data).toHaveLength(512);
        expect(virtualizedListState.props?.keyExtractor(invocations[450], 450)).toBe('inv-450');
        expect(screen.findByTestId('workflow-run-needs-you-inv-400')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-selected-detail')).toBeTruthy();

        await screen.pressByTestIdAsync('workflow-run-invocations-load-more');
        expect(onLoadMoreInvocations).toHaveBeenCalledTimes(1);
    });

    it('gives Flow one plain scroll owner without mounting the Activity list', async () => {
        const screen = await renderContent({ view: 'flow' });

        expect(screen.findAllByType('VirtualizedList' as never)).toHaveLength(0);
        expect(screen.findAllByType('ScrollView' as never)).toHaveLength(1);
        expect(screen.findByTestId('workflow-run-flow')).toBeTruthy();
    });

    /**
     * UX §3.2/§4.5: wide layouts place the selected detail in a neighbouring
     * inspector; compact ones use the canonical modal. The selected id and the
     * reviewed text buffers have one owner above both, so switching Activity
     * and Flow neither remounts the detail nor loses a half-written sentence.
     */
    it('keeps the selected detail in one neighbouring inspector across the Activity/Flow switch on wide layouts', async () => {
        const props: Partial<ContentProps> = {
            run: createWorkflowRunSummaryFixture({ state: 'interrupted' }),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'invocation_not_recoverable' },
                retry: { kind: 'available', causalInvocationIds: ['inv-1'] },
                continueSameConversation: { kind: 'available' },
                continueFreshAgent: { kind: 'unavailable', reason: 'recovery_not_prepared' },
                restoreWorkspace: { kind: 'unavailable', reason: 'recovery_not_prepared' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            onRetryWithReplacement: vi.fn(),
        };
        const screen = await renderContent({ ...props, view: 'activity' });

        const inspector = screen.findByTestId('workflow-run-inspector');
        expect(inspector).toBeTruthy();
        expect(inspector?.findAllByProps({ testID: 'workflow-run-selected-detail' }).length).toBeGreaterThan(0);
        // Not appended after the rows: the list's footer carries no detail.
        expect(virtualizedListState.props?.ListFooterComponent === null
            || screen.findAllByType('VirtualizedList' as never)[0]
                ?.findAllByProps({ testID: 'workflow-run-selected-detail' }).length === 0).toBe(true);
        expect(modalSpies.show).not.toHaveBeenCalled();

        // Open the replacement editor without typing: only a still-mounted
        // instance can keep that disclosure open across the view switch.
        await screen.pressByTestIdAsync('workflow-run-use-replacement-input');
        expect(screen.findByTestId('workflow-run-replacement-input')).not.toBeNull();
        await screen.update(React.createElement(WorkflowRunContent, {
            ...(screen.findByType(WorkflowRunContent as never)?.props as ContentProps),
            view: 'flow',
        }));
        expect(screen.findByTestId('workflow-run-flow')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-inspector')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-replacement-input')).not.toBeNull();
    });

    it('presents the selected detail through the canonical modal on compact layouts and returns focus to the row', async () => {
        viewport.window = { width: 390, height: 844 };
        const onSelectInvocation = vi.fn();
        const onDeselectInvocation = vi.fn();
        const invocation = createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' });
        const screen = await renderContent({
            invocations: [invocation],
            onSelectInvocation,
            onDeselectInvocation,
        });
        expect(modalSpies.show).not.toHaveBeenCalled();

        // Selecting from a row records where focus returns when the sheet closes.
        const row = screen.findByTestId('workflow-run-invocations-row-inv-1');
        const rowHost = { focus: vi.fn(), isConnected: true };
        await act(async () => {
            row?.props.onPress({ currentTarget: rowHost, nativeEvent: { target: 7 } });
        });
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-1');

        await screen.update(React.createElement(WorkflowRunContent, {
            ...(screen.findByType(WorkflowRunContent as never)?.props as ContentProps),
            selectedInvocationId: 'inv-1',
        }));
        expect(screen.findByTestId('workflow-run-inspector')).toBeNull();
        expect(screen.findByTestId('workflow-run-selected-detail')).toBeNull();
        expect(modalSpies.show).toHaveBeenCalledTimes(1);
        const config = modalSpies.show.mock.calls[0]?.[0] as Readonly<{
            chrome?: Readonly<{ kind: string; testID?: string }>;
            focusReturnRef?: Readonly<{ current: unknown }>;
            onRequestClose?: () => void;
            props: Readonly<{ testIDPrefix: string }>;
        }>;
        expect(config.chrome).toMatchObject({ kind: 'card', testID: 'workflow-run-detail-modal' });
        expect(config.focusReturnRef?.current).toBe(rowHost);
        expect(config.props.testIDPrefix).toBe('workflow-run');
        // Closing the sheet releases the selection through the one selection owner.
        config.onRequestClose?.();
        expect(onDeselectInvocation).toHaveBeenCalledTimes(1);

        // Growing past compact moves the same selection into the inspector and
        // takes the sheet down; nothing is selected twice.
        viewport.window = { width: 1200, height: 800 };
        await screen.update(React.createElement(WorkflowRunContent, {
            ...(screen.findByType(WorkflowRunContent as never)?.props as ContentProps),
        }));
        expect(modalSpies.hide).toHaveBeenCalledWith('workflow-detail-modal');
        expect(screen.findByTestId('workflow-run-inspector')).toBeTruthy();
    });

    it('leads with the outcome and the Run origin', async () => {
        const screen = await renderContent();

        expect(screen.findByTestId('workflow-run-state')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-outcome')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-origin')).toBeTruthy();
    });

    it('says usage is unavailable rather than showing zero', async () => {
        const screen = await renderContent();

        expect(screen.getTextContent()).toContain('workflows.run.usageUnavailable');
    });

    it('does not claim complete child coverage while invocation history is paged', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'completed' })],
            invocationHistoryComplete: false,
        });

        expect(screen.getTextContent()).toContain('workflows.runState.succeeded');
        expect(screen.getTextContent()).not.toContain('workflows.run.completedCount');
    });

    it('hides the Needs you section entirely when nothing is actionable', async () => {
        const screen = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'completed' })],
        });

        expect(screen.findAllByTestId('workflow-run-needs-you')).toHaveLength(0);
    });

    it('surfaces an actionable invocation in Needs you', async () => {
        const definition = createWorkflowDefinitionFixture({
            blocks: [{
                kind: 'step', id: 'analyze',
                document: { text: 'Analyze changes', references: [], attachments: [] }, input: [], result: { kind: 'text' },
            }],
        });
        const progress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0', logicalInvocationRecordId: 'inv-2',
        };
        const screen = await renderContent({
            definition,
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'completed' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-2', lifecycle: 'waiting_for_approval' }),
            ],
            invocationProgressById: new Map([['inv-2', progress]]),
        });

        expect(screen.findByTestId('workflow-run-needs-you')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-needs-you-inv-2')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Analyze changes');
        expect(screen.getTextContent()).not.toContain('inv-2');
        expect(screen.findAllByTestId('workflow-run-needs-you-inv-1')).toHaveLength(0);
    });

    it('labels invocation rows from opened private progress and keeps the UUID in technical details', async () => {
        const invocation = createWorkflowInvocationIndexFixture({ id: 'invocation-private-id', lifecycle: 'running' });
        const progress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0', logicalInvocationRecordId: invocation.id,
        };
        const screen = await renderContent({
            definition: createWorkflowDefinitionFixture({ blocks: [{
                kind: 'step', id: 'analyze',
                document: { text: 'Analyze changes', references: [], attachments: [] }, input: [], result: { kind: 'text' },
            }] }),
            invocations: [invocation],
            selectedInvocationId: invocation.id,
            selectedInvocationProgress: progress,
            invocationProgressById: new Map([[invocation.id, progress]]),
        });

        expect(screen.getTextContent()).toContain('Analyze changes');
        expect(screen.getTextContent()).not.toContain('invocation-private-id');
        await screen.pressByTestIdAsync('workflow-run-technical-toggle');
        expect(screen.getTextContent()).toContain('invocation-private-id');
    });

    it('offers only the controls the canonical availability projection permits', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1',
                state: 'running',
                availability: { pause: false, cancel: true, resumeBoundary: false },
            }),
            onPause: vi.fn(),
            onCancel: vi.fn(),
            onResume: vi.fn(),
        });

        expect(screen.findByTestId('workflow-run-cancel')).toBeTruthy();
        // `pause: false` is the owner saying this Run cannot pause; the UI must
        // not offer an inert button next to a reason it invented.
        expect(screen.findAllByTestId('workflow-run-pause')).toHaveLength(0);
        expect(screen.findAllByTestId('workflow-run-resume')).toHaveLength(0);
    });

    it('shows a submitted stop as a request, not as an applied stop', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            onCancel: vi.fn(),
            pendingControl: 'cancel',
        });

        expect(screen.getTextContent()).toContain('workflows.run.stopping');
    });

    /**
     * One durable operation at a time (screen mutex). While any is unsettled,
     * every other durable control is withdrawn as busy — not only the button
     * that was pressed — so Retry cannot race a pending Pause. Inspection,
     * selection and the view switch stay live.
     */
    it('withdraws every conflicting durable control while one operation is pending', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1', state: 'interrupted',
                availability: { cancel: true, pause: true, resumeBoundary: true },
            }),
            onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onRunAgain: vi.fn(), onDelete: vi.fn(),
            onReattach: vi.fn(), onRetrySameConversation: vi.fn(), onRetryFreshAgent: vi.fn(),
            onRetryWithReplacement: vi.fn(), onRestoreWorkspace: vi.fn(),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'invocation_not_recoverable' },
                retry: { kind: 'available', causalInvocationIds: ['inv-1'] },
                continueSameConversation: { kind: 'available' },
                continueFreshAgent: { kind: 'available' },
                restoreWorkspace: { kind: 'unavailable', reason: 'recovery_not_prepared' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
                recovery: {
                    conversation: 'same_conversation',
                    input: { kind: 'replacement', value: { document: { text: 'Finish', references: [], attachments: [] }, input: [] } },
                },
            },
            onContinuePrepared: vi.fn(),
            pendingControl: 'retry',
        });

        for (const testID of [
            'workflow-run-cancel', 'workflow-run-pause', 'workflow-run-resume',
            'workflow-run-retry-same', 'workflow-run-retry-fresh', 'workflow-run-continue-prepared',
        ]) {
            // The host node carries what assistive technology is told.
            const control = screen.findAllByTestId(testID).find((node) => typeof node.type === 'string');
            expect(control, testID).toBeTruthy();
            expect(control?.props.disabled, testID).toBe(true);
            expect(control?.props.accessibilityState, testID).toMatchObject({ disabled: true, busy: true });
        }
        // The rest of the screen is not inert.
        expect(screen.findByTestId('workflow-run-view:flow')?.props.disabled).toBeFalsy();
        expect(screen.findByTestId('workflow-run-technical-toggle')?.props.disabled).toBeFalsy();
    });

    it('renders invocation lifecycle from the canonical index, not from structure', async () => {
        const screen = await renderContent({
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'waiting_for_capacity' }),
            ],
        });

        expect(screen.findByTestId('workflow-run-invocations-state-inv-1')).toBeTruthy();
    });

    it('switches to Flow without losing the selected invocation identity', async () => {
        const onChangeView = vi.fn();
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' })],
            onChangeView,
        });

        screen.findByTestId('workflow-run-view:flow')?.props.onPress();

        expect(onChangeView).toHaveBeenCalledWith('flow');
    });

    it('maps Flow state only from opened private invocation paths, never by guessing ids', async () => {
        const invocation = createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' });
        const progress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0',
            logicalInvocationRecordId: 'inv-1',
        };
        const screen = await renderContent({
            view: 'flow', invocations: [invocation],
            invocationProgressById: new Map([['inv-1', progress]]),
            selectedInvocationId: 'inv-1', selectedInvocationProgress: progress,
        });
        expect(screen.findByTestId('workflow-run-flow-node-analyze-state')).toBeTruthy();
    });

    it('keeps repeated scoped occurrences and attempts individually selectable by exact invocation id', async () => {
        const onSelectInvocation = vi.fn();
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'item-1-attempt-0', sequence: '1', lifecycle: 'completed' }),
            createWorkflowInvocationIndexFixture({ id: 'item-2-attempt-0', sequence: '2', lifecycle: 'superseded' }),
            createWorkflowInvocationIndexFixture({ id: 'item-2-attempt-1', sequence: '3', attempt: '1', lifecycle: 'running' }),
        ];
        const invocationProgressById = new Map(invocations.map((invocation, index) => [invocation.id, {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: {
                blockId: 'analyze',
                scope: [
                    { kind: 'iteration' as const, blockId: 'rounds', index: 2 },
                    { kind: 'iteration' as const, blockId: 'files', index: index === 0 ? 0 : 1 },
                ],
            },
            frame: { ownerBlockId: 'files', source: { kind: 'item' as const, index: index === 0 ? '0' : '1' } },
            blockKind: 'step' as const,
            attempt: invocation.attempt,
            logicalInvocationRecordId: index === 2 ? 'item-2-attempt-0' : invocation.id,
            ...(index === 2 ? { previousAttemptRecordId: 'item-2-attempt-0' } : {}),
        }]));

        const screen = await renderContent({
            view: 'flow',
            invocations,
            invocationProgressById,
            selectedInvocationId: 'item-2-attempt-1',
            selectedInvocationProgress: invocationProgressById.get('item-2-attempt-1'),
            onSelectInvocation,
        });

        expect(screen.findByTestId('workflow-run-flow-node-analyze-occurrence-item-1-attempt-0')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-flow-node-analyze-occurrence-item-2-attempt-0')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-flow-node-analyze-occurrence-item-2-attempt-1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('workflows.input.iteration 3');
        expect(screen.getTextContent()).toContain('workflows.input.currentItem 2');
        await screen.pressByTestIdAsync('workflow-run-flow-node-analyze-occurrence-item-2-attempt-0');
        expect(onSelectInvocation).toHaveBeenCalledWith('item-2-attempt-0');
    });

    it('names and selects an exact unopened loop occurrence in Flow, starting from a paged index alone', async () => {
        const onSelectInvocation = vi.fn();
        const definition = createWorkflowDefinitionFixture({
            blocks: [{
                kind: 'loop',
                id: 'files',
                repetition: {
                    kind: 'items',
                    items: { kind: 'input', name: 'files' },
                    execution: 'parallel',
                    failurePolicy: 'collect_outcomes',
                },
                body: [{
                    kind: 'step',
                    id: 'inspect',
                    document: { text: 'Inspect the current item', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                }],
            }] as never,
        });
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({ id: 'loop', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
            createWorkflowInvocationIndexFixture({ id: 'frame-0', parentRecordId: 'loop', memberOrdinal: '0', sequence: '2' }),
            createWorkflowInvocationIndexFixture({ id: 'frame-1', parentRecordId: 'loop', memberOrdinal: '1', sequence: '3' }),
            createWorkflowInvocationIndexFixture({ id: 'inspect-0', parentRecordId: 'frame-0', memberOrdinal: '0', sequence: '4', lifecycle: 'completed' }),
            createWorkflowInvocationIndexFixture({ id: 'inspect-1', parentRecordId: 'frame-1', memberOrdinal: '0', sequence: '5', lifecycle: 'waiting_for_approval' }),
        ];

        const screen = await renderContent({
            view: 'flow',
            definition,
            invocations,
            // Nothing has been opened: no private progress exists yet.
            onSelectInvocation,
        });

        expect(screen.findByTestId('workflow-run-flow-node-inspect-occurrence-inspect-0')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-flow-node-inspect-occurrence-inspect-1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('workflows.input.currentItem 2');
        await screen.pressByTestIdAsync('workflow-run-flow-node-inspect-occurrence-inspect-1');
        expect(onSelectInvocation).toHaveBeenCalledWith('inspect-1');
    });

    it('gives Activity rows their authored identity before any private detail has been opened', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' }),
            createWorkflowInvocationIndexFixture({ id: 'analyze-row', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
        ];
        const screen = await renderContent({ invocations });

        const row = screen.findByTestId('workflow-run-invocations-row-analyze-row');
        expect(row?.props.accessibilityLabel).toContain('Analyze the repository');
        expect(row?.props.accessibilityLabel).not.toContain('workflows.contentUnavailable');
    });

    it('marks an unopened authored Flow node unavailable instead of activating a guessed invocation', async () => {
        const onSelectInvocation = vi.fn();
        const screen = await renderContent({
            view: 'flow',
            invocations: [createWorkflowInvocationIndexFixture({ id: 'opaque-row' })],
            onSelectInvocation,
        });

        const node = screen.findByTestId('workflow-run-flow-node-analyze');
        expect(node?.props.accessibilityState).toMatchObject({ disabled: true });
        node?.props.onPress?.();
        expect(onSelectInvocation).not.toHaveBeenCalled();
    });

    it('keeps technical identity behind the details section rather than in the outcome', async () => {
        const screen = await renderContent();
        expect(screen.getTextContent()).not.toContain('run-1');
        await screen.pressByTestIdAsync('workflow-run-technical-toggle');
        expect(screen.getTextContent()).toContain('run-1');
        expect(screen.getTextContent()).toContain('machine-1');
    });

    /**
     * The Machine is identified the way the rest of Happier names it. The
     * exact id stays available beside the name; an unnamed Machine keeps
     * showing its id rather than a blank.
     */
    it('names the frozen Machine in technical details and keeps its exact id', async () => {
        const named = await renderContent({ machineName: 'Mac Studio' });
        await named.pressByTestIdAsync('workflow-run-technical-toggle');
        expect(named.findByTestId('workflow-run-machine')?.props.children).toBe('Mac Studio');
        expect(named.findByTestId('workflow-run-machine-id')?.props.children).toBe('machine-1');
        await named.unmount();

        const unnamed = await renderContent();
        await unnamed.pressByTestIdAsync('workflow-run-technical-toggle');
        expect(unnamed.findByTestId('workflow-run-machine')?.props.children).toBe('machine-1');
        expect(unnamed.findByTestId('workflow-run-machine-id')).toBeNull();
    });

    it('routes an approval-backed invocation to its canonical Session owner', async () => {
        const openSession = vi.fn();
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
            },
            onOpenSession: openSession,
        });
        await screen.pressByTestIdAsync('workflow-run-open-session');
        expect(openSession).toHaveBeenCalledWith('session-1');
    });

    it('routes a detached invocation to the canonical execution Run owner', async () => {
        const openExecutionRun = vi.fn();
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                execution: {
                    kind: 'detached_run',
                    runId: 'execution/run 1',
                    localInputId: 'input-1',
                    runtimeSelection: {},
                },
            },
            onOpenExecutionRun: openExecutionRun,
        });
        await screen.pressByTestIdAsync('workflow-run-open-execution-run');
        expect(openExecutionRun).toHaveBeenCalledWith('execution/run 1');
        expect(screen.findByTestId('workflow-run-open-session')).toBeNull();
    });

    it('shows the exact selected invocation input and result from opened private content', async () => {
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                input: { repository: 'happier' },
                result: { passed: false, summary: 'One issue remains' },
                usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
            },
        });

        expect(screen.findByTestId('workflow-run-invocation-input')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-invocation-result')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-invocation-usage')).toBeTruthy();
        expect(screen.getTextContent()).toContain('One issue remains');
        expect(screen.getTextContent()).toContain('150');
    });

    /**
     * UX handbook §4.5: the outline says when its page is still loading rather
     * than looking like the end of history, and a loaded Run with no rows says
     * nothing has started — not the collection's "runs appear here" copy.
     */
    it('states a still-loading outline and an empty loaded outline distinctly', async () => {
        const loading = await renderContent({ invocationsLoaded: false, invocationHistoryComplete: false });
        expect(loading.findByTestId('workflow-run-invocations-loading')).not.toBeNull();
        expect(loading.findByTestId('workflow-run-invocations-empty')).toBeNull();
        await loading.unmount();

        const empty = await renderContent({ invocationsLoaded: true });
        expect(empty.findByTestId('workflow-run-invocations-loading')).toBeNull();
        expect(empty.findByTestId('workflow-run-invocations-empty')?.props.children)
            .toBe('workflows.run.notStarted');
    });

    /**
     * UX-26: per-step usage is explicitly unavailable when the provider
     * supplied none — never omitted as if it were zero or simply not loaded.
     * A container frame executes no agent, so it carries no usage row at all.
     */
    /**
     * Waiting and skipped rows, and a Run whose Machine went away, state only
     * what their canonical facts establish: the lifecycle plus the closed reason
     * code, and the machine owner's current reachability.
     */
    it('states a skipped cause and lost Machine contact from their canonical facts', async () => {
        const skipped = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'skipped' })],
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                reason: { code: 'condition_false' },
            },
        });
        expect(skipped.findByTestId('workflow-run-invocation-cause')).not.toBeNull();
        expect(skipped.findByTestId('workflow-run-machine-unavailable')).toBeNull();
        await skipped.unmount();

        const lost = await renderContent({ machineName: 'Mac Studio', machineReachable: false });
        expect(lost.findByTestId('workflow-run-machine-unavailable')).not.toBeNull();
        expect(lost.getTextContent()).toContain('workflows.run.machineUnavailable');
        await lost.unmount();

        const settled = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            machineName: 'Mac Studio',
            machineReachable: false,
        });
        expect(settled.findByTestId('workflow-run-machine-unavailable')).toBeNull();
    });

    it('says a step invocation usage is unavailable when the provider supplied none', async () => {
        const step = await renderContent({
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                result: 'done',
            },
        });
        expect(step.findByTestId('workflow-run-invocation-usage')?.props.children)
            .toBe('workflows.run.usageUnavailable');
        await step.unmount();

        const container = await renderContent({
            selectedInvocationId: 'inv-loop',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'review', scope: [] },
                blockKind: 'loop', attempt: '0', logicalInvocationRecordId: 'inv-loop',
            },
        });
        expect(container.findByTestId('workflow-run-invocation-usage')).toBeNull();
    });

    it('shows a nested working directory separately from its recorded checkout root', async () => {
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            workspaceHomeDirectory: '/Users/alice',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                workspace: { descriptor: {
                    machineId: 'machine-1',
                    directory: '/Users/alice/project/packages/ui',
                    checkoutRootPath: '/Users/alice/project',
                    sourceInvocation: {
                        producer: { blockId: 'analyze', scope: { kind: 'current' } },
                        invocationRecordId: 'inv-analyze-iteration-7',
                    },
                } },
            },
        });

        expect(screen.findByTestId('workflow-run-workspace-path')?.props.children).toBe('~/project/packages/ui');
        expect(screen.findByTestId('workflow-run-workspace-checkout-root')?.props.children)
            .toEqual(['workflows.workspace.projectCheckout', ': ', '~/project']);
        expect(screen.findByTestId('workflow-run-workspace-source')?.props.children)
            .toEqual('workflows.workspace.fromStep:{"block":"Analyze the repository · inv-analyze-iteration-7"}');
    });

    it('keeps an accepted stop request visible after the request itself has settled', async () => {
        const stopAgain = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1',
                state: 'running',
                availability: { cancel: true },
            }),
            machineName: 'Mac Studio',
            // The request completed; the Run is still active and the server
            // recorded `cancel_requested`. Reverting to "Stop" here told the
            // person to stop a Run that is already stopping.
            pendingControl: null,
            cancelRequested: true,
            onCancel: stopAgain,
        });

        expect(screen.getTextContent()).toContain('workflows.run.stopRequested:{"machine":"Mac Studio"}');
        expect(screen.getTextContent()).toContain('workflows.run.stopAgain');
        expect(screen.getTextContent()).not.toContain('"workflows.run.stop"');
        await screen.pressByTestIdAsync('workflow-run-cancel');
        expect(stopAgain).toHaveBeenCalledTimes(1);
    });

    it('does not invent a repeat-stop affordance from delete custody alone', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                state: 'outcome_uncertain',
                workflowCustodyState: 'pending',
                availability: { cancel: true },
            }),
            deleteBlockedByCustody: true,
            onCancel: vi.fn(),
        });

        // Custody is not a control state. Without a durable cancel receipt the
        // control is the ordinary Stop.
        expect(screen.getTextContent()).not.toContain('workflows.run.stopAgain');
        expect(screen.getTextContent()).toContain('workflows.run.stop');
    });

    it('resolves exactly one primary action when a terminal Run can also be run again', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1',
                state: 'succeeded',
                availability: { cancel: false, pause: false },
            }),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-failed', lifecycle: 'failed' })],
            firstFailedInvocationId: 'inv-failed',
            firstFailedInvocationResolution: 'resolved',
            onRunAgain: vi.fn(),
        });

        // The outcome region's dominant action is the one the state calls for.
        // `Run workflow again` stays available, but it stops competing with it.
        const seeFailures = flattenTestStyle(screen.findByTestId('workflow-run-see-failures')?.props.style);
        const runAgain = flattenTestStyle(screen.findByTestId('workflow-run-run-again')?.props.style);
        expect(seeFailures.borderWidth).toBe(0);
        expect(runAgain.borderWidth).not.toBe(0);
        expect(runAgain.backgroundColor).not.toBe(seeFailures.backgroundColor);
    });

    it('states how many interventions the Needs-you section holds', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-a', lifecycle: 'waiting_for_approval' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-b', sequence: '1', lifecycle: 'needs_attention' }),
            ],
        });

        const section = screen.findByTestId('workflow-run-needs-you');
        expect(section?.props.accessibilityLabel).toBe('workflows.a11y.needsYou:{"count":2}');
        expect(screen.getTextContent()).toContain('2');
    });

    it('announces a failed control request instead of leaving it silent', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            errorLabel: 'workflows.problem.targetUnavailable',
            errorSemantics: 'alert',
        });

        expect(screen.findByTestId('workflow-run-error')?.props.accessibilityRole).toBe('alert');
    });

    it('lets someone copy the exact technical identifiers', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-exact', state: 'running' }),
        });

        await screen.pressByTestIdAsync('workflow-run-technical-toggle');
        expect(screen.findByTestId('workflow-run-run-id')?.props.selectable).toBe(true);
        expect(screen.findByTestId('workflow-run-revision')?.props.selectable).toBe(true);
    });

    it('offers a reviewed new whole Run when the original workspace is unavailable', async () => {
        const startReviewedNewRun = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ state: 'cancelled', workflowCustodyState: 'settled' }),
            selectedInvocationId: 'inv-1',
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                reason: { code: 'workspace_unavailable' },
            },
            onRestoreWorkspace: vi.fn(),
            onStartReviewedNewRun: startReviewedNewRun,
        });

        // No restoration producer exists, so this is D4's second arm — and the
        // copy warns about repetition because only this arm repeats work.
        expect(screen.getTextContent()).toContain('workflows.workspace.unavailableNewRunBody');
        expect(screen.findAllByTestId('workflow-run-restore-workspace')).toHaveLength(0);
        await screen.pressByTestIdAsync('workflow-run-start-reviewed-new-run');
        expect(startReviewedNewRun).toHaveBeenCalledTimes(1);
        expect(screen.findAllByTestId('workflow-run-reattach')).toHaveLength(0);
    });

    it('offers exact workspace restoration when the canonical recovery projection permits it', async () => {
        const restoreWorkspace = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                state: 'interrupted',
                // Settled custody removes the waiting-for-stop block, so this is
                // the exact state in which both D4 arms were offered together.
                workflowCustodyState: 'settled',
                availability: { restoreWorkspace: true },
            }),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'workspace_unavailable' },
                retry: { kind: 'unavailable', reason: 'workspace_unavailable' },
                continueSameConversation: { kind: 'unavailable', reason: 'workspace_unavailable' },
                continueFreshAgent: { kind: 'unavailable', reason: 'workspace_unavailable' },
                restoreWorkspace: { kind: 'available' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                reason: { code: 'workspace_unavailable' },
                workspace: {
                    creationIntent: {
                        kind: 'git_worktree', sourceDirectory: '/repo', baseRef: 'a'.repeat(40),
                        displayName: 'workflow-analyze', branchMode: 'new',
                    },
                    descriptor: {
                        machineId: 'machine-1', directory: '/repo/.worktrees/workflow-analyze',
                        checkoutRootPath: '/repo/.worktrees/workflow-analyze',
                        checkout: { kind: 'git_worktree', branchName: 'workflow-analyze' },
                    },
                },
            },
            onRestoreWorkspace: restoreWorkspace,
            onStartReviewedNewRun: vi.fn(),
        });

        await screen.pressByTestIdAsync('workflow-run-restore-workspace');
        expect(restoreWorkspace).toHaveBeenCalledTimes(1);
        // Restoring resumes this Run with its completed work intact, so the
        // strictly worse offer is withheld and the copy does not warn about
        // repeating work that will not be repeated.
        expect(screen.findAllByTestId('workflow-run-start-reviewed-new-run')).toHaveLength(0);
        expect(screen.getTextContent()).toContain('workflows.workspace.unavailableRestoreBody');
        expect(screen.getTextContent()).not.toContain('workflows.recovery.repeatedEffectWarning');
    });

    it('blocks workspace replacement while authoritative Run custody is still pending', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                state: 'interrupted',
                workflowCustodyState: 'pending',
            }),
            selectedInvocationId: 'inv-1',
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                reason: { code: 'workspace_unavailable' },
            },
            onStartReviewedNewRun: vi.fn(),
        });

        expect(screen.findByTestId('workflow-run-recovery-waiting-for-stop')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-start-reviewed-new-run')).toBeNull();
    });

    it('gives the completion haptic a visible twin on the outcome region', async () => {
        const emphasised = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            completionEmphasis: true,
        });
        const quiet = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
        });

        // A haptic with nothing on screen is feedback only some users receive.
        const emphasisedStyle = flattenTestStyle(emphasised.findByTestId('workflow-run-outcome-region')?.props.style);
        const quietStyle = flattenTestStyle(quiet.findByTestId('workflow-run-outcome-region')?.props.style);
        expect(emphasisedStyle.backgroundColor).toBeDefined();
        expect(quietStyle.backgroundColor).toBeUndefined();
        expect(emphasised.findByTestId('workflow-run-outcome-emphasis')).toBeTruthy();
        expect(quiet.findByTestId('workflow-run-outcome-emphasis')).toBeNull();
    });

    it('keeps Delete history in the destructive overflow instead of beside normal actions', async () => {
        const screen = await renderContent({ onDelete: vi.fn(), onRunAgain: vi.fn() });
        expect(screen.findByTestId('workflow-run-delete')).toBeNull();
        expect(screen.findByTestId('workflow-run-overflow')).toBeTruthy();
    });

    it('offers Save as workflow from the frozen managed definition through the actions menu', async () => {
        const saveAsWorkflow = vi.fn();
        // The overflow opens the real canonical Popover, whose web placement owner
        // subscribes to `window`. The shared testkit harness supplies exactly those
        // globals instead of replacing the owner with a local stand-in.
        await withPopoverWebGlobals(async () => {
            const screen = await renderContent({ onSaveAsWorkflow: saveAsWorkflow, onDelete: vi.fn() });

            await screen.pressByTestIdAsync('workflow-run-overflow');
            expect(screen.findByTestId('workflow-run-save-as-workflow')).toBeTruthy();
            await screen.pressByTestIdAsync('workflow-run-save-as-workflow');
            // The canonical row-actions owner closes the menu and runs the action
            // off the current block — one macrotask on web — so the dispatch is
            // flushed with exactly that yield, as the owner's own test does.
            await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
        });
        expect(saveAsWorkflow).toHaveBeenCalledTimes(1);
    });

    it('gives every Run control and actionable row a real platform press target', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                id: 'run-1',
                state: 'running',
                availability: { cancel: true, pause: true },
            }),
            onCancel: vi.fn(),
            onPause: vi.fn(),
            onRunAgain: vi.fn(),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'waiting_for_approval' })],
        });

        // `hitSlop` is inert on react-native-web's `Pressable`, and the desktop
        // app IS the web bundle, so a slop-declared target is a target that does
        // not exist. The frame has to be real box model.
        for (const testID of [
            'workflow-run-cancel',
            'workflow-run-pause',
            'workflow-run-run-again',
            'workflow-run-needs-you-inv-1',
            'workflow-run-invocations-row-inv-1',
            'workflow-run-technical-toggle',
        ]) {
            const node = screen.findByTestId(testID);
            expect(node, testID).toBeTruthy();
            expect(flattenTestStyle(node?.props.style).minHeight, testID).toBe(44);
            expect(node?.props.hitSlop, testID).toBeUndefined();
        }
    });

    it('offers explicit same-conversation and fresh-Agent retry choices', async () => {
        const same = vi.fn();
        const fresh = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ state: 'interrupted' }),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'invocation_not_recoverable' },
                retry: { kind: 'available', causalInvocationIds: ['inv-1'] },
                continueSameConversation: { kind: 'available' },
                continueFreshAgent: { kind: 'available' },
                restoreWorkspace: { kind: 'unavailable', reason: 'recovery_not_prepared' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            onRetrySameConversation: same,
            onRetryFreshAgent: fresh,
        });
        await screen.pressByTestIdAsync('workflow-run-retry-same');
        await screen.pressByTestIdAsync('workflow-run-retry-fresh');
        expect(same).toHaveBeenCalledTimes(1);
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it('formats and exposes only the actual resolved workspace through canonical actions', async () => {
        const copyWorkspace = vi.fn();
        const openWorkspace = vi.fn();
        const screen = await renderContent({
            selectedInvocationId: 'inv-1',
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                workspace: {
                    descriptor: {
                        machineId: 'machine-1',
                        directory: '/Users/alice/project',
                        checkoutRootPath: '/Users/alice/project',
                        workspaceRefId: 'workspace-1',
                        checkout: { kind: 'git_worktree', branchName: 'workflow/analyze' },
                    },
                },
            },
            workspaceHomeDirectory: '/Users/alice',
            onCopyWorkspace: copyWorkspace,
            onOpenWorkspace: openWorkspace,
        });

        expect(screen.findByTestId('workflow-run-workspace-path')).toBeTruthy();
        expect(screen.getTextContent()).toContain('~/project');
        expect(screen.getTextContent()).toContain('workflow/analyze');
        await screen.pressByTestIdAsync('workflow-run-copy-workspace');
        await screen.pressByTestIdAsync('workflow-run-open-workspace');
        expect(copyWorkspace).toHaveBeenCalledWith('/Users/alice/project');
        expect(openWorkspace).toHaveBeenCalledWith('workspace-1', '/Users/alice/project');
    });

    it('does not offer retry or execution navigation for an ineligible selected row', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({
                state: 'interrupted',
                availability: { inspectExecution: false },
            }),
            selectedInvocationId: 'inv-1',
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'completed' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
            },
            onRetrySameConversation: vi.fn(),
            onRetryFreshAgent: vi.fn(),
            onOpenSession: vi.fn(),
        });

        expect(screen.findByTestId('workflow-run-retry-same')).toBeNull();
        expect(screen.findByTestId('workflow-run-retry-fresh')).toBeNull();
        expect(screen.findByTestId('workflow-run-open-session')).toBeNull();
    });

    /**
     * UX §3.3: a completed Run's primary action is **Open result**, and a Run
     * whose outcomes include failures leads with **See failures** instead. Both
     * navigate to the exact producing/failing invocation through the canonical
     * structure projection — never to "the latest row".
     */
    it('leads a completed Run with Open result and opens the exact final-output producer', async () => {
        const onSelectInvocation = vi.fn();
        const definition = createWorkflowDefinitionFixture({
            blocks: [
                {
                    kind: 'step', id: 'analyze',
                    document: { text: 'Analyze changes', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
                {
                    kind: 'step', id: 'implement',
                    document: { text: 'Implement the plan', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
            ],
            finalOutput: {
                kind: 'result',
                producer: { blockId: 'implement', scope: { kind: 'current' } },
                path: [],
            },
        });
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'inv-root', sequence: '0', parentRecordId: null, memberOrdinal: '0', lifecycle: 'completed' }),
            createWorkflowInvocationIndexFixture({ id: 'inv-analyze', sequence: '1', parentRecordId: 'inv-root', memberOrdinal: '0', lifecycle: 'completed' }),
            createWorkflowInvocationIndexFixture({ id: 'inv-implement', sequence: '2', parentRecordId: 'inv-root', memberOrdinal: '1', lifecycle: 'completed' }),
        ];
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            definition,
            invocations,
            // The canonical Action result names the exact producer row; this
            // consumer opens that row and never derives one.
            finalOutputInvocationId: 'inv-implement',
            resultLabel: 'All checks green',
            onSelectInvocation,
        });

        expect(screen.getTextContent()).toContain('All checks green');
        expect(screen.findAllByTestId('workflow-run-see-failures')).toHaveLength(0);
        await screen.pressByTestIdAsync('workflow-run-open-result');
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-implement');
    });

    it('opens the authoritative final producer even when that row is beyond the loaded history page', async () => {
        const onSelectInvocation = vi.fn();
        const definition = createWorkflowDefinitionFixture({
            blocks: [
                {
                    kind: 'step', id: 'analyze',
                    document: { text: 'Analyze changes', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
                {
                    kind: 'step', id: 'publish',
                    document: { text: 'Publish the result', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
            ],
            finalOutput: {
                kind: 'result',
                producer: { blockId: 'publish', scope: { kind: 'current' } },
                path: [],
            },
        });
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            definition,
            invocations: [
                createWorkflowInvocationIndexFixture({
                    id: 'inv-analyze', sequence: '1', parentRecordId: 'inv-root',
                    memberOrdinal: '0', lifecycle: 'completed',
                }),
            ],
            invocationHistoryComplete: false,
            finalOutputInvocationId: 'inv-publish-off-page',
            firstFailedInvocationId: null,
            firstFailedInvocationResolution: 'resolved',
            resultLabel: 'Published result',
            onSelectInvocation,
        });

        expect(screen.getTextContent()).toContain('Published result');
        expect(screen.findAllByTestId('workflow-run-result-absent')).toHaveLength(0);
        await screen.pressByTestIdAsync('workflow-run-open-result');
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-publish-off-page');
    });

    it('never reconstructs the final producer from invocation history', async () => {
        const definition = createWorkflowDefinitionFixture({
            blocks: [{
                kind: 'step', id: 'publish',
                document: { text: 'Publish the result', references: [], attachments: [] },
                input: [], result: { kind: 'text' },
            }],
            finalOutput: {
                kind: 'result',
                producer: { blockId: 'publish', scope: { kind: 'current' } },
                path: [],
            },
        });
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            definition,
            invocations: [
                createWorkflowInvocationIndexFixture({
                    id: 'inv-root', sequence: '0', parentRecordId: null,
                    memberOrdinal: '0', lifecycle: 'completed',
                }),
                createWorkflowInvocationIndexFixture({
                    id: 'old-publish-attempt', sequence: '1', parentRecordId: 'inv-root',
                    memberOrdinal: '0', lifecycle: 'completed',
                }),
            ],
            invocationHistoryComplete: false,
            resultLabel: 'Published result',
        });

        expect(screen.getTextContent()).toContain('Published result');
        expect(screen.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
        expect(screen.findAllByTestId('workflow-run-result-absent')).toHaveLength(0);

        // A complete page is not a licence to guess either: the row that
        // produced the selected result is a fact the Action owner reports, and
        // a matching block can have several attempts with different outcomes.
        const complete = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            definition,
            invocations: [
                createWorkflowInvocationIndexFixture({
                    id: 'inv-root', sequence: '0', parentRecordId: null,
                    memberOrdinal: '0', lifecycle: 'completed',
                }),
                createWorkflowInvocationIndexFixture({
                    id: 'old-publish-attempt', sequence: '1', parentRecordId: 'inv-root',
                    memberOrdinal: '0', lifecycle: 'completed',
                }),
            ],
            invocationHistoryComplete: true,
            resultLabel: 'Published result',
        });

        expect(complete.getTextContent()).toContain('Published result');
        expect(complete.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
        expect(complete.findAllByTestId('workflow-run-result-absent')).toHaveLength(0);
    });

    it('states the absence of a selected final result instead of implying one', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'completed' })],
            resultLabel: null,
        });

        expect(screen.getTextContent()).toContain('workflows.finalOutput.none');
        expect(screen.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
        // One final-output row, never two.
        expect(screen.findAllByTestId('workflow-run-result')).toHaveLength(0);
    });

    it('leads a Run whose outcomes include failures with See failures on the exact failed row', async () => {
        const onSelectInvocation = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-1', sequence: '1', lifecycle: 'completed' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-2', sequence: '2', memberOrdinal: '1', lifecycle: 'failed' }),
            ],
            resultLabel: 'partial',
            onSelectInvocation,
        });

        expect(screen.getTextContent()).toContain('workflows.runState.completed_with_failures');
        expect(screen.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
        await screen.pressByTestIdAsync('workflow-run-see-failures');
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-2');
    });

    it('opens the authoritative first failure even when that row is beyond the loaded history page', async () => {
        const onSelectInvocation = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-1', sequence: '1', lifecycle: 'completed' }),
            ],
            invocationHistoryComplete: false,
            firstFailedInvocationId: 'inv-failed-off-page',
            resultLabel: 'partial',
            onSelectInvocation,
        });

        await screen.pressByTestIdAsync('workflow-run-see-failures');
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-failed-off-page');
    });

    it.each(['loading', 'error'] as const)(
        'keeps the bounded result visible without a false terminal action while failure discovery is %s',
        async (firstFailedInvocationResolution) => {
            const screen = await renderContent({
                run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'succeeded' }),
                invocations: [
                    createWorkflowInvocationIndexFixture({ id: 'inv-1', sequence: '1', lifecycle: 'completed' }),
                ],
                invocationHistoryComplete: false,
                definition: createWorkflowDefinitionFixture({
                    blocks: [{
                        kind: 'step', id: 'publish',
                        document: { text: 'Publish', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                    finalOutput: {
                        kind: 'result', producer: { blockId: 'publish', scope: { kind: 'current' } }, path: [],
                    },
                }),
                resultLabel: 'Authoritative result preview',
                finalOutputInvocationId: 'inv-final-off-page',
                firstFailedInvocationResolution,
            });

            expect(screen.getTextContent()).toContain('Authoritative result preview');
            expect(screen.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
            expect(screen.findAllByTestId('workflow-run-see-failures')).toHaveLength(0);
            expect(screen.findAllByTestId('workflow-run-result-absent')).toHaveLength(0);
        },
    );

    it('offers See failures for a terminally failed Run and preserves its completed work', async () => {
        const onSelectInvocation = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'failed' }),
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-1', sequence: '1', lifecycle: 'completed' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-2', sequence: '2', memberOrdinal: '1', lifecycle: 'failed' }),
            ],
            onSelectInvocation,
        });

        await screen.pressByTestIdAsync('workflow-run-see-failures');
        expect(onSelectInvocation).toHaveBeenCalledWith('inv-2');
    });

    it('does not offer a terminal result action while the Run is still running', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' })],
            resultLabel: 'partial output',
        });

        expect(screen.findAllByTestId('workflow-run-open-result')).toHaveLength(0);
        expect(screen.findAllByTestId('workflow-run-see-failures')).toHaveLength(0);
        expect(screen.findAllByTestId('workflow-run-result-absent')).toHaveLength(0);
    });

    it('names each technical detail instead of reusing the section heading as a field label', async () => {
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ id: 'run-1', state: 'running' }),
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'running' })],
            selectedInvocationId: 'inv-1',
        });

        await screen.pressByTestIdAsync('workflow-run-technical-toggle');
        const text = screen.getTextContent();
        expect(text).toContain('workflows.run.technical.runId');
        expect(text).toContain('workflows.run.technical.invocationId');
        expect(text).toContain('workflows.run.technical.machine');
        expect(text).toContain('workflows.run.technical.revision');
        // The heading is not a field label, and Where is the editor's Machine control.
        expect(text).not.toContain('workflows.editor.whereTitle');
    });

    it('gives each Flow node its own lifecycle treatment rather than one uniform row', async () => {
        const definition = createWorkflowDefinitionFixture({
            blocks: [
                {
                    kind: 'step', id: 'analyze',
                    document: { text: 'Analyze changes', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
                {
                    kind: 'step', id: 'implement',
                    document: { text: 'Implement the plan', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                },
            ],
        });
        const screen = await renderContent({
            view: 'flow',
            definition,
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'inv-root', sequence: '0', parentRecordId: null, memberOrdinal: '0', lifecycle: 'running' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-analyze', sequence: '1', parentRecordId: 'inv-root', memberOrdinal: '0', lifecycle: 'completed' }),
                createWorkflowInvocationIndexFixture({ id: 'inv-implement', sequence: '2', parentRecordId: 'inv-root', memberOrdinal: '1', lifecycle: 'waiting_for_approval' }),
            ],
        });

        expect(screen.findByTestId('workflow-run-flow-node-analyze-state:variant:neutral')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-flow-node-implement-state:variant:warning')).toBeTruthy();
        // Icon plus label: colour is never the only carrier of the state.
        expect(screen.findByTestId('workflow-run-flow-node-analyze-state-marker')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-flow-node-implement-state-marker')).toBeTruthy();
    });

    /**
     * UX §6.1 lists prepared continuation and inspected-replacement retry as two
     * different reviewed decisions. Sharing one text buffer and one disclosure
     * between them means opening either reveals the other's half-written text
     * and submits it.
     */
    it('keeps the prepared continuation and the replacement retry in separate buffers', async () => {
        const onContinuePrepared = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ state: 'interrupted' }),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'invocation_not_recoverable' },
                retry: { kind: 'available', causalInvocationIds: ['inv-1'] },
                continueSameConversation: { kind: 'available' },
                continueFreshAgent: { kind: 'unavailable', reason: 'recovery_not_prepared' },
                restoreWorkspace: { kind: 'unavailable', reason: 'recovery_not_prepared' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            selectedInvocationProgress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
                recovery: {
                    conversation: 'same_conversation',
                    input: {
                        kind: 'replacement',
                        value: {
                            document: { text: 'Finish the original objective', references: [], attachments: [] },
                            input: ['recorded context'],
                        },
                    },
                },
            },
            onContinuePrepared,
            onRetryWithReplacement: vi.fn(),
        });

        // The prepared continuation opens closed (the owner already prepared it).
        expect(screen.findByTestId('workflow-run-continuation-input')).toBeNull();
        expect(screen.findByTestId('workflow-run-replacement-input')).toBeNull();

        // Ordinary Resume accepts the complete producer-prepared objective and
        // context immediately; opening the editor is optional.
        await screen.pressByTestIdAsync('workflow-run-continue-prepared');
        expect(onContinuePrepared).toHaveBeenCalledWith({
            conversation: 'same_conversation',
            document: { text: 'Finish the original objective', references: [], attachments: [] },
            input: ['recorded context'],
        });

        await screen.pressByTestIdAsync('workflow-run-edit-continuation');
        expect(screen.findByTestId('workflow-run-continuation-input')).not.toBeNull();
        // Opening the continuation must not open the replacement field too.
        expect(screen.findByTestId('workflow-run-replacement-input')).toBeNull();

        await screen.pressByTestIdAsync('workflow-run-use-replacement-input');
        const replacement = screen.findByTestId('workflow-run-replacement-input');
        expect(replacement).not.toBeNull();
        // Two decisions, two buffers: the replacement starts empty rather than
        // inheriting the prepared objective.
        expect(replacement?.props.value).toBe('');
        expect(screen.findByTestId('workflow-run-continuation-input')?.props.value)
            .toBe('Finish the original objective');
    });

    it('lets a replacement retry choose the fresh-agent conversation when the owner allows it', async () => {
        const onRetryWithReplacement = vi.fn();
        const screen = await renderContent({
            run: createWorkflowRunSummaryFixture({ state: 'interrupted' }),
            selectedInvocationId: 'inv-1',
            selectedInvocationRecoveryAvailability: {
                reattach: { kind: 'unavailable', reason: 'invocation_not_recoverable' },
                retry: { kind: 'available', causalInvocationIds: ['inv-1'] },
                continueSameConversation: { kind: 'available' },
                continueFreshAgent: { kind: 'available' },
                restoreWorkspace: { kind: 'unavailable', reason: 'recovery_not_prepared' },
            },
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'failed' })],
            onRetryWithReplacement,
        });

        await screen.pressByTestIdAsync('workflow-run-use-replacement-input');
        screen.findByTestId('workflow-run-replacement-input')?.props.onChangeText('Try the safer path');
        await act(async () => {});
        // Same conversation is the default, and fresh agent is genuinely
        // reachable rather than being decided by which capability came first.
        expect(screen.findByTestId('workflow-run-replacement-conversation-same_conversation')
            ?.props.accessibilityState?.selected).toBe(true);
        await screen.pressByTestIdAsync('workflow-run-replacement-conversation-fresh_agent');
        await screen.pressByTestIdAsync('workflow-run-submit-replacement');

        expect(onRetryWithReplacement).toHaveBeenCalledWith({
            conversation: 'fresh_agent',
            document: { text: 'Try the safer path', references: [], attachments: [] },
            input: [],
        });
    });

    /**
     * The index counts attempts from zero; people count from one. One formatter
     * owns that translation, so the Activity row, the Flow occurrence list, the
     * selected detail and their accessible names cannot disagree about which
     * attempt a person is looking at.
     */
    it('names the second physical attempt "Attempt 2" on every surface', async () => {
        const invocations = [
            createWorkflowInvocationIndexFixture({ id: 'analyze-first', sequence: '1', lifecycle: 'superseded' }),
            createWorkflowInvocationIndexFixture({ id: 'analyze-retry', sequence: '2', attempt: '1', lifecycle: 'running' }),
        ];
        const progress = (id: string, attempt: string) => ({
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt,
            logicalInvocationRecordId: 'analyze-first',
            ...(attempt === '0' ? {} : { previousAttemptRecordId: 'analyze-first' }),
        });
        const invocationProgressById = new Map([
            ['analyze-first', progress('analyze-first', '0')],
            ['analyze-retry', progress('analyze-retry', '1')],
        ]);
        const attemptTwo = 'workflows.run.attempt:{"attempt":"2"}';
        // Inside another translated label the mock serializes it once more.
        const attemptTwoNested = JSON.stringify(attemptTwo).slice(1, -1);
        const attemptOneNested = JSON.stringify('workflows.run.attempt:{"attempt":"1"}').slice(1, -1);

        const activity = await renderContent({
            invocations,
            invocationProgressById,
            selectedInvocationId: 'analyze-retry',
            selectedInvocationProgress: invocationProgressById.get('analyze-retry'),
        });
        const retryRow = activity.findByTestId('workflow-run-invocations-row-analyze-retry');
        expect(activity.findByTestId('workflow-run-invocations-attempt-analyze-retry')?.props.children).toBe(attemptTwo);
        expect(retryRow?.props.accessibilityLabel).toContain(attemptTwoNested);
        // The first attempt is not a retry and is not decorated as one.
        expect(activity.findByTestId('workflow-run-invocations-attempt-analyze-first')).toBeNull();
        expect(activity.findByTestId('workflow-run-invocation-attempt')?.props.children).toBe(attemptTwo);
        await activity.unmount();

        const flow = await renderContent({
            view: 'flow',
            invocations,
            invocationProgressById,
            selectedInvocationId: 'analyze-retry',
            selectedInvocationProgress: invocationProgressById.get('analyze-retry'),
        });
        const occurrence = flow.findByTestId('workflow-run-flow-node-analyze-occurrence-analyze-retry');
        expect(occurrence?.props.accessibilityLabel).toContain(attemptTwoNested);
        expect(occurrence?.props.accessibilityLabel).not.toContain(attemptOneNested);
        expect(flow.findByTestId('workflow-run-flow-node-analyze-occurrence-analyze-first')?.props.accessibilityLabel)
            .toContain(attemptOneNested);
    });

    it('carries the Activity row lifecycle with a marker, not colour alone', async () => {
        const screen = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1', lifecycle: 'outcome_uncertain' })],
        });

        expect(screen.findByTestId('workflow-run-invocations-state-inv-1:variant:warning')).toBeTruthy();
        expect(screen.findByTestId('workflow-run-invocations-state-inv-1-marker')).toBeTruthy();
    });

    /**
     * A continuation that failed keeps the rows already read and replaces only
     * the paging action with its reason and a Retry that asks for the same page
     * again, exactly as the Workflows collection presents a failed page.
     */
    it('replaces the Activity paging action with an accessible retry that keeps the loaded rows', async () => {
        const onLoadMoreInvocations = vi.fn();
        const screen = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({ id: 'inv-1' })],
            invocationHistoryComplete: false,
            onLoadMoreInvocations,
            loadMoreInvocationsFailed: true,
        });

        expect(screen.findByTestId('workflow-run-invocations-load-more')).toBeNull();
        expect(screen.findByTestId('workflow-run-invocations-load-more-error')?.props.accessibilityRole)
            .toBe('alert');
        expect(screen.findByTestId('workflow-run-invocations-row-inv-1')).toBeTruthy();

        await screen.pressByTestIdAsync('workflow-run-invocations-load-more-retry');
        expect(onLoadMoreInvocations).toHaveBeenCalledTimes(1);
    });

    it('replaces the Needs you paging action with an accessible retry that keeps the attention rows', async () => {
        const onLoadMoreAttention = vi.fn();
        const screen = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({
                id: 'inv-attention', lifecycle: 'waiting_for_approval',
            })],
            onLoadMoreAttention,
            loadMoreAttentionFailed: true,
        });

        expect(screen.findByTestId('workflow-run-needs-you-load-more')).toBeNull();
        expect(screen.findByTestId('workflow-run-needs-you-load-more-error')?.props.accessibilityRole)
            .toBe('alert');
        expect(screen.findByTestId('workflow-run-needs-you-inv-attention')).toBeTruthy();

        await screen.pressByTestIdAsync('workflow-run-needs-you-load-more-retry');
        expect(onLoadMoreAttention).toHaveBeenCalledTimes(1);
    });

    it('withdraws the Needs you paging action while its page is in flight', async () => {
        const onLoadMoreAttention = vi.fn();
        const screen = await renderContent({
            invocations: [createWorkflowInvocationIndexFixture({
                id: 'inv-attention', lifecycle: 'waiting_for_approval',
            })],
            onLoadMoreAttention,
            loadingMoreAttention: true,
        });

        const action = screen.findByTestId('workflow-run-needs-you-load-more');
        expect(action?.props.accessibilityState?.disabled).toBe(true);
        expect(action?.props.disabled).toBe(true);
    });
});
