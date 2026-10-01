import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { scheduleOnRN } from 'react-native-worklets';

import {
    resolveSessionBoardAnchoredPointerDrop,
    resolveSessionBoardDragMove,
    resolveSessionBoardDragOffset,
    SessionBoardItemMoveHandle,
    type SessionBoardAnchoredMove,
    type SessionBoardItemRect,
} from '@/components/sessions/board/SessionBoardItemMoveHandle';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    // Flat sections separated by a hairline (lab CA): the column reads as one
    // live strip, not a stack of cards. Only the needs-you block is tinted.
    root: { paddingTop: 11, paddingBottom: 12 },
    separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.default },
    // Cards beside the chat keep the Board grid's gap between them.
    cardGap: { marginBottom: 10 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
}));

/**
 * Everything the frame needs to offer direct manipulation for one item.
 *
 * The Companion is one vertical column, so only that axis is resisted at the
 * ends. Ordering is semantic — the frame reports a target index and never a
 * pixel position — and both the pointer drop and the staged keyboard position
 * are resolved by the Board's existing pure owners.
 */
export type SessionCompanionItemMove = Readonly<{
    itemKey: string;
    orderedKeys: readonly string[];
    rects: ReadonlyMap<string, SessionBoardItemRect>;
    moveToIndex: (index: number) => void;
}>;

function resolveIndexForAnchor(
    move: SessionCompanionItemMove,
    anchor: SessionBoardAnchoredMove,
): number | null {
    const withoutDragged = move.orderedKeys.filter((key) => key !== move.itemKey);
    const anchorIndex = withoutDragged.indexOf(anchor.itemId);
    if (anchorIndex < 0) return null;
    return anchorIndex + (anchor.side === 'after' ? 1 : 0);
}

/**
 * The Companion's local frame around one item.
 *
 * It owns ONLY placement-local affordances — reorder, remove-from-Companion and
 * Open on Board. Title, provenance, typed states and renderer selection stay with
 * `SessionWidgetHost` (or, for the built-in card, with the summary itself), so
 * this frame never becomes a second item shell or a second copy of the shared
 * state table.
 *
 * Reorder is the pair the plan requires: this frame composes the Board's move
 * handle (pointer drag plus its keyboard staging and announcements) and the
 * overflow menu keeps the explicit Move Up/Down/First/Last entries beside it.
 */
