import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import {
    Collection,
    useHappierCollection,
    type CollectionAnatomy,
    type CollectionRowActions,
} from '@happier-dev/plugin-ui';
import type { HappierCollectionWindow } from '@happier-dev/plugin-ui/presentation';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { ActivitySpinner, iconMatchedSpinnerSize } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { ItemList } from '@/components/ui/lists/ItemList';
import { CoreCollectionScope } from '@/components/ui/lists/collection/CoreCollectionScope';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';
import { SelectionListSkeletonRow } from '@/components/ui/selectionList/SelectionListSkeletonRow';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useWorkflowRunWindow } from '@/components/workflows/library/workflowLibraryReads';
import { describeWorkflowRunState } from '@/components/workflows/presentation/workflowLifecyclePresentation';
import {
    formatWorkflowRunDisplayName,
    resolveWorkflowRunDisplayName,
} from '@/components/workflows/presentation/workflowRunDisplayName';
import { formatWorkflowRunOriginLabel } from '@/components/workflows/run/workflowRunDetailPresentation';
import { useAllMachines } from '@/sync/domains/state/storage';
import { createWorkflowRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import type { WorkflowRunListFilterId } from '@/sync/domains/workflows/workflowRunListActions';
import type { WorkflowRunRow } from '@/sync/store/domains/workflowRuns';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineDisplayNames';

import type { WorkflowRunSummaryV1 } from '@happier-dev/protocol/workflows/workflowProgressV1';

/** The narrowest readable row at normal text size. */
const HISTORY_MIN_WIDTH_PX = 320;

type HistoryRow = Readonly<{
    key: string;
    summary: WorkflowRunSummaryV1;
    title: string;
    meta: string;
    needsYou: boolean;
}>;

const readRowKey = (row: HistoryRow) => row.key;

const HistoryNeedsYouContext = React.createContext<(runId: string) => void>(() => undefined);

/**
 * History (FIN 07 S3; `/workflows/runs`): every run you started, through the canonical Collection.
 * **All | Active | Needs you | Triggered** are views of your retained runs. Triggered filters by the
 * run's frozen cause (F24), so it follows history membership rather than whether a trigger still
 * exists, and it is shown only while that history holds a triggered run.
 */
export function WorkflowsHistoryScreen(): React.ReactElement {
    const router = useRouter();
    const [view, setView] = React.useState<WorkflowRunListFilterId>('all');
    const selected = useWorkflowRunWindow(view);
    const attention = useWorkflowRunWindow('attention');
    // One read of the Triggered window decides whether its segment exists at all.
    const triggered = useWorkflowRunWindow('triggered');
    const machines = useAllMachines();
    const showTriggered = triggered.status === 'loaded' && triggered.rows.length > 0;
    const activeView = view === 'triggered' && !showTriggered && triggered.status === 'loaded' ? 'all' : view;
    React.useEffect(() => { if (activeView !== view) setView(activeView); }, [activeView, view]);

    const attentionIds = React.useMemo(() => new Set(attention.rows.map((row) => row.id)), [attention.rows]);
    const rows = React.useMemo(
        () => projectHistoryRows(selected.rows, attentionIds, (machineId) => (
            getMachineDisplayName(machines.find((machine) => machine.id === machineId) ?? null) ?? t('machine.unnamedMachine')
        )),
        [attentionIds, machines, selected.rows],
    );
    const window = React.useMemo((): HappierCollectionWindow => (selected.hasMore ? {
        kind: 'partial',
        continuations: [{
            key: 'more',
            label: selected.loadMoreFailed ? t('workflows.retry') : t('workflows.destination.history.loadMore'),
            load: selected.loadMore,
            busy: selected.loadingMore,
        }],
    } : { kind: 'complete' }), [selected.hasMore, selected.loadMore, selected.loadMoreFailed, selected.loadingMore]);
    const openRun = React.useCallback((key: string | null) => {
        if (key !== null) router.push(createWorkflowRunRoute(key) as never);
    }, [router]);
    const model = useHappierCollection<HistoryRow>({
        items: rows,
        keyOf: readRowKey,
        window,
        openKey: null,
        onOpenChange: openRun,
    });
    const anatomy = useHistoryAnatomy();

    const tabs = [
        { id: 'all' as const, label: t('workflows.destination.views.all') },
        { id: 'active' as const, label: t('workflows.destination.views.active') },
        { id: 'attention' as const, label: t('workflows.destination.views.needsYou') },
        ...(showTriggered ? [{ id: 'triggered' as const, label: t('workflows.destination.views.triggered') }] : []),
    ];

    const header = (
        <View>
            <PageHeader
                testID="workflows-history:header"
                title={t('workflows.destination.history.title')}
                description={t('workflows.destination.history.description')}
            />
            <View style={styles.views}>
                <SegmentedTabBar<WorkflowRunListFilterId>
                    testIDPrefix="workflows-history:view"
                    accessibilityLabel={t('workflows.destination.views.historyAccessibility')}
                    tabs={tabs}
                    activeTabId={activeView}
                    onSelectTab={setView}
                    segmentSizing="content"
                />
            </View>
        </View>
    );

    const empty = selected.status === 'failed' && selected.rows.length === 0 ? (
        <SurfaceStateCard
            testID="workflows-history:failed"
            kind="error"
            title={t('workflows.destination.history.loadFailedTitle')}
            reason={t('workflows.destination.history.loadFailedBody')}
            action={{ label: t('workflows.retry'), onPress: selected.retry }}
            accessibilitySemantics="alert"
        />
    ) : selected.status !== 'loaded' ? (
        // First load: list-shaped placeholders where the rows will be.
        <View testID="workflows-history:loading">
            {[0, 1, 2].map((index) => <SelectionListSkeletonRow key={index} index={index} />)}
        </View>
    ) : activeView === 'all' ? (
        <EmptyState
            testID="workflows-history:empty"
            layout="inline"
            iconName="clock-counter-clockwise"
            title={t('workflows.empty.runsTitle')}
            subtitle={t('workflows.empty.runsBody')}
        />
    ) : (
        <EmptyState
            testID="workflows-history:filteredEmpty"
            layout="inline"
            iconName="funnel-simple"
            title={t('workflows.empty.filteredTitle')}
            action={(
                <RoundButton
                    testID="workflows-history:clearFilter"
                    size="small"
                    display="secondary"
                    title={t('workflows.filters.clear')}
                    onPress={() => setView('all')}
                />
            )}
        />
    );

    return (
        <HistoryNeedsYouContext.Provider value={(runId) => openRun(runId)}>
            <CoreCollectionScope renderPageScroller={renderHistoryPageScroller}>
                <Collection<HistoryRow>
                    testID="workflows-history:collection"
                    model={model}
                    anatomy={anatomy}
                    accessibilityLabel={t('workflows.destination.history.title')}
                    presentation="list"
                    detail="none"
                    scroll="page"
                    minListWidth={HISTORY_MIN_WIDTH_PX}
                    minDetailWidth={HISTORY_MIN_WIDTH_PX}
                    preferredListRatio={1}
                    header={header}
                    loading={selected.status === 'loading' && selected.rows.length === 0}
                    useRowActions={useHistoryRowActions}
                    empty={empty}
                />
            </CoreCollectionScope>
        </HistoryNeedsYouContext.Provider>
    );
}

/** History's rows from one window of the Run store, with the names and facts each row states. */
export function projectHistoryRows(
    rows: readonly WorkflowRunRow[],
    attentionIds: ReadonlySet<string>,
    machineName: (machineId: string) => string,
    nowMs: number = Date.now(),
): readonly HistoryRow[] {
    const projected: HistoryRow[] = [];
    for (const row of rows) {
        const summary = row.summary;
        if (!summary) continue;
        const createdAt = Date.parse(summary.createdAt);
        projected.push({
            key: row.id,
            summary,
            title: formatWorkflowRunDisplayName(resolveWorkflowRunDisplayName(row.metadata)),
            meta: t('workflows.destination.history.rowMeta', {
                origin: formatWorkflowRunOriginLabel(summary.origin),
                machine: machineName(summary.machineId),
                age: Number.isFinite(createdAt) ? formatRelativeTimeShort(createdAt, nowMs) : '',
            }),
            needsYou: attentionIds.has(row.id),
        });
    }
    return projected;
}

function renderHistoryPageScroller(children: React.ReactNode): React.ReactNode {
    return (
        <ItemList presentation="page">
            <HistoryPageColumn>{children}</HistoryPageColumn>
        </ItemList>
    );
}

function HistoryPageColumn(props: Readonly<{ children?: React.ReactNode }>) {
    const maxWidthStyle = useLayoutMaxWidthStyle();
    return <View style={[styles.pageColumn, maxWidthStyle]}>{props.children}</View>;
}

function useHistoryAnatomy(): CollectionAnatomy<HistoryRow> {
    const { theme } = useUnistyles();
    return React.useMemo(() => ({
        glyph: (row) => {
            const presentation = describeWorkflowRunState(row.summary.state);
            // Quiet when healthy, including a stop you chose; tinted only for trouble (07 §2.3 item 7).
            const color = presentation.variant === 'danger' || presentation.variant === 'warning'
                ? theme.colors.state[presentation.variant].foreground
                : theme.colors.text.secondary;
            return presentation.marker.kind === 'icon'
                ? <Icon name={presentation.marker.icon} size={18} color={color} />
                : <ActivitySpinner size={iconMatchedSpinnerSize(18)} color={color} />;
        },
        title: (row) => row.title,
        where: (row) => row.meta,
        accessibilityLabel: (row) => `${row.title}, ${describeWorkflowRunState(row.summary.state).label}`,
        testID: (row) => `workflows-history:row:${row.key}`,
        columnTitles: { title: t('workflows.destination.history.title') },
    }), [theme.colors.state, theme.colors.text.secondary]);
}

/** A run that needs you offers **Review** in its row; it opens the run, never answers there. */
function useHistoryRowActions(row: HistoryRow): CollectionRowActions {
    const open = React.useContext(HistoryNeedsYouContext);
    if (!row.needsYou) return {};
    return {
        accessory: (
            <RoundButton
                testID={`workflows-history:review:${row.key}`}
                size="small"
                display="secondary"
                title={t('workflows.destination.history.review')}
                onPress={() => open(row.key)}
            />
        ),
    };
}

const styles = StyleSheet.create(() => ({
    pageColumn: {
        width: '100%',
        alignSelf: 'center',
    },
    views: {
        alignItems: 'flex-start',
        paddingBottom: 8,
    },
}));
