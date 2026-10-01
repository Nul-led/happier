import * as React from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SessionWidgetHost } from '@/components/sessions/board/SessionWidgetHost';
import type { SessionBoardItemRect } from '@/components/sessions/board/SessionBoardItemMoveHandle';
import {
    defaultSessionBoardSourceAvailability,
    resolveSessionBoardItemTitle,
    type SessionBoardSourceAvailabilityResolver,
} from '@/components/sessions/board/sessionBoardItemPresentation';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import type { CallerHostedHtmlRuntime } from '@/components/ui/surfaces/hostedHtml/HostedHtmlSurfaceAdapter';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import type { SessionBoardBinding } from '@/components/sessions/board/observeSessionBoard';
import { t } from '@/text';
import type { SessionBoardPrimaryMountResolver } from '@/sync/domains/session/board';
import { resolveSessionBoardExecutableCurrentness } from '@/sync/domains/session/board';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import type { Session } from '@/sync/domains/state/storageTypes';
import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';

import { useWidgetFrameSurfaceDefault } from '@/components/widgets/frame/useWidgetFrameStyle';
import type { WidgetFrameStyle } from '@/components/widgets/frame/WidgetFrame';
import { resolveWidgetFrameStyle } from '@/components/widgets/frame/widgetFrameStyle';

import {
    isSessionCompanionGlanceItem,
    SessionCompanionGlance,
    SessionCompanionGlancePreview,
    sessionCompanionGlanceLabel,
    type SessionCompanionGlanceItem,
} from './glances/SessionCompanionGlance';
import { SessionCompanionItemFrame } from './SessionCompanionItemFrame';
import {
    applySessionCompanionMutationWithNotice,
    buildSessionPresentationNoticeKeyPrefix,
} from './presentation/sessionCompanionPresentationAdapter';
import { buildSessionCompanionItemActions } from './sessionCompanionMenu';
import {
    resolveSessionCompanionBoardInventory,
    resolveSessionCompanionContentItems,
    type SessionCompanionBoardInventory,
    type SessionCompanionContentItem,
} from './sessionCompanionContentModel';
import type { SessionCompanionController } from './state/useSessionCompanionController';
import {
    SESSION_SUMMARY_COMPANION_ITEM,
    sessionCompanionItemKey,
    type SessionCompanionBuiltinItemId,
} from './state/sessionCompanionPreference';
import {
    SessionSummaryCard,
    type SessionSummaryAnswerPermission,
    type SessionSummaryDestinationHandlers,
} from './summary/SessionSummaryCard';
import { SessionAgentPlanCard, type SessionAgentPlanActivity } from './plan/SessionAgentPlanCard';
import { SessionCompanionAddControl, type SessionCompanionAddBinding } from './picker/SessionCompanionAddControl';
import { SessionCompanionDropSlot } from './drop/SessionCompanionDropSlot';
import type { SessionPendingPermission } from '@/sync/ops/sessionPendingPermissions';
import { useSessionMachineName } from '@/components/sessions/agents/presentation/useSessionMachineName';
import { showPendingPermissionInChat } from './summary/showPendingPermissionInChat';
import { answerSessionPermission } from '@/sync/ops/sessionPermissionAnswers';
import { createAppSessionTranscriptActions } from '@/components/sessions/transcript/source/appSessionTranscriptActions';
import { useSessionSummaryModel } from './summary/useSessionSummaryModel';
import {
    resolveSessionCompanionOuterRailWidthPx,
    SESSION_COMPANION_CONTENT_HORIZONTAL_PADDING_PX,
} from './layout/resolveSessionCompanionPlacement';

const stylesheet = StyleSheet.create(() => ({
    scroll: { flex: 1, minHeight: 0 },
    content: {
        paddingTop: 2,
        paddingBottom: 12,
        paddingHorizontal: SESSION_COMPANION_CONTENT_HORIZONTAL_PADDING_PX,
    },
    stateControls: { flexDirection: 'row', justifyContent: 'flex-end' },
}));

type PendingWidgetState = Readonly<{
    kind: 'loading' | 'error' | 'warning' | 'unavailable';
    title: string;
    reason: string;
    diagnosticCode?: string;
}>;

