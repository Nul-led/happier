import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';

// The desktop's system-task bridge is the boundary for this computer's services; off the desktop
// (every other case here) the real runtime has no local bridge and the disconnect is not applicable.
const desktopRunner = vi.hoisted(() => ({
    runner: null as unknown,
    starts: [] as string[],
    reply: { ok: true, data: { outcome: 'removed' } } as { ok: true; data: Record<string, unknown> } | { ok: false; code: string },
    subscribeError: null as string | null,
}));
const modalSpies = vi.hoisted(() => ({ alerts: [] as string[], confirmAnswers: [] as boolean[], confirms: 0 }));
vi.mock('@/components/systemTasks/systemTasksRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/systemTasks/systemTasksRuntime')>();
    return { ...actual, getSystemTasksRunner: () => (desktopRunner.runner ?? actual.getSystemTasksRunner()) as never };
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alert: (title) => { modalSpies.alerts.push(title); },
            confirm: async () => {
                modalSpies.confirms += 1;
                return modalSpies.confirmAnswers.shift() ?? false;
            },
        },
    }).module;
});

afterEach(() => {
    try {
        const localStorage = (globalThis as { localStorage?: Storage }).localStorage;
        for (let index = localStorage?.length ?? 0; index > 0; index -= 1) {
            const key = localStorage?.key(index - 1);
            if (key?.includes('push-token-registration')) localStorage?.removeItem(key);
        }
    } catch {
        // Test cleanup is best-effort when a case deliberately breaks storage.
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
});

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Transform the real graph during collection; cases still reload it after setting their scope.
await import('./removeServerProfileUiAction');
await import('@/components/systemTasks/createSystemTaskRunner');
vi.resetModules();

describe('removeServerProfileUiAction', () => {
    it('clears server-scoped credentials before removing the profile', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://server-a.example.test',
            name: 'Server A',
        });
        await profiles.setActiveServerId(profile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.setCredentials({ token: 'token-a', secret: 'secret-a' })).resolves.toBe(true);
        await expect(TokenStorage.getCredentialsForServerUrl(profile.serverUrl)).resolves.toEqual({
            token: 'token-a',
            secret: 'secret-a',
        });

        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        await removeServerProfileUiAction({ profileId: profile.id, serverUrl: profile.serverUrl });

        const readded = await profiles.upsertServerProfile({ serverUrl: profile.serverUrl, name: 'Server A (again)' });
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
        const removedProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://removed.example.test',
            name: 'Removed',
        });
        const retainedProfile = await profiles.upsertServerProfile({
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
        let removalSettled = false;
        const removal = removeServerProfileUiAction({
            profileId: removedProfile.id,
            serverUrl: removedProfile.serverUrl,
        }).then((result) => {
            removalSettled = true;
            return result;
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

        try {
            await vi.waitFor(() => expect(removalSettled).toBe(true));
        } finally {
            releaseCleanup();
            await removal;
        }

        const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE');
        expect(deleteCalls).toHaveLength(2);
        expect(new Set(deleteCalls.map(([url]) => String(url)))).toEqual(new Set([
            'https://removed.example.test/v1/push-tokens/ExponentPushToken%5Bcurrent%5D',
            'https://removed.example.test/v1/push-tokens/ExponentPushToken%5Blast%5D',
        ]));
        expect(new Headers(deleteCalls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer removed-token');

        localStorageHandle.restore();
    });

    it('is idempotent when the same target removal is repeated', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://repeat-removal.example.test',
            name: 'Repeat removal',
        });
        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');

        await expect(removeServerProfileUiAction({
            profileId: profile.id,
            serverUrl: profile.serverUrl,
        })).resolves.toEqual({ kind: 'completed' });
        await expect(removeServerProfileUiAction({
            profileId: profile.id,
            serverUrl: profile.serverUrl,
        })).resolves.toEqual({ kind: 'completed' });

        expect(profiles.getServerProfileById(profile.id)).toBeNull();
        localStorageHandle.restore();
    });

    it('blocks marked nonactive server removal before credentials or the profile are mutated', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://marked.example.test',
            name: 'Marked',
        });
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        await profiles.setActiveServerId(targetProfile.id, { scope: 'device' });

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
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

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
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://delete-failure.example.test',
            name: 'Delete failure',
        });
        await profiles.setActiveServerId(profile.id, { scope: 'device' });

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

