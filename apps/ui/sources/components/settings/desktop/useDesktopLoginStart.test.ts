import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook } from '@/dev/testkit';

vi.mock('@/utils/platform/desktopHost', async () => {
    const actual = await vi.importActual<typeof import('@/utils/platform/desktopHost')>('@/utils/platform/desktopHost');
    return { ...actual, isDesktopHost: () => true };
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

// The system-task bridge (hsetup) is the boundary: the set task answers `setResult`; every status
// read answers with the managed services' common mode and the scoped service's own mode.
type Start = { kind: string; params: Record<string, unknown> };
const bridge = vi.hoisted(() => ({
    starts: [] as Start[],
    nextId: 0,
    runner: null as unknown,
    managedMode: 'at-login' as string | null,
    defaultInstalled: true,
    pinned: false,
    managedInstalled: true as boolean | null | undefined,
    rowsComplete: true,
    userOwnedPin: false,
    setResult: { ok: true } as { ok: true } | { ok: false; error: { code: string; message: string } },
}));
vi.mock('@/components/systemTasks/systemTasksRuntime', () => ({ getSystemTasksRunner: () => bridge.runner }));

import { refreshLocalDaemonStatus } from '@/components/settings/machines/localControl/useLocalDaemonControl';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import type { SystemTaskRunner } from '@/components/systemTasks/types';

import { useDesktopLoginStart } from './useDesktopLoginStart';

/** A fresh runner per test: its shared status and task ids start empty. */
function freshRunner(): SystemTaskRunner {
    return createSystemTaskRunner({
        bridge: {
            async start(spec) {
                bridge.starts.push(spec as Start);
                bridge.nextId += 1;
                return `task_${bridge.nextId}:${spec.kind}`;
            },
            async subscribe(taskId, listenerSet) {
                queueMicrotask(() => {
                    if (taskId.endsWith('daemon.service.autostart.set.v1')) {
                        const outcome = bridge.setResult;
                        if (outcome.ok) bridge.managedMode = String(bridge.starts.at(-1)?.params.autostart);
                        listenerSet.onResult(outcome.ok
                            ? { protocolVersion: 1, taskId, ok: true, data: {} }
                            : { protocolVersion: 1, taskId, ok: false, error: outcome.error });
                        return;
                    }
                    listenerSet.onResult({
                        protocolVersion: 1,
                        taskId,
                        ok: true,
                        data: {
                            serviceInstalled: bridge.defaultInstalled || bridge.userOwnedPin,
                            daemonRunning: bridge.defaultInstalled || bridge.userOwnedPin,
                            needsAuth: false,
                            serviceAutostart: bridge.managedMode,
                            ...(bridge.managedInstalled === undefined ? {} : { managedServiceInstalled: bridge.managedInstalled }),
                            runningManagedServiceCount: bridge.managedInstalled == null ? null : bridge.defaultInstalled && !bridge.userOwnedPin ? 1 : 0,
                            serviceRowsComplete: bridge.rowsComplete,
                            serviceRows: [
                                ...(bridge.userOwnedPin ? [{ relayUrl: 'https://home.example.test', state: 'connected', appManaged: false, serviceTargetMode: 'pinned', actions: [] }] : bridge.defaultInstalled ? [{ relayUrl: 'https://home.example.test', state: 'connected', appManaged: true, serviceTargetMode: 'default-following', actions: ['stop'] }] : []),
                                ...(bridge.pinned ? [{ relayUrl: 'https://pin.example.test', state: 'offline', appManaged: true, serviceTargetMode: 'pinned', actions: ['start'] }] : []),
                            ],
                        },
                    });
                });
                return () => {};
            },
            async cancel() {},
            async respond() {},
        },
    });
}

describe('useDesktopLoginStart (R16 b, A13-02)', () => {
    beforeEach(() => {
        bridge.starts.length = 0;
        bridge.managedMode = 'at-login';
        bridge.defaultInstalled = true;
        bridge.pinned = false;
        bridge.managedInstalled = true;
        bridge.rowsComplete = true;
        bridge.userOwnedPin = false;
        bridge.setResult = { ok: true };
        bridge.runner = freshRunner();
    });

    it('reads the managed services\' mode and writes the new one for every managed service, then shows what they now have', async () => {
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        await flushHookEffects();
        expect(hook.getCurrent()).toMatchObject({ mode: 'at-login', installed: true, loading: false, error: null });

        await act(async () => {
            await hook.getCurrent().setMode('on-demand');
        });
        const set = bridge.starts.find((start) => start.kind === 'daemon.service.autostart.set.v1');
        expect(set?.params).toMatchObject({ autostart: 'on-demand' });
        expect(set?.params).not.toHaveProperty('relayUrl');
        expect(hook.getCurrent()).toMatchObject({ mode: 'on-demand', loading: false, error: null });
        await hook.unmount();
    });

    it('shows no mode to flip when the managed services disagree', async () => {
        bridge.managedMode = null;
        bridge.pinned = true;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        await flushHookEffects();
        expect(hook.getCurrent()).toMatchObject({ mode: null, installed: true, loading: false });
        await hook.unmount();
    });

    it('reports an installed managed pin even when the scoped default service is absent (A15-01/A15-05 port)', async () => {
        bridge.defaultInstalled = false;
        bridge.pinned = true;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        expect(hook.getCurrent()).toMatchObject({ installed: true, mode: 'at-login', loading: false });
        await hook.unmount();
    });

    it('reports the stopped managed default hidden behind a user-owned serving pin (A16-01)', async () => {
        bridge.userOwnedPin = true;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        expect(hook.getCurrent()).toMatchObject({ installed: true, mode: 'at-login', loading: false });
        await hook.unmount();
    });

    it('keeps managed presence unknown when incomplete inventory has no rows (A16-01)', async () => {
        bridge.defaultInstalled = false;
        bridge.managedInstalled = null;
        bridge.managedMode = null;
        bridge.rowsComplete = false;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        expect(hook.getCurrent()).toMatchObject({ installed: null, mode: null, loading: false });
        await hook.unmount();
    });

    it.each([false, true])('reports complete managed absence with a user-owned serving pin: %s', async (userOwnedPin) => {
        bridge.defaultInstalled = false;
        bridge.userOwnedPin = userOwnedPin;
        bridge.managedInstalled = false;
        bridge.managedMode = null;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        expect(hook.getCurrent()).toMatchObject({ installed: false, mode: null, loading: false });
        await hook.unmount();
    });

    it('keeps presence unknown when an older status omits the managed inventory fact', async () => {
        bridge.managedInstalled = undefined;
        bridge.userOwnedPin = true;
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        expect(hook.getCurrent()).toMatchObject({ installed: null, mode: 'at-login', loading: false });
        await hook.unmount();
    });

    it('keeps the proven mode and says why when the change fails', async () => {
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        bridge.setResult = { ok: false, error: { code: 'service_install_failed', message: 'launchctl refused the change' } };
        const hook = await renderHook(() => useDesktopLoginStart());
        await flushHookEffects();

        await act(async () => {
            await hook.getCurrent().setMode('on-demand');
        });
        expect(hook.getCurrent()).toMatchObject({ mode: 'at-login', error: 'launchctl refused the change', loading: false });
        await hook.unmount();
    });

    it('offers nothing to flip until a status proved a mode', async () => {
        const hook = await renderHook(() => useDesktopLoginStart());
        await flushHookEffects();
        expect(hook.getCurrent()).toMatchObject({ mode: null, installed: null, loading: true });
        expect(bridge.starts).toEqual([]);
        await hook.unmount();
    });
});
