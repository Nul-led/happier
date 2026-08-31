import {
    ACCOUNT_DIRECTORY_AUTH_CREDENTIALS_STORAGE_KEY,
    accountDirectoryAuthCredentials,
    normalizeAccountDirectoryEndpoint,
    type AccountDirectoryAuthCredentialsFacade,
} from '@/auth/storage/tokenStorage';

/**
 * Compatibility facade for existing Account Directory callers. TokenStorage is
 * the sole persistence owner; this module intentionally contains no second
 * parser, key, or mutation path.
 */
export { ACCOUNT_DIRECTORY_AUTH_CREDENTIALS_STORAGE_KEY };
export { normalizeAccountDirectoryEndpoint };
export const accountDirectoryCredentialStorage: AccountDirectoryAuthCredentialsFacade =
    accountDirectoryAuthCredentials;
