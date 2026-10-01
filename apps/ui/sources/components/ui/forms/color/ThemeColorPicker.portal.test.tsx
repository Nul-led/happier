import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const capturedPopoverProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const portalOptions = vi.hoisted(() => ({
    web: true,
    native: true,
    matchAnchorWidth: false,
    anchorAlign: 'start',
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('reanimated-color-picker', async () => {
    const { createReanimatedColorPickerMock } = await import('@/dev/testkit/mocks/reanimatedColorPicker');
    return createReanimatedColorPickerMock();
});

vi.mock('@/components/ui/popover', () => ({
    MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS: portalOptions,
    Popover: (props: Record<string, unknown>) => {
        capturedPopoverProps.current = props;
        return React.createElement('Popover');
    },
}));

describe('ThemeColorPicker popover portal ownership', () => {
    it('uses the modal-aware portal options for the floating picker', async () => {
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                addEventListener: () => {},
                removeEventListener: () => {},
                innerWidth: 1024,
                innerHeight: 768,
            },
        });
        const { ThemeColorPicker } = await import('./ThemeColorPicker');

        const screen = await renderScreen(
            <ThemeColorPicker
                value="#123456"
                onChange={() => {}}
                previewTestID="theme-color-preview"
                pickerTestID="theme-color-picker"
            />,
        );

        await screen.pressByTestIdAsync('theme-color-preview-button');

        expect(capturedPopoverProps.current?.portal).toBe(portalOptions);
    });
});
