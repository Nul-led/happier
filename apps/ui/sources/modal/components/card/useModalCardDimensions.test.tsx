import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installModalComponentCommonModuleMocks } from '../modalComponentTestHelpers';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';

const windowState = vi.hoisted(() => ({
    width: 1024,
    height: 768,
}));

installModalComponentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            useWindowDimensions: () => ({
                width: windowState.width,
                height: windowState.height,
            }),
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    },
});

describe('useModalCardDimensions', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('clamps the modal card dimensions to the current window', async () => {
        const { renderHook } = await import('@/dev/testkit');
        const { useModalCardDimensions } = await import('./useModalCardDimensions');

        windowState.width = 920;
        windowState.height = 620;

        const hook = await renderHook(() => useModalCardDimensions({
            size: 'lg',
        }));

        expect(hook.getCurrent()).toEqual({
            width: 840,
            maxHeight: 524,
        });
    });

});
