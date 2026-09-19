import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { findGestureByKind } from '@/dev/testkit/mocks/gestureHandler';
import { renderScreen } from '@/dev/testkit';

import { SessionCompanionItemFrame, type SessionCompanionItemMove } from './SessionCompanionItemFrame';

vi.mock('react-native', async () => (
    await import('@/dev/testkit/mocks/reactNative')
).createReactNativeWebMock());

vi.mock('react-native-gesture-handler', async () => {
    const { createGestureHandlerMock } = await import('@/dev/testkit/mocks/gestureHandler');
    return createGestureHandlerMock();
});

vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args),
}));

const ORDERED_KEYS = ['summary', 'widget:a', 'widget:b'] as const;

const RECTS = new Map([
    ['summary', { x: 0, y: 0, width: 300, height: 100 }],
    ['widget:a', { x: 0, y: 110, width: 300, height: 100 }],
    ['widget:b', { x: 0, y: 220, width: 300, height: 100 }],
]);

/**
 * `findGestureByKind` walks a gesture chain, not a render tree: the pointer drag
 * is reached the same way every other reorder suite reaches it — through the
 * `GestureDetector` the handle mounts. Passing the tree root instead silently
 * returns `null`, which the optional-chained handler calls below would then make
 * unobservable.
 */
function findPanGesture(screen: Awaited<ReturnType<typeof renderScreen>>) {
    const detector = screen.tree.root.findAll(
        (node) => String(node.type) === 'GestureDetector',
        { deep: true },
    )[0];
    return findGestureByKind(
        (detector?.props as { gesture?: Parameters<typeof findGestureByKind>[0] } | undefined)?.gesture,
        'pan',
    );
}

function keyEvent(key: string) {
    return { key, nativeEvent: { key }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

async function renderFrame(overrides: Partial<SessionCompanionItemMove> = {}, itemKey = 'summary') {
    const moveToIndex = vi.fn();
    const screen = await renderScreen(
        <SessionCompanionItemFrame
            testID="companion-item"
            label="Session summary"
            actions={[]}
            move={{
                itemKey,
                orderedKeys: [...ORDERED_KEYS],
                rects: RECTS,
                moveToIndex,
                ...overrides,
            }}
        >
            {null}
        </SessionCompanionItemFrame>,
    );
    return { screen, moveToIndex };
}

describe('SessionCompanionItemFrame reorder', () => {
    it('commits one semantic index from a completed pointer drag over another card', async () => {
        const { screen, moveToIndex } = await renderFrame();
        const gesture = findPanGesture(screen);
        expect(gesture).toBeTruthy();

        await act(async () => {
            gesture?.__handlers.onStart?.({});
            gesture?.__handlers.onUpdate?.({ translationX: 0, translationY: 240 });
            // Dropped past the middle of the third card: after `widget:b`, which
            // with the dragged item removed is target index 2.
            gesture?.__handlers.onEnd?.({ translationX: 0, translationY: 240 }, true);
        });

        expect(moveToIndex).toHaveBeenCalledOnce();
        expect(moveToIndex).toHaveBeenLastCalledWith(2);
    });

    it('writes nothing when the system takes the pointer away instead of a drop', async () => {
        const { screen, moveToIndex } = await renderFrame();
        const gesture = findPanGesture(screen);

        await act(async () => {
            gesture?.__handlers.onStart?.({});
            gesture?.__handlers.onEnd?.({ translationX: 0, translationY: 240 }, false);
        });

        expect(moveToIndex).not.toHaveBeenCalled();
    });

    it('cancels an in-flight pointer drag from the handle without writing', async () => {
        const { screen, moveToIndex } = await renderFrame();
        const gesture = findPanGesture(screen);

        await act(async () => { gesture?.__handlers.onStart?.({}); });
        await act(async () => {
            screen.findHostByTestId('companion-item-move-handle')?.props.onKeyDown?.(keyEvent('Escape'));
        });
        await act(async () => { gesture?.__handlers.onEnd?.({ translationX: 0, translationY: 240 }, true); });

        expect(moveToIndex).not.toHaveBeenCalled();
    });

    it('offers the same reorder through the handle keyboard path', async () => {
        const { screen, moveToIndex } = await renderFrame({}, 'widget:b');
        const handle = () => screen.findHostByTestId('companion-item-move-handle');

        await act(async () => { handle()?.props.onKeyDown?.(keyEvent(' ')); });
        await act(async () => { handle()?.props.onKeyDown?.(keyEvent('ArrowUp')); });
        expect(moveToIndex).not.toHaveBeenCalled();
        await act(async () => { handle()?.props.onKeyDown?.(keyEvent('Enter')); });

        expect(moveToIndex).toHaveBeenCalledOnce();
        expect(moveToIndex).toHaveBeenLastCalledWith(1);
    });

    it('publishes no reorder affordance for a single-item Companion', async () => {
        const moveToIndex = vi.fn();
        const screen = await renderScreen(
            <SessionCompanionItemFrame
                testID="companion-item"
                label="Session summary"
                actions={[]}
                move={{ itemKey: 'summary', orderedKeys: ['summary'], rects: RECTS, moveToIndex }}
            >
                {null}
            </SessionCompanionItemFrame>,
        );
        expect(screen.findHostByTestId('companion-item-move-handle')).toBeNull();
    });
});
