import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';
import { formatWithCachedDateTimeFormatter } from '@/utils/datetime/cachedIntlFormatters';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { Icon } from '@/components/ui/icons/Icon';
import { WorkflowRunStateStatus } from '@/components/workflows/presentation/WorkflowLifecycleStatus';
import { describeWorkflowRunState } from '@/components/workflows/presentation/workflowLifecyclePresentation';
import type { WorkflowProblemPresentation } from '@/components/workflows/presentation/workflowProblemPresentation';
import {
    formatWorkflowRunDisplayName,
    type WorkflowRunDisplayName,
} from '@/components/workflows/presentation/workflowRunDisplayName';

import type { WorkflowDefinitionArtifactHeaderV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';
import type { WorkflowRunSummaryV1 } from '@happier-dev/protocol/workflows/workflowProgressV1';

import {
    WORKFLOW_RUN_LIST_FILTERS,
    type WorkflowRunListFilterId,
} from '@/sync/domains/workflows/workflowRunListActions';

/**
 * The Workflows collection: Saved definitions and Account-scoped Runs.
 *
 * Saved and Runs are two controlled views over two owners, not two databases.
 * Zero saved definitions never hides admitted Runs, and an unsaved Run whose
 * originating Session is gone is still an ordinary row here. Data updates never
 * switch the selected view or filter, and returning restores both.
 */

/**
 * Collection rows, filters and header actions take the platform target as a
 * real minimum height. `hitSlop` is inert on react-native-web's `Pressable`,
 * and the desktop app IS the web bundle, so a slop-declared target there is a
 * target that does not exist.
 */
const MINIMUM_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    header: {
        gap: theme.margins.md,
        paddingHorizontal: theme.margins.lg,
        paddingTop: theme.margins.lg,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
        marginLeft: 'auto',
    },
    actionTarget: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
    },
    action: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    filters: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
    },
    filterLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    filterLabelActive: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    list: {
        paddingHorizontal: theme.margins.lg,
        paddingBottom: theme.margins.xxl,
    },
    listViewport: { flex: 1 },
    row: {
        paddingVertical: theme.margins.md,
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
        gap: theme.margins.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
    },
    savedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: MINIMUM_TARGET_SIZE,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
    },
    savedRowBody: {
        flex: 1,
        minWidth: 0,
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
        paddingVertical: theme.margins.md,
        gap: theme.margins.xs,
    },
    rowTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    rowTitleLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.xs,
    },
    rowTitleUnavailable: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
        flexShrink: 1,
    },
    rowMeta: {
        ...Typography.default('regular'),
        ...Typography.tabular(),
        color: theme.colors.text.secondary,
    },
    rowStatusLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    rowReview: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
        marginLeft: 'auto',
    },
    stateTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    stateBody: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    stateBlock: {
        paddingVertical: theme.margins.xxl,
        gap: theme.margins.sm,
        alignItems: 'flex-start',
    },
    errorBanner: {
        paddingVertical: theme.margins.md,
        gap: theme.margins.xs,
    },
}));

export type WorkflowsCollectionView = 'saved' | 'runs';

export type WorkflowsCollectionLoadState = 'loading' | 'loaded' | 'failed';

type WorkflowsCollectionRow =
    | Readonly<{ kind: 'saved'; definition: WorkflowDefinitionArtifactHeaderV1 }>
    | Readonly<{ kind: 'run'; run: WorkflowRunSummaryV1 }>;

function originLabel(origin: WorkflowRunSummaryV1['origin']): string {
    if (origin.kind === 'automation') return t('workflows.run.origin.automation');
    return origin.originSessionId === undefined
        ? t('workflows.run.origin.direct')
        : t('workflows.run.origin.fromSession');
}

