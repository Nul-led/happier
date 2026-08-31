import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
});

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

describe('removeServerProfileUiAction', () => {
    it('clears server-scoped credentials before removing the profile', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = profiles.upsertServerProfile({
            serverUrl: 'https://server-a.example.test',
            name: 'Server A',
        });
        profiles.setActiveServerId(profile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.setCredentials({ token: 'token-a', secret: 'secret-a' })).resolves.toBe(true);
        await expect(TokenStorage.getCredentialsForServerUrl(profile.serverUrl)).resolves.toEqual({
            token: 'token-a',
            secret: 'secret-a',
        });

        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        await removeServerProfileUiAction({ profileId: profile.id, serverUrl: profile.serverUrl });

        const readded = profiles.upsertServerProfile({ serverUrl: profile.serverUrl, name: 'Server A (again)' });
        expect(readded.id).toBe(profile.id);
        await expect(TokenStorage.getCredentialsForServerUrl(profile.serverUrl)).resolves.toBeNull();

        localStorageHandle.restore();
    });

    it('removes only the target profile and credential before best-effort push cleanup settles', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();
        let releaseCleanup!: () => void;
        const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
        const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'DELETE') await cleanupGate;
            return Response.json({ success: true });
        });
        vi.stubGlobal('fetch', fetchSpy);

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const removedProfile = profiles.upsertServerProfile({
            serverUrl: 'https://removed.example.test',
            name: 'Removed',
        });
        const retainedProfile = profiles.upsertServerProfile({
            serverUrl: 'https://retained.example.test',
            name: 'Retained',
        });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await TokenStorage.setCredentialsForServerUrl(
            removedProfile.serverUrl,
            { serverId: removedProfile.id },
            { token: 'removed-token', secret: 'removed-secret' },
        );
        await TokenStorage.setCredentialsForServerUrl(
            retainedProfile.serverUrl,
            { serverId: retainedProfile.id },
            { token: 'retained-token', secret: 'retained-secret' },
        );
        const { saveExpoPushTokenGeneration } = await import('@/sync/domains/state/pushTokenRegistration');
        saveExpoPushTokenGeneration({
            current: 'ExponentPushToken[current]',
            cleanupPending: 'ExponentPushToken[last]',
        });

        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        const removal = removeServerProfileUiAction({
            profileId: removedProfile.id,
            serverUrl: removedProfile.serverUrl,
        });
        await vi.waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));

        expect(profiles.getServerProfileById(removedProfile.id)).toBeNull();
        expect(profiles.getServerProfileById(retainedProfile.id)).not.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            removedProfile.serverUrl,
            { serverId: removedProfile.id },
        )).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            retainedProfile.serverUrl,
            { serverId: retainedProfile.id },
        )).resolves.toMatchObject({ token: 'retained-token' });

        releaseCleanup();
        await removal;

        const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE');
        expect(deleteCalls).toHaveLength(2);
        expect(new Set(deleteCalls.map(([url]) => String(url)))).toEqual(new Set([
            'https://removed.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
            'https://removed.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
        ]));
        expect(new Headers(deleteCalls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer removed-token');

        localStorageHandle.restore();
    });

    it('blocks marked nonactive server removal before credentials or the profile are mutated', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const targetProfile = profiles.upsertServerProfile({
            serverUrl: 'https://marked.example.test',
            name: 'Marked',
        });
        const activeProfile = profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        profiles.setActiveServerId(targetProfile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.setCredentials({
            token: 'marked-token',
            secret: 'marked-secret',
        })).resolves.toBe(true);
        const createdAt = Date.now();
        await expect(TokenStorage.setPendingExternalAuth({
            provider: 'github',
            proof: 'proof',
            secret: 'marked-secret',
            serverId: targetProfile.id,
            serverUrl: targetProfile.serverUrl,
            returnTo: '/settings/account',
            accountEncryptionFirstKey: {
                accountId: 'account-1',
                requestDigest: `aemrb1_${'A'.repeat(43)}`,
                requestJson: '{"toMode":"e2ee"}',
                createdAt,
                expiresAt: createdAt + 10 * 60 * 1000,
                pending: 'oauth-pending',
                migrationSubmissionAttempted: true,
            },
        })).resolves.toBe(true);
        profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        const result = await removeServerProfileUiAction({
            profileId: targetProfile.id,
            serverUrl: targetProfile.serverUrl,
        });

        expect(result).toMatchObject({
            kind: 'finish_encryption_setup',
        });
        expect(profiles.getServerProfileById(targetProfile.id)).not.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            targetProfile.serverUrl,
            { serverId: targetProfile.id },
        )).resolves.toEqual({
            token: 'marked-token',
            secret: 'marked-secret',
        });

        localStorageHandle.restore();
    });

    it('does not remove the profile when target credential deletion fails', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = profiles.upsertServerProfile({
            serverUrl: 'https://delete-failure.example.test',
            name: 'Delete failure',
        });
        profiles.setActiveServerId(profile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        vi.spyOn(TokenStorage, 'removeCredentialsForServerUrl')
            .mockResolvedValue(false);

        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        await expect(removeServerProfileUiAction({
            profileId: profile.id,
            serverUrl: profile.serverUrl,
        })).rejects.toThrow('Failed to remove server credentials');

        expect(profiles.getServerProfileById(profile.id)).not.toBeNull();
        localStorageHandle.restore();
    });
});
