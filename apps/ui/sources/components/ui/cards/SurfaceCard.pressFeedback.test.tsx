import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    if (style && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

afterEach(() => {
    standardCleanup();
    vi.resetModules();
});

describe('SurfaceCard press feedback', () => {
    it('acknowledges a press on the whole card with the surface-level dip, not the row/card text dip', async () => {
        const { SurfaceCard } = await import('./SurfaceCard');
        const { motionTokens } = await import('@/components/ui/motion/motionTokens');
        const screen = await renderScreen(
            <SurfaceCard testID="card" onPress={() => {}}>
                {React.createElement('View')}
            </SurfaceCard>,
        );

        const pressable = screen.findAll((node) => typeof node.props.style === 'function')[0];
        expect(pressable).toBeDefined();
        const pressed = flattenStyle(pressable!.props.style({ pressed: true }));
        const resting = flattenStyle(pressable!.props.style({ pressed: false }));

        expect(pressed.opacity).toBe(motionTokens.press.opacitySurface);
        expect(resting.opacity).toBeUndefined();
    });
});
