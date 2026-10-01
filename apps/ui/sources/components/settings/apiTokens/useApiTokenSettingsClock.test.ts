import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import { readApiTokenExpiresIn } from './apiTokenSettingsPresentation';
import { useApiTokenSettingsClock } from './useApiTokenSettingsClock';

afterEach(() => {
    standardCleanup();
    vi.useRealTimers();
});

it('updates expiry copy immediately after an exact countdown boundary, without waiting for another row fact', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-10-01T12:00:00Z');
    vi.setSystemTime(now);
    const token = {
        createdAt: new Date(now - 10 * 86_400_000).toISOString(),
        lastUsedAt: null,
        expiresAt: new Date(now + 5 * 86_400_000).toISOString(),
    };
    const hook = await renderHook(() => useApiTokenSettingsClock([token], true));
    expect(readApiTokenExpiresIn(token.expiresAt, hook.getCurrent())?.count).toBe(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(readApiTokenExpiresIn(token.expiresAt, hook.getCurrent())?.count).toBe(4);
    await hook.unmount();
});
