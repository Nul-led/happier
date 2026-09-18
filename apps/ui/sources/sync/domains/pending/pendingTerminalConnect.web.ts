import { serverAccountScopedStorageKey } from '@/sync/domains/scope/serverAccountScope';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import { createPendingTerminalConnectOwner, type PendingTerminalConnectPersistence } from './pendingTerminalConnect.owner';

const STORAGE_KEY = scopedStorageId('pending-terminal-connect-record', readStorageScopeFromEnv());
const STORAGE_KEY_PREFIX = scopedStorageId('pending-terminal-connect-record:v2', readStorageScopeFromEnv());
const PRE_AUTH_STORAGE_KEY = scopedStorageId('pending-terminal-connect-pre-auth:v1', readStorageScopeFromEnv());

function getStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
    try {
        return (globalThis as { localStorage?: Storage; sessionStorage?: Storage })[name] ?? null;
    } catch {
        return null;
    }
}

function read(storage: Storage | null, key: string): string | null | undefined {
    if (!storage) return undefined;
    try { return storage.getItem(key); } catch { return undefined; }
}

function write(storage: Storage | null, key: string, value: string): boolean {
    if (!storage) return false;
    try { storage.setItem(key, value); return true; } catch { return false; }
}

function clear(storage: Storage | null, key: string): void {
    if (!storage) return;
    try { storage.setItem(key, '{}'); } catch { /* best-effort tombstone */ }
    try { storage.removeItem(key); } catch { /* tombstone remains */ }
}

const persistence: PendingTerminalConnectPersistence = {
    readPreAuth: () => read(getStorage('sessionStorage'), PRE_AUTH_STORAGE_KEY),
    writePreAuth: (value) => write(getStorage('sessionStorage'), PRE_AUTH_STORAGE_KEY, value),
    clearPreAuth: () => clear(getStorage('sessionStorage'), PRE_AUTH_STORAGE_KEY),
    readScoped: (scope) => read(getStorage('localStorage'), serverAccountScopedStorageKey(STORAGE_KEY_PREFIX, scope)),
    writeScoped: (scope, value) => write(getStorage('localStorage'), serverAccountScopedStorageKey(STORAGE_KEY_PREFIX, scope), value),
    clearScoped: (scope) => clear(getStorage('localStorage'), serverAccountScopedStorageKey(STORAGE_KEY_PREFIX, scope)),
    readLegacy: () => read(getStorage('localStorage'), STORAGE_KEY),
    clearLegacy: () => clear(getStorage('localStorage'), STORAGE_KEY),
};

export const {
    setPendingTerminalConnect,
    getPendingTerminalConnect,
    clearPendingTerminalConnect,
    retargetPendingTerminalConnectToServerUrl,
    migratePendingTerminalConnectScopes,
} = createPendingTerminalConnectOwner(persistence);
