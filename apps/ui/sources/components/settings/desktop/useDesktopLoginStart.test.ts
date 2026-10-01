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
                            serviceInstalled: true,
                            daemonRunning: true,
                            needsAuth: false,
                            serviceAutostart: bridge.managedMode,
                            serviceRowsComplete: true,
                            serviceRows: [{ relayUrl: 'https://home.example.test', state: 'connected', appManaged: true, serviceTargetMode: 'default-following', actions: ['stop'] }],
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
        await refreshLocalDaemonStatus(bridge.runner as SystemTaskRunner);
        const hook = await renderHook(() => useDesktopLoginStart());
        await flushHookEffects();
        expect(hook.getCurrent()).toMatchObject({ mode: null, installed: true, loading: false });
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
