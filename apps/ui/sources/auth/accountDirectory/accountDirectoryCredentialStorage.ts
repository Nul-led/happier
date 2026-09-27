import {
    ACCOUNT_DIRECTORY_AUTH_CREDENTIALS_STORAGE_KEY,
    accountDirectoryAuthCredentials,
    subscribeAccountDirectoryCredentialMutations,
    type AccountDirectoryAuthCredentialsFacade,
} from '@/auth/storage/tokenStorage';

/**
 * Compatibility facade for existing Account Directory callers. TokenStorage is
 * the sole persistence owner; this module intentionally contains no second
 * parser, key, or mutation path.
 */
export { ACCOUNT_DIRECTORY_AUTH_CREDENTIALS_STORAGE_KEY, subscribeAccountDirectoryCredentialMutations };
export { normalizeAccountDirectoryEndpoint } from '@/sync/domains/accountDirectory/accountDirectoryEndpoint';
export const accountDirectoryCredentialStorage: AccountDirectoryAuthCredentialsFacade =
    accountDirectoryAuthCredentials;
