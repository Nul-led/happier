import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createDeferred, renderScreen } from '@/dev/testkit';

const mocks = vi.hoisted(() => ({
    getCredentials: vi.fn(async () => null),
    getCredentialsForServerUrl: vi.fn(),
    syncSwitchServer: vi.fn(async () => undefined),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: mocks.getCredentials,
        getCredentialsForServerUrl: mocks.getCredentialsForServerUrl,
    },
}));

vi.mock('@/sync/sync', () => ({
    sync: { retryNow: vi.fn() },
    syncRestore: vi.fn(async () => undefined),
    syncSwitchServer: mocks.syncSwitchServer,
}));

vi.mock('@/sync/http/client', () => ({
    abortServerFetches: vi.fn(),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    getIrohHomeTunnelRuntime: () => ({
        releaseActiveHomeTunnels: vi.fn(async () => undefined),
        releaseLeasesForStaleTargets: vi.fn(async () => undefined),
        subscribeRecoveryRequired: vi.fn(() => () => {}),
    }),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/fallback', () => ({
    classifyIrohHomeTunnelSwitchFailure: () => ({ fallbackAllowed: false }),
}));

vi.mock('@/sync/runtime/orchestration/concurrentSessionCache', () => ({
    startConcurrentSessionCacheSync: vi.fn(),
    stopConcurrentSessionCacheSync: vi.fn(),
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/track', () => ({
    trackLogout: vi.fn(),
}));

function randomScope(): string {
    return `auth_connection_race_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

describe('AuthContext with the production connection manager', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        vi.clearAllMocks();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('keeps Home B credentials when B is requested while Home A already-applied credentials are still loading', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        vi.stubGlobal('window', { location: { origin: 'https://origin.example.test' } });
        vi.stubGlobal('document', {});

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const homeA = profiles.upsertServerProfile({
            serverUrl: 'https://a.example.test',
            name: 'Home A',
        });
        const homeB = profiles.upsertServerProfile({
            serverUrl: 'https://b.example.test',
            name: 'Home B',
        });
        profiles.setActiveServerId(homeA.id, { scope: 'device' });

        const homeACredentials = { token: 'token-a', secret: 'secret-a' };
        const homeBCredentials = { token: 'token-b', secret: 'secret-b' };
        const staleCredentialReadStarted = createDeferred<void>();
        const releaseStaleCredentialRead = createDeferred<void>();
        let homeACredentialReads = 0;
        mocks.getCredentialsForServerUrl.mockImplementation(async (serverUrl: string) => {
            if (serverUrl === homeA.serverUrl) {
                homeACredentialReads += 1;
                if (homeACredentialReads === 3) {
                    staleCredentialReadStarted.resolve();
                    await releaseStaleCredentialRead.promise;
                }
                return homeACredentials;
            }
            return homeBCredentials;
        });

        const connection = await import('@/sync/runtime/orchestration/connectionManager');
        await connection.switchConnectionToActiveServer();
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: homeACredentials,
            children: React.createElement(React.Fragment, null),
        }));

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected AuthContext to be mounted');
            const staleRefresh = auth.refreshFromActiveServer();
            await staleCredentialReadStarted.promise;

            profiles.setActiveServerId(homeB.id, { scope: 'device' });
            const newerRefresh = auth.refreshFromActiveServer();
            releaseStaleCredentialRead.resolve();

            await act(async () => {
                await Promise.all([staleRefresh, newerRefresh]);
            });

            expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: true,
                credentials: homeBCredentials,
            });
            expect(mocks.syncSwitchServer).toHaveBeenLastCalledWith(homeBCredentials);
        } finally {
            releaseStaleCredentialRead.resolve();
            await screen.unmount();
        }
    });
});