/** The Summary hero is the Companion's own anchor; every other item is a widget in the frame. */
function isCompanionFramedItem(entry: SessionCompanionContentItem): boolean {
    return entry.kind !== 'summary' && entry.kind !== 'pending_widget' && entry.kind !== 'missing_widget';
}

function companionItemMeasurementKey(entry: SessionCompanionContentItem): string {
    return sessionCompanionItemKey(entry.ref);
}

function resolvePendingWidgetState(
    inventory: Exclude<SessionCompanionBoardInventory, { kind: 'authoritative' }>,
): PendingWidgetState {
    switch (inventory.kind) {
        case 'loading':
            return {
                kind: 'loading',
                title: t('sessionBoard.item.loading.title'),
                reason: t('sessionBoard.item.loading.reason'),
            };
        case 'locked':
            return {
                kind: 'unavailable',
                title: t('sessionBoard.item.locked.title'),
                reason: t('sessionBoard.item.locked.reason'),
                diagnosticCode: 'session_companion_widget_locked',
            };
        case 'offline':
            return {
                kind: 'warning',
                title: t('sessionBoard.board.unavailable.title'),
                reason: t('sessionBoard.board.offline'),
                diagnosticCode: 'session_companion_widget_offline',
            };
        case 'revoked':
            return {
                kind: 'unavailable',
                title: t('sessionBoard.board.unavailable.title'),
                reason: t('session.follow.accessLost'),
                diagnosticCode: 'session_companion_widget_access_revoked',
            };
        case 'unavailable':
            if (inventory.reason === 'unopenable') {
                return {
                    kind: 'error',
                    title: t('sessionBoard.item.unopenable.title'),
                    reason: t('sessionBoard.item.unopenable.reason'),
                    diagnosticCode: 'session_companion_widget_unopenable',
                };
            }
            if (inventory.reason === 'unsupported' || inventory.reason === 'protocol_unavailable') {
                return {
                    kind: 'unavailable',
                    title: t('sessionBoard.item.unsupported.title'),
                    reason: t('sessionBoard.item.unsupported.reason'),
                    diagnosticCode: 'session_companion_widget_unsupported',
                };
            }
            return {
                kind: 'unavailable',
                title: t('sessionBoard.board.unavailable.title'),
                reason: inventory.reason === 'signed_out'
                    ? t('modals.pleaseSignInFirst')
                    : inventory.reason === 'invalid_address' || inventory.reason === 'unknown_home'
                        ? t('errors.sessionDeletedDescription')
                        : t('sessionBoard.board.unavailable.reason'),
                diagnosticCode: `session_companion_widget_${inventory.reason}`,
            };
    }
}

export type SessionCompanionBoardBinding = SessionBoardBinding & Readonly<{ refresh?: () => void }>;

export type SessionCompanionContentProps = Readonly<{
    /** The exact Session every widget placement mounts against. */
    session: Session;
    serverId?: string | null;
    controller: SessionCompanionController;
    /** Exact Board binding; Summary remains useful while this is unavailable. */
    boardBinding: SessionCompanionBoardBinding | null;
    /** The ONE shell-derived executable placement resolver for every exact item. */
    resolvePrimaryHost: SessionBoardPrimaryMountResolver;
    /** Exact Session-scoped plugin projection/currentness for installed items. */
    pluginRuntime?: SessionPluginRuntimeState;
    /** Canonical exact-Session caller-HTML authority from the mounted Session host. */
    callerHostedHtmlRuntime?: CallerHostedHtmlRuntime;
    /** Canonical exact-Session source decision from the mounted Board owner. */
    resolveSourceAvailability?: SessionBoardSourceAvailabilityResolver;
    summaryDestinations?: SessionSummaryDestinationHandlers;
    onRevealBoardItem?: (itemId: string) => void;
    /** Personal plugin settings recovery; independent from either removal. */
    onManageBoardItemPlugin?: (itemId: string) => void;
    onOpenFullSurface?: () => void;
    /** The one Add to Companion path; absent for a measurement pass or a read-only host. */
    addBinding?: Omit<SessionCompanionAddBinding, 'refs' | 'snapshot' | 'addItem'>;
    /** Hosts that seat Add elsewhere (the phone's navigation bar) hide the column's row. */
    addPlacement?: 'column' | 'external';
    /**
     * Hosts that replace the transcript (the phone's Companion destination) reveal it
     * before "Show in chat" lands; a host beside a live transcript passes nothing.
     */
    revealTranscript?: () => void;
    /** The rail is intentionally condensed; the Cockpit/full route is uncapped. */
    presentation?: 'rail' | 'full';
    testID?: string;
    /** Reports the outer rail bounds required by the largest laid-out card. */
    onMeasuredCardBounds?: (bounds: Readonly<{ widthPx: number; heightPx: number }>) => void;
    /**
     * Renders the real card shells for geometry only. Executable sources,
     * navigation, Actions, mutation controls, retry and hosted runtimes are all
     * withheld; the containing Host also removes this tree from interaction and
     * accessibility. This is not a second presentation or data owner. The Summary
     * keeps its live shape (compact rows, destinations, overflow) through inert
     * handlers, because withholding them would measure a different, larger card.
     */
    measurementOnly?: boolean;
}>;

