import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import {
    createPendingAdministrationOAuthOwner,
    type PendingAdministrationOAuthPersistence,
} from './pendingAdministrationOAuth.owner';

const STORAGE_KEY = scopedStorageId('pending-administration-oauth-record:v1', readStorageScopeFromEnv());

function getStorage(): Storage | null {
    try {
        return (globalThis as { localStorage?: Storage }).localStorage ?? null;
    } catch {
        return null;
    }
}

const persistence: PendingAdministrationOAuthPersistence = {
    read: () => {
        const storage = getStorage();
        if (!storage) return undefined;
        try { return storage.getItem(STORAGE_KEY); } catch { return undefined; }
    },
    write: (value) => {
        const storage = getStorage();
        if (!storage) return false;
        try { storage.setItem(STORAGE_KEY, value); return true; } catch { return false; }
    },
    clear: () => {
        const storage = getStorage();
        if (!storage) return;
        try { storage.removeItem(STORAGE_KEY); } catch { /* best-effort retirement */ }
    },
};

export const {
    setPendingAdministrationOAuth,
    peekPendingAdministrationOAuth,
    consumePendingAdministrationOAuth,
    clearPendingAdministrationOAuth,
} = createPendingAdministrationOAuthOwner(persistence);

export type {
    PendingAdministrationOAuth,
    PendingGitHubAppManifestSetupRecord,
    PendingGitHubAppVerificationRecord,
    PendingIdentityProviderTestRecord,
} from './pendingAdministrationOAuth.owner';
