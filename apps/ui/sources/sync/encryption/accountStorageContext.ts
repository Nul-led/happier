import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { isDataKeyAuthCredentials } from '@/auth/storage/tokenStorage';
import {
    createAccountScopedCryptoMaterialSnapshotV1,
    convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1,
} from '@happier-dev/protocol';
import { decodeBase64 } from '@/encryption/base64';
import { fetchAccountEncryptionCurrentness } from '@/sync/api/account/apiAccountEncryptionMode';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import type { ServerFetch } from '@/sync/http/client';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';

export type RawAccountStorageDecryption = Readonly<{
    decryptRaw: (value: string) => Promise<unknown>;
}>;
export type RawAccountStorageEncryption = RawAccountStorageDecryption & Readonly<{
    encryptRaw: (value: unknown) => Promise<string>;
}>;
export type AccountStorageContext = Readonly<{
    mode: 'plain' | 'e2ee';
    encryption: RawAccountStorageDecryption | null;
}>;

export class AccountStorageCurrentnessUnavailableError extends Error {
    readonly code = 'account_storage_currentness_unavailable';
    constructor(readonly cause?: unknown) {
        super('Account storage currentness is unavailable');
        this.name = 'AccountStorageCurrentnessUnavailableError';
    }
}

export function isRawAccountStorageEncryption(
    value: RawAccountStorageDecryption | null,
): value is RawAccountStorageEncryption {
    return value !== null && 'encryptRaw' in value;
}

/** Capture the cipher before awaiting the authoritative Account-mode/fingerprint read. */
export async function resolveAccountStorageContext(
    credentials: AuthCredentials,
    options: Readonly<{
        encryption?: AccountStorageContext['encryption'];
        request?: ServerFetch;
    }> = {},
): Promise<AccountStorageContext> {
    const encryption = options.encryption === undefined
        ? getSyncSingleton().encryption
        : options.encryption;
    try {
        const currentness = await fetchAccountEncryptionCurrentness(credentials, {
            ...(options.request ? {
                request: (path, init) => options.request!(path, init, { includeAuth: false, retry: 'none' }),
            } : {}),
        });
        if (currentness.mode === 'plain') return { mode: 'plain', encryption: null };
        if (!encryption || !currentness.contentKeyFingerprint) {
            throw new Error('Account content-key material is unavailable');
        }
        const material = resolveAccountScopedCryptoMaterialFromCredentials(credentials);
        const snapshot = createAccountScopedCryptoMaterialSnapshotV1({
            accountEncryptionMode: 'e2ee',
            material,
            ...(isDataKeyAuthCredentials(credentials) ? {
                dataKeyPublicKey: decodeBase64(credentials.encryption.publicKey, 'base64'),
            } : {}),
        });
        if (convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(
            snapshot.contentPublicKeyFingerprint,
        ) !== currentness.contentKeyFingerprint) {
            throw new Error('Account content-key fingerprint mismatch');
        }
        return { mode: 'e2ee', encryption };
    } catch (error) {
        throw new AccountStorageCurrentnessUnavailableError(error);
    }
}
