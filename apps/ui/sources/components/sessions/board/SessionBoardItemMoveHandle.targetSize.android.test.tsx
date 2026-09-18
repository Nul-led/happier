import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderScreen } from '@/dev/testkit';

import { SessionBoardItemMoveHandle } from './SessionBoardItemMoveHandle';

vi.mock('react-native', async () => (
    await import('@/dev/testkit/mocks/reactNative')
).createReactNativeNativeMock({ platformOS: 'android' }));

vi.mock('react-native-gesture-handler', () => ({
    GestureDetector: ({ children }: Readonly<{ children: React.ReactNode }>) => children,
}));

describe('SessionBoardItemMoveHandle Android target', () => {
    it('uses the canonical 48dp minimum interactive target', async () => {
        const screen = await renderScreen(
            <SessionBoardItemMoveHandle
                gesture={{} as never}
                onMove={() => undefined}
                canMoveBefore
                canMoveAfter
                accessibilityLabel="Reorder Release plan"
                itemTitle="Release plan"
                testID="move"
            />,
        );

        const style = flattenTestStyle(screen.findHostByTestId('move')?.props.style);
        expect(style.minWidth).toBe(48);
        expect(style.minHeight).toBe(48);
    });
});
