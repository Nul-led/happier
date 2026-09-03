import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionStatus } from 'expo-modules-core';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

const SECURE_STORE_DEV_FALLBACK_ENV = 'EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK';
let originalSecureStoreDevFallback: string | undefined;
const runtimeFetchWithServerReachabilityMock = vi.hoisted(() => vi.fn());
const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: runtimeFetchWithServerReachabilityMock,
}));

vi.mock('expo-notifications', () => ({
    getPermissionsAsync: vi.fn(),
    requestPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                        Platform: {
                            OS: 'ios',
                        },
                    }
    );
});

vi.mock('expo-constants', () => ({
    default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

vi.mock('expo-secure-store', () => {
    return {
        getItemAsync: async (key: string) => secureStore.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
            secureStore.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
            secureStore.delete(key);
        },
    };
});

const Notifications = await import('expo-notifications');
const serverProfiles = await import('@/sync/domains/server/serverProfiles');
const { TokenStorage } = await import('@/auth/storage/tokenStorage');
const { registerPushTokenIfAvailable } = await import('./syncAccount');

async function resetPersistedHomes(): Promise<void> {
    const { clearLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
    clearLastRegisteredExpoPushToken();
    await TokenStorage.removeCredentials();
    for (const profile of serverProfiles.listServerProfiles()) {
        serverProfiles.removeServerProfile(profile.id);
    }
    secureStore.clear();
}

beforeEach(async () => {
    await resetPersistedHomes();
    originalSecureStoreDevFallback = process.env[SECURE_STORE_DEV_FALLBACK_ENV];
    process.env[SECURE_STORE_DEV_FALLBACK_ENV] = '0';
    runtimeFetchWithServerReachabilityMock.mockReset();
    runtimeFetchWithServerReachabilityMock.mockImplementation(async () => Response.json({ success: true }));
});

afterEach(async () => {
    await resetPersistedHomes();
    if (originalSecureStoreDevFallback === undefined) {
        delete process.env[SECURE_STORE_DEV_FALLBACK_ENV];
    } else {
        process.env[SECURE_STORE_DEV_FALLBACK_ENV] = originalSecureStoreDevFallback;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('registerPushTokenIfAvailable (multi-server)', () => {
    it('registers for all saved servers with credentials', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
            status: PermissionStatus.GRANTED,
            expires: 'never',
            granted: true,
            canAskAgain: false,
        } satisfies Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
        vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
            status: PermissionStatus.GRANTED,
            expires: 'never',
            granted: true,
            canAskAgain: false,
        } satisfies Awaited<ReturnType<typeof Notifications.requestPermissionsAsync>>);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
            type: 'expo',
            data: 'ExponentPushToken[secret-token]',
        } satisfies Awaited<ReturnType<typeof Notifications.getExpoPushTokenAsync>>);

        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const defaultServer = upsertServerProfile({
            serverUrl: 'https://remote-a.example.test',
            name: 'Primary',
        });
        const company = upsertServerProfile({
            serverUrl: 'https://company.example.test',
            name: 'Company',
        });

        setActiveServerId(defaultServer.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(
            defaultServer.serverUrl,
            { serverId: defaultServer.id },
            { token: 't_primary', secret: 's' },
        );

        setActiveServerId(company.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(
            company.serverUrl,
            { serverId: company.id },
            { token: 't_company', secret: 's' },
        );

        setActiveServerId(defaultServer.id, { scope: 'device' });

        const messages: string[] = [];
        const log = { log: (message: string) => messages.push(message) };

        await registerPushTokenIfAvailable({
            credentials: { token: 't_primary', secret: 's' } satisfies AuthCredentials,
            log,
        });

        const urls = runtimeFetchWithServerReachabilityMock.mock.calls
            .filter(([request]) => request.init?.method === 'POST')
            .map(([request]) => String(request.url))
            .sort();
        expect(urls).toEqual([
            'https://company.example.test/v1/push-tokens',
            'https://remote-a.example.test/v1/push-tokens',
        ]);
        expect(messages.join('\n')).not.toContain('ExponentPushToken[secret-token]');

        const bodiesByUrl = new Map<string, any>();
        for (const [request] of runtimeFetchWithServerReachabilityMock.mock.calls) {
            const url = String(request.url);
            const init = (request.init ?? {}) as any;
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
            bodiesByUrl.set(url, body);
        }
        expect(bodiesByUrl.get('https://remote-a.example.test/v1/push-tokens')).toMatchObject({
            token: 'ExponentPushToken[secret-token]',
            clientServerUrl: 'https://remote-a.example.test',
        });
        expect(bodiesByUrl.get('https://company.example.test/v1/push-tokens')).toMatchObject({
            token: 'ExponentPushToken[secret-token]',
            clientServerUrl: 'https://company.example.test',
        });
    });

    it('uses current local consent for the focused Home and explicit settings for other Homes', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[scoped]' } as never);
        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const homeA = upsertServerProfile({ serverUrl: 'https://home-a.example.test', name: 'A' });
        const homeB = upsertServerProfile({ serverUrl: 'https://home-b.example.test', name: 'B' });
        setActiveServerId(homeA.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'a', secret: 's' });
        setActiveServerId(homeB.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'b', secret: 's' });
        setActiveServerId(homeA.id, { scope: 'device' });

        const reads: string[] = [];
        await registerPushTokenIfAvailable({
            credentials: { token: 'a', secret: 's' },
            log: { log: vi.fn() },
            getHomeAccountSettings: async (home) => {
                reads.push(home.serverUrl);
                return {};
            },
            getAccountSettings: () => ({
                attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } },
            }),
        });

        // The focused settings write is local-first and may still be pending its
        // debounced server flush. A stale live read must not override that intent.
        expect(reads).toEqual(['https://home-b.example.test']);
        const mutationCalls = runtimeFetchWithServerReachabilityMock.mock.calls
            .filter(([request]) => request.init?.method === 'POST' || request.init?.method === 'DELETE')
            .map(([request]) => ({ method: request.init?.method, url: String(request.url) }))
            .sort((left, right) => left.url.localeCompare(right.url));
        expect(mutationCalls).toEqual([
            { method: 'DELETE', url: 'https://home-a.example.test/v1/push-tokens/ExponentPushToken%5Bscoped%5D' },
            { method: 'POST', url: 'https://home-b.example.test/v1/push-tokens' },
        ]);
    });

    it('reads a never-focused Home live setting through explicit Home requests and skips the live-disabled Home', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[live-read]' } as never);
        const tokenForAccount = (accountId: string) => [
            btoa(JSON.stringify({ alg: 'none' })),
            btoa(JSON.stringify({ sub: accountId })),
            'signature',
        ].join('.');
        const secretBytes = new Uint8Array(32).fill(19);
        const { encodeBase64 } = await import('@/encryption/base64');
        const { Encryption } = await import('@/sync/encryption/encryption');
        const { sealAccountScopedBlobCiphertext } = await import('@happier-dev/protocol');
        const homeBEncryption = await Encryption.create(secretBytes);
        const homeBSettingsCiphertext = sealAccountScopedBlobCiphertext({
            kind: 'account_settings',
            material: {
                type: 'dataKey',
                machineKey: homeBEncryption.getContentPrivateKey(),
            },
            payload: { attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } } },
            randomBytes: () => new Uint8Array(24).fill(23),
        });
        const homeACredentials = { token: tokenForAccount('account-a'), secret: encodeBase64(secretBytes, 'base64url') } satisfies AuthCredentials;
        const homeBCredentials = { token: tokenForAccount('account-b'), secret: encodeBase64(secretBytes, 'base64url') } satisfies AuthCredentials;
        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const homeA = upsertServerProfile({
            serverUrl: 'https://live-a.example.test',
            name: 'A',
        });
        const homeB = upsertServerProfile({
            serverUrl: 'https://live-b.example.test',
            name: 'B',
        });
        setActiveServerId(homeA.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: homeA.id },
            homeACredentials,
        );
        await TokenStorage.setCredentialsForServerUrl(
            homeB.serverUrl,
            { serverId: homeB.id },
            homeBCredentials,
        );

        // B is never synced, so it has no persisted scoped Account Settings
        // projection. Its live endpoints authoritatively disable Expo push and
        // the disabled v2 E2EE envelope must not be misread as enabled defaults.
        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string }) => {
            const url = String(request.url);
            if (url.endsWith('/v1/account/encryption')) {
                return Response.json({ mode: url.includes('live-b') ? 'e2ee' : 'plain', updatedAt: 1 });
            }
            if (url.endsWith('/v2/account/settings')) {
                return Response.json({
                    content: url.includes('live-b')
                        ? { t: 'encrypted', c: homeBSettingsCiphertext }
                        : { t: 'plain', v: {} },
                    version: 7,
                });
            }
            return Response.json({ success: true });
        });

        await registerPushTokenIfAvailable({
            credentials: homeACredentials,
            log: { log: vi.fn() },
        });

        const calls = runtimeFetchWithServerReachabilityMock.mock.calls.map(([request]) => request as { url: string; init?: RequestInit });
        const homeBCalls = calls.filter(({ url }) => url.includes('live-b'));
        // The never-focused Home is read live through its own explicit endpoints.
        expect(homeBCalls.some(({ url }) => url.endsWith('/v1/account/encryption'))).toBe(true);
        expect(homeBCalls.some(({ url }) => url.endsWith('/v2/account/settings'))).toBe(true);
        for (const { init } of homeBCalls) {
            expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${tokenForAccount('account-b')}`);
        }
        const registeredUrls = calls
            .filter(({ url, init }) => url.endsWith('/v1/push-tokens') && init?.method === 'POST')
            .map(({ url }) => url);
        expect(registeredUrls).toEqual(['https://live-a.example.test/v1/push-tokens']);
        expect(calls.filter(({ url, init }) => url.includes('live-b') && init?.method === 'DELETE'))
            .toEqual([expect.objectContaining({
                url: 'https://live-b.example.test/v1/push-tokens/ExponentPushToken%5Blive-read%5D',
            })]);
        expect(calls.some(({ url, init }) => !url.includes('live-a') && !url.includes('live-b') && (init?.method === 'POST' || init?.method === 'DELETE'))).toBe(false);
    });

    it('falls back to the Home-scoped cached setting for an offline Home while the focused Home stays enabled', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[offline-cache]' } as never);
        const tokenForAccount = (accountId: string) => [
            btoa(JSON.stringify({ alg: 'none' })),
            btoa(JSON.stringify({ sub: accountId })),
            'signature',
        ].join('.');
        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const homeA = upsertServerProfile({ serverUrl: 'https://offline-a.example.test', name: 'A' });
        const homeB = upsertServerProfile({ serverUrl: 'https://offline-b.example.test', name: 'B' });
        setActiveServerId(homeA.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: tokenForAccount('account-a'), secret: 's' });
        setActiveServerId(homeB.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: tokenForAccount('account-b'), secret: 's' });
        setActiveServerId(homeA.id, { scope: 'device' });

        // B holds a last-known disabled scoped projection from an earlier sync.
        const { createAccountSettingsScope } = await import('@/sync/domains/settings/scope/accountSettingsScope');
        const { saveAccountSettings } = await import('@/sync/domains/state/accountSettingsPersistence');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        const scopeB = createAccountSettingsScope(homeB.id, 'account-b');
        expect(scopeB).not.toBeNull();
        if (!scopeB) return;
        saveAccountSettings(scopeB, {
            ...settingsDefaults,
            attentionDeliveryPolicyV1: {
                ...settingsDefaults.attentionDeliveryPolicyV1,
                channels: {
                    ...settingsDefaults.attentionDeliveryPolicyV1.channels,
                    expo_push: {
                        ...settingsDefaults.attentionDeliveryPolicyV1.channels.expo_push,
                        enabled: false,
                    },
                },
            },
        }, 3);

        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string }) => {
            const url = String(request.url);
            if (url.includes('offline-b')) throw new Error('home offline');
            if (url.endsWith('/v1/account/encryption')) {
                return Response.json({ mode: 'plain', updatedAt: 1 });
            }
            if (url.endsWith('/v2/account/settings')) {
                return Response.json({ content: { t: 'plain', v: {} }, version: 2 });
            }
            return Response.json({ success: true });
        });

        await registerPushTokenIfAvailable({
            credentials: { token: tokenForAccount('account-a'), secret: 's' } satisfies AuthCredentials,
            log: { log: vi.fn() },
        });

        const calls = runtimeFetchWithServerReachabilityMock.mock.calls.map(([request]) => request as { url: string; init?: RequestInit });
        // Live-first: B is asked directly even though a scoped cache exists.
        expect(calls.some(({ url }) => url.includes('offline-b') && url.endsWith('/v1/account/encryption'))).toBe(true);
        const registeredUrls = calls
            .filter(({ url, init }) => url.endsWith('/v1/push-tokens') && init?.method === 'POST')
            .map(({ url }) => url);
        // A registers from its own live setting; B keeps its offline last-known
        // disabled consent and is never registered.
        expect(registeredUrls).toEqual(['https://offline-a.example.test/v1/push-tokens']);
    });

    it('makes one registration attempt per Home and never re-registers a failed Home with caller credentials', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[single-decision]' } as never);
        const { clearLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
        clearLastRegisteredExpoPushToken();
        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const homeA = upsertServerProfile({ serverUrl: 'https://single-a.example.test', name: 'A' });
        const homeB = upsertServerProfile({ serverUrl: 'https://single-b.example.test', name: 'B' });
        setActiveServerId(homeA.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'single-a' });
        setActiveServerId(homeB.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'single-b' });
        setActiveServerId(homeA.id, { scope: 'device' });

        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string }) => {
            if (String(request.url).includes('single-a')) throw new Error('registration endpoint failed');
            return Response.json({ success: true });
        });

        // The caller context deliberately carries a credential that belongs to no
        // enumerated Home (for example an Account Service credential leaked into
        // this call). The canonical per-Home decision must never send it anywhere.
        await registerPushTokenIfAvailable({
            credentials: { token: 'foreign-account-service-credential' } satisfies AuthCredentials,
            log: { log: vi.fn() },
            getHomeAccountSettings: async () => ({}),
        });

        const postCalls = runtimeFetchWithServerReachabilityMock.mock.calls.filter(([request]) => {
            const params = request as { url: string; init?: RequestInit };
            return params.url.endsWith('/v1/push-tokens') && params.init?.method === 'POST';
        });
        const postUrls = postCalls.map(([request]) => String((request as { url: string }).url));
        // One canonical attempt per Home: the failed focused Home must not be
        // retried through a separate focused-Home fallback decision.
        expect(postUrls.filter((url) => url.includes('single-a'))).toHaveLength(1);
        expect(postUrls.filter((url) => url.includes('single-b'))).toHaveLength(1);
        for (const [request] of postCalls) {
            const headers = (request as { init?: RequestInit }).init?.headers as Record<string, string> | undefined;
            expect(JSON.stringify(headers ?? {})).not.toContain('foreign-account-service-credential');
        }
    });

    it('continues registering other Homes when one registration fails', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[isolated]' } as never);
        const { upsertServerProfile, setActiveServerId } = serverProfiles;
        const homeA = upsertServerProfile({ serverUrl: 'https://fail-home.example.test', name: 'Fail' });
        const homeB = upsertServerProfile({ serverUrl: 'https://ok-home.example.test', name: 'OK' });
        setActiveServerId(homeA.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'a', secret: 's' });
        setActiveServerId(homeB.id, { scope: 'device' });
        await TokenStorage.setCredentials({ token: 'b', secret: 's' });
        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: Request) => {
            if (String(request.url).includes('fail-home')) throw new Error('offline');
            return Response.json({ success: true });
        });
        await registerPushTokenIfAvailable({ credentials: { token: 'a', secret: 's' }, log: { log: vi.fn() } });
        expect(runtimeFetchWithServerReachabilityMock.mock.calls.some(([request]) => String(request.url).includes('ok-home'))).toBe(true);
    });

    it('compensates a registration that completes after its Home credential is removed', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[stale]' } as never);
        const home = serverProfiles.upsertServerProfile({ serverUrl: 'https://stale.example.test', name: 'Stale' });
        serverProfiles.setActiveServerId(home.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: home.id }, { token: 'stale-home-token' });
        let finishRegistration!: () => void;
        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string; init?: RequestInit }) => {
            if (request.url.endsWith('/v1/push-tokens') && request.init?.method === 'POST') {
                await new Promise<void>((resolve) => { finishRegistration = resolve; });
            }
            return Response.json({ success: true });
        });

        const run = registerPushTokenIfAvailable({ credentials: { token: 'stale-home-token' }, log: { log: vi.fn() }, getAccountSettings: () => ({}) });
        await vi.waitFor(() => expect(finishRegistration).toBeTypeOf('function'));
        await TokenStorage.removeCredentialsForServerUrl(home.serverUrl, { serverId: home.id });
        finishRegistration();
        await run;

        const mutations = runtimeFetchWithServerReachabilityMock.mock.calls
            .map(([request]) => request as { url: string; init?: RequestInit })
            .filter(({ url }) => url.includes('/v1/push-tokens'))
            .map(({ init }) => init?.method);
        expect(mutations).toEqual(['POST', 'DELETE']);
    });

    it('compensates a registration that completes after its Home profile is removed', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[removed]' } as never);
        const home = serverProfiles.upsertServerProfile({ serverUrl: 'https://removed.example.test', name: 'Removed' });
        serverProfiles.setActiveServerId(home.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: home.id }, { token: 'removed-home-token' });
        let finishRegistration!: () => void;
        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string; init?: RequestInit }) => {
            if (request.url.endsWith('/v1/push-tokens') && request.init?.method === 'POST') {
                await new Promise<void>((resolve) => { finishRegistration = resolve; });
            }
            return Response.json({ success: true });
        });

        const run = registerPushTokenIfAvailable({ credentials: { token: 'removed-home-token' }, log: { log: vi.fn() }, getAccountSettings: () => ({}) });
        await vi.waitFor(() => expect(finishRegistration).toBeTypeOf('function'));
        serverProfiles.removeServerProfile(home.id);
        finishRegistration();
        await run;

        const mutations = runtimeFetchWithServerReachabilityMock.mock.calls
            .map(([request]) => request as { url: string; init?: RequestInit })
            .filter(({ url }) => url.includes('/v1/push-tokens'))
            .map(({ init }) => init?.method);
        expect(mutations).toEqual(['POST', 'DELETE']);
    });

    it('compensates a registration that completes after focused Home push is disabled', async () => {
        vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: PermissionStatus.GRANTED, expires: 'never', granted: true, canAskAgain: false } as never);
        vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[disabled-race]' } as never);
        const home = serverProfiles.upsertServerProfile({ serverUrl: 'https://disabled-race.example.test', name: 'Disabled race' });
        serverProfiles.setActiveServerId(home.id, { scope: 'device' });
        await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: home.id }, { token: 'disabled-race-token' });
        let pushEnabled = true;
        let finishRegistration!: () => void;
        runtimeFetchWithServerReachabilityMock.mockImplementation(async (request: { url: string; init?: RequestInit }) => {
            if (request.url.endsWith('/v1/push-tokens') && request.init?.method === 'POST') {
                await new Promise<void>((resolve) => { finishRegistration = resolve; });
            }
            return Response.json({ success: true });
        });
        const readSettings = () => pushEnabled
            ? {}
            : { attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } } };

        const run = registerPushTokenIfAvailable({
            credentials: { token: 'disabled-race-token' },
            log: { log: vi.fn() },
            getAccountSettings: readSettings,
        });
        await vi.waitFor(() => expect(finishRegistration).toBeTypeOf('function'));
        pushEnabled = false;
        finishRegistration();
        await run;

        const mutations = runtimeFetchWithServerReachabilityMock.mock.calls
            .map(([request]) => request as { url: string; init?: RequestInit })
            .filter(({ url }) => url.includes('/v1/push-tokens'))
            .map(({ init }) => init?.method);
        expect(mutations).toEqual(['POST', 'DELETE']);
    });
});
