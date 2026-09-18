import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup, withPopoverWebGlobals } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

const virtualizedBoundary = vi.hoisted(() => ({
    props: null as Record<string, any> | null,
    mountLimit: Number.POSITIVE_INFINITY,
}));

vi.mock('@/components/ui/lists/virtualized', () => ({
    VirtualizedList: (props: Record<string, any>) => {
        virtualizedBoundary.props = props;
        const data = (props.data ?? []).slice(0, virtualizedBoundary.mountLimit);
        return React.createElement(
            'VirtualizedList',
            props,
            props.ListHeaderComponent,
            ...data.map((item: unknown, index: number) => props.renderItem({ item, index })),
            data.length === 0 ? props.ListEmptyComponent : null,
            props.ListFooterComponent,
        );
    },
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
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

afterEach(async () => {
    virtualizedBoundary.props = null;
    virtualizedBoundary.mountLimit = Number.POSITIVE_INFINITY;
    await standardCleanup();
});

function run(id: string, overrides: Record<string, unknown> = {}) {
    return createWorkflowRunSummaryFixture({
        id,
        origin: { kind: 'direct' },
        ...overrides,
    } as never);
}

function definition(id: string, title: string) {
    return {
        kind: 'workflow-definition.v1',
        definitionId: id,
        revision: { headerVersion: 1, bodyVersion: 1 },
        metadata: { title },
    };
}

function flattenTestStyle(style: unknown): Record<string, unknown> {
    if (typeof style === 'function') return flattenTestStyle(style({}));
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flattenTestStyle(entry) }), {});
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

async function renderCollection(overrides: Record<string, unknown> = {}) {
    const { WorkflowsScreen } = await import('./WorkflowsScreen');
    const element = React.createElement(WorkflowsScreen, {
        view: 'runs',
        onChangeView: () => {},
        savedState: 'loaded',
        savedDefinitions: [],
        onOpenDefinition: () => {},
        runsState: 'loaded',
        runs: [],
        runsFilter: 'all',
        onChangeRunsFilter: () => {},
        onOpenRun: () => {},
        onNewWorkflow: () => {},
        onRetry: () => {},
        ...overrides,
    } as never);
    return renderScreen(element);
}

describe('workflows collection', () => {
    it('shows admitted runs even when there are no saved definitions', async () => {
        const screen = await renderCollection({
            savedDefinitions: [],
            runs: [run('run-1')],
        });
        expect(screen.findByTestId('workflows-run-run-1')).not.toBeNull();
        expect(screen.findByTestId('workflows-empty')).toBeNull();
    });

    it('opens the exact run id rather than a latest-run heuristic', async () => {
        const opened: string[] = [];
        const screen = await renderCollection({
            runs: [run('run-1'), run('run-2')],
            onOpenRun: (id: string) => opened.push(id),
        });
        await screen.pressByTestIdAsync('workflows-run-run-2');
        expect(opened).toEqual(['run-2']);
    });

    it('distinguishes an empty filter from having no runs at all', async () => {
        const unfiltered = await renderCollection({ runs: [], runsFilter: 'all' });
        expect(unfiltered.getTextContent())
            .toContain('workflows.empty.runsTitle');
        expect(unfiltered.findByTestId('workflows-clear-filter')).toBeNull();
        await unfiltered.unmount();

        const filtered = await renderCollection({ runs: [], runsFilter: 'attention' });
        expect(filtered.getTextContent())
            .toContain('workflows.empty.filteredTitle');
        expect(filtered.findByTestId('workflows-clear-filter')).not.toBeNull();
    });

    it('keeps Import JSON available in the Saved header even after workflows exist', async () => {
        const withImport = await renderCollection({
            view: 'saved', savedDefinitions: [definition('definition-1', 'Review')], onImportJson: () => {},
        });
        expect(withImport.findByTestId('workflows-import')).not.toBeNull();
        await withImport.unmount();

        const runsView = await renderCollection({ runs: [], onImportJson: () => {} });
        expect(runsView.findByTestId('workflows-import')).toBeNull();
    });

    /**
     * UX handbook §4.1: an empty Saved view offers New workflow *or* Import
     * JSON as the next useful action; the Runs empty state offers only New.
     */
    it('offers Import JSON from the empty Saved state and never from the empty Runs state', async () => {
        const imported = vi.fn();
        const saved = await renderCollection({ view: 'saved', savedDefinitions: [], onImportJson: imported });
        expect(saved.findByTestId('workflows-empty-new')).not.toBeNull();
        await saved.pressByTestIdAsync('workflows-empty-import');
        expect(imported).toHaveBeenCalledTimes(1);
        await saved.unmount();

        const runs = await renderCollection({ view: 'runs', runs: [], onImportJson: imported });
        expect(runs.findByTestId('workflows-empty-new')).not.toBeNull();
        expect(runs.findByTestId('workflows-empty-import')).toBeNull();
    });

    it('keeps hydrated rows and explains itself when a refresh fails', async () => {
        const screen = await renderCollection({ runsState: 'failed', runs: [run('run-1')] });
        expect(screen.findByTestId('workflows-run-run-1')).not.toBeNull();
        expect(screen.findByTestId('workflows-refresh-error')).not.toBeNull();
        expect(screen.findByTestId('workflows-load-error')).toBeNull();
    });

    it('shows the full failure state only when there is nothing hydrated to keep', async () => {
        const screen = await renderCollection({ runsState: 'failed', runs: [] });
        expect(screen.findByTestId('workflows-load-error')).not.toBeNull();
        expect(screen.findByTestId('workflows-refresh-error')).toBeNull();
    });

    it('does not flash a loading state over rows it already has', async () => {
        const screen = await renderCollection({ runsState: 'loading', runs: [run('run-1')] });
        expect(screen.findByTestId('workflows-loading')).toBeNull();
        expect(screen.findByTestId('workflows-run-run-1')).not.toBeNull();
    });

    it('reports the selected view and filter to its owner rather than switching itself', async () => {
        const views: string[] = [];
        const filters: string[] = [];
        const screen = await renderCollection({
            runs: [run('run-1')],
            onChangeView: (view: string) => views.push(view),
            onChangeRunsFilter: (filter: string) => filters.push(filter),
        });

        await screen.pressByTestIdAsync('workflows-view:saved');
        await screen.pressByTestIdAsync('workflows-filter-attention');
        expect(views).toEqual(['saved']);
        expect(filters).toEqual(['attention']);

        // An incoming data update must not move the view or the filter.
        const { WorkflowsScreen } = await import('./WorkflowsScreen');
        await screen.update(React.createElement(WorkflowsScreen, {
            view: 'runs',
            onChangeView: (view: string) => views.push(view),
            savedState: 'loaded',
            savedDefinitions: [],
            onOpenDefinition: () => {},
            runsState: 'loaded',
            runs: [run('run-1'), run('run-2')],
            runsFilter: 'all',
            onChangeRunsFilter: (filter: string) => filters.push(filter),
            onOpenRun: () => {},
            onNewWorkflow: () => {},
            onRetry: () => {},
        } as never));
        expect(views).toEqual(['saved']);
        expect(filters).toEqual(['attention']);
    });

    it('names the run origin so a direct run is not presented as scheduled', async () => {
        const screen = await renderCollection({
            runs: [
                run('run-direct'),
                run('run-session', { origin: { kind: 'direct', originSessionId: 'session-1' } }),
                run('run-auto', { origin: { kind: 'automation', automationId: 'automation-1' } }),
            ],
        });
        expect(screen.getTextContent())
            .toContain('workflows.run.origin.direct');
        expect(screen.getTextContent())
            .toContain('workflows.run.origin.fromSession');
        expect(screen.getTextContent())
            .toContain('workflows.run.origin.automation');
    });

    it('uses an authorized workflow title when available and is explicit when private content is unavailable', async () => {
        const screen = await renderCollection({
            runs: [run('named'), run('private'), run('unnamed')],
            resolveRunDisplayName: (runId: string) => {
                if (runId === 'named') return { kind: 'name' as const, value: 'Release verification' };
                if (runId === 'private') return { kind: 'unavailable' as const };
                return { kind: 'unknown' as const };
            },
        });
        expect(screen.getTextContent()).toContain('Release verification');
        expect(screen.getTextContent()).toContain('workflows.contentUnavailable');
        expect(screen.findByTestId('workflows-run-private-locked')).not.toBeNull();
        // A row nothing has named yet is not an encryption failure: it keeps its
        // own identity and lifecycle rather than borrowing the locked phrase.
        expect(screen.getTextContent()).toContain('workflows.run.untitled');
        expect(screen.findByTestId('workflows-run-unnamed-locked')).toBeNull();
        const title = screen.findByTestId('workflows-run-named-title');
        expect(title?.props.numberOfLines).toBeUndefined();
        expect(screen.findByTestId('workflows-run-named')?.props.accessibilityLabel).toContain('Release verification');
    });

    it('shows each Run row its current state visibly, with a marker and not colour alone', async () => {
        const screen = await renderCollection({
            runs: [
                run('run-running', { state: 'running' }),
                run('run-interrupted', { state: 'interrupted' }),
            ],
        });

        expect(screen.getTextContent()).toContain('workflows.runState.running');
        expect(screen.getTextContent()).toContain('workflows.runState.interrupted');
        expect(screen.findByTestId('workflows-run-run-running-state:variant:success')).not.toBeNull();
        expect(screen.findByTestId('workflows-run-run-interrupted-state:variant:warning')).not.toBeNull();
        expect(screen.findByTestId('workflows-run-run-running-state-marker')).not.toBeNull();
    });

    it('offers Review on rows the server attention predicate returned, and only then', async () => {
        const attention = await renderCollection({
            runs: [run('run-1', { state: 'interrupted' })],
            runsFilter: 'attention',
        });
        expect(attention.findByTestId('workflows-run-run-1-review')).not.toBeNull();
        expect(attention.getTextContent()).toContain('workflows.run.review');
        await attention.unmount();

        // The unfiltered list is not an attention query, so this client cannot
        // claim a row needs the person without inventing a second predicate.
        const all = await renderCollection({
            runs: [run('run-1', { state: 'interrupted' })],
            runsFilter: 'all',
        });
        expect(all.findByTestId('workflows-run-run-1-review')).toBeNull();
    });

    it('opens a saved definition by its exact Artifact identity', async () => {
        const opened: string[] = [];
        const screen = await renderCollection({
            view: 'saved',
            savedDefinitions: [definition('def-1', 'Release check'), definition('def-2', 'Review files')],
            onOpenDefinition: (id: string) => opened.push(id),
        });
        await screen.pressByTestIdAsync('workflows-definition-def-2');
        expect(opened).toEqual(['def-2']);
    });

    it('exposes the complete Saved workflow action journey through the canonical row actions', async () => {
        const actions: string[] = [];
        // The row actions open the real canonical Popover, whose web placement
        // owner subscribes to `window`. The shared testkit harness supplies the
        // exact globals that owner needs instead of a local Popover stand-in
        // that would stop exercising it.
        await withPopoverWebGlobals(async () => {
            const screen = await renderCollection({
                view: 'saved',
                savedDefinitions: [definition('def-1', 'Release check')],
                onEditDefinition: (id: string) => actions.push(`edit:${id}`),
                onRunDefinition: (id: string) => actions.push(`run:${id}`),
                onScheduleDefinition: (id: string) => actions.push(`schedule:${id}`),
                onExportDefinition: (id: string) => actions.push(`export:${id}`),
                onDeleteDefinition: (id: string) => actions.push(`delete:${id}`),
            });

            for (const action of ['edit', 'run', 'schedule', 'export', 'delete']) {
                await screen.pressByTestIdAsync('workflows-definition-def-1-actions');
                await screen.pressByTestIdAsync(`workflows-definition-def-1-${action}`);
                // The canonical row-actions owner closes the menu first and runs
                // the action off the current block — one macrotask on web — so
                // each dispatch is flushed with exactly that yield, as the
                // owner's own test does. A microtask-only flush observed the
                // action only when another press happened to follow it.
                await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
            }
        });
        expect(actions).toEqual([
            'edit:def-1',
            'run:def-1',
            'schedule:def-1',
            'export:def-1',
            'delete:def-1',
        ]);
    });

    it('keeps loaded rows and offers an accessible Retry when the next page fails', async () => {
        const retried: number[] = [];
        const screen = await renderCollection({
            runs: [run('run-1')],
            hasMoreRuns: true,
            loadMoreFailed: true,
            onLoadMoreRuns: () => {},
            onRetryLoadMore: () => retried.push(1),
        });

        expect(screen.findByTestId('workflows-run-run-1')).not.toBeNull();
        expect(screen.findByTestId('workflows-load-error')).toBeNull();
        expect(screen.findByTestId('workflows-refresh-error')).toBeNull();
        const failure = screen.findByTestId('workflows-load-more-error');
        expect(failure).not.toBeNull();
        expect(failure?.props.accessibilityRole).toBe('alert');
        const retry = screen.findByTestId('workflows-load-more-retry');
        expect(retry?.props.accessibilityRole).toBe('button');
        expect(retry?.props.accessibilityLabel).toBe('workflows.retry');
        expect(flattenTestStyle(retry?.props.style).minHeight).toBe(44);
        // The failed page is asked for again, not the whole collection.
        await screen.pressByTestIdAsync('workflows-load-more-retry');
        expect(retried).toEqual([1]);
    });

    it('pages the selected collection without imposing a client-side history limit', async () => {
        const loads: string[] = [];
        const screen = await renderCollection({
            runs: [run('run-1')],
            hasMoreRuns: true,
            onLoadMoreRuns: () => loads.push('runs'),
        });
        await screen.pressByTestIdAsync('workflows-load-more-runs');
        expect(loads).toEqual(['runs']);
    });

    it('gives every collection row, filter and header action a real platform press target', async () => {
        const screen = await renderCollection({
            runs: [run('run-1')],
            onImportJson: () => {},
            hasMoreRuns: true,
            onLoadMoreRuns: () => {},
        });

        // `hitSlop` is inert on react-native-web's `Pressable`, and the desktop
        // app IS the web bundle, so the target has to be real box model.
        for (const testID of [
            'workflows-new',
            'workflows-filter-all',
            'workflows-filter-attention',
            'workflows-run-run-1',
            'workflows-load-more-runs',
        ]) {
            const node = screen.findByTestId(testID);
            expect(node, testID).not.toBeNull();
            expect(flattenTestStyle(node?.props.style).minHeight, testID).toBe(44);
            expect(node?.props.hitSlop, testID).toBeUndefined();
        }
    });

    it('keeps accumulated Run pages behind the canonical virtualized window', async () => {
        virtualizedBoundary.mountLimit = 2;
        const screen = await renderCollection({
            runs: Array.from({ length: 500 }, (_unused, index) => run(`run-${index}`)),
        });

        expect(virtualizedBoundary.props?.data).toHaveLength(500);
        expect(virtualizedBoundary.props?.testID).toBe('workflows-list');
        expect(screen.findByTestId('workflows-run-run-0')).not.toBeNull();
        expect(screen.findByTestId('workflows-run-run-1')).not.toBeNull();
        expect(screen.findByTestId('workflows-run-run-2')).toBeNull();
    });
});
