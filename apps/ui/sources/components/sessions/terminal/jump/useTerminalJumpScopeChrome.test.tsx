import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

import { renderHook } from '@/dev/testkit';

import { useTerminalJumpScopeChrome } from './useTerminalJumpScopeChrome';

describe('the palette Terminals scope token', () => {
    it('drops the scope on ⌫ in an empty field or the chip ×, and only then', async () => {
        const leave = vi.fn();
        const hook = await renderHook(() => useTerminalJumpScopeChrome(true, leave));
        const { filters, inputBehavior } = hook.getCurrent();
        expect(inputBehavior?.onBackspaceAtEnd?.('vi')).toBeNull();
        expect(leave).not.toHaveBeenCalled();
        expect(inputBehavior?.onBackspaceAtEnd?.('')).toBe('');
        expect(leave).toHaveBeenCalledTimes(1);
        filters?.[0]?.onClear?.();
        expect(leave).toHaveBeenCalledTimes(2);
    });

    it('is absent while Search covers everything', async () => {
        const hook = await renderHook(() => useTerminalJumpScopeChrome(false, vi.fn()));
        expect(hook.getCurrent()).toEqual({ filters: undefined, inputBehavior: undefined });
    });
});
