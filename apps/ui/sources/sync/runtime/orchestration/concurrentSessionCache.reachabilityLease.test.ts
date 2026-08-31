import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerProfilesModuleMock } from '@/dev/testkit';

type DeferredLease = Readonly<{
    release: ReturnType<typeof vi.fn<() => Promise<void>>>;
    resolve: () => void;
}>;

async function flushPromiseContinuations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function createDeferredLease(): Readonly<{
    lease: DeferredLease;
    promise: Promise<{ release: () => Promise<void> }>;
}> {
    let resolvePromise!: (lease: { release: () => Promise<void> }) => void;
    const release = vi.fn(async () => {});
    const promise = new Promise<{ release: () => Promise<void> }>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        lease: {
            release,
            resolve: () => resolvePromise({ release }),
        },
        promise,
    };
}

async function installHarness() {
    let profiles = [
        { id: 'server-a', serverUrl: 'https://stack-a.example.test', name: 'Server A' },
        { id: 'server-b', serverUrl: 'https://stack-b.example.test', name: 'Server B' },
    ];
    let credentials = { token: 'token-b-old', secret: 'secret-b-old' };
    const profileListeners = new Set<(generation: number) => void>();
    const credentialListeners = new Set<() => void>();
    let networkAllowedListener: ((allowed: boolean) => void) | null = null;
    const pendingAcquires: DeferredLease[] = [];
    const createSocketTransport = vi.fn();

    vi.doMock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', () => ({
        acquireServerReachabilitySupervisor: vi.fn(() => {
            const deferred = createDeferredLease();
            pendingAcquires.push(deferred.lease);
            return deferred.promise;
        }),
        subscribeServerReachabilityNetworkAllowed: (listener: (allowed: boolean) => void) => {
            networkAllowedListener = listener;
            listener(true);
            return () => {
                if (networkAllowedListener === listener) networkAllowedListener = null;
            };
        },
        subscribeServerReachabilityState: () => () => {},
        setServerReachabilityNetworkAllowed: () => {},
        reportServerUnreachable: () => {},
        resetServerReachabilitySupervisors: async () => {},
    }));
    vi.doMock('@/auth/storage/tokenStorage', () => ({
        TokenStorage: {
            getCredentialsForServerUrl: vi.fn(async () => credentials),
        },
        subscribeHomeCredentialMutations: (listener: () => void) => {
            credentialListeners.add(listener);
            return () => credentialListeners.delete(listener);
        },
        isLegacyAuthCredentials: () => true,
        isDataKeyAuthCredentials: () => false,
        isTokenOnlyAuthCredentials: () => false,
    }));
    vi.doMock('@/sync/domains/server/serverProfiles', () => createServerProfilesModuleMock({
        listServerProfiles: () => profiles,
        overrides: {
            loadHomeViewState: () => null,
            subscribeHomeViewState: () => () => {},
            subscribeServerProfiles: (listener) => {
                profileListeners.add(listener);
                return () => profileListeners.delete(listener);
            },
        },
    }));
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: () => ({
            serverId: 'server-a',
            serverUrl: 'https://stack-a.example.test',
            kind: 'stack',
            generation: 1,
        }),
        subscribeActiveServer: () => () => {},
    }));
    vi.doMock('./concurrentServerConnections/createConcurrentServerSocketTransport', () => ({
        createConcurrentServerSocketTransport: (...args: unknown[]) => createSocketTransport(...args),
    }));
    vi.doMock('@/sync/engine/account/syncAccount', () => ({
        schedulePushTokenReconciliation: () => {},
        startPushTokenReconciliation: () => {},
        stopPushTokenReconciliation: () => {},
    }));
    vi.doMock('@/utils/runtime/isRuntimeActive', () => ({
        startRuntimeActiveGatedInterval: () => () => {},
    }));
    vi.doMock('@/sync/domains/transfers/runtime/transferRouteCache', () => ({
        invalidateCachedTransferRoutesForMachine: () => {},
        invalidateCachedTransferRoutesForServer: () => {},
    }));

    const { storage } = await import('@/sync/domains/state/storageStore');
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    storage.setState((state) => ({
        ...state,
        settings: {
            ...state.settings,
            ...settingsDefaults,
            serverSelectionGroups: [{
                id: 'group-main',
                name: 'Main',
                serverIds: ['server-a', 'server-b'],
                presentation: 'grouped',
            }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'group-main',
        },
    }));

    const cache = await import('./concurrentSessionCache');
    cache.startConcurrentSessionCacheSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingAcquires).toHaveLength(1);

    return {
        ...cache,
        createSocketTransport,
        pendingAcquires,
        removeSecondaryProfile: async () => {
            profiles = profiles.filter((profile) => profile.id !== 'server-b');
            for (const listener of profileListeners) listener(1);
            await vi.advanceTimersByTimeAsync(0);
        },
        replaceSecondaryCredentials: async () => {
            credentials = { token: 'token-b-new', secret: 'secret-b-new' };
            for (const listener of credentialListeners) listener();
            await vi.advanceTimersByTimeAsync(0);
        },
        resumeNetworkTwice: () => {
            networkAllowedListener?.(true);
            networkAllowedListener?.(true);
        },
    };
}

