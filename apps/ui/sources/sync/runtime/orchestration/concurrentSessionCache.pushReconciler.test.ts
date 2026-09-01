import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerPushToken: vi.fn(),
    deletePushToken: vi.fn(),
    getCredentialsForServerUrl: vi.fn(),
    readPushPermission: vi.fn(),
    credentialMutationListeners: new Set<() => void>(),
    expoPushTokenListeners: new Set<() => void>(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});

vi.mock('@/config', () => ({
    config: { enableDevPushTokenRegistration: true },
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/activity/notifications/permission/pushNotificationAccess', () => ({
    readPushPermission: (...args: unknown[]) => mocks.readPushPermission(...args),
    readExpoPushToken: async () => ({ ok: true as const, token: 'ExponentPushToken[device]' }),
    subscribeExpoPushTokenChanges: async (listener: () => void) => {
        mocks.expoPushTokenListeners.add(listener);
        return () => mocks.expoPushTokenListeners.delete(listener);
    },
}));

vi.mock('@/sync/api/session/apiPush', () => ({
    registerPushToken: (...args: unknown[]) => mocks.registerPushToken(...args),
    deletePushToken: (...args: unknown[]) => mocks.deletePushToken(...args),
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: async (params: { url: string }) => {
        if (params.url.endsWith('/v1/account/encryption')) {
            return Response.json({ mode: 'plain', updatedAt: 1 });
        }
        if (params.url.endsWith('/v2/account/settings')) {
            return Response.json({
                content: { t: 'plain', v: {} },
                version: 1,
            });
        }
        return Response.json({ success: true });
    },
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: (...args: unknown[]) => mocks.getCredentialsForServerUrl(...args),
    },
    subscribeHomeCredentialMutations: (listener: () => void) => {
        mocks.credentialMutationListeners.add(listener);
        return () => {
            mocks.credentialMutationListeners.delete(listener);
        };
    },
    isLegacyAuthCredentials: () => true,
    isDataKeyAuthCredentials: () => false,
    isTokenOnlyAuthCredentials: () => false,
}));

const profiles = [
    {
        id: 'home-a',
        name: 'Home A',
        serverUrl: 'https://home-a.example.test',
        serverIdentityId: 'srv_home_a',
    },
];

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    listServerProfiles: () => profiles,
    loadHomeViewState: () => null,
    subscribeHomeViewState: () => () => {},
    subscribeServerProfiles: () => () => {},
    resolveServerProfileScopeId: (profile: typeof profiles[number]) => profile.serverIdentityId,
    areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left ?? '') === String(right ?? ''),
}));

// Device-level lifecycle fixture: mounted without any focused Sync runtime.
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: null, serverUrl: '', generation: 0 }),
    subscribeActiveServer: () => () => {},
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', () => ({
    acquireServerReachabilitySupervisor: vi.fn(async () => ({
        release: vi.fn(async () => undefined),
    })),
    subscribeServerReachabilityNetworkAllowed: () => () => {},
    setServerReachabilityNetworkAllowed: vi.fn(),
    subscribeServerReachabilityState: () => () => {},
    startServerReachabilitySupervisor: vi.fn(async () => undefined),
    stopServerReachabilitySupervisor: vi.fn(async () => undefined),
    reportServerUnreachable: vi.fn(),
    peekServerReachabilityToken: () => null,
    invalidateServerReachabilitySupervisor: async () => {},
    waitForServerReachable: async () => {},
    ServerReachabilityWaitTimeoutError: class ServerReachabilityWaitTimeoutError extends Error {},
    resetServerReachabilitySupervisors: async () => {},
}));

vi.mock('@/sync/runtime/nativeIrohTunnels', () => ({
    acquireIrohHomeRuntimeOrigin: vi.fn(async () => {
        throw new Error('no iroh endpoint in this fixture');
    }),
    classifyIrohHomeTunnelSwitchFailure: () => ({
        fallbackAllowed: false,
        failureClass: 'carrier-unavailable',
    }),
    subscribeIrohHomeTunnelRecoveryRequired: () => () => {},
}));

vi.mock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
    startNativeSshTunnelRuntimeAppStateLifecycle: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

vi.mock('@/sync/engine/sessions/sessionSnapshot', () => ({
    fetchAndApplySessions: vi.fn(async () => undefined),
}));

