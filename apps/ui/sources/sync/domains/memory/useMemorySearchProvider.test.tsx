import * as React from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const activeServerState = vi.hoisted(() => ({ serverId: 'srv_home' as string }));
const serverProfilesState = vi.hoisted(() => ({
    profile: {
        id: 'srv_home',
        name: 'Personal Home',
        serverUrl: 'https://home.example.test',
        source: 'desktop-personal-home' as string | undefined,
    } as Record<string, unknown> | null,
}));
const featureRuntimeState = vi.hoisted(() => ({ snapshot: { status: 'loading' } as unknown }));
const featureRuntimeOptionsSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: activeServerState.serverId, serverUrl: '', generation: 1 }),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 1,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getServerProfileById: () => serverProfilesState.profile,
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: (options?: unknown) => {
        featureRuntimeOptionsSpy(options);
        return featureRuntimeState.snapshot;
    },
}));

afterEach(() => {
    activeServerState.serverId = 'srv_home';
    serverProfilesState.profile = {
        id: 'srv_home',
        name: 'Personal Home',
        serverUrl: 'https://home.example.test',
        source: 'desktop-personal-home',
    };
    featureRuntimeState.snapshot = { status: 'loading' };
    featureRuntimeOptionsSpy.mockReset();
    standardCleanup();
});

async function renderProviderHook() {
    const { useMemorySearchProvider } = await import('./useMemorySearchProvider');
    return renderHook(() => useMemorySearchProvider());
}

describe('useMemorySearchProvider', () => {
    it('falls back to daemon when the active Home capability is missing', async () => {
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'daemon',
            homeReadiness: null,
            queryAvailable: true,
        });
        expect(featureRuntimeOptionsSpy).toHaveBeenCalledWith({ enabled: true });
    });

    it('chooses Home for adopted profiles from the strict active-Home capability, independent of provenance', async () => {
        featureRuntimeState.snapshot = {
            status: 'ready',
            features: {
                capabilities: {
                    homeSearch: { enabled: true, provider: 'home' },
                },
            },
        };

        for (const source of ['account-directory', 'manual']) {
            serverProfilesState.profile = {
                id: 'srv_home',
                name: 'Adopted Home',
                serverUrl: 'https://home.example.test',
                source,
            };
            const hook = await renderProviderHook();
            expect(hook.getCurrent()).toEqual({
                provider: 'home',
                homeReadiness: 'ready',
                queryAvailable: true,
            });
        }
    });

    it('keeps Home ownership while its strict capability reports indexing or unavailable', async () => {
        featureRuntimeState.snapshot = {
            status: 'ready',
            features: {
                capabilities: {
                    homeSearch: { enabled: false, provider: 'home', reason: 'indexing' },
                },
            },
        };
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'home',
            homeReadiness: 'indexing',
            queryAvailable: false,
        });

        featureRuntimeState.snapshot = {
            status: 'ready',
            features: {
                capabilities: {
                    homeSearch: { enabled: false, provider: 'home', reason: 'index_unavailable' },
                },
            },
        };
        const unavailableHook = await renderProviderHook();
        expect(unavailableHook.getCurrent()).toEqual({
            provider: 'home',
            homeReadiness: 'unavailable',
            queryAvailable: false,
        });
    });

    it('falls back to daemon for unsupported or malformed Home capabilities', async () => {
        for (const homeSearch of [
            { enabled: true, provider: 'future-provider' },
            { enabled: true, provider: 'home', unsupported: true },
        ]) {
            featureRuntimeState.snapshot = {
                status: 'ready',
                features: { capabilities: { homeSearch } },
            };
            const hook = await renderProviderHook();
            expect(hook.getCurrent()).toEqual({
                provider: 'daemon',
                homeReadiness: null,
                queryAvailable: true,
            });
        }
    });

    it('stays on daemon when no active profile resolves', async () => {
        serverProfilesState.profile = null;
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'daemon',
            homeReadiness: null,
            queryAvailable: true,
        });
    });
});
