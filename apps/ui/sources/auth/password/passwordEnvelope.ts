import {
    createPasswordEnvelopeAadV1,
    decodePasswordCredentialFieldV1,
    encodePasswordCredentialFieldV1,
    PASSWORD_ENVELOPE_SECRET_BYTES_V1,
    PasswordWrappedRecoverySecretV1Schema,
    type PasswordEnvelopeKdfV1,
    type PasswordWrappedRecoverySecretV1,
} from '@happier-dev/protocol/auth/accountPasswordCredential';
import { deriveAccountSigningPublicKey } from '@/auth/flows/challenge';
import { openAes256GcmBytes, sealAes256GcmBytes } from '@/encryption/aes256GcmBytes';
import { deriveKey } from '@/encryption/deriveKey';
import sodium from '@/encryption/libsodium.lib';
import { derivePasswordEnvelopeKey } from './derivePasswordEnvelopeKey';
import { assertPasswordDerivationCurrent } from './passwordKdfInput';

export function arePasswordEnvelopeKdfsEqual(left: PasswordEnvelopeKdfV1, right: PasswordEnvelopeKdfV1): boolean {
    return left.algorithm === right.algorithm && left.salt === right.salt
        && left.opsLimit === right.opsLimit && left.memLimitBytes === right.memLimitBytes
        && left.outputBytes === right.outputBytes;
}

/**
 * Seal the existing 32-byte recovery secret under a password-derived wrapping
 * key. The AAD binds the exact envelope version, signing key and KDF/cipher
 * facts, so an envelope cannot be replayed under different parameters.
 */
export async function sealPasswordEnvelope(input: Readonly<{
    secret: Uint8Array;
    wrapKey: Uint8Array;
    kdf: PasswordEnvelopeKdfV1;
    nonce: Uint8Array;
}>): Promise<PasswordWrappedRecoverySecretV1> {
    if (input.secret.byteLength !== PASSWORD_ENVELOPE_SECRET_BYTES_V1) {
        throw new Error('password_envelope_secret_invalid');
    }
    await sodium.ready;
    const header = {
        v: 1 as const,
        accountSigningPublicKey: encodePasswordCredentialFieldV1(deriveAccountSigningPublicKey(input.secret)),
        kdf: input.kdf,
        cipher: { algorithm: 'aes256gcm' as const, nonce: encodePasswordCredentialFieldV1(input.nonce) },
    };
    const ciphertext = await sealAes256GcmBytes({
        key: input.wrapKey,
        nonce: input.nonce,
        aad: createPasswordEnvelopeAadV1(header),
        plaintext: input.secret,
    });
    return PasswordWrappedRecoverySecretV1Schema.parse({
        ...header,
        cipher: { ...header.cipher, ciphertext: encodePasswordCredentialFieldV1(ciphertext) },
    });
}

export async function openPasswordEnvelope(envelope: unknown, wrapKey: Uint8Array): Promise<Uint8Array> {
    let secret: Uint8Array | undefined;
    try {
        const parsed = PasswordWrappedRecoverySecretV1Schema.parse(envelope);
        secret = await openAes256GcmBytes({
            key: wrapKey,
            nonce: decodePasswordCredentialFieldV1(parsed.cipher.nonce),
            aad: createPasswordEnvelopeAadV1(parsed),
            ciphertext: decodePasswordCredentialFieldV1(parsed.cipher.ciphertext),
        });
        if (secret.byteLength !== 32) throw new Error('password_authentication_failed');
        await sodium.ready;
        if (encodePasswordCredentialFieldV1(deriveAccountSigningPublicKey(secret)) !== parsed.accountSigningPublicKey) {
            throw new Error('password_authentication_failed');
        }
        return secret;
    } catch {
        secret?.fill(0);
        throw new Error('password_authentication_failed');
    }
}

export async function derivePasswordKeys(password: string, kdf: PasswordEnvelopeKdfV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<{ wrapKey: Uint8Array; authKey: Uint8Array }>> {
    const root = await derivePasswordEnvelopeKey({ password, kdf, signal: options.signal });
    let wrapKey: Uint8Array | undefined;
    let authKey: Uint8Array | undefined;
    try {
        assertPasswordDerivationCurrent(options.signal);
        wrapKey = await deriveKey(root, 'Happier Password Envelope', ['v1', 'wrap']);
        authKey = await deriveKey(root, 'Happier Password Envelope', ['v1', 'auth']);
        assertPasswordDerivationCurrent(options.signal);
        return { wrapKey, authKey };
    } catch (error) {
        wrapKey?.fill(0);
        authKey?.fill(0);
        throw error;
    } finally {
        root.fill(0);
    }
}
