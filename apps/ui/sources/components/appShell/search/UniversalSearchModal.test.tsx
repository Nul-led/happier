import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const capturedChrome = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const capturedControllerProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock('@/modal/components/card/useModalCardChrome', () => ({
    useModalCardChrome: (_setChrome: unknown, chrome: Record<string, unknown>) => {
        capturedChrome.value = chrome;
    },
}));

vi.mock('./UniversalSearchController', () => ({
    UniversalSearchController: (props: Record<string, unknown>) => {
        capturedControllerProps.value = props;
        return React.createElement('UniversalSearchController', props);
    },
}));

afterEach(() => {
    capturedChrome.value = null;
    capturedControllerProps.value = null;
    standardCleanup();
});

describe('UniversalSearchModal', () => {
    it('uses the bounded card seam while leaving SelectionList as the sole scroll owner', async () => {
        const { UniversalSearchModal } = await import('./UniversalSearchModal');

        await renderScreen(
            <UniversalSearchModal
                commands={[]}
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(capturedChrome.value).toEqual(expect.objectContaining({
            scrollHost: 'body',
            bodyScroll: 'none',
            dimensions: { width: 800, maxHeightRatio: 0.7, size: 'lg' },
        }));
    });

});