function runCreatedLabel(createdAt: string): string {
    const value = new Date(createdAt);
    return Number.isNaN(value.getTime())
        ? createdAt
        : formatWithCachedDateTimeFormatter(value, undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function WorkflowsScreen(props: Readonly<{
    view: WorkflowsCollectionView;
    onChangeView: (view: WorkflowsCollectionView) => void;

    savedState: WorkflowsCollectionLoadState;
    savedDefinitions: readonly WorkflowDefinitionArtifactHeaderV1[];
    onOpenDefinition: (definitionId: string) => void;
    onEditDefinition?: (definitionId: string) => void;
    onRunDefinition?: (definitionId: string) => void;
    onScheduleDefinition?: (definitionId: string) => void;
    onExportDefinition?: (definitionId: string) => void;
    onDeleteDefinition?: (definitionId: string) => void;

    runsState: WorkflowsCollectionLoadState;
    runs: readonly WorkflowRunSummaryV1[];
    runsFilter: WorkflowRunListFilterId;
    onChangeRunsFilter: (filter: WorkflowRunListFilterId) => void;
    onOpenRun: (runId: string) => void;
    resolveMachineName?: (machineId: string) => string;
    /**
     * The authorized Account-side name for a Run, supplied by the host: the
     * public summary deliberately carries none. This leaf never opens private
     * content and never guesses a title.
     */
    resolveRunDisplayName?: (runId: string) => WorkflowRunDisplayName;
    hasMoreRuns?: boolean;
    loadingMoreRuns?: boolean;
    onLoadMoreRuns?: () => void;
    hasMoreSaved?: boolean;
    loadingMoreSaved?: boolean;
    onLoadMoreSaved?: () => void;
    /**
     * The next page of the visible window could not be loaded. Loaded rows
     * stay; this only replaces the paging action with the reason and a Retry
     * that asks for the same page again.
     */
    loadMoreFailed?: boolean;
    onRetryLoadMore?: () => void;

    onNewWorkflow: () => void;
    onImportJson?: () => void;
    onRetry: () => void;
    /**
     * The canonical Workflow problem state for the visible view's failed read.
     *
     * The Action owner already reports why — no access, private content this
     * device cannot open, a definition that is gone — and the host resolves it
     * through the one mapping. Without it every failure read as "Could not load
     * workflows", which offered a retry to people who needed something else.
     */
    loadFailure?: WorkflowProblemPresentation | null;
    testIDPrefix?: string;
}>): React.ReactElement {
    const maxWidthStyle = useLayoutMaxWidthStyle();
    const testIDPrefix = props.testIDPrefix ?? 'workflows';
    const showingSaved = props.view === 'saved';
    const activeState = showingSaved ? props.savedState : props.runsState;
    const isEmpty = showingSaved ? props.savedDefinitions.length === 0 : props.runs.length === 0;
    const filtered = !showingSaved && props.runsFilter !== 'all';
    const attentionQuery = !showingSaved && props.runsFilter === 'attention';
    const rows = React.useMemo<readonly WorkflowsCollectionRow[]>(() => (
        showingSaved
            ? props.savedDefinitions.map((definition) => ({ kind: 'saved' as const, definition }))
            : props.runs.map((run) => ({ kind: 'run' as const, run }))
    ), [props.runs, props.savedDefinitions, showingSaved]);

    const renderRow = React.useCallback(({ item }: { item: WorkflowsCollectionRow }) => {
        if (item.kind === 'saved') {
            const { definition } = item;
            const actionBase = `${testIDPrefix}-definition-${definition.definitionId}`;
            const actions: ItemAction[] = [];
            if (props.onEditDefinition !== undefined) actions.push({
                    id: `${actionBase}-edit`,
                    title: t('common.edit'),
                    icon: 'pencil',
                    onPress: () => props.onEditDefinition?.(definition.definitionId),
                });
            if (props.onRunDefinition !== undefined) actions.push({
                    id: `${actionBase}-run`,
                    title: t('workflows.editor.runNow'),
                    icon: 'play',
                    onPress: () => props.onRunDefinition?.(definition.definitionId),
                });
            if (props.onScheduleDefinition !== undefined) actions.push({
                    id: `${actionBase}-schedule`,
                    title: t('workflows.editor.schedule'),
                    icon: 'calendar',
                    onPress: () => props.onScheduleDefinition?.(definition.definitionId),
                });
            if (props.onExportDefinition !== undefined) actions.push({
                    id: `${actionBase}-export`,
                    title: t('workflows.exportJson'),
                    icon: 'download',
                    onPress: () => props.onExportDefinition?.(definition.definitionId),
                });
            if (props.onDeleteDefinition !== undefined) actions.push({
                    id: `${actionBase}-delete`,
                    title: t('common.delete'),
                    icon: 'trash',
                    destructive: true,
                    onPress: () => props.onDeleteDefinition?.(definition.definitionId),
                });
            return (
                <View style={styles.savedRow}>
                    <Pressable
                        testID={actionBase}
                        accessibilityRole="button"
                        accessibilityLabel={definition.metadata.title}
                        onPress={() => props.onOpenDefinition(definition.definitionId)}
                        style={styles.savedRowBody}
                    >
                        <Text style={styles.rowTitle}>{definition.metadata.title}</Text>
                        {definition.metadata.description === undefined ? null : (
                            <Text style={styles.rowMeta}>{definition.metadata.description}</Text>
                        )}
                    </Pressable>
                    {actions.length === 0 ? null : (
                        <ItemRowActions
                            title={definition.metadata.title}
                            actions={actions}
                            compactThreshold={Number.POSITIVE_INFINITY}
                            compactActionIds={[]}
                            overflowTriggerTestID={`${actionBase}-actions`}
                            overflowTriggerAccessibilityLabel={t('common.moreActions')}
                        />
                    )}
                </View>
            );
        }
        const { run } = item;
        const resolved = props.resolveRunDisplayName?.(run.id) ?? { kind: 'unknown' as const };
        const contentUnavailable = resolved.kind === 'unavailable';
        const displayName = formatWorkflowRunDisplayName(resolved);
        return (
            <Pressable
                testID={`${testIDPrefix}-run-${run.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('workflows.a11y.flowNode', {
                    node: displayName,
                    state: describeWorkflowRunState(run.state).label,
                })}
                onPress={() => props.onOpenRun(run.id)}
                style={styles.row}
            >
                <View style={styles.rowTitleLine}>
                    {/* The lock is the real encrypted state, never a stand-in for an unread row. */}
                    {contentUnavailable ? (
                        <View testID={`${testIDPrefix}-run-${run.id}-locked`}>
                            <Icon name="lock" size={14} />
                        </View>
                    ) : null}
                    <Text
                        testID={`${testIDPrefix}-run-${run.id}-title`}
                        style={contentUnavailable ? styles.rowTitleUnavailable : styles.rowTitle}
                    >
                        {displayName}
                    </Text>
                </View>
                <Text style={styles.rowMeta}>
                    {`${originLabel(run.origin)} · ${props.resolveMachineName?.(run.machineId) ?? run.machineId} · ${runCreatedLabel(run.createdAt)}`}
                </Text>
                <View style={styles.rowStatusLine}>
                    <WorkflowRunStateStatus
                        testID={`${testIDPrefix}-run-${run.id}-state`}
                        state={run.state}
                    />
                    {/*
                      * Attention is the server's `attention: 'required'` predicate.
                      * Rows in that filtered query are actionable by construction;
                      * the unfiltered list carries no such fact, and deriving one
                      * here would be a second attention decision-maker.
                      */}
                    {attentionQuery ? (
                        <Text testID={`${testIDPrefix}-run-${run.id}-review`} style={styles.rowReview}>
                            {t('workflows.run.review')}
                        </Text>
                    ) : null}
                </View>
            </Pressable>
        );
    }, [
        props.onDeleteDefinition,
        props.onEditDefinition,
        props.onExportDefinition,
        props.onOpenDefinition,
        props.onOpenRun,
        props.onRunDefinition,
        props.onScheduleDefinition,
        props.resolveMachineName,
        props.resolveRunDisplayName,
        attentionQuery,
        testIDPrefix,
    ]);

    // One localized reason, from the canonical mapping, in both failure shapes.
    const failureBody = props.loadFailure?.message ?? t('workflows.loadFailedBody');
    const failureRepairLabel = props.loadFailure === null || props.loadFailure === undefined
        ? t('workflows.retry')
        : props.loadFailure.repairLabel;

    const refreshFailure = activeState === 'failed' && !isEmpty ? (
        <View testID={`${testIDPrefix}-refresh-error`} style={styles.errorBanner}>
            <Text style={styles.stateBody}>{failureBody}</Text>
            {failureRepairLabel === null ? null : (
                <Pressable
                    testID={`${testIDPrefix}-retry`}
                    accessibilityRole="button"
                    accessibilityLabel={failureRepairLabel}
                    onPress={props.onRetry}
                    style={styles.actionTarget}
                >
                    <Text style={styles.action}>{failureRepairLabel}</Text>
                </Pressable>
            )}
        </View>
    ) : null;

    const emptyState = activeState === 'loading' ? (
        <View testID={`${testIDPrefix}-loading`} style={styles.stateBlock}>
            <ActivityIndicator accessibilityLabel={t('workflows.title')} />
        </View>
    ) : activeState === 'failed' ? (
        <View testID={`${testIDPrefix}-load-error`} style={styles.stateBlock}>
            <Text style={styles.stateTitle}>{t('workflows.loadFailedTitle')}</Text>
            <Text style={styles.stateBody}>{failureBody}</Text>
            {failureRepairLabel === null ? null : (
                <Pressable
                    testID={`${testIDPrefix}-retry`}
                    accessibilityRole="button"
                    accessibilityLabel={failureRepairLabel}
                    onPress={props.onRetry}
                    style={styles.actionTarget}
                >
                    <Text style={styles.action}>{failureRepairLabel}</Text>
                </Pressable>
            )}
        </View>
    ) : (
        <View testID={`${testIDPrefix}-empty`} style={styles.stateBlock}>
            <Text style={styles.stateTitle}>
                {filtered ? t('workflows.empty.filteredTitle')
                    : showingSaved ? t('workflows.empty.savedTitle')
                        : t('workflows.empty.runsTitle')}
            </Text>
            <Text style={styles.stateBody}>
                {filtered ? t('workflows.empty.filteredBody')
                    : showingSaved ? t('workflows.empty.savedBody')
                        : t('workflows.empty.runsBody')}
            </Text>
            {filtered ? (
                <Pressable
                    testID={`${testIDPrefix}-clear-filter`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.filters.clear')}
                    onPress={() => props.onChangeRunsFilter('all')}
                    style={styles.actionTarget}
                >
                    <Text style={styles.action}>{t('workflows.filters.clear')}</Text>
                </Pressable>
            ) : (
                <View style={styles.headerRow}>
                    <Pressable
                        testID={`${testIDPrefix}-empty-new`}
                        accessibilityRole="button"
                        accessibilityLabel={t('workflows.newWorkflow')}
                        onPress={props.onNewWorkflow}
                        style={styles.actionTarget}
                    >
                        <Text style={styles.action}>{t('workflows.newWorkflow')}</Text>
                    </Pressable>
                    {/* Saving is not the only way in: a definition exported
                        elsewhere is imported through the same review draft. */}
                    {showingSaved && props.onImportJson !== undefined ? (
                        <Pressable
                            testID={`${testIDPrefix}-empty-import`}
                            accessibilityRole="button"
                            accessibilityLabel={t('workflows.importJson')}
                            onPress={props.onImportJson}
                            style={styles.actionTarget}
                        >
                            <Text style={styles.action}>{t('workflows.importJson')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            )}
        </View>
    );

    const loadingMore = showingSaved ? props.loadingMoreSaved : props.loadingMoreRuns;
    const loadMore = !(showingSaved ? props.hasMoreSaved : props.hasMoreRuns) ? null : props.loadMoreFailed ? (
        <View testID={`${testIDPrefix}-load-more-error`} accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.stateBody}>{t('workflows.loadFailedBody')}</Text>
            <Pressable
                testID={`${testIDPrefix}-load-more-retry`}
                accessibilityRole="button"
                accessibilityLabel={t('workflows.retry')}
                accessibilityState={{ disabled: loadingMore === true }}
                disabled={loadingMore}
                onPress={props.onRetryLoadMore}
                style={styles.actionTarget}
            >
                <Text style={styles.action}>{t('workflows.retry')}</Text>
            </Pressable>
        </View>
    ) : (
        <Pressable
            testID={`${testIDPrefix}-load-more-${showingSaved ? 'saved' : 'runs'}`}
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={showingSaved ? props.onLoadMoreSaved : props.onLoadMoreRuns}
            style={styles.row}
        >
            <Text style={styles.action}>{t('workflows.run.loadMore')}</Text>
        </Pressable>
    );

    return (
        <View testID={testIDPrefix} style={styles.root}>
            <View style={[styles.header, maxWidthStyle]}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>{t('workflows.title')}</Text>
                    <View style={styles.headerActions}>
                        {showingSaved && props.onImportJson !== undefined ? (
                            <ToolbarButton
                                testID={`${testIDPrefix}-import`}
                                onPress={props.onImportJson}
                                style={styles.actionTarget}
                                label={t('workflows.importJson')}
                                size="md"
                            />
                        ) : null}
                        <ToolbarButton
                            testID={`${testIDPrefix}-new`}
                            onPress={props.onNewWorkflow}
                            style={styles.actionTarget}
                            label={t('workflows.newWorkflow')}
                            tone="primary"
                            size="md"
                        />
                    </View>
                </View>

                <SegmentedTabBar<WorkflowsCollectionView>
                    testIDPrefix={`${testIDPrefix}-view`}
                    accessibilityLabel={t('workflows.tabsAccessibility.savedRuns')}
                    tabs={[
                        { id: 'saved', label: t('workflows.tabs.saved') },
                        { id: 'runs', label: t('workflows.tabs.runs') },
                    ]}
                    activeTabId={props.view}
                    onSelectTab={props.onChangeView}
                    compact
                />

                {showingSaved ? null : (
                    <View style={styles.filters} accessibilityRole="radiogroup">
                        {WORKFLOW_RUN_LIST_FILTERS.map((filter) => (
                            <Pressable
                                key={filter}
                                testID={`${testIDPrefix}-filter-${filter}`}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: props.runsFilter === filter }}
                                accessibilityLabel={t(`workflows.filters.${filter === 'attention' ? 'needsYou' : filter}`)}
                                onPress={() => props.onChangeRunsFilter(filter)}
                                style={styles.actionTarget}
                            >
                                <Text style={props.runsFilter === filter
                                    ? styles.filterLabelActive
                                    : styles.filterLabel}
                                >
                                    {t(`workflows.filters.${filter === 'attention' ? 'needsYou' : filter}`)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </View>

            <VirtualizedList
                testID={`${testIDPrefix}-list`}
                data={rows}
                keyExtractor={(item) => item.kind === 'saved'
                    ? `saved:${item.definition.definitionId}`
                    : `run:${item.run.id}`}
                renderItem={renderRow}
                style={styles.listViewport}
                contentContainerStyle={[styles.list, maxWidthStyle]}
                backendPreference="auto"
                estimatedItemSize={72}
                initialNumToRender={12}
                ListHeaderComponent={refreshFailure}
                ListEmptyComponent={emptyState}
                ListFooterComponent={loadMore}
            />
        </View>
    );
}
