import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

import { useExactHomeArrival } from './useExactHomeDestination';

afterEach(() => {
    standardCleanup();
});

describe('useExactHomeArrival', () => {
    it('turns a rejected arrival into the existing blocked retry without replaying anything else', async () => {
        const open = vi.fn<() => Promise<boolean>>()
            .mockRejectedValueOnce(new Error('refresh failed'))
            .mockResolvedValueOnce(true);
        const hook = await renderHook(() => useExactHomeArrival());

        await act(async () => {
            await hook.getCurrent().continueThrough(open);
        });

        expect(open).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().state.kind).toBe('blocked');

        const blockedState = hook.getCurrent().state;
        if (blockedState.kind !== 'blocked') throw new Error('Expected blocked arrival state');

        act(() => {
            blockedState.retry();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(open).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().state).toEqual({ kind: 'idle' });

        await hook.unmount();
    });
});
