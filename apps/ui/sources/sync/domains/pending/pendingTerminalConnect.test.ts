import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageState } from '@/sync/store/types';
import { fromRecord, toRecord } from './pendingTerminalConnect.shared';

async function importFresh() {
    vi.resetModules();
    return await import('./pendingTerminalConnect');
}

async function activateServerAccount(serverUrl: string, accountId: string) {
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const { createServerAccountScope } = await import('@/sync/domains/scope/serverAccountScope');
    const { registerStorageStateReader } = await import('@/sync/domains/state/storageStateReaderBridge');

    const server = upsertAndActivateServer({
        serverUrl,
        source: 'manual',
        scope: 'device',
        replaceEquivalentStoredUrl: true,
    });
    const scope = createServerAccountScope(server.id, accountId);
    expect(scope).not.toBeNull();
    registerStorageStateReader(() => ({ profileScope: scope } as unknown as StorageState));
}

describe('pendingTerminalConnect', () => {
    afterEach(async () => {
        const { clearPendingTerminalConnect } = await importFresh();
        clearPendingTerminalConnect();
        vi.restoreAllMocks();
    });

    it('rejects missing or malformed stable Home identity in pending state', () => {
        expect(toRecord({
            publicKeyB64Url: 'key',
            serverUrl: 'https://stack.example.test',
        } as never)).toBeNull();
        expect(toRecord({
            publicKeyB64Url: 'key',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'not a stable identity',
        })).toBeNull();
        expect(fromRecord({
            publicKeyB64Url: 'key',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'not a stable identity',
            createdAtMs: Date.now(),
        })).toBeNull();
    });

    it('round-trips a pending terminal connect payload', async () => {
        const { setPendingTerminalConnect, getPendingTerminalConnect } = await importFresh();

        await activateServerAccount('https://stack.example.test', 'account-a');
        expect(getPendingTerminalConnect()).toBeNull();

        setPendingTerminalConnect({
            publicKeyB64Url: 'abcDEF_123-zzz',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'srv_stack',
            supportsTokenOnly: true,
            pairing: {
                secretB64Url: 'pairing-secret',
                createdAtMs: 1_000,
                expiresAtMs: 61_000,
            },
        });

        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'abcDEF_123-zzz',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'srv_stack',
            supportsTokenOnly: true,
            pairing: {
                secretB64Url: 'pairing-secret',
                createdAtMs: 1_000,
                expiresAtMs: 61_000,
            },
        });
    });

    it('round-trips the strict V4 Home descriptor without weakening its identity binding', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_v4_pending',
            canonicalServerUrl: 'https://home.example.test',
            revision: 1,
            endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
        };
        const pending = {
            publicKeyB64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            serverUrl: 'https://home.example.test',
            serverIdentityId: 'srv_v4_pending',
            pairing: {
                secretB64Url: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
                createdAtMs: 1_000,
                expiresAtMs: 61_000,
            },
            supportsTokenOnly: true as const,
            homeConnectionDescriptor: descriptor,
        };

        expect(fromRecord({ ...pending, createdAtMs: Date.now() })).toEqual(pending);
        expect(toRecord({
            ...pending,
            serverIdentityId: 'srv_other_home',
        })).toBeNull();
    });

    it('expires stale pending payloads', async () => {
        const now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const { setPendingTerminalConnect, getPendingTerminalConnect } = await importFresh();

        await activateServerAccount('https://stack.example.test', 'account-a');
        setPendingTerminalConnect({
            publicKeyB64Url: 'abcDEF_123-zzz',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'srv_stack',
        });
        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'abcDEF_123-zzz',
            serverUrl: 'https://stack.example.test',
            serverIdentityId: 'srv_stack',
        });

        vi.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000);
        expect(getPendingTerminalConnect()).toBeNull();
    });

    it('keeps pending payloads isolated by active server', async () => {
        const { setPendingTerminalConnect, getPendingTerminalConnect, clearPendingTerminalConnect } = await importFresh();

        await activateServerAccount('https://server-a.example.test', 'account-a');
        clearPendingTerminalConnect();
        setPendingTerminalConnect({
            publicKeyB64Url: 'key-a',
            serverUrl: 'https://server-a.example.test',
            serverIdentityId: 'srv_a',
        });

        await activateServerAccount('https://server-b.example.test', 'account-a');
        clearPendingTerminalConnect();
        expect(getPendingTerminalConnect()).toBeNull();
        setPendingTerminalConnect({
            publicKeyB64Url: 'key-b',
            serverUrl: 'https://server-b.example.test',
            serverIdentityId: 'srv_b',
        });

        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'key-b',
            serverUrl: 'https://server-b.example.test',
            serverIdentityId: 'srv_b',
        });

        await activateServerAccount('https://server-a.example.test', 'account-a');
        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'key-a',
            serverUrl: 'https://server-a.example.test',
            serverIdentityId: 'srv_a',
        });
    });

    it('keeps pending payloads isolated by active account on the same server', async () => {
        const { setPendingTerminalConnect, getPendingTerminalConnect, clearPendingTerminalConnect } = await importFresh();

        await activateServerAccount('https://shared.example.test', 'account-a');
        clearPendingTerminalConnect();
        setPendingTerminalConnect({
            publicKeyB64Url: 'key-a',
            serverUrl: 'https://shared.example.test',
            serverIdentityId: 'srv_shared',
        });

        await activateServerAccount('https://shared.example.test', 'account-b');
        clearPendingTerminalConnect();
        expect(getPendingTerminalConnect()).toBeNull();
        setPendingTerminalConnect({
            publicKeyB64Url: 'key-b',
            serverUrl: 'https://shared.example.test',
            serverIdentityId: 'srv_shared',
        });

        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'key-b',
            serverUrl: 'https://shared.example.test',
            serverIdentityId: 'srv_shared',
        });

        await activateServerAccount('https://shared.example.test', 'account-a');
        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'key-a',
            serverUrl: 'https://shared.example.test',
            serverIdentityId: 'srv_shared',
        });
    });

    it('absorbs a host-derived scoped terminal connect into an identity scope', async () => {
        const {
            getPendingTerminalConnect,
            migratePendingTerminalConnectScopes,
            setPendingTerminalConnect,
        } = await importFresh();
        const { createServerAccountScope } = await import('@/sync/domains/scope/serverAccountScope');
        const { setServerProfileIdentityForUrl } = await import('@/sync/domains/server/serverProfiles');
        const { registerStorageStateReader } = await import('@/sync/domains/state/storageStateReaderBridge');

        await activateServerAccount('https://identity-terminal.example.test', 'account-a');
        setPendingTerminalConnect({
            publicKeyB64Url: 'key-identity',
            serverUrl: 'https://identity-terminal.example.test',
            serverIdentityId: 'srv_identity_terminal',
        });

        setServerProfileIdentityForUrl('https://identity-terminal.example.test', 'srv_identity_terminal');
        const legacyScope = createServerAccountScope('identity-terminal.example.test', 'account-a');
        const identityScope = createServerAccountScope('srv_identity_terminal', 'account-a');
        expect(legacyScope).not.toBeNull();
        expect(identityScope).not.toBeNull();
        registerStorageStateReader(() => ({ profileScope: identityScope } as unknown as StorageState));

        migratePendingTerminalConnectScopes(identityScope!, [legacyScope!]);

        expect(getPendingTerminalConnect()).toEqual({
            publicKeyB64Url: 'key-identity',
            serverUrl: 'https://identity-terminal.example.test',
            serverIdentityId: 'srv_identity_terminal',
        });
        registerStorageStateReader(() => ({ profileScope: legacyScope } as unknown as StorageState));
        expect(getPendingTerminalConnect()).toBeNull();
    });
});
