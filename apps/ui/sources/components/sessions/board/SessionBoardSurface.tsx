import * as React from 'react';
import { ScrollView, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type {
    SessionBoardItemWidth,
    SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceCard } from '@/components/ui/cards/SurfaceCard';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { SearchHeader } from '@/components/ui/forms/SearchHeader';
import { Typography } from '@/constants/Typography';
import type { FocusReturnRef, FocusReturnTarget } from '@/keyboard/focusReturn';
import { t } from '@/text';
import { useTreeDropAutoscroll } from '@/components/ui/treeDragDrop';
import {
    isSessionBoardEmpty,
    resolveSessionBoardExecutableCurrentness,
    resolveSessionBoardReferenceProjection,
    type SessionBoardItemProjection,
    type SessionBoardMountHost,
    type SessionBoardPrimaryMountResolver,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';

import {
    SESSION_BOARD_GRID_GAP_PX,
    resolveSessionBoardGridTier,
    resolveSessionBoardItemWidthPx,
} from './sessionBoardGridLayout';
import {
    resolveSessionBoardViewTitle,
    SessionBoardViewStrip,
    sessionBoardViewTabNativeId,
} from './SessionBoardViewStrip';
import type { SessionBoardItemRect } from './SessionBoardItemMoveHandle';
import { SessionWidgetHost, type SessionWidgetDensity } from './SessionWidgetHost';
import type { CallerHostedHtmlRuntime } from '@/components/ui/surfaces/hostedHtml/HostedHtmlSurfaceAdapter';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { SessionBoardHostActionBinding } from './sessionBoardHostActions';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import type {
    SessionBoardAddIntent,
    SessionBoardController,
} from './useSessionBoardController';
import { useMountedSessionBoardContinuity } from './SessionBoardContinuity';
import {
    captureSessionBoardPresentationPosition,
    filterSessionBoardItemIds,
    resolveSessionBoardPresentationOffset,
} from './sessionBoardPresentationContinuity';
import { resolveSessionBoardFailurePresentation } from './sessionBoardFailurePresentation';

/**
 * One Board implementation for every host.
 *
 * Details, focused Details, the compact sidebar and the mobile Cockpit all render
 * this component; they differ only in the host they name, the density they ask for
 * and the width mapping their layout can afford. There is no per-placement Board,
 * no second grid and no desktop/mobile renderer split.
 *
 * It holds no Board state and owns no write path: every affordance it draws comes
 * from {@link SessionBoardController}, and it draws an affordance only when that
 * controller genuinely supports the command behind it.
 */

const GRID_GAP = SESSION_BOARD_GRID_GAP_PX;

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
    },
    scroll: {
        flex: 1,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GRID_GAP,
        padding: GRID_GAP,
    },
    single: {
        flexDirection: 'column',
        gap: GRID_GAP,
        padding: GRID_GAP,
    },
    viewsRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
    },
    viewsStrip: {
        flex: 1,
        minWidth: 0,
    },
    viewsActions: {
        paddingHorizontal: 4,
        paddingBottom: 4,
    },
    addRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: GRID_GAP,
        paddingTop: GRID_GAP,
    },
    freshness: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text.secondary,
        paddingHorizontal: GRID_GAP,
        paddingTop: 8,
    },
    mutationRecovery: {
        marginHorizontal: GRID_GAP,
        marginTop: GRID_GAP,
        gap: 10,
        alignItems: 'flex-start',
    },
    mutationRecoveryText: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
    },
    section: {
        paddingHorizontal: GRID_GAP,
        paddingTop: 20,
        gap: 4,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text.secondary,
    },
    sectionBody: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text.secondary,
    },
}));

export type { SessionBoardAddIntent } from './useSessionBoardController';

