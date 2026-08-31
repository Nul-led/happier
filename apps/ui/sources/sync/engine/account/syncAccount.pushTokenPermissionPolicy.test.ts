import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { clearLastRegisteredExpoPushToken } from '@/sync/domains/state/pushTokenRegistration';

const mocks = vi.hoisted(() => ({
    registerPushToken: vi.fn(),
    deletePushToken: vi.fn(),
    listServerProfiles: vi.fn(),
    getActiveServerSnapshot: vi.fn(),
    getCredentialsForServerUrl: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
    getPermissionsAsync: vi.fn(),
    requestPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});

vi.mock('expo-constants', () => ({
    default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

vi.mock('@/sync/api/session/apiPush', () => ({
    registerPushToken: mocks.registerPushToken,
    deletePushToken: mocks.deletePushToken,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    listServerProfiles: mocks.listServerProfiles,
    areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left ?? '') === String(right ?? ''),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) =>
        profile.serverIdentityId ?? profile.id,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: mocks.getActiveServerSnapshot,
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: mocks.getCredentialsForServerUrl,
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));

const pushToken = 'ExponentPushToken[policy-token]';
const credentials: AuthCredentials = { token: 'active-token', secret: 'active-secret' };

function collectLogs(): { messages: string[]; log: { log: (message: string) => void } } {
    const messages: string[] = [];
    return { messages, log: { log: (message: string) => { messages.push(message); } } };
}

async function notificationsMock() {
    return await import('expo-notifications');
}

beforeEach(() => {
    mocks.registerPushToken.mockResolvedValue({ ok: true });
    mocks.listServerProfiles.mockReturnValue([{ id: 'active', serverUrl: 'https://active.example.test' }]);
    mocks.getActiveServerSnapshot.mockReturnValue({
        serverId: 'active',
        serverUrl: 'https://active.example.test',
        kind: 'custom',
        generation: 1,
    });
    mocks.getCredentialsForServerUrl.mockImplementation(async (serverUrl: string) => ({
        token: `token-${serverUrl}`,
        secret: `secret-${serverUrl}`,
    }));
});

afterEach(() => {
    vi.clearAllMocks();
    clearLastRegisteredExpoPushToken();
});

describe('registerPushTokenIfAvailable push policy', () => {
    it('skips a focused Home whose offline settings fallback disables Expo push', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: pushToken } as never);
        const { log } = collectLogs();
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({
            credentials,
            log,
            getAccountSettings: () => ({
                attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } },
            }),
            getHomeAccountSettings: async () => null,
        });

        expect(notifications.getPermissionsAsync).toHaveBeenCalled();
        expect(mocks.registerPushToken).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'token-https://active.example.test' }),
            pushToken,
            { apiEndpoint: 'https://active.example.test', runtimeOrigin: 'https://active.example.test' },
        );
    });

    it('treats a disabled focused Home as terminal with no fallback re-registration', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: pushToken } as never);
        mocks.listServerProfiles.mockReturnValue([
            { id: 'home-a', serverUrl: 'https://home-a.example.test' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
            kind: 'custom',
            generation: 1,
        });
        const { log } = collectLogs();
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({
            credentials,
            log,
            getHomeAccountSettings: async (home) => home.serverUrl.includes('home-a')
                ? { attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } } }
                : {},
        });

        // The focused Home opted out: its registration decision is terminal. The
        // legacy active-Home fallback must not re-register it after opt-out, and
        // the other Home must remain registered.
        const registerEndpoints = mocks.registerPushToken.mock.calls.map((call) => (call[2] as { apiEndpoint?: string } | undefined)?.apiEndpoint);
        expect(registerEndpoints).toEqual(['https://home-b.example.test']);
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'token-https://home-a.example.test' }),
            pushToken,
            { apiEndpoint: 'https://home-a.example.test', runtimeOrigin: 'https://home-a.example.test' },
        );
    });

    it('uses caller credentials inside the focused Home decision when stored credentials are missing', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: pushToken } as never);
        mocks.listServerProfiles.mockReturnValue([
            { id: 'home-a', serverUrl: 'https://home-a.example.test' },
            { id: 'home-b', serverUrl: 'https://home-b.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
            kind: 'custom',
            generation: 1,
        });
        mocks.getCredentialsForServerUrl.mockImplementation(async (_url: string, options?: { serverId?: string }) => (
            options?.serverId === 'home-b' ? { token: 'home-b-token', secret: 'home-b-secret' } : null
        ));
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({
            credentials,
            log: { log: vi.fn() },
            getHomeAccountSettings: async (home) => home.id === 'home-a'
                ? { attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } } }
                : {},
        });

        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
        expect(mocks.registerPushToken).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'home-b-token' }),
            pushToken,
            expect.objectContaining({ apiEndpoint: 'https://home-b.example.test' }),
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            pushToken,
            { apiEndpoint: 'https://home-a.example.test', runtimeOrigin: 'https://home-a.example.test' },
        );
    });

    it('does not let the absent-profile compatibility path bypass focused Home consent', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: pushToken } as never);
        mocks.listServerProfiles.mockReturnValue([]);
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({
            credentials,
            log: { log: vi.fn() },
            getAccountSettings: () => ({
                attentionDeliveryPolicyV1: { v: 1, channels: { expo_push: { enabled: false } } },
            }),
        });

        expect(mocks.registerPushToken).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            pushToken,
            { apiEndpoint: 'https://active.example.test', runtimeOrigin: 'https://active.example.test' },
        );
    });

    it('never triggers the OS permission prompt from background registration', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'undetermined', granted: false, canAskAgain: true,
        } as never);
        const { log } = collectLogs();
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({ credentials, log, getAccountSettings: () => ({}) });

        expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
        expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it('registers the token when permission was already granted', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: pushToken } as never);
        const { log } = collectLogs();
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({ credentials, log, getAccountSettings: () => ({}) });

        expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });

    it('returns instead of stalling when the notification runtime never answers', async () => {
        vi.useFakeTimers();
        try {
            const notifications = await notificationsMock();
            vi.mocked(notifications.getPermissionsAsync).mockImplementation(
                () => new Promise(() => {}) as never,
            );
            const { messages, log } = collectLogs();
            const { registerPushTokenIfAvailable } = await import('./syncAccount');

            let settled = false;
            const run = registerPushTokenIfAvailable({ credentials, log, getAccountSettings: () => ({}) })
                .then(() => { settled = true; });

            await vi.advanceTimersByTimeAsync(60_000);
            await run;

            expect(settled).toBe(true);
            expect(mocks.registerPushToken).not.toHaveBeenCalled();
            expect(messages.join('\n')).toContain('runtime_timeout');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns without registering when the device cannot mint a token', async () => {
        const notifications = await notificationsMock();
        vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({
            status: 'granted', granted: true, canAskAgain: true,
        } as never);
        vi.mocked(notifications.getExpoPushTokenAsync).mockRejectedValue(
            new Error('no valid "aps-environment" entitlement string found'),
        );
        const { log } = collectLogs();
        const { registerPushTokenIfAvailable } = await import('./syncAccount');

        await registerPushTokenIfAvailable({ credentials, log, getAccountSettings: () => ({}) });

        expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });
});
