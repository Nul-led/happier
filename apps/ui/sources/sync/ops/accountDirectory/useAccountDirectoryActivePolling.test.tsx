import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

const runtimeState = vi.hoisted(() => ({
    active: true,
    listeners: new Set<() => void>(),
}));

vi.mock('@/utils/runtime/isRuntimeActive', () => ({
    isRuntimeActive: () => runtimeState.active,
    subscribeToRuntimeActiveChange: (listener: () => void) => {
        runtimeState.listeners.add(listener);
        return () => runtimeState.listeners.delete(listener);
    },
}));

describe('useAccountDirectoryActivePolling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        runtimeState.active = true;
        runtimeState.listeners.clear();
    });

    afterEach(() => {
        standardCleanup();
        runtimeState.listeners.clear();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('uses the canonical enrollment backoff for transient failures and resets after success', async () => {
        const { useAccountDirectoryActivePolling } = await import('./useAccountDirectoryActivePolling');
        const outcomes = ['transient', 'transient', 'success'] as const;
        let outcomeIndex = 0;
        const poll = vi.fn(async () => outcomes[outcomeIndex++] ?? 'success');

        await renderHook(() => useAccountDirectoryActivePolling(poll), {
            flushOptions: { cycles: 0 },
        });

        await flushHookEffects({ cycles: 1, advanceTimersMs: 1_000 });
        expect(poll).toHaveBeenCalledTimes(1);

        // The first retry uses the bounded policy's base delay. A second
        // consecutive failure then backs off to two seconds.
        await flushHookEffects({ cycles: 1, advanceTimersMs: 1_000 });
        expect(poll).toHaveBeenCalledTimes(2);
        await flushHookEffects({ cycles: 1, advanceTimersMs: 1_999 });
        expect(poll).toHaveBeenCalledTimes(2);
        await flushHookEffects({ cycles: 1, advanceTimersMs: 1 });
        expect(poll).toHaveBeenCalledTimes(3);

        // A successful/progress response restores the normal one-second cadence.
        await flushHookEffects({ cycles: 1, advanceTimersMs: 999 });
        expect(poll).toHaveBeenCalledTimes(3);
        await flushHookEffects({ cycles: 1, advanceTimersMs: 1 });
        expect(poll).toHaveBeenCalledTimes(4);
    });

    it('treats thrown polling work as transient and keeps one shared retry scheduler', async () => {
        const { useAccountDirectoryActivePolling } = await import('./useAccountDirectoryActivePolling');
        const first = vi.fn()
            .mockRejectedValueOnce(new Error('temporary transport failure'))
            .mockResolvedValue('success');
        const second = vi.fn(async () => 'success' as const);

        await renderHook(() => {
            useAccountDirectoryActivePolling(first);
            useAccountDirectoryActivePolling(second);
        }, { flushOptions: { cycles: 0 } });

        await flushHookEffects({ cycles: 1, advanceTimersMs: 1_000 });
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        await flushHookEffects({ cycles: 1, advanceTimersMs: 1_000 });
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(2);
        expect(runtimeState.listeners.size).toBe(1);
    });
});
