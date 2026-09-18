import { describe, expect, it, vi } from 'vitest';

import { registerSessionListRouteRemovalRelease } from './sessionListRouteRetention';

describe('registerSessionListRouteRemovalRelease', () => {
    it('releases on actual route removal, not blur or temporary inactivity', () => {
        const listeners = new Map<string, () => void>();
        const removeListener = vi.fn();
        const release = vi.fn();
        const navigation = {
            addListener: vi.fn((event: 'beforeRemove', listener: () => void) => {
                listeners.set(event, listener);
                return removeListener;
            }),
        };

        const unsubscribe = registerSessionListRouteRemovalRelease(navigation, release);
        expect(navigation.addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
        expect(listeners.get('blur')).toBeUndefined();
        expect(release).not.toHaveBeenCalled();

        listeners.get('beforeRemove')?.();
        expect(release).toHaveBeenCalledOnce();

        unsubscribe();
        expect(removeListener).toHaveBeenCalledOnce();
    });
});
