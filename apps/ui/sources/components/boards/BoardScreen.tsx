import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { buildWorkBoardItemKeyV1, type BoardItemRefV1, type WorkBoardIntentV1, type WorkBoardV1 } from '@happier-dev/protocol';

import { useCompactAppDestinations } from '@/components/appShell/destinations/compactAppDestinationCatalog';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { createInboxItemRoute } from '@/components/inbox/inboxItemFocus';
import { Icon } from '@/components/ui/icons/Icon';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { workStatusWordStyle } from '@/components/work/status/workStatusTreatment';
import { Typography } from '@/constants/Typography';
import { InboxModelBoundary } from '@/hooks/inbox/useInboxModel';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { refreshWorkflowRunById } from '@/sync/engine/workflows/refreshWorkflowRun';
import { createWorkflowRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import { t } from '@/text';
import { useDeviceType } from '@/utils/platform/responsive';

import { BoardByStatus } from './byStatus/BoardByStatus';
import { BoardCanvas } from './canvas/BoardCanvas';
import { AddToBoardButton } from './header/AddToBoardPopover';
import { BoardSettingsButton } from './header/BoardSettingsPopover';
import { countBoardCardsNeedingYou, type BoardCard } from './model/boardCards';
import { resolveBoardPruneMembership } from './model/boardMembership';
import type { BoardCanvasPoint } from './model/boardCanvasGeometry';
import { useBoardLiveCards } from './model/useBoardContent';
import { resolveBoardCardOpenTarget } from './model/boardCardOpenTarget';
import { resolveBoardSaveFailure } from './model/boardSaveFailure';
import { useDispatchWorkBoardIntent, useWorkBoard, useWorkBoardReadState, useWorkBoardSaveQueue, useWorkBoardSaveState } from './model/useWorkBoards';
import { BoardReadState } from './BoardReadState';
import { BOARDS_ROUTE } from './boardsRoutes';
import { BoardSaveFailureLine, describeBoardSaveFailure } from './BoardSaveFailureLine';

/**
 * One board (lab `boards-B1`…`B5`): the header — title, the source line, Canvas | By status, Add to
 * board and ⋯ — then the board in its layout. A phone shows By status only; Canvas positions stay saved.
 */
export const BoardScreen = React.memo(function BoardScreen(props: Readonly<{ boardId: string }>) {
    const board = useWorkBoard(props.boardId);
    const read = useWorkBoardReadState();
    if (!board && read.status !== 'ready') return <BoardReadState />;
    if (!board) return <MissingBoard boardId={props.boardId} />;
    // The Needs you section reads the Inbox's own model, mounted once for the open board.
    return <InboxModelBoundary><BoardBody board={board} /></InboxModelBoundary>;
});

/**
 * A board that is not in this Home's boards: gone, or never made because its create was refused —
 * then the page says why and offers Retry, rather than "This board is gone".
 */
const MissingBoard = React.memo(function MissingBoard(props: Readonly<{ boardId: string }>) {
    const saveQueue = useWorkBoardSaveQueue();
    const failure = resolveBoardSaveFailure(useWorkBoardSaveState(), props.boardId);
    if (failure) {
        return (
            <EmptyState
                testID="board-create-failed"
                layout="page"
                iconName="squares-four"
                title={t('boards.saveFailed.createTitle')}
                subtitle={describeBoardSaveFailure(failure.reason)}
                primaryAction={failure.reason === 'not_found' ? undefined : { label: t('boards.saveFailed.retry'), onPress: () => { void saveQueue.retry(); } }}
            />
        );
    }
    return (
        <EmptyState
            testID="board-not-found"
            layout="page"
            iconName="squares-four"
            title={t('boards.notFound.title')}
            subtitle={t('boards.notFound.body')}
        />
    );
});

function useOpenBoardCard(): (card: BoardCard) => void {
    const router = useRouter();
    const destinations = useCompactAppDestinations();
    const inboxAvailable = destinations.some((destination) => destination.id === 'inbox');
    return React.useCallback((card: BoardCard) => {
        const target = resolveBoardCardOpenTarget(card, { inboxAvailable });
        if (!target) return;
        if (target.kind === 'inbox') {
            // The Inbox owns needs-you work; the board never answers it. It opens on this card's item.
            router.push(createInboxItemRoute(target.item) as never);
            return;
        }
        const { serverId, id } = target.ref.qualifiedId;
        switch (target.ref.kind) {
            case 'session':
                router.push(buildScopedSessionRouteHref({ sessionId: id, serverId }) as never);
                return;
            case 'workflow_run':
                router.push(createWorkflowRunRoute(id) as never);
                return;
            case 'workflow':
                router.push({ pathname: '/workflows/[id]', params: { id } } as never);
                return;
            case 'machine':
                // Qualified: the machine's own Home, never the focused Home's same-id machine.
                router.push({ pathname: '/machine/[id]', params: { id, serverId } } as never);
                return;
        }
    }, [inboxAvailable, router]);
}

/** Picked runs that no window has loaded are read once each, by the exact-run owner. */
function useLoadPickedRuns(cards: readonly BoardCard[]): void {
    const requested = React.useRef(new Set<string>());
    const missing = cards
        .filter((card) => card.ref.kind === 'workflow_run' && card.picked && card.availability === 'not_loaded')
        .map((card) => card.ref.qualifiedId.id)
        .join('\n');
    React.useEffect(() => {
        for (const runId of missing ? missing.split('\n') : []) {
            if (requested.current.has(runId)) continue;
            requested.current.add(runId);
            void refreshWorkflowRunById(runId).catch(() => {});
        }
    }, [missing]);
}


const BoardBody = React.memo(function BoardBody(props: Readonly<{ board: WorkBoardV1 }>) {
    const { board } = props;
    const router = useRouter();
    const { homes, membership, cards } = useBoardLiveCards(board);
    const dispatchIntent = useDispatchWorkBoardIntent();
    const dispatch = React.useCallback((intent: WorkBoardIntentV1) => { void dispatchIntent(intent); }, [dispatchIntent]);
    const saveState = useWorkBoardSaveState();
    const phone = useDeviceType() === 'phone';
    const mode = phone ? 'by_status' : board.mode;
    const [addOpen, setAddOpen] = React.useState(false);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    /** The card just added with ⌘↵ "Add and place": focused on Canvas so arrows or a drag place it. */
    const [placingKey, setPlacingKey] = React.useState<string | null>(null);
    const onOpen = useOpenBoardCard();
    useLoadPickedRuns(cards);

    const onBoardKeys = React.useMemo(() => new Set(membership.members.map((member) => member.key)), [membership.members]);
    const pickedCards = React.useMemo(() => cards.filter((card) => card.picked), [cards]);
    const needYou = countBoardCardsNeedingYou(cards);

    const onAdd = React.useCallback((ref: BoardItemRefV1, options: Readonly<{ place: boolean }>) => {
        dispatch({ kind: 'add_items', boardId: board.id, refs: [ref] });
        if (options.place && mode === 'canvas') setPlacingKey(buildWorkBoardItemKeyV1(ref));
    }, [board.id, dispatch, mode]);
    const onCommitPositions = React.useCallback((positions: Readonly<Record<string, BoardCanvasPoint>>) => {
        dispatch({
            kind: 'set_positions',
            boardId: board.id,
            positionsByItemRef: positions,
            membership: resolveBoardPruneMembership(board, membership, homes.isHomeMounted),
        });
    }, [board, dispatch, homes.isHomeMounted, membership]);

    const onRemoveItem = React.useCallback((ref: BoardItemRefV1) => {
        dispatch({
            kind: 'remove_item',
            boardId: board.id,
            ref,
            membership: resolveBoardPruneMembership(board, membership, homes.isHomeMounted),
        });
    }, [board, dispatch, homes.isHomeMounted, membership]);

    const hasSource = (board.source.sections?.length ?? 0) > 0 || board.source.filter !== undefined || board.source.picked.length > 0;
    // Only this board's refused save shows here; another board's failure belongs on that board.
    const failure = resolveBoardSaveFailure(saveState, board.id);

    return (
        <View testID={`board:${board.id}`} style={styles.root}>
            <PageHeader
                testID="board-header"
                title={board.name}
                alwaysShowTitle
                columnWidth="pane"
                details={(
                    <BoardSourceLine
                        board={board}
                        itemCount={cards.length}
                        needYou={needYou}
                        onPress={() => setSettingsOpen(true)}
                    />
                )}
                actions={(
                    <View style={styles.actions}>
                        {phone ? null : (
                            <SegmentedTabBar
                                testIDPrefix="board-header.layout"
                                accessibilityLabel={t('boards.header.layoutA11y')}
                                compact
                                segmentSizing="content"
                                tabs={[
                                    { id: 'canvas' as const, label: t('boards.header.canvas') },
                                    { id: 'by_status' as const, label: t('boards.header.byStatus') },
                                ]}
                                activeTabId={board.mode}
                                onSelectTab={(next) => dispatch({ kind: 'update', boardId: board.id, patch: { mode: next } })}
                            />
                        )}
                        <AddToBoardButton
                            board={board}
                            homes={homes}
                            onBoardKeys={onBoardKeys}
                            onAdd={onAdd}
                            open={addOpen}
                            onOpenChange={setAddOpen}
                        />
                        <BoardSettingsButton
                            board={board}
                            homes={homes}
                            pickedCards={pickedCards}
                            canvasAvailable={!phone}
                            dispatch={dispatch}
                            onRemoveItem={onRemoveItem}
                            open={settingsOpen}
                            onOpenChange={setSettingsOpen}
                            onAddByHand={() => setAddOpen(true)}
                            onDeleted={() => router.replace(BOARDS_ROUTE as never)}
                        />
                    </View>
                )}
            />
            <BoardReadState retained />
            {failure ? (
                <View style={styles.failure}>
                    <BoardSaveFailureLine testID="board-save-failed" failure={failure} />
                </View>
            ) : null}
            {!hasSource ? (
                <EmptyState
                    testID="board-empty"
                    layout="page"
                    iconName="squares-four"
                    title={t('boards.empty.title')}
                    subtitle={t('boards.empty.body')}
                    primaryAction={{ label: t('boards.empty.action'), onPress: () => setAddOpen(true) }}
                />
            ) : mode === 'canvas' ? (
                <BoardCanvas
                    cards={cards}
                    positionsByItemRef={board.positionsByItemRef}
                    snap={board.snap}
                    placingKey={placingKey}
                    onPlaced={() => setPlacingKey(null)}
                    onOpen={onOpen}
                    onCommitPositions={onCommitPositions}
                />
            ) : (
                <BoardByStatus cards={cards} onOpen={onOpen} stacked={phone} />
            )}
        </View>
    );
});

/** The header's one meta line: the source chip (opens Board settings), the item count, and who needs you. */
const BoardSourceLine = React.memo(function BoardSourceLine(props: Readonly<{
    board: WorkBoardV1;
    itemCount: number;
    needYou: number;
    onPress: () => void;
}>) {
    const { theme } = useUnistyles();
    const { board } = props;
    const parts = (board.source.sections ?? []).map((section) => t(`boards.sections.${section}.title`));
    if (board.source.filter) parts.push(t('boards.sections.filter.title'));
    const pickedCount = board.source.picked.length;
    const source = parts.length === 0
        ? t('boards.meta.handPicked')
        : pickedCount > 0 ? `${parts.join(', ')} ${t('boards.meta.moreSources', { count: pickedCount })}` : parts.join(', ');
    return (
        <View style={styles.sourceLine}>
            <Pressable
                testID="board-header.source"
                accessibilityRole="button"
                accessibilityLabel={`${source}, ${t('boards.header.settings')}`}
                onPress={props.onPress}
                style={styles.sourceChip}
            >
                <Icon name="funnel-simple" size={14} color={theme.colors.text.secondary} />
                <Text numberOfLines={1} style={styles.meta}>{source}</Text>
                <Icon name="caret-down" size={12} color={theme.colors.text.secondary} />
            </Pressable>
            <Text style={styles.meta}>· {t('boards.meta.items', { count: props.itemCount })}</Text>
            {props.needYou > 0 ? (
                <Text testID="board-header.need-you" style={[styles.meta, workStatusWordStyle('attention')]}>
                    · {t('boards.meta.needYou', { count: props.needYou })}
                </Text>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    failure: {
        paddingHorizontal: 24,
        paddingBottom: 8,
    },
    sourceLine: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    sourceChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        flexShrink: 1,
    },
    meta: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
}));
