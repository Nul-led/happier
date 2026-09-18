import { describe, expect, it, vi } from 'vitest';

const nativeFocus = vi.hoisted(() => ({
    findNodeHandle: vi.fn<(target: unknown) => number | null>(() => 71),
    setAccessibilityFocus: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' }, {
        findNodeHandle: nativeFocus.findNodeHandle,
        AccessibilityInfo: { setAccessibilityFocus: nativeFocus.setAccessibilityFocus },
    });
});

import { restoreFocusToBestTarget } from './focusReturn';

describe('focus return helpers on Android', () => {
    it('moves TalkBack accessibility focus to a native host ref', () => {
        const target = {};

        expect(restoreFocusToBestTarget({ current: target })).toBe(true);
        expect(nativeFocus.findNodeHandle).toHaveBeenCalledWith(target);
        expect(nativeFocus.setAccessibilityFocus).toHaveBeenCalledWith(71);
    });
});