const INERT_SUMMARY_HANDLER = (): void => {};

/** The same destination set, each one a no-op: identical row shape, no effect. */
function inertSessionSummaryDestinations(
    destinations: SessionSummaryDestinationHandlers,
): SessionSummaryDestinationHandlers {
    return Object.freeze(Object.fromEntries(Object.entries(destinations)
        .filter(([, handler]) => handler !== undefined)
        .map(([destination]) => [destination, INERT_SUMMARY_HANDLER]))) as SessionSummaryDestinationHandlers;
}

/**
 * The ordered Companion body, shared by the wide rail and the mobile screen.
 *
 * Every widget renders through the sibling-owned `SessionWidgetHost` with the
 * exact Session id, the canonical Session plugin runtime and the shell-derived
 * primary mount. The Companion contains no renderer switch, Host API bridge,
 * widget repository or capability decision of its own.
 */
export const SessionCompanionContent = React.memo(function SessionCompanionContent(
    props: SessionCompanionContentProps,
) {
    const styles = stylesheet;
    const testID = props.testID ?? 'session-companion-content';
    const full = props.presentation === 'full';
    const { controller } = props;
    const inventory = resolveSessionCompanionBoardInventory(props.boardBinding);
    const board = props.boardBinding?.status === 'ready' ? props.boardBinding.snapshot : null;
    const boardItemsById = board?.itemsById;
    const items = React.useMemo(() => resolveSessionCompanionContentItems({
        refs: controller.preference.items,
        boardItemsById: boardItemsById ?? new Map(),
        inventory,
    }), [boardItemsById, controller.preference.items, inventory]);
    const itemMeasurementKeys = React.useMemo(() => items.map(companionItemMeasurementKey), [items]);
    // Reorder needs a second item to reorder against, and a measurement pass has
    // no person in front of it. Both halves of the required pair — pointer drag
    // and the explicit Move commands — appear together or not at all.
    const reorderable = props.measurementOnly !== true && items.length > 1;
    // One subscription to the Companion's Appearance default; each item resolves against it.
    const frameSurfaceDefault = useWidgetFrameSurfaceDefault('companion');
    const frameStyleOf = (entry: SessionCompanionContentItem): WidgetFrameStyle => resolveWidgetFrameStyle({
        placement: 'companion',
        surfaceDefault: frameSurfaceDefault,
        override: entry.ref.frameStyle ?? null,
    });
    // Viewer-local card geometry for the shared pointer-drop resolver. It never
    // reaches persistence: a drop resolves to a semantic target index and the
    // Companion preference stores order, not pixels.
    const cardRectsRef = React.useRef(new Map<string, SessionBoardItemRect>());
    const measuredCardsRef = React.useRef(new Map<string, Readonly<{ widthPx: number; heightPx: number }>>());
    const reportLargestMeasuredCard = React.useCallback(() => {
        if (!props.onMeasuredCardBounds || measuredCardsRef.current.size === 0) return;
        let widthPx = 0;
        let heightPx = 0;
        for (const bounds of measuredCardsRef.current.values()) {
            widthPx = Math.max(widthPx, bounds.widthPx);
            heightPx = Math.max(heightPx, bounds.heightPx);
        }
        // `onLayout` measures the card inside this owner's horizontal content
        // padding. Placement reserves the outer rail, so publish that unit once
        // here rather than feeding the inner width back as the next constraint.
        props.onMeasuredCardBounds({
            widthPx: resolveSessionCompanionOuterRailWidthPx(widthPx),
            heightPx,
        });
    }, [props.onMeasuredCardBounds]);
    React.useEffect(() => {
        const currentKeys = new Set(itemMeasurementKeys);
        for (const key of measuredCardsRef.current.keys()) {
            if (!currentKeys.has(key)) measuredCardsRef.current.delete(key);
        }
        for (const key of cardRectsRef.current.keys()) {
            if (!currentKeys.has(key)) cardRectsRef.current.delete(key);
        }
        reportLargestMeasuredCard();
    }, [itemMeasurementKeys, reportLargestMeasuredCard]);
    const reportCardLayout = React.useCallback((key: string, event: LayoutChangeEvent) => {
        const { width, height, x, y } = event.nativeEvent.layout;
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
        if (Number.isFinite(x) && Number.isFinite(y)) {
            cardRectsRef.current.set(key, { x, y, width, height });
        }
        if (!props.onMeasuredCardBounds) return;
        measuredCardsRef.current.set(key, { widthPx: width, heightPx: height });
        reportLargestMeasuredCard();
    }, [props.onMeasuredCardBounds, reportLargestMeasuredCard]);

    // The Companion frames the same items as the Board, so it consumes the exact
    // resolver published by that mounted controller. Rebuilding one here from a
    // plugin projection would omit the controller's Home/Session policy facts and
    // make Companion availability disagree with Board/Details. An isolated host
    // without that owner fails closed rather than inventing a second decision.
    const pluginRuntime = props.pluginRuntime;
    const resolveSourceAvailability = props.resolveSourceAvailability
        ?? defaultSessionBoardSourceAvailability;

    const summary = useSessionSummaryModel({ session: props.session, serverId: props.serverId ?? null });
    const sessionId = props.session.id;
    const actions = React.useMemo(() => createAppSessionTranscriptActions(sessionId, props.serverId ?? null), [sessionId, props.serverId]);
    // The ONE permission-answer owner the chat card and plugin Host API use, bound to
    // this exact Session. A measurement pass never answers anything.
    const answerPermission = React.useCallback<SessionSummaryAnswerPermission>((request, answer) => (
        answerSessionPermission({
            requestId: request.requestId,
            ...(request.turnId !== undefined ? { turnId: request.turnId } : {}),
            toolName: request.toolName,
            answer,
            policy: request.policy,
            respondToPermission: actions.respondToPermission,
        })
    ), [actions]);
    const planActivity: SessionAgentPlanActivity = summary.needsYou
        ? 'held'
        : summary.status?.state === 'thinking' ? 'working' : 'idle';
    // Freshness is not authorization. Last-known Board content remains a valid
    // navigation target while its Home is reachable; CAS owns write concurrency.
    const boardReachable = board?.reachability === 'reachable';
    const noticeKeyPrefix = React.useMemo(() => buildSessionPresentationNoticeKeyPrefix(
        normalizeSessionAddress(props.serverId ?? null, props.session.id),
        props.session.id,
    ), [props.serverId, props.session.id]);
    const mutateCompanion = React.useCallback((input: Readonly<{
        kind: string;
        message: string;
        apply: Parameters<typeof applySessionCompanionMutationWithNotice>[0]['apply'];
    }>) => applySessionCompanionMutationWithNotice({
        companion: controller,
        publishNotice: publishPresentationNotice,
        noticeKeyPrefix,
        ...input,
    }), [controller, noticeKeyPrefix]);
    // One reorder owner for the menu entries and the pointer/keyboard handle, so
    // direct manipulation and the explicit Move commands can never diverge.
    const moveCompanionItemTo = React.useCallback((entry: SessionCompanionContentItem, toIndex: number) => {
        mutateCompanion({
            kind: 'companion.item.move',
            message: t('sessionBoard.companion.notices.reordered'),
            apply: (companion) => companion.moveItem(entry.ref, toIndex),
        });
    }, [mutateCompanion]);
    const setCompanionItemFrameStyle = React.useCallback((entry: SessionCompanionContentItem, style: WidgetFrameStyle | null) => {
        mutateCompanion({
            kind: 'companion.item.frameStyle.set',
            message: t('widgetFrame.noticeChanged'),
            apply: (companion) => companion.setItemFrameStyle(entry.ref, style),
        });
    }, [mutateCompanion]);
    const removeFromCompanion = React.useCallback((entry: SessionCompanionContentItem) => {
        mutateCompanion({
            kind: 'companion.item.remove',
            message: t('sessionBoard.companion.notices.removed'),
            apply: (companion) => companion.removeItem(entry.ref),
        });
    }, [mutateCompanion]);
    const machineName = useSessionMachineName(props.session.id, props.serverId ?? null);
    const revealTranscript = props.revealTranscript;
    const showPermissionInChat = React.useCallback((request: SessionPendingPermission) => {
        showPendingPermissionInChat({
            sessionId,
            requestId: request.requestId,
            ...(revealTranscript ? { revealTranscript } : {}),
        });
    }, [revealTranscript, sessionId]);
    const [pickerRequest, setPickerRequest] = React.useState(0);
    const addItem = React.useCallback((ref: SessionCompanionAddBinding['refs'][number]) => {
        mutateCompanion({
            kind: 'companion.item.add',
            message: t('sessionBoard.companion.notices.added'),
            apply: (companion) => companion.addItem(ref),
        });
    }, [mutateCompanion]);
    const addBindingInput = props.addBinding;
    const glanceServerId = props.serverId ?? null;
    // The add popover's Glances tiles show the real glance (Changes from the cached snapshot; Local
    // services as its frame until added, so a closed popover never starts the daemon watch).
    const renderGlancePreview = React.useCallback((id: SessionCompanionBuiltinItemId): React.ReactNode => (
        id === 'changes' || id === 'local_services'
            ? <SessionCompanionGlancePreview kind={id} sessionId={sessionId} serverId={glanceServerId} testID={`${testID}-add-preview-${id}`} />
            : null
    ), [glanceServerId, sessionId, testID]);
    const addBinding = React.useMemo<SessionCompanionAddBinding | null>(() => (
        addBindingInput && !props.measurementOnly
            ? { ...addBindingInput, refs: controller.preference.items, snapshot: board, addItem, renderGlancePreview }
            : null
    ), [addBindingInput, addItem, board, controller.preference.items, props.measurementOnly, renderGlancePreview]);

    // A measurement pass must size the SAME card the live rail shows: compact rows,
    // row destinations and the "More details" overflow all shape its height. It keeps
    // that shape with inert handlers, so nothing it renders can navigate.
    const summaryDestinations = React.useMemo(() => (
        props.measurementOnly && props.summaryDestinations
            ? inertSessionSummaryDestinations(props.summaryDestinations)
            : props.summaryDestinations
    ), [props.measurementOnly, props.summaryDestinations]);
    const summaryOpenFullSurface = props.measurementOnly && props.onOpenFullSurface
        ? INERT_SUMMARY_HANDLER
        : props.onOpenFullSurface;
    const renderBody = (
        entry: SessionCompanionContentItem,
        headerAccessory: React.ReactNode,
        frameStyle: WidgetFrameStyle,
    ): React.ReactNode => {
        if (entry.kind === 'summary') {
            return (
                <SessionSummaryCard
                    model={summary}
                    density={controller.preference.density}
                    testID={`${testID}-summary`}
                    {...(summaryDestinations ? { destinations: summaryDestinations } : {})}
                    {...(summaryOpenFullSurface ? { onOpenFullSurface: summaryOpenFullSurface } : {})}
                    {...(props.measurementOnly ? {} : { answerPermission })}
                    {...(props.measurementOnly ? {} : { showPermissionInChat })}
                    machineName={machineName}
                    headerAccessory={headerAccessory}
                    presentation={full ? 'full' : 'card'}
                />
            );
        }
        if (isSessionCompanionGlanceItem(entry)) {
            return (
                <SessionCompanionGlance
                    entry={entry}
                    sessionId={props.session.id}
                    serverId={props.serverId ?? null}
                    frameStyle={frameStyle}
                    headerAccessory={headerAccessory}
                    measurementOnly={props.measurementOnly === true}
                    testID={`${testID}-glance-${companionItemMeasurementKey(entry)}`}
                />
            );
        }
        if (entry.kind === 'plan') {
            return (
                <SessionAgentPlanCard
                    plan={summary.plan}
                    agentLabel={summary.agentLabel}
                    activity={planActivity}
                    headerAccessory={headerAccessory}
                    frameStyle={frameStyle}
                    testID={`${testID}-plan`}
                />
            );
        }
        // Pending, removed and widget items keep their own typed states; the
        // placement's controls sit above them on the same line as their title.
        return (
            <>
                {entry.kind === 'widget' ? null : <View style={styles.stateControls}>{headerAccessory}</View>}
                {renderWidgetBody(entry, headerAccessory, frameStyle)}
            </>
        );
    };
    const renderWidgetBody = (
        entry: Exclude<SessionCompanionContentItem, { kind: 'summary' } | { kind: 'plan' } | SessionCompanionGlanceItem>,
        headerAccessory: React.ReactNode,
        frameStyle: WidgetFrameStyle,
    ): React.ReactNode => {
        if (entry.kind === 'pending_widget') {
            // Not resolved yet. Uncertainty is never relabelled as a deletion.
            const retry = (entry.inventory.kind === 'offline'
                || (entry.inventory.kind === 'unavailable'
                    && (entry.inventory.reason === 'server_error' || entry.inventory.reason === 'invalid_response')))
                ? props.boardBinding?.refresh
                : undefined;
            const state = resolvePendingWidgetState(entry.inventory);
            return (
                <SurfaceStateCard
                    testID={`${testID}-pending-${entry.ref.widgetId}`}
                    kind={state.kind}
                    title={state.title}
                    reason={state.reason}
                    {...(state.diagnosticCode ? { diagnosticCode: state.diagnosticCode } : {})}
                    {...(!props.measurementOnly && retry
                        ? { action: { label: t('common.retry'), onPress: retry } }
                        : {})}
                    accessibilitySemantics="status"
                />
            );
        }
        if (entry.kind === 'missing_widget') {
            return (
                <SurfaceStateCard
                    testID={`${testID}-removed-${entry.ref.widgetId}`}
                    kind="unavailable"
                    title={t('sessionBoard.item.removed.title')}
                    reason={t('sessionBoard.item.removed.reason')}
                    diagnosticCode="session_companion_widget_removed"
                    accessibilitySemantics="status"
                    // Only an authoritative inventory reaches this state, so dropping the
                    // reference is the one next step; it never touches the Board.
                    {...(props.measurementOnly ? {} : {
                        action: {
                            label: t('sessionBoard.companion.actions.removeFromCompanion'),
                            onPress: () => { removeFromCompanion(entry); },
                        },
                    })}
                />
            );
        }
        return (
            <SessionWidgetHost
                sessionId={props.session.id}
                session={props.session}
                item={entry.item}
                host="companion"
                frame="section"
                frameStyle={frameStyle}
                headerAccessory={headerAccessory}
                // A cold sizing pass is deliberately not a visible-host
                // candidate. `null` forces installed and hosted sources through
                // their incumbent inert preview path, so no plugin frame, Host
                // API subscription or hosted document is instantiated twice.
                primaryHost={props.measurementOnly
                    ? null
                    : props.resolvePrimaryHost(entry.ref.widgetId)}
                density={full ? 'full' : 'compact'}
                expanded={full}
                // Editing and deleting the shared record happen on the Board; the
                // Companion keeps a reference and offers only its own actions.
                canEdit={false}
                executableCurrentness={board
                    ? resolveSessionBoardExecutableCurrentness(board, entry.item, pluginRuntime)
                    : 'unverified'}
                heightBounds={{ min: 96, max: 520 }}
                resolveSourceAvailability={resolveSourceAvailability}
                {...(pluginRuntime ? { pluginRuntime } : {})}
                {...(!props.measurementOnly && props.callerHostedHtmlRuntime
                    ? { callerHostedHtmlRuntime: props.callerHostedHtmlRuntime }
                    : {})}
                testID={`session-companion-widget-${entry.ref.widgetId}`}
            />
        );
    };

    const label = (entry: SessionCompanionContentItem): string => (
        entry.kind === 'summary'
            ? t('sessionBoard.companion.summary.title')
            : entry.kind === 'plan'
            ? t('sessionCompanion.plan.title')
            : entry.kind === 'widget'
                ? resolveSessionBoardItemTitle(entry.item.state)
                : isSessionCompanionGlanceItem(entry)
                    ? sessionCompanionGlanceLabel(entry)
                    : t('sessionBoard.item.untitled')
    );

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID={testID}>
            {items.length === 0 ? (
                <SurfaceStateCard
                    testID={`${testID}-empty`}
                    kind="empty"
                    title={t('sessionBoard.companion.empty.title')}
                    reason={t('sessionBoard.companion.empty.reason')}
                    note={t('sessionBoard.companion.empty.note')}
                    accessibilitySemantics="status"
                    {...(!addBinding ? {} : {
                        secondaryAction: {
                            label: t('sessionCompanion.picker.chooseWidget'),
                            onPress: () => { setPickerRequest((request) => request + 1); },
                        },
                    })}
                    {...(props.measurementOnly ? {} : {
                        action: {
                            label: t('sessionBoard.companion.actions.addSummary'),
                            // One atomic local mutation seeds the summary and reveals
                            // the Companion together, never as two observable steps.
                            onPress: () => { mutateCompanion({
                                kind: 'companion.item.add',
                                message: t('sessionBoard.companion.notices.added'),
                                apply: (companion) => companion.show(SESSION_SUMMARY_COMPANION_ITEM),
                            }); },
                        },
                    })}
                />
            ) : items.map((entry, index) => {
                const key = companionItemMeasurementKey(entry);
                const frameStyle = frameStyleOf(entry);
                // Everything but the Summary hero draws itself in the widget frame.
                const framed = isCompanionFramedItem(entry);
                return (
                    <SessionCompanionItemFrame
                        key={key}
                        testID={`${testID}-item-${key}`}
                        label={label(entry)}
                        separated={index > 0}
                        {...(framed ? { flush: frameStyle } : {})}
                        onLayout={props.onMeasuredCardBounds || reorderable
                            ? (event) => reportCardLayout(key, event)
                            : undefined}
                        {...(reorderable ? {
                            move: {
                                itemKey: key,
                                orderedKeys: itemMeasurementKeys,
                                rects: cardRectsRef.current,
                                moveToIndex: (toIndex: number) => { moveCompanionItemTo(entry, toIndex); },
                            },
                        } : {})}
                        actions={props.measurementOnly ? [] : buildSessionCompanionItemActions({
                            index,
                            count: items.length,
                            moveTo: (toIndex) => { moveCompanionItemTo(entry, toIndex); },
                            remove: () => { removeFromCompanion(entry); },
                            ...(entry.ref.kind === 'widget' && boardReachable && props.onRevealBoardItem
                                ? { openOnBoard: () => props.onRevealBoardItem?.(entry.ref.kind === 'widget' ? entry.ref.widgetId : '') }
                                : {}),
                            ...(entry.kind === 'widget' && props.onManageBoardItemPlugin
                                && entry.item.state.kind === 'ready'
                                && entry.item.state.item.source.kind === 'installedSurface'
                                ? { managePlugin: () => props.onManageBoardItemPlugin?.(entry.ref.widgetId) }
                                : {}),
                            ...(framed ? {
                                frame: {
                                    surfaceDefault: frameSurfaceDefault,
                                    override: entry.ref.frameStyle ?? null,
                                    onSet: (style: WidgetFrameStyle | null) => setCompanionItemFrameStyle(entry, style),
                                },
                            } : {}),
                        })}
                    >
                        {(accessory) => renderBody(entry, accessory, frameStyle)}
                    </SessionCompanionItemFrame>
                );
            })}
            {!full && !props.measurementOnly ? (
                <SessionCompanionDropSlot sessionId={props.session.id} testID={`${testID}-drop`} />
            ) : null}
            {addBinding ? (
                // Rendered while empty too, so "Choose a widget…" has its anchor; the
                // phone seats the visible control in its navigation bar instead.
                <SessionCompanionAddControl
                    binding={addBinding}
                    variant={props.addPlacement === 'external' || items.length === 0 ? 'anchor' : 'row'}
                    openRequest={pickerRequest}
                    testID={`${testID}-add`}
                />
            ) : null}
        </ScrollView>
    );
});
