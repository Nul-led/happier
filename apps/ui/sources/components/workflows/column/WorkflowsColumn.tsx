import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import {
    HAPPIER_COLLECTION_LIST_METRICS,
    HAPPIER_COLLECTION_LIST_TEXT,
    HappierPressable,
    HappierSkeletonBlock,
} from '@happier-dev/plugin-ui/presentation';

import { usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { ActivitySpinner, iconMatchedSpinnerSize } from '@/components/ui/feedback/ActivitySpinner';
import { ICON_SIZE, Icon } from '@/components/ui/icons/Icon';
import {
    CollectionList,
    CollectionListGroupLabel,
    CollectionNavigationRow,
    collectionListStyles,
} from '@/components/ui/lists/collection/CollectionList';
import { SurfaceFreshnessLine } from '@/components/ui/surfaces/SurfaceFreshnessLine';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useWorkflowsDestinationAccess } from '@/components/workflows/gating/workflowsDestinationAccess';
import { AccountTriggersSection } from '@/components/workflows/triggers/AccountTriggersSection';
import {
    useWorkflowDefinitionLibrary,
    useWorkflowRunWindow,
} from '@/components/workflows/library/workflowLibraryReads';
import { describeWorkflowRunState } from '@/components/workflows/presentation/workflowLifecyclePresentation';
import {
    formatWorkflowRunDisplayName,
    resolveWorkflowRunDisplayName,
} from '@/components/workflows/presentation/workflowRunDisplayName';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';
import { useSocketStatus } from '@/sync/domains/state/storage';
import { createWorkflowRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import type { WorkflowRunRow } from '@/sync/store/domains/workflowRuns';
import { t } from '@/text';

import { WorkflowsColumnActions } from './WorkflowsColumnActions';

import {
    selectHistoryPreviewRuns,
    splitLibraryDefinitions,
} from './workflowsColumnModel';

/** What the open `/workflows/…` route selects, so the column marks exactly that row. */
function readOpenSelection(pathname: string): Readonly<{ definitionId: string | null; runId: string | null }> {
    const run = /^\/workflows\/runs\/([^/?#]+)/.exec(pathname);
    if (run) return { definitionId: null, runId: decode(run[1]!) };
    const definition = /^\/workflows\/([^/?#]+)$/.exec(pathname);
    if (definition && !['new', 'runs', 'settings', 'edit'].includes(definition[1]!)) {
        return { definitionId: decode(definition[1]!), runId: null };
    }
    return { definitionId: null, runId: null };
}

function decode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function ageOf(iso: string): string {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? formatRelativeTimeShort(at, Date.now()) : '';
}

function runTitle(row: WorkflowRunRow): string {
    return formatWorkflowRunDisplayName(resolveWorkflowRunDisplayName(row.metadata));
}

/**
 * The Workflows destination's column (FIN 04 §3.3, lab `nav-N1` as corrected by 07 §2.3): what needs
 * you, what is running, your library, your Account's triggers, what others shared with you, and
 * recent history. It is built like the Projects column on the canonical `CollectionList`, so its
 * header, labels and rows share every other column's rhythm. Only the open destination's column (or
 * its peek) is mounted, so a closed Workflows destination holds no subscriptions.
 */
export const WorkflowsColumn = React.memo(function WorkflowsColumn(props: Readonly<{
    /**
     * `page`: the column is the destination's first screen (a phone, or a collapsed column), so it
     * draws on the page instead of the shell's plane.
     */
    surface?: 'plane' | 'page';
}>) {
    const access = useWorkflowsDestinationAccess();
    return (
        <View testID="workflows-column" style={styles.column}>
            <CollectionList
                testID="workflows-column:list"
                surface={props.surface ?? 'plane'}
                title={t('workflows.title')}
                headerAction={access.kind === 'workflows' || access.kind === 'triggersOnly'
                    ? <WorkflowsColumnActions canCreate={access.kind === 'workflows'} />
                    : null}
            >
                {access.kind === 'workflows' ? <WorkflowsColumnSections /> : null}
                {access.kind === 'triggersOnly' ? <AccountTriggersSection first /> : null}
            </CollectionList>
        </View>
    );
});

const WorkflowsColumnSections = React.memo(function WorkflowsColumnSections() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const pathname = usePathname();
    const selection = readOpenSelection(pathname);
    const socket = useSocketStatus();
    const attention = useWorkflowRunWindow('attention');
    const active = useWorkflowRunWindow('active');
    const history = useWorkflowRunWindow('all');
    const library = useWorkflowDefinitionLibrary();
    const split = React.useMemo(() => splitLibraryDefinitions(library.definitions), [library.definitions]);
    const historyPreview = selectHistoryPreviewRuns(history.rows.flatMap((row) => row.summary ? [{ ...row.summary, row }] : []));
    const openRun = (runId: string) => router.push(createWorkflowRunRoute(runId) as never);

    const firstLoad = library.status === 'loading' && library.definitions.length === 0;
    const libraryFailed = library.status === 'failed' && library.definitions.length === 0;
    // Offline is a lost connection after this device had one; connecting for the first time is not.
    const offline = (socket.status === 'disconnected' || socket.status === 'error')
        && socket.lastConnectedAt !== null && library.status !== 'loading';
    const firstVisit = library.status === 'loaded' && library.definitions.length === 0
        && attention.status === 'loaded' && attention.rows.length === 0
        && active.status === 'loaded' && active.rows.length === 0
        && history.status === 'loaded' && history.rows.length === 0;

    return (
        <>
            {offline ? (
                <View style={styles.freshness}>
                    <SurfaceFreshnessLine
                        testID="workflows-column:offline"
                        asOf={socket.lastConnectedAt}
                        reason={t('workflows.destination.offline')}
                        action={{ label: t('workflows.retry'), onPress: () => { library.retry(); attention.retry(); active.retry(); history.retry(); } }}
                    />
                </View>
            ) : null}

            {attention.rows.length > 0 ? (
                <>
                    <CollectionListGroupLabel
                        testID="workflows-column:group:needsYou"
                        title={t('workflows.destination.sections.needsYou')}
                        count={attention.rows.length}
                        first
                    />
                    {attention.rows.map((row) => row.summary ? (
                        <CollectionNavigationRow
                            key={row.id}
                            testID={`workflows-column:needsYou:${row.id}`}
                            title={runTitle(row)}
                            subtitle={t('workflows.destination.waitingForYou', { age: ageOf(row.summary.updatedAt) })}
                            icon={<Icon name="hand" />}
                            rightElement={<View style={collectionListStyles.troubleDot} />}
                            selected={selection.runId === row.id}
                            onPress={() => openRun(row.id)}
                        />
                    ) : null)}
                </>
            ) : null}

            {firstLoad || active.rows.length > 0 ? (
                <>
                    <CollectionListGroupLabel
                        testID="workflows-column:group:running"
                        title={t('workflows.destination.sections.running')}
                        {...(active.rows.length > 0 ? { count: active.rows.length } : {})}
                        first={attention.rows.length === 0}
                    />
                    {firstLoad && active.rows.length === 0 ? <ColumnSkeletonRows count={2} /> : null}
                    {active.rows.map((row) => row.summary ? (
                        <CollectionNavigationRow
                            key={row.id}
                            testID={`workflows-column:running:${row.id}`}
                            title={runTitle(row)}
                            subtitle={t('workflows.destination.stateAge', {
                                state: describeWorkflowRunState(row.summary.state).label,
                                age: ageOf(row.summary.createdAt),
                            })}
                            icon={runStateGlyph(row.summary.state, !offline, theme)}
                            selected={selection.runId === row.id}
                            onPress={() => openRun(row.id)}
                        />
                    ) : null)}
                </>
            ) : null}

            <CollectionListGroupLabel
                testID="workflows-column:group:library"
                title={t('workflows.destination.sections.library')}
                {...(split.library.length > 0 ? { count: split.library.length } : {})}
                first={attention.rows.length === 0 && active.rows.length === 0 && !firstLoad}
            />
            {firstLoad ? <ColumnSkeletonRows count={3} /> : null}
            {libraryFailed ? (
                <ColumnStateLine
                    testID="workflows-column:library:failed"
                    text={t('workflows.destination.columnLoadFailed')}
                    action={{ label: t('workflows.retry'), onPress: library.retry }}
                />
            ) : null}
            {library.status === 'loaded' && split.library.length === 0 ? (
                <EmptyState
                    testID="workflows-column:library:empty"
                    layout="line"
                    title={t('workflows.destination.libraryEmpty')}
                    lineDensity="compact"
                    lineRowStyle={collectionListStyles.row}
                />
            ) : null}
            {split.library.map((definition) => (
                <CollectionNavigationRow
                    key={definition.definitionId}
                    testID={`workflows-column:library:${definition.definitionId}`}
                    title={definition.metadata.title}
                    icon={<Icon name="tree-structure" />}
                    selected={selection.definitionId === definition.definitionId}
                    onPress={() => router.push(`/workflows/${encodeURIComponent(definition.definitionId)}` as never)}
                />
            ))}

            <AccountTriggersSection />

            {split.sharedWithYou.length > 0 ? (
                <>
                    <CollectionListGroupLabel
                        testID="workflows-column:group:sharedWithYou"
                        title={t('workflows.destination.sections.sharedWithYou')}
                        count={split.sharedWithYou.length}
                    />
                    {split.sharedWithYou.map((definition) => (
                        <CollectionNavigationRow
                            key={definition.definitionId}
                            testID={`workflows-column:shared:${definition.definitionId}`}
                            title={definition.metadata.title}
                            icon={<Icon name="tree-structure" />}
                            selected={selection.definitionId === definition.definitionId}
                            onPress={() => router.push(`/workflows/${encodeURIComponent(definition.definitionId)}` as never)}
                        />
                    ))}
                </>
            ) : null}

            {!firstVisit && historyPreview.length > 0 ? (
                <>
                    <CollectionListGroupLabel
                        testID="workflows-column:group:history"
                        title={t('workflows.destination.sections.history')}
                        trailing={(
                            <ColumnGroupLink
                                testID="workflows-column:allRuns"
                                label={t('workflows.destination.allRuns')}
                                onPress={() => router.push('/workflows/runs' as never)}
                            />
                        )}
                    />
                    {historyPreview.map(({ row, state, createdAt }) => (
                        <CollectionNavigationRow
                            key={row.id}
                            testID={`workflows-column:history:${row.id}`}
                            title={runTitle(row)}
                            subtitle={t('workflows.destination.stateAge', {
                                state: describeWorkflowRunState(state).label,
                                age: ageOf(createdAt),
                            })}
                            icon={runStateGlyph(state, false, theme)}
                            selected={selection.runId === row.id}
                            onPress={() => openRun(row.id)}
                        />
                    ))}
                </>
            ) : null}
        </>
    );
});

type ColumnTheme = ReturnType<typeof useUnistyles>['theme'];

/**
 * A run's state glyph, as an element `Item` sizes in its leading column. Healthy and stopped-by-you
 * states are neutral; only failed, interrupted and uncertain runs take their state tone (FIN 07 §2.3
 * item 7). A live spinner stops while offline.
 */
function runStateGlyph(state: Parameters<typeof describeWorkflowRunState>[0], live: boolean, theme: ColumnTheme): React.ReactElement {
    const presentation = describeWorkflowRunState(state);
    const color = presentation.variant === 'danger' || presentation.variant === 'warning'
        ? theme.colors.state[presentation.variant].foreground
        : theme.colors.text.secondary;
    if (presentation.marker.kind === 'activity') {
        return live
            ? <ActivitySpinner size={iconMatchedSpinnerSize(ICON_SIZE.sm)} color={color} />
            : <Icon name="clock" color={color} />;
    }
    return <Icon name={presentation.marker.icon} color={color} />;
}

/** "All runs" beside the History label: a quiet link, the label's own size. */
function ColumnGroupLink(props: Readonly<{ testID: string; label: string; onPress: () => void }>) {
    return (
        <HappierPressable
            testID={props.testID}
            accessibilityRole="link"
            accessibilityLabel={props.label}
            onPress={props.onPress}
            style={styles.groupLink}
        >
            <Text style={styles.groupLinkText}>{props.label}</Text>
        </HappierPressable>
    );
}

/** One quiet line where a section's rows would be, with its one action. */
function ColumnStateLine(props: Readonly<{ testID: string; text: string; action: Readonly<{ label: string; onPress: () => void }> }>) {
    return (
        <View testID={props.testID} style={styles.stateLine}>
            <Text style={styles.stateLineText}>{props.text}</Text>
            <ColumnGroupLink testID={`${props.testID}:retry`} label={props.action.label} onPress={props.action.onPress} />
        </View>
    );
}

/** Reserved row slots while a section's first page loads, so nothing moves when rows arrive. */
function ColumnSkeletonRows(props: Readonly<{ count: number }>) {
    const { theme } = useUnistyles();
    return (
        <>
            {Array.from({ length: props.count }, (_, index) => (
                <View key={index} style={styles.skeletonRow} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <HappierSkeletonBlock color={theme.colors.surface.pressedOverlay} width={HAPPIER_COLLECTION_LIST_METRICS.rowGlyphBox} height={HAPPIER_COLLECTION_LIST_METRICS.rowGlyphBox - 4} radius={4} />
                    <HappierSkeletonBlock color={theme.colors.surface.pressedOverlay} width={index % 2 === 0 ? '62%' : '48%'} height={10} radius={4} />
                </View>
            ))}
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    column: {
        flex: 1,
        minHeight: 0,
    },
    freshness: {
        paddingHorizontal: HAPPIER_COLLECTION_LIST_METRICS.rowInset,
        paddingBottom: HAPPIER_COLLECTION_LIST_METRICS.groupLabelFirstPaddingTop,
    },
    groupLink: {
        borderRadius: 4,
    },
    groupLinkText: {
        ...Typography.default(HAPPIER_COLLECTION_LIST_TEXT.groupCount.weight),
        fontSize: HAPPIER_COLLECTION_LIST_TEXT.groupCount.fontSize,
        lineHeight: HAPPIER_COLLECTION_LIST_TEXT.groupCount.lineHeight,
        color: theme.colors.text.secondary,
    },
    stateLine: {
        paddingHorizontal: HAPPIER_COLLECTION_LIST_METRICS.contentInset,
        paddingVertical: 6,
        gap: 4,
        alignItems: 'flex-start',
    },
    stateLineText: {
        ...Typography.default(HAPPIER_COLLECTION_LIST_TEXT.rowTitle.weight),
        fontSize: HAPPIER_COLLECTION_LIST_TEXT.rowTitle.fontSize,
        lineHeight: HAPPIER_COLLECTION_LIST_TEXT.rowTitle.lineHeight,
        color: theme.colors.text.secondary,
    },
    skeletonRow: {
        minHeight: HAPPIER_COLLECTION_LIST_METRICS.rowMinHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: HAPPIER_COLLECTION_LIST_METRICS.rowGlyphGap,
        paddingHorizontal: HAPPIER_COLLECTION_LIST_METRICS.contentInset,
    },
}));
