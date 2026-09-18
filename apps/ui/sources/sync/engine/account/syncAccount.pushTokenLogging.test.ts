import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { clearLastRegisteredExpoPushToken, saveLastRegisteredExpoPushToken } from '@/sync/domains/state/pushTokenRegistration';

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

vi.mock('@/sync/api/session/apiPush', () => ({
    registerPushToken: mocks.registerPushToken,
    deletePushToken: mocks.deletePushToken,
}));

// Transport remains a genuine system boundary in this suite. Registration cases
// provide exact-Home consent explicitly below; an unreadable live response with no
// scoped cached projection must remain fail-closed.
vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: vi.fn(async () => Response.json({ success: true })),
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
    subscribeHomeCredentialMutations: () => () => undefined,
    TokenStorage: {
        getCredentialsForServerUrl: mocks.getCredentialsForServerUrl,
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));

const { registerPushTokenIfAvailable } = await import('./syncAccount');

const secretPushToken = 'ExponentPushToken[secret-token]';

function collectLogs(): { messages: string[]; log: { log: (message: string) => void } } {
    const messages: string[] = [];
    return {
        messages,
        log: {
            log: (message: string) => {
                messages.push(message);
            },
        },
    };
}

function profileCredentials(serverUrl: string): AuthCredentials {
    return {
        token: `token-${serverUrl}`,
        secret: `secret-${serverUrl}`,
    };
}

async function allowExactHomePush(): Promise<Record<string, never>> {
    return {};
}

