import { describe, expect, it, vi } from 'vitest';

import {
    isUiSurfaceRendererKind,
    resolveUiSurfaceRenderer,
    type UiSurfaceRendererKind,
} from './UiSurfaceRendererHost';

describe('resolveUiSurfaceRenderer', () => {
    it('owns the closed renderer-kind admission check', () => {
        expect(isUiSurfaceRendererKind('hostedHtml')).toBe(true);
        expect(isUiSurfaceRendererKind('unknown')).toBe(false);
        expect(isUiSurfaceRendererKind(null)).toBe(false);
    });

    it.each(['declarative', 'reactNative', 'hostedWeb', 'hostedHtml'] as const)(
        'dispatches %s through the one closed renderer switch',
        (kind) => {
            const calls: UiSurfaceRendererKind[] = [];
            const factories = {
                declarative: vi.fn(() => { calls.push('declarative'); return 'declarative'; }),
                reactNative: vi.fn(() => { calls.push('reactNative'); return 'reactNative'; }),
                hostedWeb: vi.fn(() => { calls.push('hostedWeb'); return 'hostedWeb'; }),
                hostedHtml: vi.fn(() => { calls.push('hostedHtml'); return 'hostedHtml'; }),
            };
            expect(resolveUiSurfaceRenderer(kind, factories)).toBe(kind);
            expect(calls).toEqual([kind]);
        },
    );
});
