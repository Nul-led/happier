import * as React from 'react';
import { View } from 'react-native';

import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock(
        { platformOS: 'ios' },
        {
            ScrollView: 'ScrollView',
            View: 'View',
        },
    );
});

vi.mock('./ScrollEdgeFades', () => ({
    ScrollEdgeFades: () => null,
}));

vi.mock('./ScrollEdgeIndicators', () => ({
    ScrollEdgeIndicators: () => null,
}));

describe('HorizontalScrollableRow', () => {
    it('applies row layout to the native scroll content container', async () => {
        const { HorizontalScrollableRow } = await import('./HorizontalScrollableRow');
        const contentStyle = {
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            gap: 8,
            paddingHorizontal: 12,
        };

        const screen = await renderScreen(
            <HorizontalScrollableRow
                testID="horizontal-row"
                contentTestID="horizontal-row-content"
                fadeColor="#fff"
                indicatorColor="#000"
                contentStyle={contentStyle}
            >
                <View testID="first-option" />
                <View testID="last-option" />
            </HorizontalScrollableRow>,
        );

        const scrollView = screen.findByTestId('horizontal-row');
        expect(scrollView?.props.contentContainerStyle).toBe(contentStyle);
        expect(screen.findByTestId('first-option')?.parent).toBe(scrollView);
        expect(screen.findByTestId('last-option')?.parent).toBe(scrollView);
    });
});
