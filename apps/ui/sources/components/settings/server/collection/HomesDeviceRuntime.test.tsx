import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';

const host = vi.hoisted(() => ({
    nextTask: 0,
    commands: [] as Array<{ command: string; args?: Record<string, unknown> }>,
    purpose: { kind: 'generic' } as { kind: 'generic' } | { kind: 'personal-home'; canonicalServerUrl: string },
}));
// Only the real OS command bridge is replaced. Runner, runtime purpose,
// profile provenance and production operations remain their actual owners.
vi.mock('@/utils/platform/desktopHost', () => ({
    desktopHostKind: () => 'tauri',
    isDesktopHost: () => true,
    invokeDesktopHost: async (command: string, args?: Record<string, unknown>) => {
        host.commands.push({ command, args });
        if (command === 'start_system_task') {
            const spec = JSON.parse(String(args?.specJson)) as { kind: string };
            return { taskId: `device-runtime:${spec.kind}:${++host.nextTask}` };
        }
        if (command === 'get_system_task_snapshot') {
            const taskId = String(args?.taskId);
            return {
                events: [],
                result: taskId.includes('relay.runtime.status.v1') ? {
                    protocolVersion: 1, taskId, ok: true,
                    data: {
                        installed: true, dataPresent: true, version: '1', healthy: true,
                        relayUrl: 'http://127.0.0.1:43123', purpose: host.purpose,
                        anonymousSignupEnabled: host.purpose.kind === 'personal-home' ? false : null,
                        service: { active: true, enabled: true },
                    },
                } : taskId.includes('relay.runtime.uninstall.v1') ? {
                    protocolVersion: 1, taskId, ok: true, data: { uninstalled: true },
                } : null,
            };
        }
        return undefined;
    },
    listenDesktopHostEvent: async () => async () => {},
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

beforeEach(() => {
    host.commands = [];
    host.purpose = { kind: 'generic' };
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `device-runtime-${crypto.randomUUID()}`);
});
afterEach(() => {
    standardCleanup();
    vi.unstubAllEnvs();
});

describe('device runtime ownership', () => {
    it('uses fresh generic runtime purpose rather than a stale Personal Home label', async () => {
        const { ServerLocalRuntimeControlSection } = await import('./HomesDeviceScreen');
        const screen = await renderScreen(<ServerLocalRuntimeControlSection homeLabel="Stale Personal Home" />);
        await vi.waitFor(() => expect(screen.findByTestId('settings.localRelayRuntime.status')).not.toBeNull());
        expect(screen.findByTestId('settings.personalHomeRuntime.home')).toBeNull();
    });

    it('selects the Personal Home runtime from the OS fact without a saved profile', async () => {
        host.purpose = { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' };
        const { ServerLocalRuntimeControlSection } = await import('./HomesDeviceScreen');
        const screen = await renderScreen(<ServerLocalRuntimeControlSection />);
        await vi.waitFor(() => expect(screen.findByTestId('settings.personalHomeRuntime.home')).not.toBeNull());
    });

    it('keeps actual runtime operations after profile removal while withholding profile-scoped operations', async () => {
        const { usePersonalHomeRuntimeOperations } = await import('../localControl/usePersonalHomeRuntimeOperations');
        const hook = await renderHook(() => usePersonalHomeRuntimeOperations({ profiles: [] }));
        const operations = hook.getCurrent().operations;
        expect(operations.removeProfile).toBeUndefined();
        expect(operations.repairSearch).toBeUndefined();
        expect(operations.relocation).toBeUndefined();

        await operations.openDataLocation?.('/home/.happier/self-host/data');
        await operations.openLogs?.('/home/.happier/self-host/logs');
        await operations.revealBackupOutput?.('/mnt/backups/personal-home.tar');
        await operations.selectBackupArchive?.();
        await operations.selectBackupExportDestination?.();
        await operations.uninstallRuntime?.();
        expect(host.commands.filter(({ command }) => command === 'system_tasks_open_log_path').map(({ args }) => args?.path))
            .toEqual(['/home/.happier/self-host/data', '/home/.happier/self-host/logs']);
        expect(host.commands.find(({ command }) => command === 'system_tasks_reveal_output_path')?.args?.path)
            .toBe('/mnt/backups/personal-home.tar');
        expect(host.commands.some(({ command }) => command === 'desktop_pick_personal_home_backup_archive')).toBe(true);
        expect(host.commands.some(({ command }) => command === 'desktop_save_personal_home_backup_archive')).toBe(true);
        expect(host.commands.filter(({ command }) => command === 'start_system_task').map(({ args }) => JSON.parse(String(args?.specJson)).kind))
            .toContain('relay.runtime.uninstall.v1');
    });

    it('does not give mutable adoption provenance profile-scoped authority', async () => {
        const { usePersonalHomeRuntimeOperations } = await import('../localControl/usePersonalHomeRuntimeOperations');
        const profile = {
            id: 'ordinary-home', name: 'Ordinary Home', serverUrl: 'https://ordinary.example.test',
            source: 'desktop-personal-home', serverIdentityId: 'ordinary-home-identity',
            createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        } satisfies ServerProfile;
        const hook = await renderHook(() => usePersonalHomeRuntimeOperations({ profiles: [profile] }));
        expect(hook.getCurrent().personalHomeProfile).toBeNull();
        expect(hook.getCurrent().operations.relocation).toBeUndefined();
        expect(hook.getCurrent().operations.repairSearch).toBeUndefined();
    });

    it('finds the completed managed Home independently of the Home in use without changing focus', async () => {
        const { usePersonalHomeRuntimeOperations } = await import('../localControl/usePersonalHomeRuntimeOperations');
        const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        const active = getActiveServerSnapshot();
        const managed = {
            id: 'managed-home', name: 'Studio', serverUrl: 'http://127.0.0.1:43123',
            source: 'desktop-personal-home', serverIdentityId: 'srv_managed_home',
            personalHomeBootstrapCompleted: true,
            createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        } satisfies ServerProfile;
        const other = {
            id: 'other-home', name: 'Other Home', serverUrl: 'https://other.example.test',
            createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        } satisfies ServerProfile;
        const hook = await renderHook(() => usePersonalHomeRuntimeOperations({ profiles: [other, managed] }));
        expect(hook.getCurrent().personalHomeProfile?.id).toBe(managed.id);
        expect(getActiveServerSnapshot()).toEqual(active);
    });
});
