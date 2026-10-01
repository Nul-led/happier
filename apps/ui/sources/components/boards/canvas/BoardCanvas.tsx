import * as React from 'react';
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { BoardCardView } from '../cards/BoardCardView';
import type { BoardCard } from '../model/boardCards';
import {
    BOARD_CANVAS_METRICS,
    moveBoardCardByKeyboard,
    resolveBoardCanvasColumnCount,
    resolveBoardCardDrop,
    type BoardCanvasDirection,
    type BoardCanvasPoint,
} from '../model/boardCanvasGeometry';

/**
 * Canvas (lab `boards-B1`, `B1s`, `B1b`): the user's arrangement. Placed cards stand at their saved
 * positions; cards that were never placed flow into columns. The first move of any card saves where
 * every card on screen is, so nothing else shifts when one leaves the flow. A card is dragged (touch:
 * after a short press) or, focused, moved one grid step per arrow key or screen-reader move action;
 * snapping is a board setting.
 */

const { cardWidthPx, gapPx, paddingPx, gridStepPx } = BOARD_CANVAS_METRICS;
const KEYBOARD_COMMIT_IDLE_MS = 600;
/** Touch drags start after a short press, so a swipe still scrolls the canvas. */
const TOUCH_DRAG_DELAY_MS = 250;
const ARROWS: Readonly<Record<string, BoardCanvasDirection>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

/** The screen-reader actions that move a card, one grid step each (touch has no arrow keys). */
const MOVE_ACTIONS: readonly Readonly<{ name: string; direction: BoardCanvasDirection }>[] = [
    { name: 'moveUp', direction: 'up' },
    { name: 'moveDown', direction: 'down' },
    { name: 'moveLeft', direction: 'left' },
    { name: 'moveRight', direction: 'right' },
];

type Rect = Readonly<{ x: number; y: number; height: number }>;

export type BoardCanvasProps = Readonly<{
    cards: readonly BoardCard[];
    positionsByItemRef: Readonly<Record<string, BoardCanvasPoint>>;
    snap: boolean;
    /** A card just added with ⌘↵ "Add and place": focused so arrow keys or a drag place it. */
    placingKey?: string | null;
    onPlaced?: () => void;
    onOpen: (card: BoardCard) => void;
    /** Saves positions (canvas coordinates) for the moved card and every card measured so far. */
    onCommitPositions: (positions: Readonly<Record<string, BoardCanvasPoint>>) => void;
}>;

export const BoardCanvas = React.memo(function BoardCanvas(props: BoardCanvasProps) {
    const [width, setWidth] = React.useState(0);
    const rectsRef = React.useRef(new Map<string, Rect>());
    const [contentHeight, setContentHeight] = React.useState(0);
    const columnCount = resolveBoardCanvasColumnCount(Math.max(0, width - paddingPx * 2));
    const { positionsByItemRef, onCommitPositions } = props;

    const placed = props.cards.filter((card) => positionsByItemRef[card.key] !== undefined);
    const flowColumns = React.useMemo(() => {
        const columns: BoardCard[][] = Array.from({ length: columnCount }, () => []);
        props.cards
            .filter((card) => positionsByItemRef[card.key] === undefined)
            .forEach((card, index) => columns[index % columnCount]!.push(card));
        return columns;
    }, [columnCount, positionsByItemRef, props.cards]);

    const recomputeHeight = React.useCallback(() => {
        let bottom = 0;
        for (const rect of rectsRef.current.values()) bottom = Math.max(bottom, rect.y + rect.height);
        setContentHeight((previous) => (previous === bottom ? previous : bottom));
    }, []);
    const reportRect = React.useCallback((key: string, rect: Rect) => {
        rectsRef.current.set(key, rect);
        recomputeHeight();
    }, [recomputeHeight]);

    // Read at commit time, so the callback (and every card's props) stays stable across live updates.
    const latestRef = React.useRef({ cards: props.cards, positionsByItemRef, onCommitPositions });
    latestRef.current = { cards: props.cards, positionsByItemRef, onCommitPositions };
    const placingKey = props.placingKey ?? null;
    const onPlacedRef = React.useRef(props.onPlaced);
    onPlacedRef.current = props.onPlaced;
    const commitMove = React.useCallback((key: string, point: BoardCanvasPoint) => {
        onPlacedRef.current?.();
        const latest = latestRef.current;
        // Freeze the flow: every measured card keeps the place it has on screen now.
        const positions: Record<string, BoardCanvasPoint> = {};
        for (const card of latest.cards) {
            if (latest.positionsByItemRef[card.key]) continue;
            const rect = rectsRef.current.get(card.key);
            if (rect) positions[card.key] = { x: rect.x, y: rect.y };
        }
        positions[key] = point;
        latest.onCommitPositions(positions);
    }, []);

    const placedWidth = placed.reduce((max, card) => Math.max(max, positionsByItemRef[card.key]!.x + cardWidthPx), 0);
    const contentWidth = Math.max(width, placedWidth + paddingPx * 2, columnCount * (cardWidthPx + gapPx) - gapPx + paddingPx * 2);

    return (
        <ScrollView testID="board-canvas" style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <ScrollView horizontal contentContainerStyle={{ width: contentWidth }}>
                <View
                    onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
                    style={[styles.content, { width: contentWidth, minHeight: contentHeight + paddingPx * 2 }]}
                >
                    <View style={styles.flow}>
                        {flowColumns.map((column, columnIndex) => (
                            <View key={columnIndex} style={styles.flowColumn}>
                                {column.map((card) => (
                                    <CanvasCard
                                        key={card.key}
                                        card={card}
                                        position={null}
                                        flowX={columnIndex * (cardWidthPx + gapPx)}
                                        snap={props.snap}
                                        placing={placingKey === card.key}
                                        onOpen={props.onOpen}
                                        onReportRect={reportRect}
                                        onCommitMove={commitMove}
                                    />
                                ))}
                            </View>
                        ))}
                    </View>
                    {placed.map((card) => (
                        <CanvasCard
                            key={card.key}
                            card={card}
                            position={positionsByItemRef[card.key]!}
                            flowX={0}
                            snap={props.snap}
                            placing={placingKey === card.key}
                            onOpen={props.onOpen}
                            onReportRect={reportRect}
                            onCommitMove={commitMove}
                        />
                    ))}
                </View>
            </ScrollView>
        </ScrollView>
    );
});

