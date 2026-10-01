import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { t } from '@/text';

import { SessionBoardItemMoveHandle } from './SessionBoardItemMoveHandle';

const platform = vi.hoisted(() => ({ os: 'web' as 'web' | 'ios' | 'android' }));
const announceForAccessibilityMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const base = await createReactNativeWebMock();
    return {
        ...base,
        AccessibilityInfo: {
            ...base.AccessibilityInfo,
            announceForAccessibility: announceForAccessibilityMock,
        },
        Platform: {
            ...base.Platform,
            get OS() {
                return platform.os;
            },
        },
    };
});

vi.mock('react-native-gesture-handler', () => ({
    GestureDetector: ({ children }: Readonly<{ children: React.ReactNode }>) => children,
}));

function liveText(screen: Awaited<ReturnType<typeof renderScreen>>): string {
    return String(screen.findHostByTestId('move-live-region')?.props.children?.props.children ?? '');
}

beforeEach(() => {
    platform.os = 'web';
    announceForAccessibilityMock.mockClear();
});

function keyEvent(key: string) {
    return {
        key,
        nativeEvent: { key },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    };
}

describe('SessionBoardItemMoveHandle keyboard reorder', () => {
    it('stages a semantic neighbour and submits exactly one existing move action only on drop', async () => {
        const onMove = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent(' ')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowUp')));
        expect(onMove).not.toHaveBeenCalled();
        expect(screen.findHostByTestId('move')?.props['aria-grabbed']).toBe(true);

        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.({
            ...keyEvent('Enter'),
            repeat: true,
        }));
        expect(onMove).not.toHaveBeenCalled();

        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('Enter')));
        expect(onMove).toHaveBeenCalledOnce();
        expect(onMove).toHaveBeenLastCalledWith('before');
        expect(screen.findHostByTestId('move')?.props['aria-grabbed']).toBe(false);
    });

    it('cancels a staged move with Escape without writing', async () => {
        const onMove = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('Enter')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowDown')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('Escape')));

        expect(onMove).not.toHaveBeenCalled();
        expect(screen.findHostByTestId('move')?.props['aria-grabbed']).toBe(false);
        expect(liveText(screen)).toBe(t('sessionsList.dragA11yCancelled', { item: 'Release plan' }));
    });

    it('stages a Board-view destination with horizontal arrows and commits it once on drop', async () => {
        const onMove = vi.fn();
        const onMoveToView = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                moveDestinations={[
                    { id: 'research', title: 'Research' },
                    { id: 'ship', title: 'Ship' },
                ]}
                onMoveToView={onMoveToView}
                testID="move"
            />,
        );
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent(' ')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowRight')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowRight')));
        expect(onMove).not.toHaveBeenCalled();
        expect(onMoveToView).not.toHaveBeenCalled();

        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent(' ')));
        expect(onMoveToView).toHaveBeenCalledOnce();
        expect(onMoveToView).toHaveBeenLastCalledWith('ship');
        expect(onMove).not.toHaveBeenCalled();
    });

    // An accessible value is the CONTROL'S value. Repeating the control's own
    // name inside it makes every arrow press announce "Reorder Release plan,
    // Reorder Release plan. 2 / 4" — and "2 / 4" is a code-joined fragment that
    // no locale authored and that screen readers read as "two slash four".
    it('speaks the staged position as one authored phrase without repeating the handle name', async () => {
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={vi.fn()}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );

        const value = screen.findHostByTestId('move')?.props.accessibilityValue?.text;

        expect(value).toBe(t('sessionBoard.item.movePosition', { position: 2, total: 4 }));
        expect(value).not.toContain('Reorder Release plan');
    });

    it('speaks a staged board-view destination as one authored phrase', async () => {
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={vi.fn()}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                moveDestinations={[{ id: 'research', title: 'Research' }]}
                onMoveToView={vi.fn()}
                testID="move"
            />,
        );
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent(' ')));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowRight')));

        expect(screen.findHostByTestId('move')?.props.accessibilityValue?.text)
            .toBe(t('sessionBoard.item.moveTargetView', { title: 'Research' }));
        expect(liveText(screen)).toBe(t('sessionBoard.item.moveTargetView', { title: 'Research' }));
        expect(liveText(screen)).not.toContain(`${t('sessionBoard.views.label')}:`);
    });

    it('keeps screen-reader increment/decrement as immediate semantic alternatives', async () => {
        const onMove = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );

        screen.findHostByTestId('move')?.props.onAccessibilityAction?.({
            nativeEvent: { actionName: 'increment' },
        });

        expect(onMove).toHaveBeenCalledOnce();
        expect(onMove).toHaveBeenLastCalledWith('after');
    });

    // The committed move is announced once, by the Board controller after the
    // layout write lands ('sessionBoard.item.moved.*'). The handle announcing its
    // own "dropped" phrase as well spoke every move twice — and on Android three
    // times, because it also paired a live region with the imperative API.
    it('leaves the committed-move announcement to the Board controller on Android', async () => {
        platform.os = 'android';
        const onMove = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );

        await act(async () => screen.findHostByTestId('move')?.props.onAccessibilityAction?.({
            nativeEvent: { actionName: 'increment' },
        }));

        expect(onMove).toHaveBeenCalledOnce();
        expect(announceForAccessibilityMock).not.toHaveBeenCalled();
        expect(liveText(screen)).toBe('');
    });

    it('speaks each keyboard transition once through one polite region and leaves the drop to the controller', async () => {
        const onMove = vi.fn();
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={onMove}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                position={2}
                total={4}
                testID="move"
            />,
        );
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('Enter')));
        expect(liveText(screen)).toBe(t('sessionsList.dragA11yPickedUp', { item: 'Release plan' }));
        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('ArrowUp')));
        const staged = liveText(screen);
        expect(staged).toBe(t('sessionBoard.item.movePosition', { position: 1, total: 4 }));

        await act(async () => screen.findHostByTestId('move')?.props.onKeyDown?.(keyEvent('Enter')));

        expect(onMove).toHaveBeenCalledOnce();
        expect(liveText(screen)).toBe(staged);
    });
});
