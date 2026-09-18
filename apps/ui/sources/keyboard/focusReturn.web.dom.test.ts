import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

import { restoreFocusToBestTarget } from './focusReturn';

describe('focus return helpers on web', () => {
    it('invokes DOM focus on the requested anchor', () => {
        const focus = vi.fn();

        expect(restoreFocusToBestTarget({ current: { focus, isConnected: true } })).toBe(true);
        expect(focus).toHaveBeenCalledExactlyOnceWith();
    });
});