describe('removeServerProfileUiAction — this computer stops serving the Home first (R15 c, R13C-P3-5)', () => {
    async function setUp() {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();
        const { createSystemTaskRunner } = await import('@/components/systemTasks/createSystemTaskRunner');
        desktopRunner.starts = [];
        modalSpies.alerts = [];
        modalSpies.confirmAnswers = [];
        modalSpies.confirms = 0;
        desktopRunner.subscribeError = null;
        desktopRunner.runner = createSystemTaskRunner({
            mode: 'tauri',
            bridge: {
                async start(spec) {
                    desktopRunner.starts.push(spec.kind);
                    return `task_${desktopRunner.starts.length}`;
                },
                async subscribe(taskId, listenerSet) {
                    if (desktopRunner.subscribeError) throw new Error(desktopRunner.subscribeError);
                    const reply = desktopRunner.reply;
                    setTimeout(() => listenerSet.onResult(reply.ok
                        ? { protocolVersion: 1, taskId, ok: true, data: reply.data as never }
                        : { protocolVersion: 1, taskId, ok: false, error: { code: reply.code, message: 'failed' } }), 0);
                    return () => {};
                },
                async cancel() {},
                async respond() {},
            },
        });
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const home = await profiles.upsertServerProfile({ serverUrl: 'https://company.example.test', name: 'Company' });
        const { removeServerProfileUiAction } = await import('./removeServerProfileUiAction');
        const remove = (extra: Record<string, unknown> = {}) =>
            removeServerProfileUiAction({ profileId: home.id, serverUrl: home.serverUrl, ...extra });
        const stillSaved = () => profiles.getServerProfileById(home.id) !== null;
        return { remove, stillSaved, restore: () => { desktopRunner.runner = null; localStorageHandle.restore(); } };
    }

    it('uninstalls this computer\'s service for the Home before forgetting it, on every removal path', async () => {
        const t = await setUp();
        desktopRunner.reply = { ok: true, data: { outcome: 'removed' } };
        await expect(t.remove()).resolves.toEqual({ kind: 'completed' });
        expect(desktopRunner.starts).toEqual(['daemon.service.relay.disconnect.v1']);
        expect(t.stillSaved()).toBe(false);
        t.restore();
    });

    it('keeps the Home when its service could not be uninstalled, and says so', async () => {
        const t = await setUp();
        desktopRunner.reply = { ok: false, code: 'service_uninstall_failed' };
        await expect(t.remove()).resolves.toEqual({ kind: 'kept' });
        expect(modalSpies.alerts).toHaveLength(1);
        expect(t.stillSaved()).toBe(true);
        t.restore();
    });

    it('asks before removing anyway when this computer\'s services could not be read', async () => {
        const t = await setUp();
        desktopRunner.reply = { ok: false, code: 'service_inventory_unavailable' };
        modalSpies.confirmAnswers = [false];
        await expect(t.remove()).resolves.toEqual({ kind: 'kept' });
        expect(t.stillSaved()).toBe(true);
        modalSpies.confirmAnswers = [true];
        await expect(t.remove()).resolves.toEqual({ kind: 'completed' });
        expect(modalSpies.confirms).toBe(2);
        expect(t.stillSaved()).toBe(false);
        t.restore();
    });

    it('leaves a service the user installed, says so, and still forgets the Home', async () => {
        const t = await setUp();
        desktopRunner.reply = { ok: true, data: { outcome: 'user_owned', label: 'happier-daemon.company' } };
        await expect(t.remove()).resolves.toEqual({ kind: 'completed' });
        expect(modalSpies.alerts).toHaveLength(1);
        t.restore();
    });

    it('does not disconnect twice for the caller that already did (the Personal Home erase)', async () => {
        const t = await setUp();
        await expect(t.remove({ thisComputer: 'disconnected' })).resolves.toEqual({ kind: 'completed' });
        expect(desktopRunner.starts).toEqual([]);
        t.restore();
    });

    it('keeps the Home when the disconnect broke off after it started, and asks only when no bridge existed', async () => {
        const t = await setUp();
        // The task started on this computer, then the connection to it failed: it may have uninstalled.
        desktopRunner.subscribeError = 'channel closed';
        await expect(t.remove()).resolves.toEqual({ kind: 'kept' });
        expect(modalSpies.confirms).toBe(0);
        expect(modalSpies.alerts).toHaveLength(1);
        // No bridge at all: nothing was attempted, so the person may remove it anyway.
        desktopRunner.subscribeError = 'system_tasks_unavailable';
        modalSpies.confirmAnswers = [false];
        await expect(t.remove()).resolves.toEqual({ kind: 'kept' });
        expect(modalSpies.confirms).toBe(1);
        t.restore();
    });
});
