/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { installPopoverCommonModuleMocks } from '@/components/ui/popover/popoverTestHelpers';

installPopoverCommonModuleMocks({ reactNative: async () => await vi.importActual('react-native-web') });

it.each(['action', 'help'] as const)('keeps a focused %s tooltip outside a clipping toolbar without moving focus', async (kind) => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0);
    globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    const { IconButton } = await import('./IconButton');
    const { Tooltip } = await import('../overlays/Tooltip');
    await import('../overlays/AnchoredTooltip');
    const container = document.createElement('div');
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
    const root = createRoot(container);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 100, y: 100, width: 28, height: 28,
        top: 100, left: 100, right: 128, bottom: 128, toJSON: () => ({}),
    });
    try {
        await act(async () => {
            root.render(kind === 'action'
                ? <IconButton testID="review-action" icon={<span>↓</span>} accessibilityLabel="Next file" tooltip="Next file" onPress={() => {}} />
                : <Tooltip testID="review-action" label="Large diff help"><span>i</span></Tooltip>);
        });
        const button = container.querySelector<HTMLElement>('[data-testid="review-action"]');
        if (!button) throw new Error('Missing review action');
        if (kind === 'help') expect(button.getAttribute('role')).not.toBe('button');
        await act(async () => { button.focus(); });
        await vi.waitFor(() => {
            const tooltip = document.body.querySelector('[data-testid="review-action-tooltip"]');
            expect(tooltip).not.toBeNull();
            expect(container.contains(tooltip)).toBe(false);
            for (let node = tooltip; node instanceof HTMLElement; node = node.parentElement) {
                const style = window.getComputedStyle(node);
                expect(style.opacity).not.toBe('0');
                expect(style.display).not.toBe('none');
                expect(style.visibility).not.toBe('hidden');
            }
        }, { timeout: 10000 });
        expect(document.activeElement).toBe(button);
        await act(async () => { button.blur(); });
        expect(document.body.querySelector('[data-testid="review-action-tooltip"]')).toBeNull();
        await act(async () => { button.dispatchEvent(new MouseEvent(window.PointerEvent != null ? 'pointerenter' : 'mouseenter', { bubbles: true })); });
        await vi.waitFor(() => expect(document.body.querySelector('[data-testid="review-action-tooltip"]')).not.toBeNull());
        expect(document.activeElement).not.toBe(button);
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        bounds.mockRestore();
        vi.restoreAllMocks();
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    }
});
