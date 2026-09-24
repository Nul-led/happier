import { MMKV } from 'react-native-mmkv';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import {
    createPendingAdministrationOAuthOwner,
    type PendingAdministrationOAuthPersistence,
} from './pendingAdministrationOAuth.owner';

const storage = new MMKV({ id: scopedStorageId('pending-administration-oauth', readStorageScopeFromEnv()) });
const KEY_RECORD = 'record:v1';

const persistence: PendingAdministrationOAuthPersistence = {
    read: () => {
        try { return storage.getString(KEY_RECORD) ?? null; } catch { return undefined; }
    },
    write: (value) => {
        try { storage.set(KEY_RECORD, value); return true; } catch { return false; }
    },
    clear: () => {
        try { storage.delete(KEY_RECORD); } catch { /* best-effort retirement */ }
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
