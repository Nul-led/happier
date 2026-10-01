import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';

const mocks = vi.hoisted(() => ({
    syncSwitchServer: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    sync: { retryNow: vi.fn() },
    syncSwitchServer: (...args: unknown[]) => mocks.syncSwitchServer(...args),
    syncRestore: vi.fn(async () => undefined),
}));

vi.mock('@/sync/http/client', () => ({
    abortServerFetches: vi.fn(),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: vi.fn(async () => null),
        getCredentialsForServerUrl: vi.fn(async () => null),
    },
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    getIrohHomeTunnelRuntime: () => ({
        releaseActiveHomeTunnels: vi.fn(async () => undefined),
        releaseLeasesForStaleTargets: vi.fn(async () => undefined),
    }),
}));

vi.mock('@/sync/ops/account/accountEncryptionFirstKeyExternalAuth', () => ({
    guardAccountEncryptionFirstKeyCredentialMutation: vi.fn(async () => ({ kind: 'allowed' })),
}));

vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: async (params: {
        run: () => Promise<{ kind: string }>;
    }) => await params.run(),
}));

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

describe('active focus transaction with the production connection manager', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        vi.clearAllMocks();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('does not hand focused ownership to the next Home until full Sync applies the current Home', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        vi.stubGlobal('window', { location: { origin: 'https://origin.example.test' } });
        vi.stubGlobal('document', {});
        const lockTails = new Map<string, Promise<void>>();
        vi.stubGlobal('navigator', {
            locks: {
                request: <T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> => {
                    const previous = lockTails.get(name) ?? Promise.resolve();
                    const result = previous.then(callback);
                    lockTails.set(name, result.then(() => undefined, () => undefined));
                    return result;
                },
            },
        });

        const firstSwitchStarted = createDeferred<void>();
        const releaseFirstSwitch = createDeferred<void>();
        let switchCount = 0;
        mocks.syncSwitchServer.mockImplementation(async () => {
            switchCount += 1;
            if (switchCount !== 1) return;
            firstSwitchStarted.resolve();
            await releaseFirstSwitch.promise;
        });

        const profiles = await import('./serverProfiles');
        const active = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const middle = await profiles.upsertServerProfile({
            serverUrl: 'https://middle.example.test',
            name: 'Middle',
        });
        const final = await profiles.upsertServerProfile({
            serverUrl: 'https://final.example.test',
            name: 'Final',
        });
        await profiles.setActiveServerId(active.id, { scope: 'device' });
        const [switches, connection] = await Promise.all([
            import('./activeServerSwitch'),
            import('@/sync/runtime/orchestration/connectionManager'),
        ]);

        const first = switches.setActiveServerAndSwitch({ serverId: middle.id, scope: 'device' });
        await firstSwitchStarted.promise;
        const second = switches.setActiveServerAndSwitch({ serverId: final.id, scope: 'device' });

        await Promise.resolve();
        expect(profiles.getActiveServerId()).toBe(middle.id);
        expect(connection.getAppliedActiveServerId()).toBe(active.id);
        expect(mocks.syncSwitchServer).toHaveBeenCalledTimes(1);

        releaseFirstSwitch.resolve();
        await expect(Promise.all([first, second])).resolves.toEqual(['switched', 'switched']);

        expect(profiles.getActiveServerId()).toBe(final.id);
        expect(connection.getAppliedActiveServerId()).toBe(final.id);
        expect(mocks.syncSwitchServer).toHaveBeenCalledTimes(2);
    });
});
