import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createSessionSurfaceNoteDocumentV1,
    type SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import { SURFACE_CARD_PADDING_PX, SURFACE_CARD_RADIUS_PX } from '@/components/ui/cards/SurfaceCard';
import { findGestureByKind } from '@/dev/testkit/mocks/gestureHandler';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { SessionBoardItemProjection } from '@/sync/domains/session/board';

import {
    resolveSessionBoardDragVisualOffset,
    SessionWidgetHost,
    type SessionWidgetHostProps,
} from './SessionWidgetHost';

const workletsHarness = vi.hoisted(() => ({
    defer: false,
    pending: [] as Array<() => unknown>,
}));

// Escape cancelling an in-flight pointer drag is a keyboard affordance of the
// pointer platforms (web and desktop), so the handle only publishes `onKeyDown`
// there. Under the default node platform runtime that bridge is absent and the
// cancellation case below asserts nothing at all.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-gesture-handler', async () => {
    const { createGestureHandlerMock } = await import('@/dev/testkit/mocks/gestureHandler');
    return createGestureHandlerMock();
});
vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
        if (workletsHarness.defer) {
            workletsHarness.pending.push(() => callback(...args));
            return;
        }
        return callback(...args);
    },
}));

/**
 * The widget card's chrome, as a person actually meets it.
 *
 * These are reach and hierarchy failures rather than type errors: a reorder
 * handle that announces the name of an unrelated control, a rename that only a
 * mouse can start, and a destructive action drawn louder than every constructive
 * one because it is the only control that never went into the menu.
 */

function noteItem(overrides: Partial<SessionSurfaceItemV1> = {}): SessionBoardItemProjection {
    return {
        itemId: 'note-1',
        revision: 'rev-1',
        state: {
            kind: 'ready',
            item: {
                v: 1,
                title: 'Release plan',
                frame: 'card',
                height: { mode: 'auto', fallback: 'regular' },
                source: { kind: 'declarative', document: createSessionSurfaceNoteDocumentV1('Body') },
                ...overrides,
            } as SessionSurfaceItemV1,
        },
    };
}

function unavailableInstalledItem(): SessionBoardItemProjection {
    return {
        itemId: 'plugin-widget-1',
        revision: 'rev-plugin-1',
        state: {
            kind: 'ready',
            item: {
                v: 1,
                title: 'Review status',
                frame: 'card',
                height: { mode: 'auto', fallback: 'regular' },
                source: {
                    kind: 'installedSurface',
                    surface: { pluginId: 'acme.review', localId: 'review-status' },
                },
            } as SessionSurfaceItemV1,
        },
    };
}

async function renderCard(overrides: Partial<SessionWidgetHostProps> = {}) {
    const props: SessionWidgetHostProps = {
        sessionId: 'session-1',
        item: noteItem(),
        host: 'details',
        primaryHost: 'details',
        density: 'full',
        canEdit: true,
        executableCurrentness: 'not_executable',
        width: 'medium',
        heightBounds: { min: 96, max: 520 },
        testID: 'widget',
        ...overrides,
    } as SessionWidgetHostProps;
    return await renderScreen(<SessionWidgetHost {...props} />);
}

function actionsOf(screen: Awaited<ReturnType<typeof renderCard>>): ReadonlyArray<Record<string, unknown>> {
    // The overflow is the person's route to every card operation, so its
    // contents are the contract this card publishes — not an internal detail.
    const trigger = screen.findHostByTestId('widget-actions');
    if (!trigger) return [];
    const owner = screen.tree.root.findAll(
        (node) => Array.isArray((node.props as { actions?: unknown }).actions)
            && (node.props as { overflowTriggerTestID?: string }).overflowTriggerTestID === 'widget-actions',
        { deep: true },
    );
    return (owner.at(-1)?.props as { actions: Record<string, unknown>[] } | undefined)?.actions ?? [];
}

function elementHasTestId(
    element: unknown,
    testID: string,
): element is Readonly<{ props: Readonly<{ testID: string }> }> {
    if (typeof element !== 'object' || element === null || !('props' in element)) return false;
    const props = element.props;
    return typeof props === 'object'
        && props !== null
        && 'testID' in props
        && props.testID === testID;
}