export const SessionCompanionItemFrame = React.memo(function SessionCompanionItemFrame(props: Readonly<{
    /** The item's own accessible name, from its canonical presentation owner. */
    label: string;
    actions: readonly ItemAction[];
    /**
     * The item body. It receives this placement's controls (reorder handle and
     * item menu) and draws them at the end of its own header line, so the item
     * keeps one header and the frame adds no second title row.
     */
    children: (headerAccessory: React.ReactNode) => React.ReactNode;
    /** Every item after the first sits under a hairline. */
    separated?: boolean;
    /**
     * The item draws itself in the widget frame (Plan, Board widgets, glances), which owns its own
     * hairline (plain) or card and its insets; this frame then adds no padding or hairline of its own.
     */
    flush?: 'plain' | 'card';
    testID: string;
    onLayout?: (event: LayoutChangeEvent) => void;
    /** Absent while measuring, on a read-only Companion or for a single item. */
    move?: SessionCompanionItemMove;
}>) {
    const styles = stylesheet;
    const actions = React.useMemo(() => [...props.actions], [props.actions]);
    const move = props.move;
    const moveRef = React.useRef(move);
    moveRef.current = move;

    const reduceMotion = useReducedMotionPreference();
    const liftDurationMs = reduceMotion ? motionTokens.durationMs.instant : motionTokens.durationMs.fast;
    const dragY = useSharedValue(0);
    const dragging = useSharedValue(0);
    const dragCancelled = useSharedValue(0);
    const pointerDragActive = React.useRef(false);
    const pointerDragCancelled = React.useRef(false);

    const position = move ? move.orderedKeys.indexOf(move.itemKey) : -1;
    const canMoveBefore = position > 0;
    const canMoveAfter = position >= 0 && position < (move?.orderedKeys.length ?? 0) - 1;

    const applyIndex = React.useCallback((index: number | null) => {
        const current = moveRef.current;
        if (!current || index === null) return;
        const currentIndex = current.orderedKeys.indexOf(current.itemKey);
        if (currentIndex < 0 || index === currentIndex) return;
        current.moveToIndex(index);
    }, []);

    const moveAnchored = React.useCallback((anchor: SessionBoardAnchoredMove) => {
        const current = moveRef.current;
        if (!current) return;
        applyIndex(resolveIndexForAnchor(current, anchor));
    }, [applyIndex]);

    const moveByDirection = React.useCallback((direction: 'before' | 'after') => {
        const current = moveRef.current;
        if (!current) return;
        const currentIndex = current.orderedKeys.indexOf(current.itemKey);
        if (currentIndex < 0) return;
        applyIndex(currentIndex + (direction === 'before' ? -1 : 1));
    }, [applyIndex]);

    const beginPointerDrag = React.useCallback(() => {
        pointerDragActive.current = true;
        pointerDragCancelled.current = false;
        dragCancelled.value = 0;
    }, [dragCancelled]);

    const cancelPointerDrag = React.useCallback(() => {
        if (!pointerDragActive.current) return false;
        pointerDragActive.current = false;
        pointerDragCancelled.current = true;
        dragCancelled.value = 1;
        dragging.value = withTiming(0, { duration: liftDurationMs });
        dragY.value = withTiming(0, { duration: liftDurationMs });
        return true;
    }, [dragCancelled, dragY, dragging, liftDurationMs]);

    // `succeeded` separates "the person dropped it here" from "the system took
    // the pointer away"; gesture handler reports both through one callback.
    const commitDrag = React.useCallback((translationY: number, succeeded: boolean) => {
        const cancelled = pointerDragCancelled.current;
        pointerDragActive.current = false;
        pointerDragCancelled.current = false;
        const current = moveRef.current;
        if (!succeeded || cancelled || !current) return;
        const anchor = resolveSessionBoardAnchoredPointerDrop({
            draggedId: current.itemKey,
            orderedIds: current.orderedKeys,
            itemRects: current.rects,
            translationX: 0,
            translationY,
            droppedInside: true,
        });
        if (anchor) {
            moveAnchored(anchor);
            return;
        }
        // No card under the drop point (the gap between two cards, or past the
        // last one): fall back to the shared one-step threshold rather than
        // silently discarding a deliberate drag.
        const direction = resolveSessionBoardDragMove({
            translationX: 0,
            translationY,
            canMoveBefore,
            canMoveAfter,
            succeeded: true,
        });
        if (direction) moveByDirection(direction);
    }, [canMoveAfter, canMoveBefore, moveAnchored, moveByDirection]);

    const moveGesture = React.useMemo(() => Gesture.Pan()
        .minDistance(6)
        .onStart(() => {
            'worklet';
            dragging.value = withTiming(1, { duration: liftDurationMs });
            scheduleOnRN(beginPointerDrag);
        })
        .onUpdate((event) => {
            'worklet';
            if (dragCancelled.value > 0) return;
            dragY.value = resolveSessionBoardDragOffset({
                translation: event.translationY,
                canMoveBefore,
                canMoveAfter,
            });
        })
        .onEnd((event, success) => {
            'worklet';
            const shouldCommit = success && dragCancelled.value === 0;
            scheduleOnRN(commitDrag, event.translationY, shouldCommit);
        })
        .onFinalize(() => {
            'worklet';
            dragCancelled.value = 0;
            dragging.value = withTiming(0, { duration: liftDurationMs });
            if (liftDurationMs === 0) {
                dragY.value = 0;
                return;
            }
            dragY.value = withSpring(0);
        }), [
        beginPointerDrag,
        canMoveAfter,
        canMoveBefore,
        commitDrag,
        dragCancelled,
        dragY,
        dragging,
        liftDurationMs,
    ]);

    const dragStyle = useAnimatedStyle(() => ({
        position: 'relative',
        zIndex: dragging.value > 0 ? 20 : 0,
        opacity: 1 - (dragging.value * 0.14),
        transform: [
            { translateY: dragY.value },
            { scale: 1 + (dragging.value * 0.015) },
        ],
    }));

    const reorderable = move !== undefined && move.orderedKeys.length > 1 && position >= 0;

    const accessory = reorderable || actions.length > 0 ? (
        <View style={styles.controls}>
            {reorderable && move ? (
                <SessionBoardItemMoveHandle
                    testID={`${props.testID}-move-handle`}
                    gesture={moveGesture}
                    onMove={moveByDirection}
                    onMoveAnchored={moveAnchored}
                    itemId={move.itemKey}
                    orderedItemIds={move.orderedKeys}
                    canMoveBefore={canMoveBefore}
                    canMoveAfter={canMoveAfter}
                    accessibilityLabel={t('sessionBoard.item.reorderA11y', { title: props.label })}
                    itemTitle={props.label}
                    position={position + 1}
                    total={move.orderedKeys.length}
                    onCancelPointerDrag={cancelPointerDrag}
                />
            ) : null}
            {actions.length > 0 ? (
                <ItemRowActions
                    title={props.label}
                    actions={actions}
                    // One overflow control keeps the item quiet; hover is never
                    // the only way to reach these on touch or with a keyboard.
                    compactThreshold={Number.POSITIVE_INFINITY}
                    overflowTriggerTestID={`${props.testID}-actions`}
                    overflowTriggerAccessibilityLabel={t('sessionBoard.companion.actions.itemMenuA11y', {
                        title: props.label,
                    })}
                    iconSize={16}
                    gap={6}
                />
            ) : null}
        </View>
    ) : null;

    // One node carries the frame, its measured rect and the drag transform. A
    // separate animated wrapper would make `onLayout` report a position relative
    // to itself — always the origin — and the shared pointer-drop resolver
    // anchors against the item's place in the scrolled column.
    return (
        <Animated.View
            style={[props.flush ? (props.flush === 'card' ? styles.cardGap : null) : styles.root, !props.flush && props.separated ? styles.separated : null, dragStyle]}
            testID={props.testID}
            onLayout={props.onLayout}
        >
            {props.children(accessory)}
        </Animated.View>
    );
});
