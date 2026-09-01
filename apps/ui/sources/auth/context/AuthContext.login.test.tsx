import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

const secureStore = vi.hoisted(() => new Map<string, string>());
const syncSwitchServerSpy = vi.hoisted(() =>
    vi.fn((credentials: { token: string; secret: string } | null) => {
        if (!credentials) return Promise.resolve();
        return new Promise<void>(() => {});
    }),
);
const switchConnectionToActiveServerSpy = vi.hoisted(() => vi.fn(
    async (): Promise<{ token: string; secret?: string } | null> => null,
));
const activeServerSnapshotState = vi.hoisted(() => ({
    serverId: '',
    serverUrl: '',
    generation: 0,
    connectionDescriptorRevision: undefined as number | undefined,
}));
const nextServerSequenceState = vi.hoisted(() => ({ value: 0 }));
const serverProfilesState = vi.hoisted(() => ({
    profiles: [] as Array<{ id: string; serverUrl: string; name: string; serverIdentityId?: string }>,
}));
let activeServerListener: ((snapshot: {
    serverId: string;
    serverUrl: string;
    generation: number;
    connectionDescriptorRevision?: number;
}) => void) | null = null;
vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => secureStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        secureStore.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
        secureStore.delete(key);
    },
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: {
        onSessionFocus: vi.fn(),
        onSessionOffline: vi.fn(),
        onSessionOnline: vi.fn(),
        onMessages: vi.fn(),
        reportContextualUpdate: vi.fn(),
    },
}));

vi.mock('@/track', () => ({
    trackLogout: vi.fn(),
    initializeTracking: vi.fn(),
    tracking: null,
}));

vi.mock('@/sync/sync', () => ({
    syncSwitchServer: syncSwitchServerSpy,
}));

// Network boundary: these tests own AuthContext credential/focus behavior, not
// reachability supervision. Fake timers would otherwise park the supervisor's
// probe loop indefinitely before the injected fetch boundary is reached.
vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: async ({
        url,
        init,
    }: Readonly<{ url: string; init: RequestInit }>) => await fetch(url, init),
}));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    switchConnectionToActiveServer: switchConnectionToActiveServerSpy,
    getAppliedActiveServerId: () => activeServerSnapshotState.serverId,
    subscribeAppliedActiveServer: () => () => {},
    subscribeApplyingActiveServer: () => () => {},
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ ...activeServerSnapshotState }),
    upsertAndActivateServer: ({ serverUrl }: { serverUrl: string }) => {
        nextServerSequenceState.value += 1;
        activeServerSnapshotState.serverId = `server-${nextServerSequenceState.value}`;
        activeServerSnapshotState.serverUrl = serverUrl;
        activeServerSnapshotState.generation += 1;
        return {
            id: activeServerSnapshotState.serverId,
            serverUrl,
        };
    },
    subscribeActiveServer: (listener: unknown) => {
        // AuthProvider and the concurrent secondary-Home runtime both subscribe.
        // These tests drive the first (AuthContext) subscriber explicitly.
        activeServerListener ??= listener as typeof activeServerListener;
        return () => {
            if (activeServerListener === listener) {
                activeServerListener = null;
            }
        };
    },
}));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getActiveServerId: () => activeServerSnapshotState.serverId,
    getActiveServerUrl: () => activeServerSnapshotState.serverUrl,
    listServerProfiles: () => serverProfilesState.profiles,
}));

function buildTokenWithSub(sub: string): string {
    const payload = Buffer.from(JSON.stringify({ sub })).toString('base64');
    return `hdr.${payload}.sig`;
}

