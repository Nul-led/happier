import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) {
            return kvStore.get(key);
        }
        set(key: string, value: string) {
            kvStore.set(key, value);
        }
        delete(key: string) {
            kvStore.delete(key);
        }
        getAllKeys() {
            return [...kvStore.keys()];
        }
        clearAll() {
            kvStore.clear();
        }
        trim() {}
    }
    return { MMKV };
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getActiveServerSnapshot, upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { buildSessionListRenderableFromCacheEntry } from '@/sync/domains/state/warmCacheAdapters';
import {
    clearWarmCacheAccountScope,
    loadSessionListWarmCacheEntries,
    saveSessionListWarmCacheEntries,
    setWarmCacheAccountScope,
    type SessionListCacheEntryV1,
} from '@/sync/domains/state/warmCachePersistence';
import { prepareWarmCacheEncryptionKey } from '@/sync/domains/state/warmCacheEncryptionKey';

import { prepareSessionListAccountScope } from './concurrentSessionCache';

function cacheEntry(sessionId: string): SessionListCacheEntryV1 {
    return {
        sessionId,
        metadataVersion: 1,
        agentStateVersion: 1,
        updatedAt: 20,
        createdAt: 10,
        active: false,
        activeAt: 20,
        archivedAt: null,
        pendingCount: 0,
        pendingVersion: 0,
        accessLevel: 'edit',
        canApprovePermissions: true,
        name: sessionId,
        path: `/home/u/${sessionId}`,
        homeDir: '/home/u',
        host: 'mbp',
        machineId: 'm1',
        hasPendingPermissionRequests: false,
        hasPendingUserActionRequests: false,
    } as SessionListCacheEntryV1;
}

describe('focused-Home retained rows before the runtime is applied', () => {
    beforeEach(async () => {
        kvStore.clear();
        clearWarmCacheAccountScope();
        await prepareWarmCacheEncryptionKey();
    });

    function hydrateFocusedHome(accountId: string): string {
        upsertAndActivateServer({ serverUrl: 'http://localhost:53292', scope: 'tab' });
        const serverId = getActiveServerSnapshot().serverId;
        const entries = { s1: cacheEntry('s1') };
        saveSessionListWarmCacheEntries(serverId, accountId, entries);
        // What Sync's local restore phase does: Account-keyed cache into the store,
        // while no carrier or runtime exists yet (offline, or an unreachable Home).
        setWarmCacheAccountScope(accountId);
        storage.getState().applyServerScopedSessionListRows(
            serverId,
            Object.values(entries).map(buildSessionListRenderableFromCacheEntry),
            { source: 'ordinary', mode: 'replace' },
        );
        return serverId;
    }

    it('keeps the same Account\'s locally restored rows and their persisted cache when a list consumer binds', () => {
        const serverId = hydrateFocusedHome('account-a');

        prepareSessionListAccountScope({ serverId, accountId: 'account-a' });

        expect(storage.getState().ordinarySessionListMembershipByServerId[serverId]).toEqual(['s1']);
        expect(Object.keys(loadSessionListWarmCacheEntries(serverId, 'account-a'))).toEqual(['s1']);
    });

    it('still withdraws the rows when the binding proves a different Account', () => {
        const serverId = hydrateFocusedHome('account-a');

        prepareSessionListAccountScope({ serverId, accountId: 'account-b' });

        expect(storage.getState().ordinarySessionListMembershipByServerId[serverId] ?? []).toEqual([]);
    });
});