async function arrangeNotifications(): Promise<void> {
    const notifications = await import('expo-notifications');
    vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    vi.mocked(notifications.requestPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    vi.mocked(notifications.getExpoPushTokenAsync).mockResolvedValue({ data: secretPushToken } as never);
}

beforeEach(() => {
    mocks.registerPushToken.mockReset();
    mocks.deletePushToken.mockReset();
    mocks.listServerProfiles.mockReset();
    mocks.getActiveServerSnapshot.mockReset();
    mocks.getCredentialsForServerUrl.mockReset();
    mocks.registerPushToken.mockResolvedValue({ ok: true });
    mocks.deletePushToken.mockResolvedValue(undefined);
    mocks.listServerProfiles.mockReturnValue([]);
    mocks.getActiveServerSnapshot.mockReturnValue({
        serverId: 'active',
        serverUrl: 'https://active.example.test',
        kind: 'custom',
        generation: 1,
    });
    mocks.getCredentialsForServerUrl.mockImplementation(async (serverUrl: string) => profileCredentials(serverUrl));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearLastRegisteredExpoPushToken();
});

describe('registerPushTokenIfAvailable logging', () => {
    it('does not log the raw push token', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([{ id: 'active', serverUrl: 'https://active.example.test' }]);
        const { messages, log } = collectLogs();

        await registerPushTokenIfAvailable({
            credentials: { token: 'active-token', secret: 'active-secret' },
            log,
            getHomeAccountSettings: allowExactHomePush,
        });

        expect(messages.join('\n')).not.toContain(secretPushToken);
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });

    it('continues registration for remaining profiles when the first profile fails', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([
            { id: 's1', serverUrl: 'https://s1.example.test' },
            { id: 's2', serverUrl: 'https://s2.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 's2',
            serverUrl: 'https://s2.example.test',
            kind: 'custom',
            generation: 1,
        });
        mocks.registerPushToken
            .mockRejectedValueOnce(new Error('first server down'))
            .mockResolvedValueOnce({ ok: true });
        const { messages, log } = collectLogs();

        await registerPushTokenIfAvailable({
            credentials: { token: 'fallback-token', secret: 'fallback-secret' },
            log,
            getHomeAccountSettings: allowExactHomePush,
        });

        expect(mocks.getCredentialsForServerUrl).toHaveBeenCalledWith(
            'https://s1.example.test',
            { serverId: 's1' },
        );
        expect(mocks.getCredentialsForServerUrl).toHaveBeenCalledWith(
            'https://s2.example.test',
            { serverId: 's2' },
        );
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(2);
        expect(mocks.registerPushToken.mock.calls[0]?.[2]).toMatchObject({
            apiEndpoint: 'https://s1.example.test',
            clientServerUrl: 'https://s1.example.test',
        });
        expect(mocks.registerPushToken.mock.calls[1]?.[2]).toMatchObject({
            apiEndpoint: 'https://s2.example.test',
            clientServerUrl: 'https://s2.example.test',
        });
        expect(messages.join('\n')).toContain('Push token registered successfully');
        expect(messages.join('\n')).not.toContain(secretPushToken);
    });

    it('does not retry an enumerated active Home when its registration fails', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([
            { id: 's1', serverUrl: 'https://s1.example.test' },
            { id: 's2', serverUrl: 'https://s2.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 's2',
            serverUrl: 'https://s2.example.test',
            kind: 'custom',
            generation: 1,
        });
        mocks.registerPushToken
            .mockResolvedValueOnce({ ok: true })
            .mockRejectedValueOnce(new Error('active profile failed'));
        const { messages, log } = collectLogs();

        await registerPushTokenIfAvailable({
            credentials: { token: 'active-server-token', secret: 'active-server-secret' },
            log,
            getHomeAccountSettings: allowExactHomePush,
        });

        expect(mocks.registerPushToken).toHaveBeenCalledTimes(2);
        expect(mocks.registerPushToken.mock.calls[0]?.[2]).toMatchObject({
            apiEndpoint: 'https://s1.example.test',
            clientServerUrl: 'https://s1.example.test',
        });
        expect(mocks.registerPushToken.mock.calls[1]?.[2]).toMatchObject({
            apiEndpoint: 'https://s2.example.test',
            clientServerUrl: 'https://s2.example.test',
        });
        expect(messages.join('\n')).toContain('Push token registered successfully');
        expect(messages.join('\n')).not.toContain(secretPushToken);
    });

    it('does not act on an active server missing from the canonical profile snapshot', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([{ id: 'profile', serverUrl: 'https://profile.example.test' }]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 'active',
            serverUrl: 'https://active.example.test',
            kind: 'custom',
            generation: 1,
        });
        mocks.registerPushToken
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true });
        mocks.deletePushToken.mockResolvedValue(undefined);
        saveLastRegisteredExpoPushToken('ExponentPushToken[old-token]');
        const { messages, log } = collectLogs();

        await registerPushTokenIfAvailable({
            credentials: { token: 'active-server-token', secret: 'active-server-secret' },
            log,
            getHomeAccountSettings: allowExactHomePush,
        });

        // Freshness checks may reread this exact Home credential around awaits;
        // no read may drift to the absent focused Home's credential namespace.
        expect(mocks.getCredentialsForServerUrl).toHaveBeenCalled();
        expect(mocks.getCredentialsForServerUrl.mock.calls.every(([serverUrl, options]) => (
            serverUrl === 'https://profile.example.test'
            && (options as { serverId?: string } | undefined)?.serverId === 'profile'
        ))).toBe(true);
        expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
        expect(mocks.registerPushToken.mock.calls[0]?.[2]).toMatchObject({
            apiEndpoint: 'https://profile.example.test',
            clientServerUrl: 'https://profile.example.test',
        });
        expect(mocks.deletePushToken.mock.calls.some(([credential]) => (
            (credential as AuthCredentials).token === 'active-server-token'
        ))).toBe(false);
        expect(messages.join('\n')).toContain('Push token registered successfully');
        expect(messages.join('\n')).not.toContain(secretPushToken);
    });

    it('does not substitute captured caller credentials after focus changes during credential lookup', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([{ id: 'home-a', serverUrl: 'https://home-a.example.test' }]);
        let activeServerId = 'home-a';
        mocks.getActiveServerSnapshot.mockImplementation(() => ({
            serverId: activeServerId,
            serverUrl: `https://${activeServerId}.example.test`,
            kind: 'custom',
            generation: 1,
        }));
        let finishCredentialRead!: () => void;
        mocks.getCredentialsForServerUrl.mockImplementation(async () => {
            await new Promise<void>((resolve) => { finishCredentialRead = resolve; });
            return null;
        });

        const run = registerPushTokenIfAvailable({
            credentials: { token: 'home-a-caller-token', secret: 'home-a-caller-secret' },
            log: { log: vi.fn() },
        });
        await vi.waitFor(() => expect(finishCredentialRead).toBeTypeOf('function'));
        activeServerId = 'home-b';
        finishCredentialRead();
        await run;

        expect(mocks.registerPushToken).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).not.toHaveBeenCalled();
    });

    it('logs an overall failure when all profile attempts fail', async () => {
        await arrangeNotifications();
        mocks.listServerProfiles.mockReturnValue([
            { id: 's1', serverUrl: 'https://s1.example.test' },
            { id: 's2', serverUrl: 'https://s2.example.test' },
        ]);
        mocks.getActiveServerSnapshot.mockReturnValue({
            serverId: 's2',
            serverUrl: 'https://s2.example.test',
            kind: 'custom',
            generation: 1,
        });
        mocks.registerPushToken
            .mockRejectedValueOnce(new Error('s1 down'))
            .mockRejectedValueOnce(new Error('s2 down'));
        const { messages, log } = collectLogs();

        await registerPushTokenIfAvailable({
            credentials: { token: 'fallback-token', secret: 'fallback-secret' },
            log,
            getHomeAccountSettings: allowExactHomePush,
        });

        expect(mocks.registerPushToken).toHaveBeenCalledTimes(2);
        expect(messages.join('\n')).toContain('Failed to register push token for https://s1.example.test');
        expect(messages.join('\n')).toContain('Failed to register push token for https://s2.example.test');
        expect(messages.join('\n')).toContain('Failed to register push token:');
        expect(messages.join('\n')).not.toContain(secretPushToken);
    });
});