describe('AuthContext.login', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        secureStore.clear();
        activeServerListener = null;
        activeServerSnapshotState.serverId = '';
        activeServerSnapshotState.serverUrl = '';
        activeServerSnapshotState.generation = 0;
        activeServerSnapshotState.connectionDescriptorRevision = undefined;
        nextServerSequenceState.value = 0;
        serverProfilesState.profiles = [];
        syncSwitchServerSpy.mockClear();
        switchConnectionToActiveServerSpy.mockReset();
        switchConnectionToActiveServerSpy.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('resolves without waiting for syncSwitchServer to finish', async () => {
        // Make sync's initial HTTP work hang so `syncSwitchServer` cannot complete until timers advance.
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: null,
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await act(async () => {
                await auth.login(buildTokenWithSub('server-test'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            });
            await vi.advanceTimersByTimeAsync(1);
            expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(1);
            expect(syncSwitchServerSpy).not.toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
        } finally {
            await screen.unmount();
        }
    });

    it('keeps the session authenticated while a login-triggered server refresh is still rebinding credentials', async () => {
        switchConnectionToActiveServerSpy.mockImplementation(
            () => new Promise<null>(() => {}),
        );
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: null,
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');
            await vi.waitFor(() => {
                expect(activeServerListener).toBeTypeOf('function');
            });

            const loginPromise = act(async () => {
                await auth.login(buildTokenWithSub('server-test'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            });
            await loginPromise;

            expect(getCurrentAuth()?.isAuthenticated).toBe(true);

            await act(async () => {
                activeServerListener?.({
                    serverId: 'server-test',
                    serverUrl: 'http://localhost:53288',
                    generation: 1,
                });
            });

            expect(getCurrentAuth()?.isAuthenticated).toBe(true);
        } finally {
            await screen.unmount();
        }
    });

    it('rebinds the same focused Home when its connection descriptor revision changes', async () => {
        vi.useRealTimers();
        const credentials = { token: buildTokenWithSub('server-test'), secret: 'secret-test' };
        activeServerSnapshotState.serverId = 'server-test';
        activeServerSnapshotState.serverUrl = 'http://localhost:53288';
        activeServerSnapshotState.generation = 1;
        activeServerSnapshotState.connectionDescriptorRevision = 1;
        switchConnectionToActiveServerSpy.mockResolvedValue(credentials);
        const { AuthProvider } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: credentials,
            children: React.createElement(React.Fragment, null),
        }));
        try {
            await vi.waitFor(() => expect(activeServerListener).toBeTypeOf('function'));
            activeServerSnapshotState.generation = 2;
            activeServerSnapshotState.connectionDescriptorRevision = 2;
            await act(async () => {
                activeServerListener?.({
                    serverId: 'server-test',
                    serverUrl: 'http://localhost:53288',
                    generation: 2,
                    connectionDescriptorRevision: 2,
                });
                await Promise.resolve();
            });

            await vi.waitFor(() => expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(1));
        } finally {
            await screen.unmount();
        }
    });

    it('clears stale auth state when the active server changes during a login-triggered rebind', async () => {
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: null,
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');
            await vi.waitFor(() => {
                expect(activeServerListener).toBeTypeOf('function');
            });

            await act(async () => {
                await auth.login(buildTokenWithSub('server-test'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            });

            expect(getCurrentAuth()?.isAuthenticated).toBe(true);

            upsertAndActivateServer({ serverUrl: 'http://localhost:59876', scope: 'tab' });
            await act(async () => {
                await auth.refreshFromActiveServer();
            });

            expect(switchConnectionToActiveServerSpy).toHaveBeenCalled();
            expect(getCurrentAuth()?.isAuthenticated).toBe(false);
            expect(getCurrentAuth()?.credentials).toBeNull();
        } finally {
            await screen.unmount();
        }
    });

    it('replaces persisted and in-memory E2EE credentials with a token-only credential', async () => {
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        const initialCredentials = {
            token,
            encryption: {
                publicKey: 'account-public-key',
                machineKey: 'account-machine-key',
            },
        };
        await TokenStorage.setCredentials(initialCredentials);
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials,
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await act(async () => {
                await expect(auth.loginWithCredentials({ token }))
                    .resolves.toEqual({ kind: 'completed' });
            });

            expect(await TokenStorage.getCredentials()).toEqual({ token });
            expect(getCurrentAuth()?.credentials).toEqual({ token });
            expect(getCurrentAuth()?.isAuthenticated).toBe(true);
            expect(switchConnectionToActiveServerSpy).toHaveBeenCalled();
        } finally {
            await screen.unmount();
        }
    });

    it('keeps the mobile brand hero dismissed after logout', async () => {
        const seenAt = 1_789_222_000_000;
        const { localSettingsDefaults } = await import('@/sync/domains/settings/localSettings');
        const { clearPersistence, loadLocalSettings, saveLocalSettings } = await import('@/sync/domains/state/persistence');
        clearPersistence();
        saveLocalSettings({
            ...localSettingsDefaults,
            brandHeroSeenAt: seenAt,
        });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');

        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token: buildTokenWithSub('server-test'), secret: 'secret-test' },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await act(async () => {
                await auth.logout();
            });

            expect(loadLocalSettings().brandHeroSeenAt).toBe(seenAt);
            expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(1);
            expect(getCurrentAuth()).toMatchObject({ isAuthenticated: false, credentials: null });
        } finally {
            await screen.unmount();
            clearPersistence();
        }
    });

    it('runs the authorized pre-mutation callback immediately before destructive logout', async () => {
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        await TokenStorage.setCredentials({ token });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const { trackLogout } = await import('@/track');
        const beforeMutation = vi.fn();
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            let result;
            await act(async () => {
                result = await auth.logout({
                    beforeMutation,
                });
            });
            expect(result).toEqual({
                kind: 'completed',
            });

            expect(beforeMutation).toHaveBeenCalledTimes(1);
            expect(trackLogout).toHaveBeenCalledTimes(1);
            expect(
                beforeMutation.mock.invocationCallOrder[0],
            ).toBeLessThan(
                vi.mocked(trackLogout).mock.invocationCallOrder[0]!,
            );
            expect(getCurrentAuth()?.isAuthenticated).toBe(false);
        } finally {
            await screen.unmount();
        }
    });

    it('blocks logout before any auth mutation while marked first-key custody is active', async () => {
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        await TokenStorage.setCredentials({ token });
        await expect(TokenStorage.setPendingExternalAuth({
            provider: 'github',
            proof: 'proof',
            secret: 'secret',
            serverId: activeServerSnapshotState.serverId,
            serverUrl: activeServerSnapshotState.serverUrl,
            accountEncryptionFirstKey: {
                accountId: 'account-test',
                requestDigest: `aemrb1_${'A'.repeat(43)}`,
                requestJson: '{}',
                pending: 'pending',
                createdAt: Date.now(),
                expiresAt: Date.now() + 60_000,
                migrationSubmissionAttempted: true,
            },
        })).resolves.toBe(true);
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toMatchObject({
            serverMismatch: false,
            value: {
                accountEncryptionFirstKey: {
                    migrationSubmissionAttempted: true,
                },
            },
        });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const { abandonAccountEncryptionFirstKeyExternalAuth } = await import(
            '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth'
        );
        const { trackLogout } = await import('@/track');
        let recovery: Parameters<typeof abandonAccountEncryptionFirstKeyExternalAuth>[0] | null = null;
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');
            const logoutCallsBefore =
                vi.mocked(trackLogout).mock.calls.length;
            const beforeMutation = vi.fn();
            const result = await auth.logout({
                beforeMutation,
            });

            expect(result).toMatchObject({ kind: 'finish_encryption_setup' });
            expect(beforeMutation).not.toHaveBeenCalled();
            expect(vi.mocked(trackLogout).mock.calls.length)
                .toBe(logoutCallsBefore);
            expect(syncSwitchServerSpy).not.toHaveBeenCalledWith(null);
            expect(await TokenStorage.getCredentials()).toEqual({ token });
            expect(getCurrentAuth()?.isAuthenticated).toBe(true);
            if (result.kind !== 'finish_encryption_setup') {
                throw new Error('Expected first-key custody recovery');
            }
            recovery = result.recovery;
        } finally {
            if (recovery) {
                await expect(
                    abandonAccountEncryptionFirstKeyExternalAuth(recovery),
                ).resolves.toEqual({ kind: 'abandoned' });
                await expect(TokenStorage.readPendingExternalAuthState()).resolves.toEqual({
                    value: null,
                    serverMismatch: false,
                });
            }
            await screen.unmount();
        }
    });

    it('does not mutate auth state when the authorized pre-mutation callback fails', async () => {
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        await TokenStorage.setCredentials({ token });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const { trackLogout } = await import('@/track');
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');
            const logoutCallsBefore =
                vi.mocked(trackLogout).mock.calls.length;

            await expect(auth.logout({
                beforeMutation: () => {
                    throw new Error('navigation failed');
                },
            })).rejects.toThrow('navigation failed');

            expect(vi.mocked(trackLogout).mock.calls.length)
                .toBe(logoutCallsBefore);
            expect(syncSwitchServerSpy).not.toHaveBeenCalledWith(null);
            expect(await TokenStorage.getCredentials()).toEqual({ token });
            expect(getCurrentAuth()?.isAuthenticated).toBe(true);
        } finally {
            await screen.unmount();
        }
    });

    it('awaits an authorized asynchronous pre-mutation callback before deleting local credentials', async () => {
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        await TokenStorage.setCredentials({ token });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const beforeMutation = vi.fn(async () => await pending);
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');
            const logout = auth.logout({ beforeMutation });
            await vi.waitFor(() => expect(beforeMutation).toHaveBeenCalledTimes(1));

            expect(await TokenStorage.getCredentials()).toEqual({ token });
            expect(getCurrentAuth()?.isAuthenticated).toBe(true);

            await act(async () => {
                release();
                await logout;
            });
            expect(getCurrentAuth()?.isAuthenticated).toBe(false);
        } finally {
            await screen.unmount();
        }
    });

    it('logs out only the focused Home while preserving another Home and Account Service credentials', async () => {
        const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'DELETE' && String(input).includes('home-a')) {
                throw new Error('home a cleanup unavailable');
            }
            return Response.json({ success: true });
        });
        vi.stubGlobal('fetch', fetchSpy);
        serverProfilesState.profiles = [
            { id: 'home-a', serverUrl: 'https://home-a.example.test', name: 'Home A', serverIdentityId: 'srv_logout_home_a' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test', name: 'Home B', serverIdentityId: 'srv_logout_home_b' },
        ];
        activeServerSnapshotState.serverId = 'srv_logout_home_a';
        activeServerSnapshotState.serverUrl = 'https://home-a.example.test';
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.clearPendingExternalAuth()).resolves.toBe(true);
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toEqual({
            value: null,
            serverMismatch: false,
        });
        await TokenStorage.setCredentialsForServerUrl(
            'https://home-a.example.test',
            { serverId: 'srv_logout_home_a' },
            { token: buildTokenWithSub('home-a') },
        );
        await TokenStorage.setCredentialsForServerUrl(
            'https://home-b.example.test',
            { serverId: 'srv_logout_home_b' },
            { token: buildTokenWithSub('home-b') },
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: 'ExponentPushToken[last]',
        });
        const { accountDirectoryCredentialStorage } = await import('@/auth/accountDirectory/accountDirectoryCredentialStorage');
        await accountDirectoryCredentialStorage.set(
            { endpoint: 'https://accounts.example.test', serverIdentityId: 'account-service-a' },
            { token: 'account-service-token' },
        );

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: { token: buildTokenWithSub('home-a') },
            children: React.createElement(React.Fragment, null),
        }));
        try {
            await act(async () => {
                await getCurrentAuth()?.logout();
            });
            const deletedUrls = fetchSpy.mock.calls
                .filter(([, init]) => init?.method === 'DELETE')
                .map(([url]) => String(url))
                .sort();
            expect(deletedUrls).toEqual([
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
            ]);
            await expect(TokenStorage.getCredentialsForServerUrl(
                'https://home-a.example.test',
                { serverId: 'srv_logout_home_a' },
            )).resolves.toBeNull();
            await expect(TokenStorage.getCredentialsForServerUrl(
                'https://home-b.example.test',
                { serverId: 'srv_logout_home_b' },
            )).resolves.toMatchObject({ token: buildTokenWithSub('home-b') });
            await expect(accountDirectoryCredentialStorage.get(
                { endpoint: 'https://accounts.example.test', serverIdentityId: 'account-service-a' },
            )).resolves.toMatchObject({ token: 'account-service-token' });
        } finally {
            await screen.unmount();
        }
    });

    it('removes focused Home credentials and updates local auth before push cleanup settles', async () => {
        let releaseCleanup!: () => void;
        const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
        const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'DELETE') await cleanupGate;
            return Response.json({ success: true });
        });
        vi.stubGlobal('fetch', fetchSpy);
        const profile = {
            id: 'home-a',
            serverUrl: 'https://home-a.example.test',
            name: 'Home A',
            serverIdentityId: 'srv_logout_home_a',
        };
        serverProfilesState.profiles = [profile];
        activeServerSnapshotState.serverId = profile.serverIdentityId;
        activeServerSnapshotState.serverUrl = profile.serverUrl;
        const homeCredentials = { token: buildTokenWithSub('home-a') };
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await TokenStorage.setCredentialsForServerUrl(
            profile.serverUrl,
            { serverId: profile.serverIdentityId },
            homeCredentials,
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: null,
        });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: homeCredentials,
            children: React.createElement(React.Fragment, null),
        }));
        let logoutPromise: Promise<unknown> | undefined;
        let logoutSettled = false;
        try {
            await act(async () => {
                logoutPromise = getCurrentAuth()?.logout().then((result) => {
                    logoutSettled = true;
                    return result;
                });
                if (!logoutPromise) throw new Error('Expected current auth logout');
                await vi.waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
            });

            await expect(TokenStorage.getCredentialsForServerUrl(
                profile.serverUrl,
                { serverId: profile.serverIdentityId },
            )).resolves.toBeNull();
            await vi.waitFor(() => expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: false,
                credentials: null,
            }));
            await vi.waitFor(() => expect(logoutSettled).toBe(true));
        } finally {
            releaseCleanup();
            await act(async () => {
                await logoutPromise;
            });
            await screen.unmount();
        }
    });

    it('keeps the newly focused Home authenticated when an earlier Home logout resumes', async () => {
        const fetchSpy = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) => Response.json({ success: true }));
        vi.stubGlobal('fetch', fetchSpy);
        const homeACredentials = { token: buildTokenWithSub('home-a') };
        const homeBCredentials = { token: buildTokenWithSub('home-b') };
        serverProfilesState.profiles = [
            { id: 'home-a', serverUrl: 'https://home-a.example.test', name: 'Home A', serverIdentityId: 'srv_logout_home_a' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test', name: 'Home B', serverIdentityId: 'srv_logout_home_b' },
        ];
        activeServerSnapshotState.serverId = 'srv_logout_home_a';
        activeServerSnapshotState.serverUrl = 'https://home-a.example.test';
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.clearPendingExternalAuth()).resolves.toBe(true);
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toEqual({
            value: null,
            serverMismatch: false,
        });
        await TokenStorage.setCredentialsForServerUrl(
            'https://home-a.example.test',
            { serverId: 'srv_logout_home_a' },
            homeACredentials,
        );
        await TokenStorage.setCredentialsForServerUrl(
            'https://home-b.example.test',
            { serverId: 'srv_logout_home_b' },
            homeBCredentials,
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: 'ExponentPushToken[last]',
        });
        const { accountDirectoryCredentialStorage } = await import('@/auth/accountDirectory/accountDirectoryCredentialStorage');
        await accountDirectoryCredentialStorage.set(
            { endpoint: 'https://accounts.example.test', serverIdentityId: 'account-service-a' },
            { token: 'account-service-token' },
        );

        let resumeLogout!: () => void;
        const logoutPaused = new Promise<void>((resolve) => { resumeLogout = resolve; });
        const beforeMutation = vi.fn(async () => await logoutPaused);
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: homeACredentials,
            children: React.createElement(React.Fragment, null),
        }));
        try {
            const homeALogout = getCurrentAuth()?.logout({ beforeMutation });
            if (!homeALogout) throw new Error('Expected current auth logout');
            await vi.waitFor(() => expect(beforeMutation).toHaveBeenCalledTimes(1));

            activeServerSnapshotState.serverId = 'srv_logout_home_b';
            activeServerSnapshotState.serverUrl = 'https://home-b.example.test';
            activeServerSnapshotState.generation += 1;
            switchConnectionToActiveServerSpy.mockResolvedValueOnce(homeBCredentials);
            await act(async () => {
                await getCurrentAuth()?.refreshFromActiveServer();
            });
            expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: true,
                credentials: homeBCredentials,
            });

            await act(async () => {
                resumeLogout();
                await homeALogout;
            });

            expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: true,
                credentials: homeBCredentials,
            });
            expect(syncSwitchServerSpy).not.toHaveBeenCalledWith(null);
            await expect(TokenStorage.getCredentialsForServerUrl(
                'https://home-a.example.test',
                { serverId: 'srv_logout_home_a' },
            )).resolves.toBeNull();
            await expect(TokenStorage.getCredentialsForServerUrl(
                'https://home-b.example.test',
                { serverId: 'srv_logout_home_b' },
            )).resolves.toEqual(homeBCredentials);
            await expect(accountDirectoryCredentialStorage.get(
                { endpoint: 'https://accounts.example.test', serverIdentityId: 'account-service-a' },
            )).resolves.toMatchObject({ token: 'account-service-token' });
            const deletedUrls = fetchSpy.mock.calls
                .filter(([, init]) => init?.method === 'DELETE')
                .map(([url]) => String(url))
                .sort();
            expect(deletedUrls).toEqual([
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
            ]);
        } finally {
            await screen.unmount();
        }
    });

    it('explicitly forgets all Home and Account Service credentials without removing Home profiles', async () => {
        const fetchSpy = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) => Response.json({ success: true }));
        vi.stubGlobal('fetch', fetchSpy);
        const profiles = [
            { id: 'home-a', serverUrl: 'https://home-a.example.test', name: 'Home A', serverIdentityId: 'srv_forget_home_a' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test', name: 'Home B', serverIdentityId: 'srv_forget_home_b' },
        ];
        serverProfilesState.profiles = profiles;
        activeServerSnapshotState.serverId = 'srv_forget_home_a';
        activeServerSnapshotState.serverUrl = 'https://home-a.example.test';
        const homeACredentials = { token: buildTokenWithSub('home-a') };
        const homeBCredentials = { token: buildTokenWithSub('home-b') };
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await TokenStorage.setCredentialsForServerUrl(
            profiles[0]!.serverUrl,
            { serverId: profiles[0]!.serverIdentityId },
            homeACredentials,
        );
        await TokenStorage.setCredentialsForServerUrl(
            profiles[1]!.serverUrl,
            { serverId: profiles[1]!.serverIdentityId },
            homeBCredentials,
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: 'ExponentPushToken[last]',
        });
        const { accountDirectoryCredentialStorage } = await import('@/auth/accountDirectory/accountDirectoryCredentialStorage');
        const directoryTarget = {
            endpoint: 'https://accounts.example.test',
            serverIdentityId: 'account-service-a',
        };
        await accountDirectoryCredentialStorage.set(directoryTarget, { token: 'account-service-token' });
        await TokenStorage.setPendingAccountDirectoryAuth({
            credentialTarget: 'account_directory',
            ...directoryTarget,
            provider: 'github',
            purpose: 'account_directory',
            pending: 'pending-account-service-auth',
            createdAt: Date.now() - 100,
            expiresAt: Date.now() + 10_000,
        });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: homeACredentials,
            children: React.createElement(React.Fragment, null),
        }));
        try {
            await act(async () => {
                await getCurrentAuth()?.logout({ scope: 'all-credentials' });
            });

            await expect(TokenStorage.getCredentialsForServerUrl(
                profiles[0]!.serverUrl,
                { serverId: profiles[0]!.serverIdentityId },
            )).resolves.toBeNull();
            await expect(TokenStorage.getCredentialsForServerUrl(
                profiles[1]!.serverUrl,
                { serverId: profiles[1]!.serverIdentityId },
            )).resolves.toBeNull();
            await expect(accountDirectoryCredentialStorage.get(directoryTarget)).resolves.toBeNull();
            await expect(TokenStorage.getPendingAccountDirectoryAuth(directoryTarget)).resolves.toBeNull();
            expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: false,
                credentials: null,
            });
            expect(serverProfilesState.profiles).toBe(profiles);
            const deletedUrls = fetchSpy.mock.calls
                .filter(([, init]) => init?.method === 'DELETE')
                .map(([url]) => String(url))
                .sort();
            expect(deletedUrls).toEqual([
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
                'https://home-b.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
                'https://home-b.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
            ]);
        } finally {
            await screen.unmount();
        }
    });

    it('forgets local credentials before concurrently isolating per-Home push cleanup failures', async () => {
        let releaseCleanup!: () => void;
        const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
        const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'DELETE') {
                await cleanupGate;
                if (String(input).includes('home-a')) throw new Error('Home A is offline');
            }
            return Response.json({ success: true });
        });
        vi.stubGlobal('fetch', fetchSpy);
        const profiles = [
            { id: 'home-a', serverUrl: 'https://home-a.example.test', name: 'Home A', serverIdentityId: 'srv_forget_home_a' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test', name: 'Home B', serverIdentityId: 'srv_forget_home_b' },
        ];
        serverProfilesState.profiles = profiles;
        activeServerSnapshotState.serverId = profiles[0]!.serverIdentityId;
        activeServerSnapshotState.serverUrl = profiles[0]!.serverUrl;
        const homeACredentials = { token: buildTokenWithSub('home-a') };
        const homeBCredentials = { token: buildTokenWithSub('home-b') };
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await TokenStorage.setCredentialsForServerUrl(
            profiles[0]!.serverUrl,
            { serverId: profiles[0]!.serverIdentityId },
            homeACredentials,
        );
        await TokenStorage.setCredentialsForServerUrl(
            profiles[1]!.serverUrl,
            { serverId: profiles[1]!.serverIdentityId },
            homeBCredentials,
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: null,
        });

        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(React.createElement(AuthProvider, {
            initialCredentials: homeACredentials,
            children: React.createElement(React.Fragment, null),
        }));
        let logoutPromise: Promise<unknown> | undefined;
        let logoutSettled = false;
        try {
            await act(async () => {
                logoutPromise = getCurrentAuth()?.logout({ scope: 'all-credentials' }).then((result) => {
                    logoutSettled = true;
                    return result;
                });
                if (!logoutPromise) throw new Error('Expected current auth logout');
                await vi.waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
            });

            const deleteUrls = fetchSpy.mock.calls
                .filter(([, init]) => init?.method === 'DELETE')
                .map(([url]) => String(url));
            expect(deleteUrls).toEqual(expect.arrayContaining([
                'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
                'https://home-b.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
            ]));
            await expect(TokenStorage.getCredentialsForServerUrl(
                profiles[0]!.serverUrl,
                { serverId: profiles[0]!.serverIdentityId },
            )).resolves.toBeNull();
            await expect(TokenStorage.getCredentialsForServerUrl(
                profiles[1]!.serverUrl,
                { serverId: profiles[1]!.serverIdentityId },
            )).resolves.toBeNull();
            await vi.waitFor(() => expect(getCurrentAuth()).toMatchObject({
                isAuthenticated: false,
                credentials: null,
            }));
            await vi.waitFor(() => expect(logoutSettled).toBe(true));
        } finally {
            releaseCleanup();
            await act(async () => {
                await logoutPromise;
            });
            await screen.unmount();
        }
    });

    it('blocks different-token replacement and unproven same-token keyed replacement', async () => {
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'http://localhost:53288', scope: 'tab' });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const token = buildTokenWithSub('server-test');
        await TokenStorage.setCredentials({ token });
        await expect(TokenStorage.setPendingExternalAuth({
            provider: 'github',
            proof: 'proof',
            secret: 'secret',
            serverId: activeServerSnapshotState.serverId,
            serverUrl: activeServerSnapshotState.serverUrl,
            accountEncryptionFirstKey: {
                accountId: 'account-test',
                requestDigest: `aemrb1_${'A'.repeat(43)}`,
                requestJson: '{}',
                pending: 'pending',
                createdAt: Date.now(),
                expiresAt: Date.now() + 60_000,
                migrationSubmissionAttempted: true,
            },
        })).resolves.toBe(true);
        await expect(TokenStorage.readPendingExternalAuthState()).resolves.toMatchObject({
            serverMismatch: false,
            value: {
                accountEncryptionFirstKey: {
                    migrationSubmissionAttempted: true,
                },
            },
        });
        const { AuthProvider, getCurrentAuth } = await import('./AuthContext');
        const screen = await renderScreen(
            React.createElement(AuthProvider, {
                initialCredentials: { token },
                children: React.createElement(React.Fragment, null),
            }),
        );

        try {
            const auth = getCurrentAuth();
            if (!auth) throw new Error('Expected current auth to be set');

            await expect(auth.loginWithCredentials({ token: 'different-token' }))
                .resolves.toMatchObject({ kind: 'finish_encryption_setup' });
            expect(await TokenStorage.getCredentials()).toEqual({ token });

            await expect(auth.loginWithCredentials({ token, secret: 'recovered-secret' }))
                .resolves.toMatchObject({ kind: 'finish_encryption_setup' });
            expect(await TokenStorage.getCredentials()).toEqual({ token });
        } finally {
            await screen.unmount();
        }
    });
});
