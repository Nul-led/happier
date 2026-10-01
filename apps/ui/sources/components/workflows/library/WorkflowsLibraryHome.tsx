import * as React from 'react';
import { showDocumentShareSheet } from '@/components/sharing/documents/showDocumentShareSheet';
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
import { Icon } from '@/components/ui/icons/Icon';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { ItemList } from '@/components/ui/lists/ItemList';
import { CoreCollectionScope } from '@/components/ui/lists/collection/CoreCollectionScope';
import { SelectionListSkeletonRow } from '@/components/ui/selectionList/SelectionListSkeletonRow';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import {
    deleteWorkflowDefinition,
    getWorkflowDefinition,
} from '@/sync/domains/workflows/workflowDefinitionActions';
import { exportWorkflowDefinition } from '@/sync/domains/workflows/workflowInterchange';
import { createWorkflowDefinitionRoute, createWorkflowRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import { formatRelativeTimeShort } from '@/components/ui/selectionList/formatRelativeTimeShort';
import { t } from '@/text';

import { confirmWorkflowDocumentExport } from '../actions/confirmWorkflowDocumentExport';
import { splitLibraryDefinitions } from '../column/workflowsColumnModel';
import { WORKFLOWS_IMPORT_ROUTE, WORKFLOWS_NEW_ROUTE } from '../column/WorkflowsColumnActions';
import {
    forgetWorkflowLibraryDefinition,
    useWorkflowDefinitionLibrary,
    useWorkflowRunWindow,
    type WorkflowLibraryDefinition,
} from './workflowLibraryReads';
import { useWorkflowLibrarySummaries, type WorkflowLibraryRunSummary } from './useWorkflowLibrarySummaries';
import { projectWorkflowRunStrip } from './workflowRunStrip';
import { WorkflowRunStripView } from './WorkflowRunStripView';

/** A library longer than this gets its search field (the collection columns' shared convention). */
const SEARCH_THRESHOLD = 8;
/** The narrowest readable row at normal text size. */
const LIBRARY_MIN_WIDTH_PX = 320;

type LibraryRow = Readonly<{
    key: string;
    group: 'library' | 'sharedWithYou';
    definition: WorkflowLibraryDefinition;
}>;

type LibraryRowCommands = Readonly<{
    /** Opens the exact run the summary names as needing you, at its first actionable item. */
    openRun: (runId: string) => void;
    summaries: ReadonlyMap<string, WorkflowLibraryRunSummary> | null;
    run: (definitionId: string) => void;
    exportJson: (definitionId: string) => void;
    /** Opens the one document share sheet (INT I2) for a workflow the caller owns (07 S7 Share). */
    share: (definitionId: string, name: string) => void;
    remove: (definitionId: string) => void;
}>;

const LibraryRowCommandsContext = React.createContext<LibraryRowCommands | null>(null);

const LIBRARY_GROUPS = {
    get axis() {
        return [
            { key: 'library', title: t('workflows.destination.sections.library') },
            { key: 'sharedWithYou', title: t('workflows.destination.sections.sharedWithYou') },
        ];
    },
    groupOf: (row: LibraryRow) => row.group,
};

const readRowKey = (row: LibraryRow) => row.key;

/**
 * The Workflows library home (FIN 04 §3.3, 07 S2, lab `nav-N1` as corrected): what the column lacks,
 * never a copy of it. A header with one primary **New workflow**, then your saved workflows and the
 * ones shared with you through the canonical Collection. Needs you, Running and History stay in the
 * column. A saved row carries "last run {age}", a neutral run strip and **Needs you** from the one
 * `workflow.run.summaries` read; facts no owner reads yet (step count, trigger summary) are
 * omitted, never guessed.
 */
export function WorkflowsLibraryHome(): React.ReactElement {
    const { theme } = useUnistyles();
    const router = useRouter();
    const library = useWorkflowDefinitionLibrary();
    const history = useWorkflowRunWindow('all');
    const [query, setQuery] = React.useState('');
    const split = React.useMemo(() => splitLibraryDefinitions(library.definitions), [library.definitions]);
    const rows = React.useMemo((): readonly LibraryRow[] => [
        ...split.library.map((definition) => ({ key: definition.definitionId, group: 'library' as const, definition })),
        ...split.sharedWithYou.map((definition) => ({ key: definition.definitionId, group: 'sharedWithYou' as const, definition })),
    ], [split.library, split.sharedWithYou]);
    const needle = query.trim().toLocaleLowerCase();
    const filter = React.useCallback(
        (row: LibraryRow) => needle.length === 0 || row.definition.metadata.title.toLocaleLowerCase().includes(needle),
        [needle],
    );
    const window = React.useMemo((): HappierCollectionWindow => (library.hasMore ? {
        kind: 'partial',
        continuations: [{
            key: 'more',
            label: library.loadMoreFailed ? t('workflows.retry') : t('workflows.destination.loadMoreWorkflows'),
            load: library.loadMore,
            busy: library.loadingMore,
        }],
    } : { kind: 'complete' }), [library.hasMore, library.loadMore, library.loadMoreFailed, library.loadingMore]);
    const openDefinition = React.useCallback((key: string | null) => {
        if (key !== null) router.push(`/workflows/${encodeURIComponent(key)}` as never);
    }, [router]);
    const model = useHappierCollection<LibraryRow>({
        items: rows,
        keyOf: readRowKey,
        groups: LIBRARY_GROUPS,
        filter,
        window,
        openKey: null,
        onOpenChange: openDefinition,
    });
    const summaryIds = React.useMemo(() => rows.map((row) => row.definition.definitionId), [rows]);
    const summaries = useWorkflowLibrarySummaries(summaryIds);
    const anatomy = useLibraryAnatomy(summaries);
    const commands = useLibraryRowCommands(summaries);

    const newWorkflow = () => router.push(WORKFLOWS_NEW_ROUTE as never);
    const importWorkflow = () => router.push(WORKFLOWS_IMPORT_ROUTE as never);

    const firstVisit = library.status === 'loaded' && library.definitions.length === 0
        && history.status === 'loaded' && history.rows.length === 0;
    if (firstVisit) return <WorkflowsFirstVisit onNewWorkflow={newWorkflow} onImport={importWorkflow} />;

    const header = (
        <PageHeader
            testID="workflows-home:header"
            title={t('workflows.title')}
            description={t('workflows.destination.description')}
            actions={(
                <View style={styles.headerActions}>
                    <RoundButton
                        testID="workflows-home:import"
                        size="small"
                        display="inverted"
                        title={t('workflows.destination.import')}
                        leading={<Icon name="download" size={14} color={theme.colors.text.secondary} />}
                        textStyle={{ color: theme.colors.text.secondary }}
                        onPress={importWorkflow}
                    />
                    <RoundButton
                        testID="workflows-home:new"
                        size="small"
                        title={t('workflows.newWorkflow')}
                        leading={<Icon name="plus" size={14} color={theme.colors.button.primary.tint} />}
                        onPress={newWorkflow}
                    />
                </View>
            )}
        />
    );

    const empty = library.status === 'failed' && library.definitions.length === 0 ? (
        <SurfaceStateCard
            testID="workflows-home:failed"
            kind="error"
            title={t('workflows.loadFailedTitle')}
            reason={t('workflows.loadFailedBody')}
            action={{ label: t('workflows.retry'), onPress: library.retry }}
            accessibilitySemantics="alert"
        />
    ) : needle.length > 0 ? (
        <EmptyState
            testID="workflows-home:noMatch"
            layout="inline"
            iconName="magnifying-glass"
            title={t('workflows.destination.noMatch', { query: query.trim() })}
        />
    ) : library.status === 'loaded' && history.status !== 'loading' ? (
        // Nothing saved yet, but runs exist (else this is the first visit): say what goes here.
        <EmptyState
            testID="workflows-home:empty"
            layout="line"
            title={t('workflows.destination.libraryEmpty')}
        />
    ) : (
        // First load: list-shaped placeholders where the rows will be, so nothing moves on arrival.
        <View testID="workflows-home:loading">
            {[0, 1, 2].map((index) => <SelectionListSkeletonRow key={index} index={index} />)}
        </View>
    );

    return (
        <LibraryRowCommandsContext.Provider value={commands}>
            <CoreCollectionScope renderPageScroller={renderLibraryPageScroller}>
                <Collection<LibraryRow>
                    testID="workflows-home:collection"
                    model={model}
                    anatomy={anatomy}
                    accessibilityLabel={t('workflows.title')}
                    presentation="list"
                    detail="none"
                    scroll="page"
                    minListWidth={LIBRARY_MIN_WIDTH_PX}
                    minDetailWidth={LIBRARY_MIN_WIDTH_PX}
                    preferredListRatio={1}
                    header={header}
                    loading={library.status === 'loading' && library.definitions.length === 0}
                    useRowActions={useLibraryRowActions}
                    {...(rows.length > SEARCH_THRESHOLD ? {
                        search: {
                            label: t('workflows.destination.searchPlaceholder'),
                            placeholder: t('workflows.destination.searchPlaceholder'),
                            value: query,
                            onValueChange: setQuery,
                            testID: 'workflows-home:search',
                        },
                    } : {})}
                    empty={empty}
                />
            </CoreCollectionScope>
        </LibraryRowCommandsContext.Provider>
    );
}

/** The page's content column, so the header and the rows share one edge. */
function LibraryPageColumn(props: Readonly<{ children?: React.ReactNode }>) {
    const maxWidthStyle = useLayoutMaxWidthStyle();
    return <View style={[styles.pageColumn, maxWidthStyle]}>{props.children}</View>;
}

function renderLibraryPageScroller(children: React.ReactNode): React.ReactNode {
    return (
        <ItemList presentation="page">
            <LibraryPageColumn>{children}</LibraryPageColumn>
        </ItemList>
    );
}

function useLibraryAnatomy(summaries: ReadonlyMap<string, WorkflowLibraryRunSummary> | null): CollectionAnatomy<LibraryRow> {
    const { theme } = useUnistyles();
    return React.useMemo(() => ({
        glyph: () => <Icon name="tree-structure" size={18} color={theme.colors.text.secondary} />,
        title: (row) => row.definition.metadata.title,
        where: (row) => {
            const lastRun = summaries?.get(row.definition.definitionId)?.lastRun ?? null;
            const createdAt = lastRun === null ? Number.NaN : Date.parse(lastRun.createdAt);
            return Number.isFinite(createdAt)
                ? t('workflows.destination.lastRun', { age: formatRelativeTimeShort(createdAt, Date.now()) })
                : row.definition.metadata.description ?? null;
        },
        reason: (row) => {
            const summary = summaries?.get(row.definition.definitionId);
            if (summary === undefined || summary.recent.length === 0) return null;
            return (
                <WorkflowRunStripView
                    testID={`workflows-home:row:${row.definition.definitionId}:strip`}
                    strip={projectWorkflowRunStrip(summary)}
                />
            );
        },
        accessibilityLabel: (row) => row.definition.metadata.title,
        testID: (row) => `workflows-home:row:${row.definition.definitionId}`,
        columnTitles: { title: t('workflows.title') },
    }), [summaries, theme.colors.text.secondary]);
}

/** A row's own menu: Run now, Export JSON, and Delete for workflows you own. */
function useLibraryRowActions(row: LibraryRow): CollectionRowActions {
    const commands = React.useContext(LibraryRowCommandsContext);
    const { theme } = useUnistyles();
    const owned = row.group === 'library';
    const needsYouRunId = commands?.summaries?.get(row.definition.definitionId)?.needsYouRunId ?? null;
    return {
        // Navigation only: the run's own page answers; this never does (07 S2, M3).
        ...(needsYouRunId === null || commands === null ? {} : {
            accessory: (
                <RoundButton
                    testID={`workflows-home:row:${row.definition.definitionId}:needsYou`}
                    size="small"
                    display="inverted"
                    title={t('workflows.destination.sections.needsYou')}
                    textStyle={{ color: theme.colors.state.warning.foreground }}
                    onPress={() => commands.openRun(needsYouRunId)}
                />
            ),
        }),
        secondaryActionAccessibilityLabel: t('workflows.destination.rowMenu.accessibility'),
        secondaryActions: [
            { id: 'run', label: t('workflows.destination.rowMenu.runNow') },
            ...(owned ? [{ id: 'share', label: t('workflows.destination.rowMenu.share') }] : []),
            { id: 'export', label: t('workflows.exportJson') },
            ...(owned ? [{ id: 'delete', label: t('common.delete') }] : []),
        ],
        onSecondaryAction: (id) => {
            if (commands === null) return;
            const definitionId = row.definition.definitionId;
            if (id === 'run') commands.run(definitionId);
            else if (id === 'share') commands.share(definitionId, row.definition.metadata.title);
            else if (id === 'export') commands.exportJson(definitionId);
            else if (id === 'delete') commands.remove(definitionId);
        },
    };
}

function useLibraryRowCommands(summaries: ReadonlyMap<string, WorkflowLibraryRunSummary> | null): LibraryRowCommands {
    const router = useRouter();
    const deleting = React.useRef(new Set<string>());
    return React.useMemo(() => ({
        summaries,
        openRun: (runId) => router.push(createWorkflowRunRoute(runId) as never),
        // A saved row holds an Artifact identity, not a reviewed machine or inputs: Run now opens the
        // exact revision in the editor, whose Run review admits the run.
        run: (definitionId) => router.push({ pathname: '/workflows/[id]', params: { id: definitionId, intent: 'run' } } as never),
        exportJson: (definitionId) => { void exportDefinition(definitionId); },
        share: (definitionId, name) => showDocumentShareSheet({
            kind: 'workflow-definition.v1', artifactId: definitionId, name,
            linkPath: createWorkflowDefinitionRoute(definitionId),
            // "Send a copy instead" is the existing JSON export (INT I2).
            onSendCopy: () => { void exportDefinition(definitionId); },
        }),
        remove: (definitionId) => {
            if (deleting.current.has(definitionId)) return;
            void (async () => {
                const lifetime = captureActiveServerAccountScopeLifetime();
                if (lifetime === null) return;
                const confirmed = await Modal.confirm(
                    t('workflows.destination.deleteTitle'),
                    t('workflows.destination.deleteBody'),
                    { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
                );
                if (!confirmed || !lifetime.isCurrent()) return;
                deleting.current.add(definitionId);
                try {
                    await deleteWorkflowDefinition({ definitionId });
                    if (lifetime.isCurrent()) forgetWorkflowLibraryDefinition(definitionId);
                } catch {
                    // Deletion never retries by itself; the row stays and the person decides.
                    if (lifetime.isCurrent()) await Modal.alert(t('workflows.destination.deleteFailedTitle'), t('workflows.loadFailedBody'));
                } finally {
                    deleting.current.delete(definitionId);
                }
            })();
        },
    }), [router, summaries]);
}

async function exportDefinition(definitionId: string): Promise<void> {
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (lifetime === null) return;
    try {
        const opened = await getWorkflowDefinition({ definitionId });
        if (!lifetime.isCurrent()) return;
        const exported = exportWorkflowDefinition({ definition: opened.definition });
        if (!exported.ok) {
            await Modal.alert(t('workflows.destination.exportFailedTitle'), t('workflows.loadFailedBody'));
            return;
        }
        await confirmWorkflowDocumentExport({ name: opened.metadata.title, json: exported.json, isCurrent: lifetime.isCurrent });
    } catch {
        if (lifetime.isCurrent()) await Modal.alert(t('workflows.destination.exportFailedTitle'), t('workflows.loadFailedBody'));
    }
}

/**
 * First visit (lab `nav-N3`): show, guide, confirm. One primary, and a quiet way in for a file. The
 * example tiles join when the starter catalog lands (08 §6).
 */
function WorkflowsFirstVisit(props: Readonly<{ onNewWorkflow: () => void; onImport: () => void }>) {
    return (
        <ItemList presentation="page">
            <LibraryPageColumn>
                <EmptyState
                    testID="workflows-home:firstVisit"
                    layout="page"
                    iconName="tree-structure"
                    title={t('workflows.destination.firstVisitTitle')}
                    subtitle={t('workflows.destination.firstVisitBody')}
                    primaryAction={{ label: t('workflows.newWorkflow'), onPress: props.onNewWorkflow, testID: 'workflows-home:firstVisit:new' }}
                />
                <View style={styles.importLine}>
                    <Text style={styles.importPrompt}>{t('workflows.destination.importPrompt')}</Text>
                    <RoundButton
                        testID="workflows-home:firstVisit:import"
                        size="small"
                        display="inverted"
                        title={t('workflows.destination.import')}
                        onPress={props.onImport}
                    />
                </View>
            </LibraryPageColumn>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    pageColumn: {
        width: '100%',
        alignSelf: 'center',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    importLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingBottom: 24,
    },
    importPrompt: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
    },
}));
