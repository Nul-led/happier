import * as React from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { PoliteAccessibilityStatus } from '@/components/ui/accessibility/PoliteAccessibilityStatus';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { t } from '@/text';

const MOVE_HANDLE_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

const stylesheet = StyleSheet.create(() => ({
    handle: {
        width: MOVE_HANDLE_TARGET_SIZE,
        height: MOVE_HANDLE_TARGET_SIZE,
        minWidth: MOVE_HANDLE_TARGET_SIZE,
        minHeight: MOVE_HANDLE_TARGET_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

const MOVE_COMMIT_DISTANCE = 24;

/**
 * How far past an end of the view the card may still travel.
 *
 * A view's first item has nothing above it. Letting the card follow the finger
 * anyway and then quietly refusing reads as a dropped input; stopping it dead
 * reads as a broken gesture. It resists instead, so the edge is felt.
 */
export const SESSION_BOARD_DRAG_EDGE_RESISTANCE_PX = 16;

export type SessionBoardItemRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type SessionBoardAnchoredMove = Readonly<{
    side: 'before' | 'after';
    itemId: string;
}>;

/** Resolve a one-based staged keyboard position to the existing semantic anchor. */
export function resolveSessionBoardKeyboardAnchor(input: Readonly<{
    draggedId: string;
    orderedIds: readonly string[];
    targetPosition: number;
}>): SessionBoardAnchoredMove | null {
    const currentIndex = input.orderedIds.indexOf(input.draggedId);
    if (currentIndex < 0 || !Number.isInteger(input.targetPosition)) return null;
    const desiredIndex = input.targetPosition - 1;
    if (desiredIndex < 0 || desiredIndex >= input.orderedIds.length || desiredIndex === currentIndex) return null;
    const withoutDragged = input.orderedIds.filter((itemId) => itemId !== input.draggedId);
    if (desiredIndex >= withoutDragged.length) {
        const last = withoutDragged.at(-1);
        return last ? { side: 'after', itemId: last } : null;
    }
    const anchor = withoutDragged[desiredIndex];
    return anchor ? { side: 'before', itemId: anchor } : null;
}

/**
 * Resolve the card beneath a completed pointer drop into the same semantic
 * anchor used by menus and assistive actions. Geometry stays viewer-local and
 * no pixel position reaches persistence.
 */
export function resolveSessionBoardAnchoredPointerDrop(input: Readonly<{
    draggedId: string;
    orderedIds: readonly string[];
    itemRects: ReadonlyMap<string, SessionBoardItemRect>;
    translationX: number;
    translationY: number;
    droppedInside: boolean;
}>): SessionBoardAnchoredMove | null {
    if (!input.droppedInside || !Number.isFinite(input.translationX) || !Number.isFinite(input.translationY)) return null;
    const draggedRect = input.itemRects.get(input.draggedId);
    if (!draggedRect || !input.orderedIds.includes(input.draggedId)) return null;

    const dropX = draggedRect.x + (draggedRect.width / 2) + input.translationX;
    const dropY = draggedRect.y + (draggedRect.height / 2) + input.translationY;
    const targetId = input.orderedIds.find((itemId) => {
        if (itemId === input.draggedId) return false;
        const rect = input.itemRects.get(itemId);
        return rect !== undefined
            && dropX >= rect.x && dropX <= rect.x + rect.width
            && dropY >= rect.y && dropY <= rect.y + rect.height;
    });
    if (!targetId) return null;
    const target = input.itemRects.get(targetId);
    if (!target) return null;
    const horizontal = Math.abs(input.translationX) >= Math.abs(input.translationY);
    const side = horizontal
        ? (dropX < target.x + (target.width / 2) ? 'before' : 'after')
        : (dropY < target.y + (target.height / 2) ? 'before' : 'after');

    const current = input.orderedIds;
    const withoutDragged = current.filter((itemId) => itemId !== input.draggedId);
    const anchorIndex = withoutDragged.indexOf(targetId);
    if (anchorIndex < 0) return null;
    const insertionIndex = anchorIndex + (side === 'after' ? 1 : 0);
    const next = [
        ...withoutDragged.slice(0, insertionIndex),
        input.draggedId,
        ...withoutDragged.slice(insertionIndex),
    ];
    return next.every((itemId, index) => itemId === current[index]) ? null : { side, itemId: targetId };
}

export const SESSION_BOARD_VIEW_DROP_DWELL_MS = 500;

export type SessionBoardViewDropDwell = Readonly<{
    viewId: string;
    enteredAt: number;
    armed: boolean;
}>;

/** Pure cross-view dwell state: leaving or crossing targets resets immediately. */
export function advanceSessionBoardViewDropDwell(
    current: SessionBoardViewDropDwell | null,
    viewId: string | null,
    nowMs: number,
): SessionBoardViewDropDwell | null {
    if (viewId === null || !Number.isFinite(nowMs)) return null;
    if (!current || current.viewId !== viewId) return { viewId, enteredAt: nowMs, armed: false };
    if (current.armed || nowMs - current.enteredAt >= SESSION_BOARD_VIEW_DROP_DWELL_MS) {
        return current.armed ? current : { ...current, armed: true };
    }
    return current;
}

/**
 * Convert one completed handle drag into at most one semantic Board move.
 *
 * The dominant axis matters because the same semantic ordering renders as rows in
 * a narrow host and as a wrapping grid in Details. Cancellation and short
 * movements return `null`, so the gesture finalizer has no write path of its own.
 *
 * `succeeded` is load-bearing, not defensive: gesture handler reports "the person
 * dropped it here" and "the system took the pointer away" through the SAME
 * callback and separates them only by that flag. Without it a backgrounded app,
 * a lost pointer or a parent scroll claiming the gesture rewrites a layout every
 * Session reader sees.
 */
export function resolveSessionBoardDragMove(input: Readonly<{
    translationX: number;
    translationY: number;
    canMoveBefore: boolean;
    canMoveAfter: boolean;
    /** Defaults to a completed drop for the existing menu/keyboard callers. */
    succeeded?: boolean;
}>): 'before' | 'after' | null {
    if (input.succeeded === false) return null;
    const displacement = Math.abs(input.translationX) >= Math.abs(input.translationY)
        ? input.translationX
        : input.translationY;
    if (!Number.isFinite(displacement)) return null;
    if (Math.abs(displacement) < MOVE_COMMIT_DISTANCE) return null;
    if (displacement < 0) return input.canMoveBefore ? 'before' : null;
    return input.canMoveAfter ? 'after' : null;
}

/**
 * The card's on-screen offset for one axis of finger travel.
 *
 * Inside the movable range the card stays attached 1:1 to the pointer. Past an
 * end of the view it decays asymptotically toward
 * {@link SESSION_BOARD_DRAG_EDGE_RESISTANCE_PX}: progressive resistance rather
 * than an abrupt dead stop.
 */
export function resolveSessionBoardDragOffset(input: Readonly<{
    translation: number;
    canMoveBefore: boolean;
    canMoveAfter: boolean;
}>): number {
    'worklet';

    const translation = input.translation;
    if (!Number.isFinite(translation)) return 0;
    if (translation === 0) return 0;
    const blocked = translation < 0 ? !input.canMoveBefore : !input.canMoveAfter;
    if (!blocked) return translation;

    const limit = SESSION_BOARD_DRAG_EDGE_RESISTANCE_PX;
    const resisted = limit * (1 - (limit / (limit + Math.abs(translation))));
    return translation < 0 ? -resisted : resisted;
}

/**
 * The Board's only direct-manipulation source.
 *
 * The gesture is deliberately attached to this visible handle, never the card:
 * selecting text and operating embedded controls therefore cannot start a move.
 * Cancellation/finalization performs no write; one completed threshold crossing
 * emits one semantic move through the controller's existing layout Action.
 */
export function SessionBoardItemMoveHandle(props: Readonly<{
    gesture: GestureType;
    onMove: (direction: 'before' | 'after') => void;
    onMoveAnchored?: (anchor: SessionBoardAnchoredMove) => void;
    itemId?: string;
    orderedItemIds?: readonly string[];
    canMoveBefore: boolean;
    canMoveAfter: boolean;
    accessibilityLabel: string;
    itemTitle: string;
    position?: number;
    total?: number;
    moveDestinations?: readonly Readonly<{ id: string; title: string }>[];
    onMoveToView?: (viewId: string) => void;
    /** Web/desktop Escape bridge for a pointer drag owned by the host gesture. */
    onCancelPointerDrag?: () => boolean;
    testID: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const [grabbed, setGrabbed] = React.useState(false);
    const [target, setTarget] = React.useState<
        | Readonly<{ kind: 'current' }>
        | Readonly<{ kind: 'position'; direction: 'before' | 'after'; position: number }>
        | Readonly<{ kind: 'view'; id: string; title: string }>
    >({ kind: 'current' });
    const grabbedRef = React.useRef(false);
    const targetRef = React.useRef<typeof target>({ kind: 'current' });
    /** Counter-keyed so repeating the same phrase (cancel twice) still speaks. */
    const [announcement, setAnnouncement] = React.useState<Readonly<{ counter: number; text: string }>>({ counter: 0, text: '' });

    const updateGrabbed = React.useCallback((next: boolean) => {
        grabbedRef.current = next;
        setGrabbed(next);
    }, []);
    const updateTarget = React.useCallback((next: typeof target) => {
        targetRef.current = next;
        setTarget(next);
    }, []);

    const announce = React.useCallback((text: string) => {
        setAnnouncement((previous) => ({ counter: previous.counter + 1, text }));
    }, []);

    /**
     * The handle's accessible VALUE, which is the staged position and nothing
     * else. Repeating the control's own name inside its value made every arrow
     * press announce the label twice, and "2 / 4" is a shape a screen reader
     * reads as "two slash four" in every locale.
     */
    const positionLabel = React.useCallback((position: number) => {
        if (props.total === undefined) return props.accessibilityLabel;
        return t('sessionBoard.item.movePosition', { position, total: props.total });
    }, [props.accessibilityLabel, props.total]);

    const cancel = React.useCallback(() => {
        updateGrabbed(false);
        updateTarget({ kind: 'current' });
        announce(t('sessionsList.dragA11yCancelled', { item: props.itemTitle }));
    }, [announce, props.itemTitle, updateGrabbed, updateTarget]);

    const drop = React.useCallback(() => {
        const finalTarget = targetRef.current;
        updateGrabbed(false);
        updateTarget({ kind: 'current' });
        if (finalTarget.kind === 'position') {
            const anchor = props.onMoveAnchored && props.itemId && props.orderedItemIds
                ? resolveSessionBoardKeyboardAnchor({
                    draggedId: props.itemId,
                    orderedIds: props.orderedItemIds,
                    targetPosition: finalTarget.position,
                })
                : null;
            // The Board controller announces the committed move once the layout write lands.
            if (anchor) props.onMoveAnchored?.(anchor);
            else props.onMove(finalTarget.direction);
        } else if (finalTarget.kind === 'view') {
            props.onMoveToView?.(finalTarget.id);
        } else {
            announce(t('sessionsList.dragA11yCancelled', { item: props.itemTitle }));
        }
    }, [announce, props, updateGrabbed, updateTarget]);

    const stageView = React.useCallback((delta: -1 | 1) => {
        const destinations = props.moveDestinations ?? [];
        if (destinations.length === 0) return;
        const currentTarget = targetRef.current;
        const currentIndex = currentTarget.kind === 'view'
            ? destinations.findIndex((destination) => destination.id === currentTarget.id)
            : delta > 0 ? -1 : 0;
        const nextIndex = (currentIndex + delta + destinations.length) % destinations.length;
        const destination = destinations[nextIndex];
        if (!destination) return;
        updateTarget({ kind: 'view', ...destination });
        announce(t('sessionBoard.item.moveTargetView', { title: destination.title }));
    }, [announce, props.moveDestinations, updateTarget]);

    const handleKeyDown = React.useCallback((event: unknown) => {
        const keyboardEvent = event as Readonly<{
            key?: string;
            nativeEvent?: Readonly<{ key?: string }>;
            repeat?: boolean;
            preventDefault?: () => void;
            stopPropagation?: () => void;
        }>;
        const key = keyboardEvent.key ?? keyboardEvent.nativeEvent?.key;
        if (!key) return;
        if ((key === ' ' || key === 'Enter') && keyboardEvent.repeat === true) return;
        if (!grabbedRef.current) {
            if (key === 'Escape' && props.onCancelPointerDrag?.()) {
                keyboardEvent.preventDefault?.();
                keyboardEvent.stopPropagation?.();
                announce(t('sessionsList.dragA11yCancelled', { item: props.itemTitle }));
                return;
            }
            if (key !== ' ' && key !== 'Enter') return;
            keyboardEvent.preventDefault?.();
            keyboardEvent.stopPropagation?.();
            updateGrabbed(true);
            updateTarget({ kind: 'current' });
            announce(t('sessionsList.dragA11yPickedUp', { item: props.itemTitle }));
            return;
        }
        if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
        keyboardEvent.preventDefault?.();
        keyboardEvent.stopPropagation?.();
        if (key === ' ' || key === 'Enter') drop();
        else if (key === 'Escape') cancel();
        else if ((key === 'ArrowUp' || key === 'ArrowDown') && props.position !== undefined && props.total !== undefined) {
            const origin = props.position;
            const current = targetRef.current.kind === 'position' ? targetRef.current.position : origin;
            const next = Math.max(1, Math.min(props.total, current + (key === 'ArrowUp' ? -1 : 1)));
            if (next === current) return;
            if (next === origin) updateTarget({ kind: 'current' });
            else updateTarget({ kind: 'position', direction: next < origin ? 'before' : 'after', position: next });
            announce(positionLabel(next));
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
            const visualDelta = key === 'ArrowRight' ? 1 : -1;
            stageView((I18nManager.isRTL ? -visualDelta : visualDelta) as -1 | 1);
        }
    }, [announce, cancel, drop, positionLabel, props.itemTitle, props.onCancelPointerDrag, props.position, props.total, stageView, updateGrabbed, updateTarget]);

    const targetValue = target.kind === 'position'
        ? positionLabel(target.position)
        : target.kind === 'view'
            ? t('sessionBoard.item.moveTargetView', { title: target.title })
            : props.position !== undefined && props.total !== undefined
                ? t('sessionBoard.item.movePosition', { position: props.position, total: props.total })
                : undefined;

    return (
        <GestureDetector gesture={props.gesture}>
            <View
                style={stylesheet.handle}
                testID={props.testID}
                accessibilityRole="adjustable"
                accessibilityLabel={props.accessibilityLabel}
                {...(targetValue !== undefined
                    ? { accessibilityValue: { text: targetValue } }
                    : {})}
                {...(Platform.OS === 'web'
                    ? ({ 'aria-grabbed': grabbed, onKeyDown: handleKeyDown, tabIndex: 0 } as Record<string, unknown>)
                    : {})}
                accessibilityActions={[
                    ...(props.canMoveBefore ? [{ name: 'decrement' as const, label: t('common.moveUp') }] : []),
                    ...(props.canMoveAfter ? [{ name: 'increment' as const, label: t('common.moveDown') }] : []),
                ]}
                onAccessibilityAction={(event) => {
                    // The Board controller announces the committed move.
                    if (event.nativeEvent.actionName === 'decrement' && props.canMoveBefore) props.onMove('before');
                    if (event.nativeEvent.actionName === 'increment' && props.canMoveAfter) props.onMove('after');
                }}
            >
                <Icon name="dots-six-vertical" size={20} color={theme.colors.text.secondary} />
                <PoliteAccessibilityStatus
                    announcement={announcement.text}
                    transitionKey={String(announcement.counter)}
                    statusTestID={`${props.testID}-live-region`}
                />
            </View>
        </GestureDetector>
    );
}