describe('concurrentSessionCache reachability lease fencing', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT = '1';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        delete process.env.EXPO_PUBLIC_HAPPY_MULTI_SERVER_CONCURRENT;
    });

    it('releases an acquire that resolves after the cache stops without starting authenticated supervision', async () => {
        const harness = await installHarness();
        const [staleAcquire] = harness.pendingAcquires;

        harness.stopConcurrentSessionCacheSync();
        staleAcquire.resolve();
        await flushPromiseContinuations();

        expect(staleAcquire.release).toHaveBeenCalledTimes(1);
        expect(harness.createSocketTransport).not.toHaveBeenCalled();
    });

    it('releases an acquire that resolves after its secondary profile is removed', async () => {
        const harness = await installHarness();
        const [staleAcquire] = harness.pendingAcquires;

        await harness.removeSecondaryProfile();
        staleAcquire.resolve();
        await flushPromiseContinuations();

        expect(staleAcquire.release).toHaveBeenCalledTimes(1);
        expect(harness.createSocketTransport).not.toHaveBeenCalled();
        harness.stopConcurrentSessionCacheSync();
    });

    it('releases the old acquire after credential replacement and retains only the replacement lease', async () => {
        const harness = await installHarness();
        const [staleAcquire] = harness.pendingAcquires;

        await harness.replaceSecondaryCredentials();
        expect(harness.pendingAcquires).toHaveLength(2);
        const replacementAcquire = harness.pendingAcquires[1];

        staleAcquire.resolve();
        replacementAcquire.resolve();
        await flushPromiseContinuations();
        expect(staleAcquire.release).toHaveBeenCalledTimes(1);
        expect(replacementAcquire.release).not.toHaveBeenCalled();

        harness.stopConcurrentSessionCacheSync();
        await flushPromiseContinuations();
        expect(replacementAcquire.release).toHaveBeenCalledTimes(1);
        expect(harness.createSocketTransport).not.toHaveBeenCalled();
    });

    it('releases an older repeated-resume acquire when a newer acquire completes first', async () => {
        const harness = await installHarness();
        const initialAcquire = harness.pendingAcquires[0];
        initialAcquire.resolve();
        await Promise.resolve();

        harness.resumeNetworkTwice();
        expect(harness.pendingAcquires).toHaveLength(3);
        const olderResumeAcquire = harness.pendingAcquires[1];
        const newestResumeAcquire = harness.pendingAcquires[2];

        newestResumeAcquire.resolve();
        await flushPromiseContinuations();
        expect(initialAcquire.release).toHaveBeenCalledTimes(1);
        olderResumeAcquire.resolve();
        await flushPromiseContinuations();
        expect(olderResumeAcquire.release).toHaveBeenCalledTimes(1);
        expect(newestResumeAcquire.release).not.toHaveBeenCalled();

        harness.stopConcurrentSessionCacheSync();
        await flushPromiseContinuations();
        expect(newestResumeAcquire.release).toHaveBeenCalledTimes(1);
    });
});
