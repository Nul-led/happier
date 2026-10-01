import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

import { BrowserAgentCursor } from './BrowserAgentCursor';

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

function flatten(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

describe('BrowserAgentCursor', () => {
    it('rings the target inside the drawn page, not the whole letterboxed surface', async () => {
        const target = { x: 0.5, y: 0.25, width: 0.2, height: 0.1 };
        // A 1280 × 800 page fitted into a 600 × 700 surface is drawn 600 × 375, 162.5 px from the top.
        const pageRect = { x: 0, y: 162.5, width: 600, height: 375 };
        const element = <BrowserAgentCursor testID="c" target={target} pageRect={pageRect} />;
        const screen = await renderScreen(element);
        const layer = screen.findByTestId('c');
        await act(async () => {
            layer?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 600, height: 700 } } });
        });
        // The Reanimated test double evaluates animated styles during render: the placement written
        // by the effect shows on the next render of the same props.
        await screen.update(React.cloneElement(element));
        const ring = flatten(screen.findHostByTestId('c-ring')?.props.style);
        // The ring sits RING_OUTSET (3 px) outside the element: top = 162.5 + (0.25 - 0.05) × 375 - 3.
        expect(ring.top).toBeCloseTo(234.5);
        expect(ring.left).toBeCloseTo(237);
        expect(ring.height).toBeCloseTo(43.5);
    });
});
