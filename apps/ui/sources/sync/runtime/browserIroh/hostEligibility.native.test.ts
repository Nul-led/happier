import { describe, expect, it, vi } from 'vitest';

import { resolveBrowserIrohHostDecision } from './hostEligibility';

// Native targets keep the native Iroh implementation; the browser carrier must
// never be offered to them even when the JS globals happen to exist.
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeNativeMock({ platformOS: 'ios' });
});

describe('sync/runtime/browserIroh/hostEligibility (native)', () => {
    it('excludes a native runtime', () => {
        expect(resolveBrowserIrohHostDecision({ hasSharedWorker: true, hasIndexedDb: true })).toEqual({
            eligible: false,
            reason: 'not_web',
        });
    });
});