export type SessionBoardSurfaceProps = Readonly<{
    sessionId: string;
    session?: Session;
    controller: SessionBoardController;
    host: SessionBoardMountHost;
    /** Resolves the executable placement for each exact item. */
    resolvePrimaryHost: SessionBoardPrimaryMountResolver;
    density: SessionWidgetDensity;
    /** One column on mobile and in the compact sidebar; the semantic grid elsewhere. */
    layout: 'grid' | 'single';
    /** Sidebar composition: previews and navigation only; editing belongs in Details. */
    navigationOnly?: boolean;
    /**
     * A retained background tab: identical content, density and selected view,
     * but no mutation controls. Only the visible placement may act.
     */
    retained?: boolean;
    onOpenBoardDetails?: () => void;
    /** Host-local navigation; durable Board state remains owned by the shell controller. */
    onOpenItemHere?: (itemId: string) => void;
    resolveActionBinding?: (itemId: string) => SessionBoardHostActionBinding | null;
    pluginRuntime?: SessionPluginRuntimeState;
    callerHostedHtmlRuntime?: CallerHostedHtmlRuntime;
    /** The host's measured item height range. */
    heightBounds?: Readonly<{ min: number; max: number }>;
    /** Open this item's canonical expanded/full-content route in the current host. */
    onReadFullItem?: (itemId: string) => void;
    /** Viewer-local Companion membership supplied by its one preference owner. */
    companionItemIds?: ReadonlySet<string>;
    /** Adds the existing item reference and reveals Companion atomically. */
    onAddToCompanion?: (itemId: string) => void;
    /** Removes only the viewer-local reference; shared Board content survives. */
    onRemoveFromCompanion?: (itemId: string) => void;
    /**
     * Render one item's expanded route instead of the grid. This is the canonical
     * full-content destination for a long or read-only Note, and the nested view a
     * Board selection opens; it is not a second Board or a modal.
     */
    focusedItemId?: string | null;
    /** Leave the expanded route and return to the Board. */
    onLeaveFocusedItem?: () => void;
    testID?: string;
    /** Header slot rendered above the view strip. */
    header?: React.ReactNode;
    /** Retained in-place editor; it stays mounted through refresh/offline/conflict. */
    editor?: React.ReactNode;
    /** The installed-widget Add picker, rendered in the same in-place slot. */
    picker?: React.ReactNode;
    /** Viewer-local tab hosts used only by the incumbent modal focus-return owner. */
    onViewFocusTargetChange?: (viewId: string, target: FocusReturnTarget) => void;
    /** Surviving Board-view action control when the source tab disappears. */
    onViewActionsFocusTargetChange?: (target: FocusReturnTarget) => void;
    viewActionsFocusTargetRef?: FocusReturnRef;
}>;

const DEFAULT_HEIGHT_BOUNDS = Object.freeze({ min: 96, max: 720 });

const ADD_INTENT_LABEL_KEY: Readonly<Record<SessionBoardAddIntent, Parameters<typeof t>[0]>> = Object.freeze({
    note: 'sessionBoard.add.note',
    interactiveView: 'sessionBoard.add.interactiveView',
    fromPlugins: 'sessionBoard.add.fromPlugins',
    askAgent: 'sessionBoard.empty.editor.askAgent',
});

function boardStateCard(
    snapshot: SessionBoardSnapshot,
    testID: string,
    onPrepareEncryption?: () => void,
): React.ReactElement | null {
    switch (snapshot.layoutState.kind) {
        case 'loading':
            return (
                <SurfaceStateCard
                    testID={`${testID}-state`}
                    kind="loading"
                    title={t('sessionBoard.board.loading.title')}
                    reason={t('sessionBoard.board.loading.reason')}
                    accessibilitySemantics="status"
                />
            );
        case 'locked':
            return (
                <SurfaceStateCard
                    testID={`${testID}-state`}
                    kind="unavailable"
                    title={t('sessionBoard.board.locked.title')}
                    reason={t('sessionBoard.board.locked.reason')}
                    diagnosticCode="session_board_layout_locked"
                    {...(onPrepareEncryption
                        ? {
                            action: {
                                label: t('sessionBoard.item.actions.prepareEncryption'),
                                onPress: onPrepareEncryption,
                            },
                        }
                        : {})}
                    accessibilitySemantics="status"
                />
            );
        case 'unopenable':
            return (
                <SurfaceStateCard
                    testID={`${testID}-state`}
                    kind="error"
                    title={t('sessionBoard.board.unopenable.title')}
                    reason={t('sessionBoard.board.unopenable.reason')}
                    diagnosticCode={`session_board_layout_${snapshot.layoutState.reason}`}
                    accessibilitySemantics="alert"
                />
            );
        case 'unsupported':
            return (
                <SurfaceStateCard
                    testID={`${testID}-state`}
                    kind="unavailable"
                    title={t('sessionBoard.board.unsupported.title')}
                    reason={t('sessionBoard.board.unsupported.reason')}
                    diagnosticCode="session_board_layout_unsupported_version"
                    accessibilitySemantics="status"
                />
            );
        case 'ready':
            return null;
    }
}

/**
 * The one Add affordance, drawn wherever the person can add.
 *
 * It renders only the intents whose producer exists in this build. A source with
 * no producer is absent from the menu rather than present and inert.
 */
function AddControls(props: Readonly<{
    controller: SessionBoardController;
    testID: string;
}>): React.ReactElement | null {
    const intents = props.controller.addIntents;
    if (intents.length === 0) return null;
    return (
        <View style={stylesheet.addRow} testID={`${props.testID}-add`}>
            {intents.map((intent, index) => (
                <RoundButton
                    key={intent}
                    size="small"
                    {...(index === 0 ? {} : { display: 'inverted' as const })}
                    testID={`${props.testID}-add-${intent}`}
                    title={t(ADD_INTENT_LABEL_KEY[intent])}
                    onPress={() => { void props.controller.run({ kind: 'add', intent }); }}
                />
            ))}
        </View>
    );
}

