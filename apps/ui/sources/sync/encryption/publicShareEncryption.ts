import { deriveKey } from '@/encryption/deriveKey';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';
import {
    openPublicShareEncryptedDataKeyEnvelopeV0,
    PUBLIC_SHARE_KEY_DERIVATION_PATH_V1,
    PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1,
    sealPublicShareEncryptedDataKeyEnvelopeV0,
} from '@happier-dev/protocol';
import { getRandomBytes } from '@/platform/cryptoRandom';

/**
 * Encrypt a data encryption key for public sharing using a token
 *
 * @param dataEncryptionKey - The session's data encryption key to encrypt
 * @param token - The random public share token
 * @returns Base64 encoded encrypted data key
 *
 * @remarks
 * Uses SecretBox encryption with a key derived from the token.
 * The token must be kept secret as it enables decryption.
 */
export async function encryptDataKeyForPublicShare(
    dataEncryptionKey: Uint8Array,
    token: string
): Promise<string> {
    // Derive encryption key from token
    const tokenBytes = new TextEncoder().encode(token);
    const encryptionKey = await deriveKey(
        tokenBytes,
        PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1,
        [...PUBLIC_SHARE_KEY_DERIVATION_PATH_V1],
    );
    const encrypted = sealPublicShareEncryptedDataKeyEnvelopeV0({
        dataKey: dataEncryptionKey,
        wrappingKey: encryptionKey,
        randomBytes: getRandomBytes,
    });

    // Return as base64
    return encodeBase64(encrypted, 'base64');
}

/**
 * Decrypt a data encryption key from a public share using a token
 *
 * @param encryptedDataKey - The encrypted data key (base64)
 * @param token - The public share token
 * @returns Decrypted data encryption key, or null if decryption fails
 *
 * @remarks
 * This is the inverse of encryptDataKeyForPublicShare.
 */
export async function decryptDataKeyFromPublicShare(
    encryptedDataKey: string,
    token: string
): Promise<Uint8Array | null> {
    try {
        // Derive decryption key from token
        const tokenBytes = new TextEncoder().encode(token);
        const decryptionKey = await deriveKey(
            tokenBytes,
            PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1,
            [...PUBLIC_SHARE_KEY_DERIVATION_PATH_V1],
        );

        // Decode from base64
        return openPublicShareEncryptedDataKeyEnvelopeV0({
            envelope: decodeBase64(encryptedDataKey, 'base64'),
            wrappingKey: decryptionKey,
        });
    } catch (error) {
        return null;
    }
}
