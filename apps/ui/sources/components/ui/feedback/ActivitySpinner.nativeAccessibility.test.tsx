import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        ActivityIndicator: 'ActivityIndicator',
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.native ?? options.default,
        },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                text: {
                    secondary: 'theme-secondary-text',
                },
            },
        },
    });
});

describe('ActivitySpinner native accessibility', () => {
    it('defaults the native activity indicator to a progressbar role', async () => {
        const { ActivitySpinner } = await import('./ActivitySpinner');
        const screen = await renderScreen(<ActivitySpinner testID="spinner" />);

        const spinner = screen.findByTestId('spinner');
        expect(spinner?.type).toBe('ActivityIndicator');
        expect(spinner?.props.accessibilityRole).toBe('progressbar');
    });

    it('preserves an explicit native accessibility role', async () => {
        const { ActivitySpinner } = await import('./ActivitySpinner');
        const screen = await renderScreen(
            <ActivitySpinner testID="spinner" accessibilityRole="alert" />,
        );

        expect(screen.findByTestId('spinner')?.props.accessibilityRole).toBe('alert');
    });
});
