import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

// Connection boundary: focus staging, the persisted profile store, credential
// storage and the first-key custody owner below it are the real modules.
const connection = vi.hoisted(() => ({ switches: 0 }));
vi.mock('@/sync/runtime/orchestration/connectionManager', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/connectionManager')>(),
    switchConnectionToActiveServer: async () => {
        connection.switches += 1;
        return null;
    },
}));
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    abortServerFetches: vi.fn(),
}));
vi.mock('@/sync/sync', () => ({ syncSwitchServer: vi.fn(async () => {}) }));

// Presentation boundary: records the custody outcome the switch surfaces instead of opening a modal.
const presented = vi.hoisted(() => ({ outcomes: [] as string[] }));
vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: async (params: Readonly<{ run: () => Promise<{ kind: string }> }>) => {
        const result = await params.run();
        presented.outcomes.push(result.kind);
    },
}));

function stubWebRuntime(origin: string): void {
    const session = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => session.get(key) ?? null,
        setItem: (key: string, value: string) => void session.set(key, String(value)),
        removeItem: (key: string) => void session.delete(key),
        clear: () => void session.clear(),
    });
    vi.stubGlobal('window', { location: { origin }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { getElementById: () => null });
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
}

describe('active Home switch and retained first-key custody', () => {
    let restoreLocalStorage: (() => void) | null = null;
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    beforeEach(() => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `first_key_custody_scope_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        stubWebRuntime('https://origin.example.test');
        restoreLocalStorage = installLocalStorageMock().restore;
        connection.switches = 0;
        presented.outcomes.length = 0;
        vi.resetModules();
    });

    afterEach(() => {
        restoreLocalStorage?.();
        vi.unstubAllGlobals();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('lets focus move between other Homes, keeps Home A\'s custody, and surfaces it on return', async () => {
        const profiles = await import('./serverProfiles');
        const switches = await import('./activeServerSwitch');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://home-a.example.test', name: 'A' });
        const homeB = await profiles.upsertServerProfile({ serverUrl: 'https://home-b.example.test', name: 'B' });
        const homeC = await profiles.upsertServerProfile({ serverUrl: 'https://home-c.example.test', name: 'C' });
        await profiles.setActiveServerId(homeB.id, { scope: 'device' });
        await expect(TokenStorage.setPendingExternalAuth({
            provider: 'github',
            proof: 'proof',
            secret: 'secret',
            serverId: homeA.id,
            serverUrl: homeA.serverUrl,
            accountEncryptionFirstKey: {
                accountId: 'account-home-a',
                requestDigest: `aemrb1_${'A'.repeat(43)}`,
                requestJson: '{}',
                pending: 'pending',
                createdAt: Date.now(),
                expiresAt: Date.now() + 60_000,
                migrationSubmissionAttempted: true,
            },
        }, { serverUrl: homeA.serverUrl, serverId: homeA.id })).resolves.toBe(true);
        const readHomeACustody = async () => (
            await TokenStorage.readPendingExternalAuthStateForServerUrl(homeA.serverUrl, { serverId: homeA.id })
        ).value?.accountEncryptionFirstKey?.migrationSubmissionAttempted ?? null;

        // An unrelated focus change is not a credential mutation of Home A.
        await expect(switches.setActiveServerAndSwitch({ serverId: homeC.id, scope: 'device' })).resolves.toBe('switched');
        expect(profiles.getActiveServerId()).toBe(homeC.id);
        expect(connection.switches).toBe(1);
        await expect(readHomeACustody()).resolves.toBe(true);

        // Returning to Home A keeps the custody and presents its recovery.
        await expect(switches.setActiveServerAndSwitch({ serverId: homeA.id, scope: 'device' })).resolves.toBe('switched');
        expect(profiles.getActiveServerId()).toBe(homeA.id);
        expect(presented.outcomes.at(-1)).toBe('finish_encryption_setup');
        await expect(readHomeACustody()).resolves.toBe(true);
    });
});