function MutationRecoveryNotice(props: Readonly<{
    controller: SessionBoardController;
    testID: string;
}>): React.ReactElement | null {
    const recovery = props.controller.mutationRecovery;
    if (!recovery) return null;
    const presentation = resolveSessionBoardFailurePresentation(
        recovery.kind === 'conflict' ? 'session_board_revision_conflict' : 'outcome_unknown',
    );
    return (
        <SurfaceCard
            testID={`${props.testID}-mutation-recovery`}
            tone="muted"
            padding="md"
            style={stylesheet.mutationRecovery}
        >
            <Text
                style={stylesheet.mutationRecoveryText}
                accessibilityLiveRegion="polite"
                role="status"
            >
                {presentation.message}
            </Text>
            {recovery.ready ? (
                <RoundButton
                    testID={`${props.testID}-mutation-recovery-retry`}
                    size="small"
                    title={t('common.retry')}
                    accessibilityLabel={t('common.retry')}
                    action={props.controller.retryLastMutation}
                />
            ) : null}
        </SurfaceCard>
    );
}

/** Board-view administration, beside the strip and never inside it. */
function ViewActions(props: Readonly<{
    controller: SessionBoardController;
    testID: string;
    onBeginRename: (viewId: string) => void;
    onFocusTargetChange?: (target: FocusReturnTarget) => void;
}>): React.ReactElement | null {
    const controller = props.controller;
    const activeView = controller.activeView;
    const views = controller.snapshot?.views;
    const actions = React.useMemo((): ItemAction[] => {
        const built: ItemAction[] = [];
        if (controller.supports('view.create')) {
            built.push({
                id: 'view-create',
                title: t('sessionBoard.views.actions.create'),
                icon: 'plus',
                onPress: () => { void controller.run({ kind: 'view.create' }); },
            });
        }
        if (activeView && !activeView.synthetic && controller.supports('view.rename')) {
            // A view move needs a real neighbour to anchor against, exactly as an
            // item move does. At either end of the strip the layout Action has
            // nothing to write, so the direction is omitted rather than offered
            // and silently ignored.
            const ordered = views ?? [];
            const index = ordered.findIndex((candidate) => candidate.id === activeView.id);
            const anchorAt = (offset: number) => {
                const candidate = index < 0 ? undefined : ordered[index + offset];
                return candidate !== undefined && !candidate.synthetic;
            };
            built.push({
                id: 'view-rename',
                title: t('sessionBoard.views.actions.rename'),
                icon: 'pencil',
                onPress: () => props.onBeginRename(activeView.id),
            });
            if (anchorAt(-1)) {
                built.push({
                    id: 'view-move-before',
                    title: t('sessionBoard.views.actions.moveBefore'),
                    icon: 'arrow-up',
                    onPress: () => { void controller.run({ kind: 'view.move', viewId: activeView.id, direction: 'before' }); },
                });
            }
            if (anchorAt(1)) {
                built.push({
                    id: 'view-move-after',
                    title: t('sessionBoard.views.actions.moveAfter'),
                    icon: 'arrow-down',
                    onPress: () => { void controller.run({ kind: 'view.move', viewId: activeView.id, direction: 'after' }); },
                });
            }
            built.push({
                id: 'view-remove',
                title: t('sessionBoard.views.actions.remove'),
                icon: 'trash',
                destructive: true,
                onPress: () => { void controller.run({ kind: 'view.remove', viewId: activeView.id }); },
            });
        }
        return built;
    }, [activeView, controller, props, views]);

    if (actions.length === 0) return null;
    return (
        <View style={stylesheet.viewsActions}>
            <ItemRowActions
                title={t('sessionBoard.views.label')}
                actions={actions}
                compactThreshold={Number.POSITIVE_INFINITY}
                overflowTriggerTestID={`${props.testID}-view-actions`}
                overflowTriggerAccessibilityLabel={t('common.moreActions')}
                iconSize={18}
                gap={8}
                onOverflowTriggerFocusTargetChange={props.onFocusTargetChange}
            />
        </View>
    );
}

