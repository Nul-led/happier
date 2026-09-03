import * as React from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const activeServerState = vi.hoisted(() => ({ serverId: 'srv_home' as string }));
const daemonTargetState = vi.hoisted(() => ({
    target: { serverId: 'srv_daemon', machineId: 'machine_1' } as Readonly<{
        serverId: string;
        machineId: string;
    }> | null,
}));
const featureRuntimeState = vi.hoisted(() => ({ snapshot: { status: 'loading' } as unknown }));
const featureRuntimeOptionsSpy = vi.hoisted(() => vi.fn());
const featureEnabledState = vi.hoisted(() => ({
    enabled: { search: true, 'memory.search': true } as Record<string, boolean>,
    scopes: [] as Array<readonly [string, unknown]>,
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: activeServerState.serverId, serverUrl: '', generation: 1 }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string, scope?: unknown) => {
        featureEnabledState.scopes.push([featureId, scope]);
        return featureEnabledState.enabled[featureId] === true;
    },
}));

vi.mock('./resolveDaemonMemorySearchTarget', () => ({
    useDaemonMemorySearchTargetSelection: () => ({ resolveExecutionTarget: () => null }),
    resolveDaemonMemorySearchTarget: () => daemonTargetState.target,
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: (options?: unknown) => {
        featureRuntimeOptionsSpy(options);
        return featureRuntimeState.snapshot;
    },
    useServerFeaturesSnapshotForServerId: () => featureRuntimeState.snapshot,
}));

afterEach(() => {
    activeServerState.serverId = 'srv_home';
    daemonTargetState.target = { serverId: 'srv_daemon', machineId: 'machine_1' };
    featureRuntimeState.snapshot = { status: 'loading' };
    featureRuntimeOptionsSpy.mockReset();
    featureEnabledState.enabled = { search: true, 'memory.search': true };
    featureEnabledState.scopes = [];
    standardCleanup();
});

function setReadyHomeCapability(homeSearch: unknown) {
    featureRuntimeState.snapshot = {
        status: 'ready',
        features: { capabilities: { homeSearch } },
    };
}

async function renderProviderHook() {
    const { useMemorySearchProvider } = await import('./useMemorySearchProvider');
    return renderHook(() => useMemorySearchProvider());
}

async function renderScopedProviderHook(target: Readonly<{ serverId?: string | null; machineId?: string | null }>) {
    const { useMemorySearchProvider } = await import('./useMemorySearchProvider');
    return renderHook(() => useMemorySearchProvider(target));
}

describe('useMemorySearchProvider', () => {
    it('falls back to daemon when the active Home capability is missing', async () => {
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'daemon',
            homeServerId: null,
            homeReadiness: null,
            daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
            queryAvailable: true,
            unavailableReason: null,
        });
        expect(featureRuntimeOptionsSpy).toHaveBeenCalledWith({ enabled: true });
    });

    it('chooses Home for adopted profiles from the strict active-Home capability, independent of provenance', async () => {
        setReadyHomeCapability({ enabled: true });

        for (const _source of ['account-directory', 'manual']) {
            const hook = await renderProviderHook();
            expect(hook.getCurrent()).toEqual({
                provider: 'home',
                homeServerId: 'srv_home',
                homeReadiness: 'ready',
                daemonTarget: null,
                queryAvailable: true,
                unavailableReason: null,
            });
        }
        expect(featureEnabledState.scopes).toContainEqual(['search', { scopeKind: 'runtime' }]);
    });

    it('captures the exact focused Home as the Home search target', async () => {
        setReadyHomeCapability({ enabled: true });
        activeServerState.serverId = 'srv_home_b';

        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toMatchObject({ provider: 'home', homeServerId: 'srv_home_b' });
    });

    it('never lets a ready Home capability authorize Home search while the search feature is off', async () => {
        setReadyHomeCapability({ enabled: true });
        featureEnabledState.enabled = { search: false, 'memory.search': true };

        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'daemon',
            homeServerId: null,
            homeReadiness: null,
            daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
            queryAvailable: true,
            unavailableReason: null,
        });
    });

    it('admits no transcript provider when neither search feature is enabled', async () => {
        setReadyHomeCapability({ enabled: true });
        featureEnabledState.enabled = { search: false, 'memory.search': false };

        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: null,
            homeServerId: null,
            homeReadiness: null,
            daemonTarget: null,
            queryAvailable: false,
            unavailableReason: null,
        });
    });

    it('keeps Home usable when only daemon memory search is disabled', async () => {
        setReadyHomeCapability({ enabled: true });
        featureEnabledState.enabled = { search: true, 'memory.search': false };

        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toMatchObject({ provider: 'home', queryAvailable: true });
    });

    it('uses the explicit daemon target while an admitted Home is not ready', async () => {
        setReadyHomeCapability({ enabled: false, reason: 'indexing' });
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toMatchObject({
            provider: 'daemon',
            daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
            queryAvailable: true,
        });

        setReadyHomeCapability({ enabled: false, reason: 'index_unavailable' });
        const unavailableHook = await renderProviderHook();
        expect(unavailableHook.getCurrent()).toMatchObject({
            provider: 'daemon',
            daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
            queryAvailable: true,
        });
    });

    it('does not daemon-fallback across servers for an explicit Home-only target', async () => {
        setReadyHomeCapability({ enabled: false, reason: 'indexing' });

        const hook = await renderScopedProviderHook({ serverId: 'srv_home_b', machineId: null });

        expect(hook.getCurrent()).toEqual({
            provider: 'home',
            homeServerId: 'srv_home_b',
            homeReadiness: 'indexing',
            daemonTarget: null,
            queryAvailable: false,
            unavailableReason: 'home_indexing',
        });
    });

    it('keeps the admitted Home state honest when no daemon target is usable', async () => {
        daemonTargetState.target = null;
        setReadyHomeCapability({ enabled: false, reason: 'indexing' });
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'home',
            homeServerId: 'srv_home',
            homeReadiness: 'indexing',
            daemonTarget: null,
            queryAvailable: false,
            unavailableReason: 'home_indexing',
        });
    });

    it('falls back to daemon for unsupported or malformed Home capabilities', async () => {
        for (const homeSearch of [
            { enabled: true, provider: 'home' },
            { enabled: true, unsupported: true },
        ]) {
            setReadyHomeCapability(homeSearch);
            const hook = await renderProviderHook();
            expect(hook.getCurrent()).toEqual({
                provider: 'daemon',
                homeServerId: null,
                homeReadiness: null,
                daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
                queryAvailable: true,
                unavailableReason: null,
            });
        }
    });

    it('stays on daemon when no focused Home target resolves', async () => {
        setReadyHomeCapability({ enabled: true });
        activeServerState.serverId = '';
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'daemon',
            homeServerId: null,
            homeReadiness: null,
            daemonTarget: { serverId: 'srv_daemon', machineId: 'machine_1' },
            queryAvailable: true,
            unavailableReason: null,
        });
    });
});