describe('SessionWidgetHost chrome', () => {
    beforeEach(() => {
        standardCleanup();
        workletsHarness.defer = false;
        workletsHarness.pending = [];
    });

    it('names the reorder handle after the item it reorders', async () => {
        const screen = await renderCard({
            onMove: vi.fn(),
            canMoveBefore: true,
            canMoveAfter: true,
        });

        const handle = screen.findHostByTestId('widget-move-handle');
        expect(handle).not.toBeNull();
        const label = String((handle?.props as { accessibilityLabel?: string }).accessibilityLabel ?? '');
        // "Board views" is the tab strip beside this card. Borrowing its name
        // tells a screen-reader user they are on the wrong control entirely.
        expect(label).not.toBe('Board views');
        expect(label).toContain('Release plan');
    });

    it('keeps a single item attached to a valid cross-view target and commits only that move', async () => {
        const onMoveToView = vi.fn();
        const onMove = vi.fn();
        const onMoveAnchored = vi.fn();
        const screen = await renderCard({
            onMove,
            canMoveBefore: false,
            canMoveAfter: false,
            moveDestinations: [{ id: 'research', title: 'Research' }],
            onMoveToView,
            resolveMoveToView: (_translationX, translationY) => translationY <= -80 ? 'research' : null,
            onMoveAnchored,
            orderedMoveItemIds: ['note-1'],
            moveItemRects: new Map([['note-1', { x: 0, y: 160, width: 240, height: 120 }]]),
        });

        // Same-view edge resistance belongs only to the current ordering path.
        // Once the pointer is over a real view target, the card remains under it
        // even though this one-item view has no before/after neighbour.
        expect(resolveSessionBoardDragVisualOffset({
            translationX: 12,
            translationY: -120,
            canMoveBefore: false,
            canMoveAfter: false,
            crossViewTarget: true,
        })).toEqual({ x: 12, y: -120 });

        const detector = screen.tree.root.findAll(
            (node) => String(node.type) === 'GestureDetector',
            { deep: true },
        )[0];
        const pan = findGestureByKind(
            (detector?.props as { gesture?: Parameters<typeof findGestureByKind>[0] }).gesture,
            'pan',
        );
        expect(pan).not.toBeNull();

        vi.useFakeTimers();
        act(() => {
            pan?.__handlers.onStart?.();
            pan?.__handlers.onUpdate?.({ translationX: 12, translationY: -120 });
            vi.advanceTimersByTime(500);
            pan?.__handlers.onUpdate?.({ translationX: 12, translationY: -120 });
            pan?.__handlers.onEnd?.({ translationX: 12, translationY: -120 }, true);
            pan?.__handlers.onFinalize?.();
        });
        vi.useRealTimers();

        expect(onMoveToView).toHaveBeenCalledOnce();
        expect(onMoveToView).toHaveBeenCalledWith('research');
        expect(onMove).not.toHaveBeenCalled();
        expect(onMoveAnchored).not.toHaveBeenCalled();
    });

    it('restores an active pointer drag on Escape without allowing its later end event to write', async () => {
        const onMove = vi.fn();
        const onMoveAnchored = vi.fn();
        const screen = await renderCard({
            onMove,
            canMoveBefore: false,
            canMoveAfter: true,
            onMoveAnchored,
            orderedMoveItemIds: ['note-1', 'note-2'],
            moveItemRects: new Map([
                ['note-1', { x: 0, y: 0, width: 100, height: 80 }],
                ['note-2', { x: 116, y: 0, width: 100, height: 80 }],
            ]),
        });
        const detector = screen.tree.root.findAll(
            (node) => String(node.type) === 'GestureDetector',
            { deep: true },
        )[0];
        const pan = findGestureByKind(
            (detector?.props as { gesture?: Parameters<typeof findGestureByKind>[0] }).gesture,
            'pan',
        );
        const handle = screen.findHostByTestId('widget-move-handle');

        act(() => {
            pan?.__handlers.onStart?.();
            pan?.__handlers.onUpdate?.({ translationX: 140, translationY: 0 });
            handle?.props.onKeyDown?.({
                key: 'Escape',
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            });
            // Model the real UI-thread/RN boundary: the gesture end can be
            // accepted now and its RN callback can run only after finalize.
            workletsHarness.defer = true;
            pan?.__handlers.onEnd?.({ translationX: 140, translationY: 0 }, true);
            pan?.__handlers.onFinalize?.();
            workletsHarness.defer = false;
            for (const pending of workletsHarness.pending.splice(0)) pending();
        });

        expect(onMove).not.toHaveBeenCalled();
        expect(onMoveAnchored).not.toHaveBeenCalled();
    });

    it('offers rename to a keyboard and screen reader, not only to a pointer on the title', async () => {
        const screen = await renderCard({ onRename: vi.fn() });

        expect(actionsOf(screen).map((action) => action.id)).toContain('rename');
    });

    it('keeps removal in the menu as the one destructive entry rather than a button under every card', async () => {
        const screen = await renderCard({ onRemove: vi.fn(), onRename: vi.fn() });

        const actions = actionsOf(screen);
        const remove = actions.find((action) => action.id === 'remove');
        expect(remove).toBeDefined();
        expect(remove?.destructive).toBe(true);
        // Last, so the menu never puts a delete next to the pointer's resting place.
        expect(actions.at(-1)?.id).toBe('remove');
        expect(screen.findHostByTestId('widget-remove')).toBeNull();
    });

    it('keeps shared Board removal reachable from compact hosts without confusing it with local placement removal', async () => {
        const remove = vi.fn();
        const screen = await renderCard({ density: 'compact', onRemove: remove });

        const action = actionsOf(screen).find((candidate) => candidate.id === 'remove');
        expect(action?.destructive).toBe(true);
        (action?.onPress as (() => void) | undefined)?.();
        expect(remove).toHaveBeenCalledOnce();
    });

    it('still hides every editing entry from a viewer who cannot edit', async () => {
        const screen = await renderCard({ canEdit: false, onRemove: vi.fn(), onRename: vi.fn() });

        expect(actionsOf(screen).map((action) => action.id)).not.toContain('remove');
    });

    it('keeps plugin management and shared Board removal independently reachable when an installed widget is unavailable', async () => {
        const managePlugin = vi.fn();
        const removeFromBoard = vi.fn();
        const screen = await renderCard({
            item: unavailableInstalledItem(),
            onManagePlugin: managePlugin,
            onRemove: removeFromBoard,
            resolveSourceAvailability: () => ({ kind: 'unavailable', reason: 'plugin_unavailable' }),
        });

        await screen.pressByTestIdAsync('widget-state-action');
        await screen.pressByTestIdAsync('widget-state-secondary-action');

        expect(managePlugin).toHaveBeenCalledOnce();
        expect(removeFromBoard).toHaveBeenCalledOnce();
    });

    it('keeps plugin management available without exposing shared Board removal to a read-only viewer', async () => {
        const managePlugin = vi.fn();
        const removeFromBoard = vi.fn();
        const screen = await renderCard({
            item: unavailableInstalledItem(),
            canEdit: false,
            onManagePlugin: managePlugin,
            onRemove: removeFromBoard,
            resolveSourceAvailability: () => ({
                kind: 'unavailable',
                reason: 'session_widget_contribution_unavailable',
            }),
        });

        await screen.pressByTestIdAsync('widget-state-action');

        expect(managePlugin).toHaveBeenCalledOnce();
        expect(screen.findHostByTestId('widget-state-secondary-action')).toBeNull();
        expect(removeFromBoard).not.toHaveBeenCalled();
    });

    it('consumes one exact post-save focus request on the rendered item heading', async () => {
        const focus = vi.fn();
        const onHeadingFocusHandled = vi.fn();
        await renderScreen(
            <SessionWidgetHost
                sessionId="session-1"
                item={noteItem()}
                host="details"
                primaryHost="details"
                density="full"
                canEdit
                executableCurrentness="not_executable"
                width="medium"
                heightBounds={{ min: 96, max: 520 }}
                focusHeadingRequestId={1}
                onHeadingFocusHandled={onHeadingFocusHandled}
                testID="widget"
            />,
            {
                createNodeMock: (element) => elementHasTestId(element, 'widget-title')
                    ? { focus }
                    : {},
            },
        );

        expect(focus).toHaveBeenCalledOnce();
        expect(onHeadingFocusHandled).toHaveBeenCalledWith(1);
    });

    it('keeps viewer-local Companion placement reachable without requiring Board edit access', async () => {
        const add = vi.fn();
        const screen = await renderCard({
            canEdit: false,
            onAddToCompanion: add,
        });

        const action = actionsOf(screen).find((candidate) => candidate.id === 'add-to-companion');
        expect(action).toBeDefined();
        expect(action?.destructive).not.toBe(true);
        (action?.onPress as (() => void) | undefined)?.();
        expect(add).toHaveBeenCalledTimes(1);
    });

    it('offers the inverse local Companion action when the widget is already selected', async () => {
        const remove = vi.fn();
        const screen = await renderCard({
            canEdit: false,
            onRemoveFromCompanion: remove,
        });

        const action = actionsOf(screen).find((candidate) => candidate.id === 'remove-from-companion');
        expect(action).toBeDefined();
        expect(action?.destructive).not.toBe(true);
        (action?.onPress as (() => void) | undefined)?.();
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('bleeds content to the card edge the card actually draws, at every density', async () => {
        const observed: Record<string, Record<string, unknown>> = {};
        for (const density of ['full', 'compact'] as const) {
            const screen = await renderCard({
                density,
                item: noteItem({ frame: 'full_bleed' }),
            });
            const body = screen.findHostByTestId('widget-body');
            observed[density] = ([] as unknown[])
                .concat((body?.props as { style?: unknown }).style ?? [])
                .filter(Boolean)
                .reduce<Record<string, unknown>>(
                    (accumulator, entry) => ({ ...accumulator, ...(entry as Record<string, unknown>) }),
                    {},
                );
        }

        // A spacious card and a compact one do not have the same inset, so one
        // hardcoded offset must overhang on one of them.
        expect(observed.full!.marginHorizontal).toBe(-SURFACE_CARD_PADDING_PX.md.horizontal);
        expect(observed.full!.marginBottom).toBe(-SURFACE_CARD_PADDING_PX.md.vertical);
        expect(observed.compact!.marginHorizontal).toBe(-SURFACE_CARD_PADDING_PX.sm.horizontal);
        expect(observed.compact!.marginBottom).toBe(-SURFACE_CARD_PADDING_PX.sm.vertical);
        // …and reaching the edge means clipping to the card's real corner.
        expect(observed.full!.borderBottomLeftRadius).toBe(SURFACE_CARD_RADIUS_PX);
        expect(observed.full!.overflow).toBe('hidden');
    });
});
