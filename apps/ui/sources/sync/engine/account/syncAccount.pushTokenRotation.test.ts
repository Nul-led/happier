import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

const mocks = vi.hoisted(() => {
    return {
        registerPushToken: vi.fn(),
        deletePushToken: vi.fn(),
        getCredentialsForServerUrl: vi.fn(),
        listServerProfiles: vi.fn(),
        getActiveServerSnapshot: vi.fn(),
        getExpoPushTokenAsync: vi.fn(),
        acquireIrohHomeRuntimeOrigin: vi.fn(),
        runtimeFetchCalls: [] as Array<{ url: string; serverUrl: string; runtimeOrigin?: string }>,
    };
});

vi.mock('expo-constants', () => ({
    default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

vi.mock('expo-notifications', () => ({
    getPermissionsAsync: vi.fn(async () => ({ status: 'granted', granted: true, canAskAgain: false })),
    requestPermissionsAsync: vi.fn(async () => ({ status: 'granted', granted: true, canAskAgain: false })),
    getExpoPushTokenAsync: (...args: unknown[]) => mocks.getExpoPushTokenAsync(...args),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                        Platform: { OS: 'ios' },
                    }
    );
});

vi.mock('@/sync/api/session/apiPush', () => ({
    registerPushToken: (...args: unknown[]) => mocks.registerPushToken(...args),
    deletePushToken: (...args: unknown[]) => mocks.deletePushToken(...args),
}));

// The canonical registration path reads each Home's notification settings through an
// explicit Home-targeted request. Resolve it as an offline Home (no settings payload)
// so per-Home consent falls back to the last-known/product-default semantics.
vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: vi.fn(async (params: { url: string; serverUrl: string; runtimeOrigin?: string }) => {
        mocks.runtimeFetchCalls.push({ url: params.url, serverUrl: params.serverUrl, runtimeOrigin: params.runtimeOrigin });
        return Response.json({ success: true });
    }),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels', () => ({
    acquireIrohHomeRuntimeOrigin: (...args: unknown[]) => mocks.acquireIrohHomeRuntimeOrigin(...args),
    classifyIrohHomeTunnelSwitchFailure: (error: unknown) => ({
        fallbackAllowed: error instanceof Error && error.message.includes('fallback-allowed'),
        failureClass: 'carrier-unavailable',
    }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    listServerProfiles: () => mocks.listServerProfiles(),
    areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left ?? '') === String(right ?? ''),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) =>
        profile.serverIdentityId ?? profile.id,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => mocks.getActiveServerSnapshot(),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: (
            serverUrl: string,
            options?: Readonly<{ serverId?: string | null }>,
        ) => mocks.getCredentialsForServerUrl(serverUrl, options),
    },
}));

