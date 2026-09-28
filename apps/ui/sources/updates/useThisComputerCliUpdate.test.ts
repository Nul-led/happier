import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { renderHook, flushHookEffects } from '@/dev/testkit';
import { useCliUpdateTask } from '@/components/settings/machines/localControl/useCliUpdateTask';
import { desktopSetupCoordinator } from '@/setup/desktopSetupCoordinator';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';
import * as tauri from '@/utils/platform/tauri';

import { readUnseenUpdateCompletions } from './updateCompletions';
import { useThisComputerCliUpdate } from './useThisComputerCliUpdate';

afterEach(() => {
    storage.setState({ profileScope: null });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

it('keeps a shared local update completion with its starting account when a new account mounts an observer', async () => {
    // The existing deterministic desktop bridge is the process boundary; task lifecycle,
    // inspection, storage and update observers remain real.
    vi.stubEnv('EXPO_PUBLIC_SYSTEM_TASKS_RUNNER_MODE', 'dev');
    vi.spyOn(tauri, 'isTauriDesktop').mockReturnValue(true);
    vi.useFakeTimers();
    const serverId = getActiveServerSnapshot().serverId;
    const accountA = { serverId, accountId: 'local-update-a' };
    const accountB = { serverId, accountId: 'local-update-b' };
    storage.setState({ profileScope: accountA });
    const inspection = desktopSetupCoordinator.inspect();
    await vi.advanceTimersByTimeAsync(30);
    await inspection;

    const starter = await renderHook(() => useCliUpdateTask());
    const firstObserver = await renderHook(() => useThisComputerCliUpdate());
    await act(async () => { await starter.getCurrent().start(); });
    expect(starter.getCurrent().running).toBe(true);
    await firstObserver.unmount();
    await act(async () => { storage.setState({ profileScope: accountB }); });
    const laterObserver = await renderHook(() => useThisComputerCliUpdate());
    await flushHookEffects({ advanceTimersMs: 210, cycles: 1 });

    expect(starter.getCurrent().running).toBe(false);
    expect(readUnseenUpdateCompletions(accountB).size).toBe(0);
    expect(readUnseenUpdateCompletions(accountA).get('machine-local-1:happier-cli')).toBe('done');
    await laterObserver.unmount();
    await starter.unmount();
});