export function SessionBoardSurface(props: SessionBoardSurfaceProps): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const testID = props.testID ?? 'session-board';
    const accessibilityInstanceId = React.useId().replace(/:/g, '');
    const viewTabIdPrefix = `session-board-${accessibilityInstanceId}-view-tab`;
    const viewPanelId = `session-board-${accessibilityInstanceId}-tabpanel`;
    const controller = props.controller;
    const snapshot = controller.snapshot;
    // A sidebar preview and a retained background tab are read-only for
    // different reasons, but neither may draw a control that writes to the
    // shared Board. Only `navigationOnly` also changes the projection itself;
    // a retained tab keeps its density, layout and selected view untouched.
    const mutationControls = props.navigationOnly !== true && props.retained !== true;
    const continuity = useMountedSessionBoardContinuity();
    const heightBounds = props.heightBounds ?? DEFAULT_HEIGHT_BOUNDS;
    const [gridWidth, setGridWidth] = React.useState(0);
    const windowHeight = useWindowDimensions().height;
    const [measuredViewportHeight, setMeasuredViewportHeight] = React.useState(0);
    const [bodyWindowTopOffset, setBodyWindowTopOffset] = React.useState(0);
    const [renamingViewId, setRenamingViewId] = React.useState<string | null>(null);
    const [mobileQuery, setMobileQuery] = React.useState('');
    const placementRects = React.useRef(new Map<string, SessionBoardItemRect>());
    const viewRects = React.useRef(new Map<string, SessionBoardItemRect>());
    const viewsRowY = React.useRef(0);
    const viewsHorizontalOffset = React.useRef(0);
    const scrollViewportY = React.useRef(0);
    const scrollOffsetY = React.useRef(0);
    const gridContentY = React.useRef(0);
    const scrollRef = React.useRef<ScrollView>(null);
    const orderedPresentationItemIds = React.useRef<readonly string[]>([]);
    const presentationKey = `view:${controller.activeViewId}`;
    const dragAutoscrollActive = useSharedValue(false);
    const dragPointerContentY = useSharedValue<number | null>(null);
    const scrollViewportTop = useSharedValue(0);
    const scrollViewportHeight = useSharedValue(0);
    const scrollOffset = useSharedValue(0);
    const scrollContentHeight = useSharedValue(0);
    const scrollToOffset = React.useCallback((offsetY: number) => {
        scrollRef.current?.scrollTo({ y: offsetY, animated: false });
    }, []);
    useTreeDropAutoscroll({
        isActive: dragAutoscrollActive,
        pointerY: dragPointerContentY,
        viewportTopY: scrollViewportTop,
        viewportHeight: scrollViewportHeight,
        scrollOffsetY: scrollOffset,
        contentHeight: scrollContentHeight,
        scrollToOffset,
    });
    const onGridLayout = React.useCallback((event: LayoutChangeEvent) => {
        const width = Math.trunc(event.nativeEvent.layout.width);
        gridContentY.current = event.nativeEvent.layout.y;
        setGridWidth((current) => (current === width ? current : width));
    }, []);
    const capturePresentationPosition = React.useCallback((offset: number) => {
        continuity?.presentationPositions.write(presentationKey, captureSessionBoardPresentationPosition({
            orderedItemIds: orderedPresentationItemIds.current,
            itemRects: placementRects.current,
            contentStartY: gridContentY.current,
            scrollOffset: offset,
        }));
    }, [continuity, presentationKey]);
    const restorePresentationPosition = React.useCallback(() => {
        const position = continuity?.presentationPositions.read(presentationKey);
        if (!position) return;
        scrollRef.current?.scrollTo({
            y: resolveSessionBoardPresentationOffset({
                position,
                itemRects: placementRects.current,
                contentStartY: gridContentY.current,
            }),
            animated: false,
        });
    }, [continuity, presentationKey]);

    if (!snapshot) {
        return <View style={styles.root} testID={testID} />;
    }

    const activeView = controller.activeView;
    const layoutCard = boardStateCard(
        snapshot,
        testID,
        mutationControls && controller.supports('item.prepareEncryption')
            ? () => { void controller.run({ kind: 'item.prepareEncryption' }); }
            : undefined,
    );

    // Offline and stale are explained, never faked: the last content the person
    // loaded stays on screen and the freshness line says why it may be behind.
    const freshnessLabel = snapshot.reachability === 'offline'
        ? t('sessionBoard.board.offline')
        : snapshot.freshness === 'stale'
            ? t('sessionBoard.board.stale')
            : null;

    const boardEmpty = isSessionBoardEmpty(snapshot);
    const placements = activeView?.placements ?? [];
    const recovered = controller.recoveredItemIds;
    const visiblePlacementIds = props.host === 'mobileCockpit'
        ? filterSessionBoardItemIds({
            orderedItemIds: placements.map((placement) => placement.itemId),
            itemsById: snapshot.itemsById,
            query: mobileQuery,
        })
        : placements.map((placement) => placement.itemId);
    const visiblePlacementIdSet = new Set(visiblePlacementIds);
    const visiblePlacements = placements.filter((placement) => visiblePlacementIdSet.has(placement.itemId));
    const visibleRecovered = props.host === 'mobileCockpit'
        ? filterSessionBoardItemIds({ orderedItemIds: recovered, itemsById: snapshot.itemsById, query: mobileQuery })
        : recovered;
    orderedPresentationItemIds.current = visiblePlacementIds;

    /**
     * Semantic spans as real widths.
     *
     * The grid recomposes in whole tiers at its measured width rather than
     * letting each card fall back on its own, so the person's intent survives
     * every window size: a `compact` card can never end up drawn wider than the
     * `medium` beside it.
     */
    const gridAvailableWidth = gridWidth - (GRID_GAP * 2);
    const gridTier = resolveSessionBoardGridTier(gridAvailableWidth);
    const itemWidthFor = (width: SessionBoardItemWidth): number | null => {
        if (props.layout !== 'grid' || gridWidth <= 0) return null;
        return resolveSessionBoardItemWidthPx({
            width,
            availableWidthPx: gridAvailableWidth,
            tier: gridTier,
        });
    };

    /**
     * Which cards build their body.
     *
     * Opening a Board must not instantiate every document, hosted surface and
     * plugin frame it holds, so a card outside a near-viewport window draws its
     * chrome and waits. Nothing here is an invented budget: the window is one
     * measured viewport of overscan either side of the scroll position, and an
     * item that has not been laid out yet is placed by the surface's own
     * minimum card height (`heightBounds.min`), which is a sound lower bound on
     * where ordinal `n` can start. Before the ScrollView reports its height the
     * platform window height stands in for it, so the very first frame is
     * bounded too.
     *
     * Card chrome always renders, so an offscreen card keeps its title, menu and
     * accessibility identity; only the expensive content waits.
     */
    const bodyWindowQuantum = Math.max(1, heightBounds.min);
    const bodyWindowViewport = measuredViewportHeight > 0 ? measuredViewportHeight : windowHeight;
    const bodyWindowTop = bodyWindowTopOffset - bodyWindowViewport;
    const bodyWindowBottom = bodyWindowTopOffset + bodyWindowQuantum + (bodyWindowViewport * 2);
    const isItemBodyNearViewport = (itemId: string, ordinal: number): boolean => {
        if (bodyWindowViewport <= 0) return true;
        const rect = placementRects.current.get(itemId);
        if (!rect) return ordinal * bodyWindowQuantum <= bodyWindowBottom;
        const top = gridContentY.current + rect.y;
        return top + rect.height >= bodyWindowTop && top <= bodyWindowBottom;
    };

    // Item recovery navigation comes from the same controller that answers for the
    // Board-level card above, so an item and its Board can never disagree about
    // whether a way out of a locked or retired source exists.
    const renderItem = (
        itemId: string,
        width: SessionBoardItemWidth,
        expanded = false,
        projectedOverride?: SessionBoardItemProjection,
        deferBody = false,
    ) => {
        const projected = projectedOverride ?? snapshot.itemsById.get(itemId);
        if (!projected) return null;
        // Edit is item-specific: caller-authored HTML additionally requires the
        // mounted caller runtime, while native Notes remain editable without it.
        // The controller owns that combined handler truth for every activation
        // surface (pointer, keyboard, screen reader and direct command).
        const supportsEdit = controller.supportsItemEdit(itemId);
        // A move needs a sibling to anchor against. At the ends of a view there is
        // none, so the direction is omitted rather than offered and ignored.
        const placementIndex = placements.findIndex((placement) => placement.itemId === itemId);
        // Resize, reorder, Move to view and Remove from this view all address a
        // PLACEMENT. A recovered item has none, so the layout owner would answer
        // every one of them `session_board_item_not_found`: they are absent here
        // and Pin is the operation that item actually has.
        const placed = placementIndex >= 0;
        const movable = placementIndex < 0
            ? null
            : { before: placementIndex > 0, after: placementIndex < placements.length - 1 };
        const moveDestinations = !placed ? [] : snapshot.views
            .filter((candidate) => !candidate.synthetic
                && candidate.id !== activeView?.id
                && !candidate.placements.some((placement) => placement.itemId === itemId))
            // The move menu names a destination the person can recognise, so it uses
            // the same title resolver the view strip draws — a shared view title is
            // author copy that may be absent or blank, and `null` is not a label.
            .map((candidate) => ({ id: candidate.id, title: resolveSessionBoardViewTitle(candidate) }));
        return (
            <SessionWidgetHost
                expanded={expanded}
                sessionId={props.sessionId}
                {...(props.session ? { session: props.session } : {})}
                item={projected}
                host={props.host}
                primaryHost={props.resolvePrimaryHost(itemId)}
                density={props.navigationOnly ? 'preview' : props.density}
                canEdit={mutationControls ? snapshot.canEdit : false}
                executableCurrentness={resolveSessionBoardExecutableCurrentness(
                    snapshot,
                    projected,
                    props.pluginRuntime,
                )}
                width={width}
                heightBounds={heightBounds}
                {...(deferBody ? { deferBody: true } : {})}
                {...(controller.headingFocusRequest?.itemId === itemId
                    ? {
                        focusHeadingRequestId: controller.headingFocusRequest.requestId,
                        onHeadingFocusHandled: controller.acknowledgeHeadingFocus,
                    }
                    : {})}
                actionBinding={props.resolveActionBinding?.(itemId) ?? null}
                resolveSourceAvailability={controller.resolveSourceAvailability}
                {...(props.pluginRuntime ? { pluginRuntime: props.pluginRuntime } : {})}
                {...(props.callerHostedHtmlRuntime ? { callerHostedHtmlRuntime: props.callerHostedHtmlRuntime } : {})}
                {...(props.onReadFullItem ? { onReadFull: () => props.onReadFullItem?.(itemId) } : {})}
                {...(props.retained !== true
                    ? props.companionItemIds?.has(itemId)
                        ? props.onRemoveFromCompanion
                            ? { onRemoveFromCompanion: () => props.onRemoveFromCompanion?.(itemId) }
                            : {}
                        : props.onAddToCompanion
                            ? { onAddToCompanion: () => props.onAddToCompanion?.(itemId) }
                            : {}
                    : {})}
                {...(props.onOpenItemHere
                    ? { onOpenHere: () => props.onOpenItemHere?.(itemId) }
                    : {})}
                {...(mutationControls && controller.supports('item.remove')
                    ? { onRemove: () => { void controller.run({ kind: 'item.remove', itemId }); } }
                    : {})}
                {...(mutationControls && placed && controller.supports('item.unpin')
                    ? { onUnpin: () => { void controller.run({ kind: 'item.unpin', itemId }); } }
                    : {})}
                {...(mutationControls && supportsEdit ? { onEdit: () => { void controller.run({ kind: 'item.edit', itemId }); } } : {})}
                {...(mutationControls && controller.supports('item.rename')
                    ? { onRename: (title: string) => { void controller.run({ kind: 'item.rename', itemId, title }); } }
                    : {})}
                {...(mutationControls && placed && controller.supports('item.resize')
                    ? { onResize: (next: SessionBoardItemWidth) => { void controller.run({ kind: 'item.resize', itemId, width: next }); } }
                    : {})}
                {...(mutationControls && controller.supports('item.height')
                    ? { onSetHeight: (height: SessionSurfaceItemV1['height']) => { void controller.run({ kind: 'item.height', itemId, height }); } }
                    : {})}
                {...(mutationControls && controller.supports('item.move') && movable
                    ? {
                        onMove: (direction: 'before' | 'after') => { void controller.run({ kind: 'item.move', itemId, direction }); },
                        onMoveAnchored: (anchor: Readonly<{ side: 'before' | 'after'; itemId: string }>) => {
                            if (!activeView || activeView.synthetic) return;
                            void controller.run({
                                kind: 'item.moveAnchored',
                                itemId,
                                fromViewId: activeView.id,
                                toViewId: activeView.id,
                                anchor,
                            });
                        },
                        orderedMoveItemIds: placements.map((placement) => placement.itemId),
                        moveItemRects: placementRects.current,
                        canMoveBefore: movable.before,
                        canMoveAfter: movable.after,
                        movePosition: placementIndex + 1,
                        moveTotal: placements.length,
                        onDragActivityChange: (active: boolean) => {
                            dragAutoscrollActive.value = active;
                            if (!active) dragPointerContentY.value = null;
                        },
                        onDragTranslation: (_translationX: number, translationY: number) => {
                            const rect = placementRects.current.get(itemId);
                            if (!rect) return;
                            dragPointerContentY.value = gridContentY.current
                                + rect.y
                                + (rect.height / 2)
                                - scrollOffsetY.current
                                + translationY;
                        },
                    }
                    : {})}
                {...(mutationControls && controller.supports('item.moveToView') && moveDestinations.length > 0
                    ? {
                        moveDestinations,
                        onMoveToView: (viewId: string) => { void controller.run({ kind: 'item.moveToView', itemId, viewId }); },
                        resolveMoveToView: (translationX: number, translationY: number) => {
                            const itemRect = placementRects.current.get(itemId);
                            if (!itemRect) return null;
                            const x = itemRect.x + (itemRect.width / 2) + translationX;
                            const y = scrollViewportY.current
                                + gridContentY.current
                                + itemRect.y
                                + (itemRect.height / 2)
                                - scrollOffsetY.current
                                + translationY;
                            for (const destination of moveDestinations) {
                                const rect = viewRects.current.get(destination.id);
                                if (!rect) continue;
                                const left = rect.x - viewsHorizontalOffset.current;
                                const top = viewsRowY.current + rect.y;
                                if (x >= left && x <= left + rect.width && y >= top && y <= top + rect.height) {
                                    return destination.id;
                                }
                            }
                            return null;
                        },
                    }
                    : {})}
                {...(props.navigationOnly ? { openActionLabel: t('sessionBoard.sidebar.openInDetails') } : {})}
                {...(mutationControls && controller.supports('item.managePlugin')
                    ? { onManagePlugin: () => { void controller.run({ kind: 'item.managePlugin', itemId }); } }
                    : {})}
                {...(mutationControls && controller.supports('item.prepareEncryption')
                    ? { onPrepareEncryption: () => { void controller.run({ kind: 'item.prepareEncryption' }); } }
                    : {})}
            />
        );
    };

    // The expanded item route: still inside Details, with a compact back
    // affordance and no modal or nested navigator of its own.
    const focusedItemId = props.focusedItemId ?? null;
    if (focusedItemId) {
        const focusedItem = resolveSessionBoardReferenceProjection(snapshot, focusedItemId);
        return (
            <View style={styles.root} testID={`${testID}-focused`}>
                {props.header}
                {mutationControls ? <MutationRecoveryNotice controller={controller} testID={testID} /> : null}
                {props.onLeaveFocusedItem ? (
                    <View style={styles.addRow}>
                        <RoundButton
                            size="small"
                            display="inverted"
                            testID={`${testID}-focused-back`}
                            title={t('sessionBoard.title')}
                            onPress={props.onLeaveFocusedItem}
                        />
                    </View>
                ) : null}
                <ScrollView style={styles.scroll} testID={`${testID}-focused-scroll`}>
                    <View style={styles.single}>
                        {props.editor ? (
                            <View testID={`${testID}-focused-editor`}>{props.editor}</View>
                        ) : null}
                        {renderItem(focusedItemId, 'full', true, focusedItem)}
                    </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={styles.root} testID={testID}>
            {props.header}
            {mutationControls ? <MutationRecoveryNotice controller={controller} testID={testID} /> : null}
            <View
                style={styles.viewsRow}
                onLayout={(event) => { viewsRowY.current = event.nativeEvent.layout.y; }}
            >
                <View style={styles.viewsStrip}>
                    <SessionBoardViewStrip
                        views={snapshot.views}
                        activeViewId={controller.activeViewId}
                        removalFocusRequest={controller.viewRemovalFocusRequest}
                        onRemovalFocusHandled={controller.acknowledgeViewRemovalFocus}
                        tabIdPrefix={viewTabIdPrefix}
                        panelId={viewPanelId}
                        onSelectView={(viewId) => { void controller.run({ kind: 'view.select', viewId }); }}
                        onViewLayout={(viewId, event) => {
                            const { x, y, width, height } = event.nativeEvent.layout;
                            viewRects.current.set(viewId, { x, y, width, height });
                        }}
                        onHorizontalOffset={(offset) => { viewsHorizontalOffset.current = offset; }}
                        onViewFocusTargetChange={props.onViewFocusTargetChange}
                        focusFallbackRef={props.viewActionsFocusTargetRef}
                        {...(mutationControls ? {
                            renamingViewId,
                            onRenameCancel: () => setRenamingViewId(null),
                            onRenameCommit: (viewId: string, title: string) => {
                                setRenamingViewId(null);
                                void controller.run({ kind: 'view.rename', viewId, title });
                            },
                        } : {})}
                        testID={`${testID}-views`}
                    />
                </View>
                {mutationControls ? (
                    <ViewActions
                        controller={controller}
                        testID={testID}
                        onBeginRename={setRenamingViewId}
                        onFocusTargetChange={props.onViewActionsFocusTargetChange}
                    />
                ) : null}
            </View>
            {controller.announcement ? (
                <Text
                    testID={`${testID}-announcement`}
                    style={styles.freshness}
                    accessibilityLiveRegion="polite"
                    role="status"
                >
                    {controller.announcement}
                </Text>
            ) : null}
            {freshnessLabel ? (
                <Text testID={`${testID}-freshness`} style={styles.freshness} accessibilityLiveRegion="polite">
                    {freshnessLabel}
                </Text>
            ) : null}
            {layoutCard ?? (
                <ScrollView
                    ref={scrollRef}
                    {...(snapshot.views.length > 1
                        ? {
                            nativeID: viewPanelId,
                            // `tabpanel` is an ARIA role, so it belongs on `role`;
                            // React Native's `accessibilityRole` union has no such
                            // value and silently dropped the panel relationship.
                            role: 'tabpanel' as const,
                            accessibilityLabelledBy: sessionBoardViewTabNativeId(viewTabIdPrefix, controller.activeViewId),
                            'aria-labelledby': sessionBoardViewTabNativeId(viewTabIdPrefix, controller.activeViewId),
                        }
                        : {})}
                    style={styles.scroll}
                    testID={`${testID}-scroll`}
                    scrollEventThrottle={16}
                    onLayout={(event) => {
                        scrollViewportY.current = event.nativeEvent.layout.y;
                        scrollViewportTop.value = 0;
                        scrollViewportHeight.value = event.nativeEvent.layout.height;
                        setMeasuredViewportHeight(event.nativeEvent.layout.height);
                    }}
                    onContentSizeChange={(_width, height) => {
                        scrollContentHeight.value = height;
                        restorePresentationPosition();
                    }}
                    onScroll={(event) => {
                        scrollOffsetY.current = event.nativeEvent.contentOffset.y;
                        scrollOffset.value = event.nativeEvent.contentOffset.y;
                        capturePresentationPosition(event.nativeEvent.contentOffset.y);
                        // Quantized by one minimum card height so a flick advances the
                        // body window once per card rather than once per frame.
                        const nextWindowTop = Math.max(0, Math.floor(
                            event.nativeEvent.contentOffset.y / bodyWindowQuantum,
                        ) * bodyWindowQuantum);
                        setBodyWindowTopOffset((current) => (current === nextWindowTop ? current : nextWindowTop));
                    }}
                >
                    {props.navigationOnly && props.onOpenBoardDetails ? (
                        <View style={styles.addRow}>
                            <RoundButton
                                size="small"
                                display="inverted"
                                testID={`${testID}-open-details`}
                                title={t('sessionBoard.sidebar.openInDetails')}
                                onPress={props.onOpenBoardDetails}
                            />
                        </View>
                    ) : null}
                    {props.host === 'mobileCockpit' && !boardEmpty ? (
                        <SearchHeader
                            testID={`${testID}-search`}
                            value={mobileQuery}
                            onChangeText={setMobileQuery}
                            placeholder={t('sessionBoard.mobile.searchPlaceholder')}
                        />
                    ) : null}
                    {props.editor ?? props.picker}
                    {/*
                      * An open editor or picker owns the interaction layer of an
                      * EMPTY Board: its invitation controls are not simultaneously
                      * focusable beneath the card. A Board that already has content
                      * keeps rendering it — the editor is an insertion point above
                      * the grid, not a modal that hides the person's work.
                      *
                      * The invitation itself is the app's ONE empty-state tile, not
                      * a Board-local pair of centered Texts: the same glyph, measure,
                      * typography and font-scale behaviour every other empty surface
                      * in Happier already has.
                      */}
                    {boardEmpty ? (props.editor ?? props.picker ? null : (
                        <EmptyState
                            testID={`${testID}-empty`}
                            icon={<Icon name="squares-four" size={32} color={theme.colors.text.secondary} />}
                            title={snapshot.canEdit
                                ? t('sessionBoard.empty.editor.title')
                                : t('sessionBoard.empty.viewer.title')}
                            subtitle={snapshot.canEdit
                                ? t('sessionBoard.empty.editor.description')
                                : t('sessionBoard.empty.viewer.description')}
                            {...(mutationControls && controller.addIntents.length > 0
                                ? { action: <AddControls controller={controller} testID={testID} /> }
                                : {})}
                        />
                    )) : (
                        <>
                            {/* The Add affordance stays reachable once content exists. */}
                            {mutationControls ? <AddControls controller={controller} testID={testID} /> : null}
                            {visiblePlacements.length === 0 && visibleRecovered.length === 0 ? (
                                <EmptyState
                                    testID={`${testID}-empty-view`}
                                    icon={<Icon
                                        name={mobileQuery.trim() ? 'magnifying-glass' : 'squares-four'}
                                        size={32}
                                        color={theme.colors.text.secondary}
                                    />}
                                    title={mobileQuery.trim()
                                        ? t('common.noMatches')
                                        : t('sessionBoard.views.empty.title')}
                                    {...(mobileQuery.trim()
                                        ? {}
                                        : { subtitle: t('sessionBoard.views.empty.reason') })}
                                />
                            ) : (
                                <View
                                    style={props.layout === 'grid' ? styles.grid : styles.single}
                                    onLayout={onGridLayout}
                                >
                                                    {visiblePlacements.map((placement, ordinal) => {
                                        const width = itemWidthFor(placement.width);
                                        const deferBody = !isItemBodyNearViewport(placement.itemId, ordinal);
                                        return (
                                            <View
                                                key={placement.itemId}
                                                testID={`${testID}-placement-${placement.itemId}`}
                                                style={width === null ? undefined : { width, minWidth: 0 }}
                                                onLayout={(event) => {
                                                    const { x, y, width: measuredWidth, height } = event.nativeEvent.layout;
                                                    placementRects.current.set(placement.itemId, {
                                                        x,
                                                        y,
                                                        width: measuredWidth,
                                                        height,
                                                    });
                                                }}
                                            >
                                                {renderItem(placement.itemId, placement.width, false, undefined, deferBody)}
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                            {visibleRecovered.length > 0 ? (
                                <View testID={`${testID}-recovered`}>
                                    <View style={styles.section}>
                                        <Text style={styles.sectionTitle} accessibilityRole="header">
                                            {t('sessionBoard.recovered.title')}
                                        </Text>
                                        <Text style={styles.sectionBody}>{t('sessionBoard.recovered.description')}</Text>
                                    </View>
                                    <View style={styles.single}>
                                        {visibleRecovered.map((itemId) => (
                                            <View key={itemId}>
                                                {renderItem(itemId, 'full')}
                                                {mutationControls && controller.supports('item.pin') ? (
                                                    <View style={styles.addRow}>
                                                        <RoundButton
                                                            size="small"
                                                            display="inverted"
                                                            testID={`${testID}-recovered-pin-${itemId}`}
                                                            title={t('sessionBoard.recovered.pin')}
                                                            onPress={() => { void controller.run({ kind: 'item.pin', itemId }); }}
                                                        />
                                                    </View>
                                                ) : null}
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            ) : null}
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    );
}