const CanvasCard = React.memo(function CanvasCard(props: Readonly<{
    card: BoardCard;
    /** Saved canvas position, or null while the card flows in its column. */
    position: BoardCanvasPoint | null;
    flowX: number;
    snap: boolean;
    placing: boolean;
    onOpen: (card: BoardCard) => void;
    onReportRect: (key: string, rect: Rect) => void;
    onCommitMove: (key: string, point: BoardCanvasPoint) => void;
}>) {
    const { card, position, flowX, snap, placing, onCommitMove, onReportRect, onOpen } = props;
    const pressableRef = React.useRef<View>(null);
    // ⇧ held while dragging snaps this one drop (lab B1b). Web reports it through the keyboard.
    const shiftRef = React.useRef(false);
    const [shiftDown, setShiftDown] = React.useState(false);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const originX = useSharedValue(position?.x ?? flowX);
    const originY = useSharedValue(position?.y ?? 0);
    const originRef = React.useRef<BoardCanvasPoint>(position ?? { x: flowX, y: 0 });
    const [dragging, setDragging] = React.useState(false);
    const [keyboardPosition, setKeyboardPosition] = React.useState<BoardCanvasPoint | null>(null);
    const commitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // A saved position arrived (or changed): the card now stands there, untranslated.
    React.useLayoutEffect(() => {
        if (position) {
            originRef.current = position;
            originX.value = position.x;
            originY.value = position.y;
        }
        translateX.value = 0;
        translateY.value = 0;
        setKeyboardPosition(null);
    }, [originX, originY, position, translateX, translateY]);
    React.useEffect(() => () => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    }, []);
    React.useEffect(() => {
        if (placing) pressableRef.current?.focus?.();
    }, [placing]);
    React.useEffect(() => {
        if (!dragging || Platform.OS !== 'web' || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Shift') return;
            shiftRef.current = event.type === 'keydown';
            setShiftDown(shiftRef.current);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('keyup', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('keyup', onKey);
            shiftRef.current = false;
            setShiftDown(false);
        };
    }, [dragging]);

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        const origin = position ?? { x: flowX, y };
        originRef.current = origin;
        originX.value = origin.x;
        originY.value = origin.y;
        onReportRect(card.key, { x: origin.x, y: origin.y, height });
    }, [card.key, flowX, onReportRect, originX, originY, position]);

    const pan = React.useMemo(() => {
        const gesture = Gesture.Pan().runOnJS(true).minDistance(4);
        return (Platform.OS === 'web' ? gesture : gesture.activateAfterLongPress(TOUCH_DRAG_DELAY_MS))
        .onStart(() => setDragging(true))
        .onUpdate((event) => {
            translateX.value = event.translationX;
            translateY.value = event.translationY;
        })
        .onEnd((event) => {
            setDragging(false);
            onCommitMove(card.key, resolveBoardCardDrop({
                origin: originRef.current,
                translation: { x: event.translationX, y: event.translationY },
                snap,
                snapOnce: shiftRef.current,
            }));
        })
        .onFinalize(() => setDragging(false));
    }, [card.key, onCommitMove, snap, translateX, translateY]);

    const dragStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    }));
    const snapTargetStyle = useAnimatedStyle(() => {
        const x = Math.max(0, Math.round((originX.value + translateX.value) / gridStepPx) * gridStepPx);
        const y = Math.max(0, Math.round((originY.value + translateY.value) / gridStepPx) * gridStepPx);
        return { transform: [{ translateX: x - originX.value }, { translateY: y - originY.value }] };
    });

    // One move per grid step, from an arrow key (web) or a screen reader's named action (touch).
    const moveBy = React.useCallback((direction: BoardCanvasDirection) => {
        const from = keyboardPosition ?? originRef.current;
        const next = moveBoardCardByKeyboard(from, direction);
        setKeyboardPosition(next);
        announceAccessibilityMessage(t('boards.card.moved', { x: Math.round(next.x / gridStepPx), y: Math.round(next.y / gridStepPx) }));
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        // Arrow presses settle into one save once the card rests.
        commitTimerRef.current = setTimeout(() => {
            commitTimerRef.current = null;
            onCommitMove(card.key, next);
        }, KEYBOARD_COMMIT_IDLE_MS);
    }, [card.key, keyboardPosition, onCommitMove]);
    const onKeyDown = React.useCallback((event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
        const direction = ARROWS[event.key ?? event.nativeEvent?.key ?? ''];
        if (!direction) return;
        event.preventDefault?.();
        moveBy(direction);
    }, [moveBy]);
    const accessibilityActions = React.useMemo(() => MOVE_ACTIONS.map((action) => ({
        name: action.name,
        label: t(`boards.card.moveActions.${action.direction}`),
    })), []);
    const onAccessibilityAction = React.useCallback((event: { nativeEvent: { actionName: string } }) => {
        const action = MOVE_ACTIONS.find((candidate) => candidate.name === event.nativeEvent.actionName);
        if (action) moveBy(action.direction);
    }, [moveBy]);

    const shown = keyboardPosition ?? position;
    const frameStyle = shown
        ? [styles.placed, { left: paddingPx + shown.x, top: paddingPx + shown.y }]
        : styles.flowCard;

    return (
        <View style={frameStyle} onLayout={onLayout}>
            {dragging && (snap || shiftDown) ? (
                <Animated.View pointerEvents="none" style={[styles.snapTarget, snapTargetStyle]}>
                    <Text style={styles.snapLabel}>{t('boards.canvas.snapsHere')}</Text>
                </Animated.View>
            ) : null}
            {dragging && !snap && !shiftDown && Platform.OS === 'web' ? (
                <Text pointerEvents="none" style={styles.snapHint}>{t('boards.canvas.snapOnceHint')}</Text>
            ) : null}
            <GestureDetector gesture={pan}>
                <Animated.View style={[dragStyle, dragging ? styles.dragging : null]}>
                    <Pressable
                        ref={pressableRef}
                        testID={`board-canvas-card:${card.key}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${card.title}, ${card.status.word}`}
                        accessibilityHint={t('boards.card.moveHint')}
                        accessibilityActions={accessibilityActions}
                        onAccessibilityAction={onAccessibilityAction}
                        onPress={() => onOpen(card)}
                        // Web: arrow keys move the focused card (RN Web forwards key events to the focused element).
                        {...({ onKeyDown } as object)}
                    >
                        <BoardCardView card={card} lifted={dragging || placing} />
                    </Pressable>
                </Animated.View>
            </GestureDetector>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    content: {
        position: 'relative',
    },
    flow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: gapPx,
        padding: paddingPx,
    },
    flowColumn: {
        width: cardWidthPx,
        gap: gapPx,
    },
    flowCard: {
        width: cardWidthPx,
    },
    placed: {
        position: 'absolute',
        width: cardWidthPx,
    },
    dragging: {
        zIndex: 10,
    },
    snapTarget: {
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.border.default,
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: 8,
    },
    snapLabel: {
        ...Typography.rowMeta(),
        color: theme.colors.text.tertiary,
    },
    snapHint: {
        ...Typography.rowMeta(),
        position: 'absolute',
        top: -20,
        right: 0,
        color: theme.colors.text.tertiary,
    },
}));