describe('registerPushTokenIfAvailable rotation cleanup', () => {
    beforeEach(async () => {
        mocks.registerPushToken.mockReset();
        mocks.deletePushToken.mockReset();
        mocks.getCredentialsForServerUrl.mockReset();
        mocks.listServerProfiles.mockReset();
        mocks.getActiveServerSnapshot.mockReset();
        mocks.getExpoPushTokenAsync.mockReset();
        mocks.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[new]' });
        mocks.acquireIrohHomeRuntimeOrigin.mockReset();
        mocks.acquireIrohHomeRuntimeOrigin.mockRejectedValue(new Error('no iroh endpoint configured'));
        mocks.runtimeFetchCalls.length = 0;
        const tokenRegistration = await import('@/sync/domains/state/pushTokenRegistration');
        tokenRegistration.clearLastRegisteredExpoPushToken();
    });

    it('unregisters the previous token when Expo rotates tokens', async () => {
        const { saveLastRegisteredExpoPushToken, loadLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');

        mocks.listServerProfiles.mockReturnValue([
            { id: 'server-1', serverUrl: 'https://api.happier.dev' },
            { id: 'server-2', serverUrl: 'https://company.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({ serverId: 'server-1', serverUrl: 'https://api.happier.dev', generation: 1 });
        mocks.getCredentialsForServerUrl.mockImplementation(async (url: string) => ({ token: `t:${url}`, secret: 's' }));
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: { token: 't:active', secret: 's' } satisfies AuthCredentials,
            log: { log: () => {} },
        });

        expect(loadLastRegisteredExpoPushToken()).toBe('ExponentPushToken[new]');

        expect(mocks.deletePushToken).toHaveBeenCalledWith({ token: 't:https://api.happier.dev', secret: 's' }, 'ExponentPushToken[old]', { apiEndpoint: 'https://api.happier.dev', runtimeOrigin: 'https://api.happier.dev' });
        expect(mocks.deletePushToken).toHaveBeenCalledWith({ token: 't:https://company.example.test', secret: 's' }, 'ExponentPushToken[old]', { apiEndpoint: 'https://company.example.test', runtimeOrigin: 'https://company.example.test' });
    });

    it('uses serverId-scoped credentials when profiles share the same server URL', async () => {
        const { saveLastRegisteredExpoPushToken, loadLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');

        mocks.listServerProfiles.mockReturnValue([
            { id: 'server-a', serverUrl: 'https://shared.example.test' },
            { id: 'server-b', serverUrl: 'https://shared.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'server-b',
            serverUrl: 'https://shared.example.test',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockImplementation(async (_serverUrl: string, options?: Readonly<{ serverId?: string | null }>) => {
            if (options?.serverId === 'server-a') {
                return { token: 'token-a', secret: 'secret-a' };
            }
            if (options?.serverId === 'server-b') {
                return { token: 'token-b', secret: 'secret-b' };
            }
            return { token: 'token-b', secret: 'secret-b' };
        });
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: { token: 'token-b', secret: 'secret-b' } satisfies AuthCredentials,
            log: { log: () => {} },
        });

        expect(loadLastRegisteredExpoPushToken()).toBe('ExponentPushToken[new]');
        expect(mocks.getCredentialsForServerUrl).toHaveBeenCalledWith('https://shared.example.test', {
            serverId: 'server-a',
        });
        expect(mocks.getCredentialsForServerUrl).toHaveBeenCalledWith('https://shared.example.test', {
            serverId: 'server-b',
        });
        expect(mocks.registerPushToken).toHaveBeenCalledWith(
            { token: 'token-a', secret: 'secret-a' },
            'ExponentPushToken[new]',
            expect.objectContaining({ clientServerUrl: 'https://shared.example.test' }),
        );
        expect(mocks.registerPushToken).toHaveBeenCalledWith(
            { token: 'token-b', secret: 'secret-b' },
            'ExponentPushToken[new]',
            expect.objectContaining({ clientServerUrl: 'https://shared.example.test' }),
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            { token: 'token-a', secret: 'secret-a' },
            'ExponentPushToken[old]',
            { apiEndpoint: 'https://shared.example.test', runtimeOrigin: 'https://shared.example.test' },
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            { token: 'token-b', secret: 'secret-b' },
            'ExponentPushToken[old]',
            { apiEndpoint: 'https://shared.example.test', runtimeOrigin: 'https://shared.example.test' },
        );
    });

    it('unregisters the previous token exactly once per Home without duplicating the focused Home', async () => {
        const { saveLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');

        mocks.listServerProfiles.mockReturnValue([
            { id: 'focused-1', serverUrl: 'https://focused.example.test' },
            { id: 'secondary-2', serverUrl: 'https://secondary.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'focused-1',
            serverUrl: 'https://focused.example.test',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockImplementation(async (url: string) => ({ token: `t:${url}`, secret: 's' }));
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: { token: 't:caller-context', secret: 's' } satisfies AuthCredentials,
            log: { log: () => {} },
        });

        expect(mocks.deletePushToken).toHaveBeenCalledTimes(2);
        const deleteEndpoints = mocks.deletePushToken.mock.calls
            .map((call) => (call[2] as { apiEndpoint?: string } | undefined)?.apiEndpoint)
            .sort();
        expect(deleteEndpoints).toEqual(['https://focused.example.test', 'https://secondary.example.test']);
        for (const call of mocks.deletePushToken.mock.calls) {
            expect(call[0]).not.toEqual({ token: 't:caller-context', secret: 's' });
        }
    });

    it('keeps the prior token reachable for cleanup when one enabled Home fails, cleans succeeded Homes, and settles on the next full cycle', async () => {
        const {
            saveLastRegisteredExpoPushToken,
            loadExpoPushTokensToUnregister,
            loadRegisteredExpoPushTokenState,
        } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');
        mocks.listServerProfiles.mockReturnValue([
            { id: 'home-a', serverUrl: 'https://home-a.example.test' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockImplementation(async (url: string) => ({ token: `t:${url}`, secret: 's' }));
        mocks.registerPushToken
            .mockRejectedValueOnce(new Error('home a unavailable'))
            .mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: { token: 't:home-a-caller', secret: 's' },
            log: { log: () => {} },
            getHomeAccountSettings: async () => ({}),
        });

        // Partial rotation: Home B adopted the new token, so the dead prior token
        // is cleaned there immediately. Home A did not adopt it yet, so the prior
        // token stays cleanup-pending and both tokens stay reachable for logout —
        // neither may be stranded by an intermediate logout or profile removal.
        expect(mocks.deletePushToken).toHaveBeenCalledTimes(1);
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            { token: 't:https://home-b.example.test', secret: 's' },
            'ExponentPushToken[old]',
            { apiEndpoint: 'https://home-b.example.test', runtimeOrigin: 'https://home-b.example.test' },
        );
        expect(loadRegisteredExpoPushTokenState()).toEqual({
            current: 'ExponentPushToken[new]',
            cleanupPending: 'ExponentPushToken[old]',
        });
        expect(loadExpoPushTokensToUnregister())
            .toEqual(['ExponentPushToken[new]', 'ExponentPushToken[old]']);

        // Next fully successful cycle: prior-token cleanup succeeds at every Home
        // and only then is the cleanup-pending state dropped.
        mocks.deletePushToken.mockClear();
        await registerPushTokenIfAvailable({
            credentials: { token: 't:home-a-caller', secret: 's' },
            log: { log: () => {} },
            getHomeAccountSettings: async () => ({}),
        });

        expect(mocks.deletePushToken).toHaveBeenCalledTimes(2);
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            { token: 't:https://home-a.example.test', secret: 's' },
            'ExponentPushToken[old]',
            { apiEndpoint: 'https://home-a.example.test', runtimeOrigin: 'https://home-a.example.test' },
        );
        expect(loadRegisteredExpoPushTokenState()).toEqual({
            current: 'ExponentPushToken[new]',
            cleanupPending: null,
        });
        expect(loadExpoPushTokensToUnregister()).toEqual(['ExponentPushToken[new]']);
    });

    it('keeps the cleanup basis when a Home cleanup fails while the observed token advances', async () => {
        const {
            saveLastRegisteredExpoPushToken,
            loadExpoPushTokensToUnregister,
            loadRegisteredExpoPushTokenState,
        } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');
        mocks.listServerProfiles.mockReturnValue([
            { id: 'home-a', serverUrl: 'https://home-a.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockResolvedValue({ token: 'home-a-token', secret: 's' });
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockRejectedValue(new Error('cleanup unavailable'));

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: { token: 'home-a-token', secret: 's' },
            log: { log: () => {} },
            getHomeAccountSettings: async () => ({}),
        });

        // The observed token advanced (Home A holds it), but the failed old-token
        // cleanup keeps the prior token cleanup-pending so logout, global forget,
        // and profile removal still reach it, and the next cycle retries it.
        expect(loadRegisteredExpoPushTokenState()).toEqual({
            current: 'ExponentPushToken[new]',
            cleanupPending: 'ExponentPushToken[old]',
        });
        expect(loadExpoPushTokensToUnregister())
            .toEqual(['ExponentPushToken[new]', 'ExponentPushToken[old]']);
    });

    it('settles an unresolved token before advancing through a successive rotation', async () => {
        const {
            saveLastRegisteredExpoPushToken,
            loadRegisteredExpoPushTokenState,
        } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[A]');
        mocks.listServerProfiles.mockReturnValue([
            { id: 'home-a', serverUrl: 'https://home-a.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockResolvedValue({ token: 'home-a-token', secret: 's' });
        mocks.getExpoPushTokenAsync
            .mockResolvedValueOnce({ data: 'ExponentPushToken[B]' })
            .mockResolvedValueOnce({ data: 'ExponentPushToken[C]' });
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockRejectedValueOnce(new Error('A cleanup unavailable'));

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        const params = {
            credentials: { token: 'home-a-token', secret: 's' } satisfies AuthCredentials,
            log: { log: () => {} },
            getHomeAccountSettings: async () => ({}),
        };
        await registerPushTokenIfAvailable(params);

        expect(loadRegisteredExpoPushTokenState()).toEqual({
            current: 'ExponentPushToken[B]',
            cleanupPending: 'ExponentPushToken[A]',
        });

        const secondCycleEvents: string[] = [];
        mocks.registerPushToken.mockImplementation(async (_credentials, token: string) => {
            secondCycleEvents.push(`register:${token}`);
        });
        mocks.deletePushToken.mockImplementation(async (_credentials, token: string) => {
            secondCycleEvents.push(`delete:${token}`);
        });
        await registerPushTokenIfAvailable(params);

        expect(secondCycleEvents).toEqual([
            'delete:ExponentPushToken[A]',
            'register:ExponentPushToken[C]',
            'delete:ExponentPushToken[B]',
        ]);
        expect(loadRegisteredExpoPushTokenState()).toEqual({
            current: 'ExponentPushToken[C]',
            cleanupPending: null,
        });
    });

    it('removes both current and previous tokens when the absent focused profile is disabled', async () => {
        const { saveLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
        saveLastRegisteredExpoPushToken('ExponentPushToken[old]');
        mocks.listServerProfiles.mockReturnValue([]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'focused-absent',
            serverUrl: 'https://focused-absent.example.test',
            generation: 1,
        });
        mocks.deletePushToken.mockResolvedValue(undefined);

        const credentials = { token: 'focused-token', secret: 's' } satisfies AuthCredentials;
        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials,
            log: { log: () => {} },
            getAccountSettings: () => ({
                attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } },
            }),
        });

        expect(mocks.registerPushToken).not.toHaveBeenCalled();
        expect(mocks.deletePushToken.mock.calls).toEqual([
            [credentials, 'ExponentPushToken[new]', { apiEndpoint: 'https://focused-absent.example.test', runtimeOrigin: 'https://focused-absent.example.test' }],
            [credentials, 'ExponentPushToken[old]', { apiEndpoint: 'https://focused-absent.example.test', runtimeOrigin: 'https://focused-absent.example.test' }],
        ]);
    });

    it('registers and unregisters Iroh-only Homes through the verified runtime origin, never the canonical URL', async () => {
        const irohLeaseFor = (origin: string) => ({
            leaseId: `lease-${origin}`,
            runtimeOrigin: origin,
            release: vi.fn(async () => undefined),
        });
        mocks.acquireIrohHomeRuntimeOrigin.mockImplementation(async (params: { homeServerIdentityId: string }) => {
            if (params.homeServerIdentityId === 'srv_iroh_a') return irohLeaseFor('http://127.0.0.1:45991');
            return irohLeaseFor('http://127.0.0.1:46111');
        });
        mocks.listServerProfiles.mockReturnValue([
            {
                id: 'iroh-enabled',
                serverUrl: 'https://iroh-only.example.test',
                serverIdentityId: 'srv_iroh_a',
                irohEndpoint: { endpointId: 'a'.repeat(64) },
                connectionDescriptorRevision: 3,
            },
            {
                id: 'iroh-disabled',
                serverUrl: 'https://iroh-disabled.example.test',
                serverIdentityId: 'srv_iroh_b',
                irohEndpoint: { endpointId: 'b'.repeat(64) },
                connectionDescriptorRevision: 4,
            },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({ serverId: '', serverUrl: '', generation: 0 });
        mocks.getCredentialsForServerUrl.mockImplementation(async (url: string) => ({ token: `t:${url}`, secret: 's' }));
        mocks.registerPushToken.mockResolvedValue(undefined);
        mocks.deletePushToken.mockResolvedValue(undefined);

        const { registerPushTokenIfAvailable } = await import('./syncAccount');
        await registerPushTokenIfAvailable({
            credentials: null,
            log: { log: () => {} },
            getHomeAccountSettings: async (home) => home.serverUrl.includes('iroh-disabled')
                ? { attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } } }
                : {},
        });

        // Register and delete both ride the verified Iroh runtime origin; the
        // canonical URL is only the reachability/auth audience and is never fetched.
        expect(mocks.registerPushToken).toHaveBeenCalledWith(
            { token: 't:https://iroh-only.example.test', secret: 's' },
            'ExponentPushToken[new]',
            expect.objectContaining({
                apiEndpoint: 'https://iroh-only.example.test',
                runtimeOrigin: 'http://127.0.0.1:45991',
                clientServerUrl: 'https://iroh-only.example.test',
            }),
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            { token: 't:https://iroh-disabled.example.test', secret: 's' },
            'ExponentPushToken[new]',
            { apiEndpoint: 'https://iroh-disabled.example.test', runtimeOrigin: 'http://127.0.0.1:46111' },
        );
        // The API adapter's runtime-origin behavior is tested at its own network
        // boundary; this policy test proves every Home decision receives that
        // verified origin rather than the canonical URL.
        expect(mocks.acquireIrohHomeRuntimeOrigin).toHaveBeenCalledTimes(2);
    });
});