vi.mock('@/sync/engine/machines/syncMachines', () => ({
    fetchAndApplyMachines: vi.fn(async () => undefined),
}));

let stopLifecycle: (() => void) | null = null;

async function flushSchedulerTurn(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('device-level push token reconciliation lifecycle', () => {
    beforeEach(() => {
        mocks.registerPushToken.mockReset();
        mocks.deletePushToken.mockReset();
        mocks.getCredentialsForServerUrl.mockReset();
        mocks.readPushPermission.mockReset();
        mocks.readPushPermission.mockResolvedValue({
            ok: true as const,
            permission: { granted: true, status: 'granted', canAskAgain: true },
        });
        mocks.getCredentialsForServerUrl.mockResolvedValue({ token: 'home-a-token', secret: 's' });
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);
        mocks.credentialMutationListeners.clear();
        mocks.expoPushTokenListeners.clear();
    });

    afterEach(() => {
        stopLifecycle?.();
        stopLifecycle = null;
    });

    it('runs reconciliation from the mounted device lifecycle without an authenticated focused Sync', async () => {
        const concurrentModule = await import('./concurrentSessionCache');
        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = concurrentModule;
        const { schedulePushTokenReconciliation } = await import('@/sync/engine/account/syncAccount');
        stopLifecycle = stopConcurrentSessionCacheSync;

        startConcurrentSessionCacheSync();
        schedulePushTokenReconciliation();

        await flushSchedulerTurn();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
        expect(mocks.registerPushToken).toHaveBeenCalledWith(
            { token: 'home-a-token', secret: 's' },
            'ExponentPushToken[device]',
            expect.objectContaining({
                apiEndpoint: 'https://home-a.example.test',
                clientServerUrl: 'https://home-a.example.test',
                serverId: 'srv_home_a',
            }),
        );
        expect(mocks.deletePushToken).not.toHaveBeenCalled();
    }, 60_000);

    it('coalesces concurrent triggers into one registration run', async () => {
        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        const { schedulePushTokenReconciliation } = await import('@/sync/engine/account/syncAccount');
        stopLifecycle = stopConcurrentSessionCacheSync;

        startConcurrentSessionCacheSync();
        schedulePushTokenReconciliation();
        schedulePushTokenReconciliation();
        schedulePushTokenReconciliation();

        await flushSchedulerTurn();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
        await flushSchedulerTurn();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });

    it('schedules a run when a Home credential mutation arrives after mount', async () => {
        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        const { schedulePushTokenReconciliation } = await import('@/sync/engine/account/syncAccount');
        stopLifecycle = stopConcurrentSessionCacheSync;

        startConcurrentSessionCacheSync();
        await flushSchedulerTurn();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
        mocks.registerPushToken.mockClear();

        expect(mocks.credentialMutationListeners.size).toBeGreaterThan(0);
        for (const listener of mocks.credentialMutationListeners) {
            listener();
        }

        await flushSchedulerTurn();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });

    it('schedules a fresh canonical read when Expo reports an in-process push-token change', async () => {
        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        stopLifecycle = stopConcurrentSessionCacheSync;
        mocks.readPushPermission.mockResolvedValue({
            ok: true as const,
            permission: { granted: false, status: 'denied', canAskAgain: true },
        });

        startConcurrentSessionCacheSync();
        await vi.waitFor(() => expect(mocks.readPushPermission).toHaveBeenCalledTimes(1));
        mocks.readPushPermission.mockClear();

        await vi.waitFor(() => expect(mocks.expoPushTokenListeners.size).toBe(1));
        for (const listener of mocks.expoPushTokenListeners) listener();

        await vi.waitFor(() => expect(mocks.readPushPermission).toHaveBeenCalledTimes(1));
        expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it('does not run or stay scheduled after the device lifecycle stops', async () => {
        const { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } = await import('./concurrentSessionCache');
        const { schedulePushTokenReconciliation } = await import('@/sync/engine/account/syncAccount');

        startConcurrentSessionCacheSync();
        stopConcurrentSessionCacheSync();
        stopLifecycle = null;

        schedulePushTokenReconciliation();
        await flushSchedulerTurn();

        expect(mocks.registerPushToken).not.toHaveBeenCalled();
        expect(mocks.expoPushTokenListeners.size).toBe(0);
    });
});
