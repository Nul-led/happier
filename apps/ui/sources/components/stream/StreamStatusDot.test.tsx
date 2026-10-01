import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
            (acc, item) => Object.assign(acc, flattenStyle(item)),
            {},
        );
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function dotStyle(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string): Record<string, unknown> {
    return flattenStyle(screen.findByTestId(`${testID}:dot`)?.props.style);
}

describe('StreamStatusDot', () => {
    /**
     * Healthy is quiet: a playing stream already moves (the frames are the motion), so its dot is
     * still. DESIGN: no indefinite decorative animation on routine surfaces (H-UX F-11).
     */
    it('keeps the live dot still', async () => {
        const { StreamStatusDot } = await import('./StreamStatusDot');

        const screen = await renderScreen(
            <StreamStatusDot variant="live" testID="stream-dot" />,
        );

        expect(screen.findByTestId('stream-dot')).not.toBeNull();
        expect(dotStyle(screen, 'stream-dot').animationName).toBeUndefined();
    });

    it('does not pulse for non-live variants', async () => {
        const { StreamStatusDot } = await import('./StreamStatusDot');

        for (const variant of ['stale', 'error', 'idle'] as const) {
            const screen = await renderScreen(
                <StreamStatusDot variant={variant} testID={`stream-dot-${variant}`} />,
            );
            expect(dotStyle(screen, `stream-dot-${variant}`).animationName).toBeUndefined();
        }
    });

    it('maps each variant to a distinct themed color (no shared default)', async () => {
        const { StreamStatusDot } = await import('./StreamStatusDot');

        const colors = new Set<string>();
        for (const variant of ['live', 'stale', 'error', 'idle'] as const) {
            const screen = await renderScreen(
                <StreamStatusDot variant={variant} testID={`stream-dot-${variant}`} />,
            );
            const color = dotStyle(screen, `stream-dot-${variant}`).backgroundColor;
            expect(typeof color).toBe('string');
            expect((color as string).length).toBeGreaterThan(0);
            colors.add(color as string);
        }
        // live / error must be visually distinct so a stalled stream never reads as live.
        expect(colors.size).toBeGreaterThan(1);
    });

    it('renders the canonical soft halo ring behind the dot', async () => {
        const { StreamStatusDot } = await import('./StreamStatusDot');

        const screen = await renderScreen(
            <StreamStatusDot variant="live" size={8} testID="stream-dot" />,
        );

        // The one halo composition (StatusDot `halo`): a concentric ring twice the dot size.
        const halo = flattenStyle(screen.findByTestId('stream-dot:dot-halo')?.props.style);
        expect(halo.width).toBe(16);
        expect(halo.borderRadius).toBe(8);
        expect(typeof halo.backgroundColor).toBe('string');
    });
});
