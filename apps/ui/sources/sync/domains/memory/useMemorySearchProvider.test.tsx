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
    useServerFeaturesRuntimeSnapshot: () => featureRuntimeState.snapshot,
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
    standardCleanup();
});

async function renderProviderHook() {
    const { useMemorySearchProvider } = await import('./useMemorySearchProvider');
    return renderHook(() => useMemorySearchProvider());
}

describe('useMemorySearchProvider', () => {
    it('keeps a classified plaintext Personal Home on Home when the optional capability is missing', async () => {
        const hook = await renderProviderHook();
        expect(hook.getCurrent()).toEqual({
            provider: 'home',
            homeReadiness: 'unknown',
            queryAvailable: false,
        });
    });

    it('keeps a classified Personal Home on Home while its optional capability is indexing or unavailable', async () => {
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

    it('stays on daemon for non-desktop-personal-home profiles even with a plaintext_only policy', async () => {
        for (const source of ['manual', 'qr', 'account-directory', 'preconfigured', undefined]) {
            serverProfilesState.profile = {
                id: 'srv_home',
                name: 'Other Home',
                serverUrl: 'https://other.example.test',
                ...(source === undefined ? {} : { source }),
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
