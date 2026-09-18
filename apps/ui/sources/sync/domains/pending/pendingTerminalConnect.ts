import { MMKV } from 'react-native-mmkv';
import { serverAccountScopedStorageKey } from '@/sync/domains/scope/serverAccountScope';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import { createPendingTerminalConnectOwner, type PendingTerminalConnectPersistence } from './pendingTerminalConnect.owner';

const scope = readStorageScopeFromEnv();
const storage = new MMKV({ id: scopedStorageId('pending-terminal-connect', scope) });
const KEY_RECORD = 'record';
const KEY_RECORD_PREFIX = 'record:v2';
const KEY_PRE_AUTH_RECORD = 'record:pre-auth:v1';

function read(key: string): string | null | undefined {
    try { return storage.getString(key) ?? null; } catch { return undefined; }
}

function write(key: string, value: string): boolean {
    try { storage.set(key, value); return true; } catch { return false; }
}

function clear(key: string): void {
    try { storage.set(key, '{}'); } catch { /* best-effort tombstone */ }
    try { storage.delete(key); } catch { /* tombstone remains */ }
}

const persistence: PendingTerminalConnectPersistence = {
    readPreAuth: () => read(KEY_PRE_AUTH_RECORD),
    writePreAuth: (value) => write(KEY_PRE_AUTH_RECORD, value),
    clearPreAuth: () => clear(KEY_PRE_AUTH_RECORD),
    readScoped: (accountScope) => read(serverAccountScopedStorageKey(KEY_RECORD_PREFIX, accountScope)),
    writeScoped: (accountScope, value) => write(serverAccountScopedStorageKey(KEY_RECORD_PREFIX, accountScope), value),
    clearScoped: (accountScope) => clear(serverAccountScopedStorageKey(KEY_RECORD_PREFIX, accountScope)),
    readLegacy: () => read(KEY_RECORD),
    clearLegacy: () => clear(KEY_RECORD),
};

export const {
    setPendingTerminalConnect,
    getPendingTerminalConnect,
    clearPendingTerminalConnect,
    retargetPendingTerminalConnectToServerUrl,
    migratePendingTerminalConnectScopes,
} = createPendingTerminalConnectOwner(persistence);
