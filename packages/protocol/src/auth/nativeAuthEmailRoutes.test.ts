import { describe, expect, it } from 'vitest';
import {
    NATIVE_AUTH_PASSWORD_RECOVERY_APP_PATH_V1,
    NativeEmailVerifyRequestV1Schema,
    NativeEmailPasswordProvisionErrorResponseV1Schema,
    NativeEmailPasswordProvisionRequestV1Schema,
    NativeEmailPasswordProvisionResponseV1Schema,
} from './nativeAuthEmailRoutes.js';
import { encodePasswordCredentialFieldV1 } from './accountPasswordCredential.js';

describe('native email provision wire', () => {
    it('publishes the canonical bearer-free E2EE recovery entry', () => {
        expect(NATIVE_AUTH_PASSWORD_RECOVERY_APP_PATH_V1).toBe('/auth/password/recover');
    });
    it('binds mailbox verification requests to public or exact Team-invitation admission', () => {
        expect(NativeEmailVerifyRequestV1Schema.safeParse({
            v: 1, email: 'person@example.test',
        }).success).toBe(true);
        expect(NativeEmailVerifyRequestV1Schema.safeParse({
            v: 1, email: 'person@example.test',
            admission: { kind: 'team_invitation', token: 'a'.repeat(43) },
        }).success).toBe(true);
        expect(NativeEmailVerifyRequestV1Schema.safeParse({
            v: 1, email: 'person@example.test', admission: { kind: 'team_invitation', token: 'short' },
        }).success).toBe(false);
    });

    it('is recursively closed and mode-qualified', () => {
        const plain = {
            v: 1,
            email: 'person@example.test',
            admission: { kind: 'native_email_verification', token: 'a'.repeat(43) },
            account: { mode: 'plain', password: 'correct password with spaces' },
        };
        expect(NativeEmailPasswordProvisionRequestV1Schema.safeParse(plain).success).toBe(true);
        expect(NativeEmailPasswordProvisionRequestV1Schema.safeParse({ ...plain, accountId: 'caller-selected' }).success).toBe(false);
        expect(NativeEmailPasswordProvisionRequestV1Schema.safeParse({
            ...plain,
            account: { ...plain.account, proof: {} },
        }).success).toBe(false);

        const bytes = (length: number, fill: number) => encodePasswordCredentialFieldV1(new Uint8Array(length).fill(fill));
        const e2ee = {
            ...plain,
            account: {
                mode: 'e2ee',
                authKey: bytes(32, 1),
                envelope: {
                    v: 1,
                    accountSigningPublicKey: bytes(32, 2),
                    kdf: { algorithm: 'argon2id13', salt: bytes(16, 3), opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32 },
                    cipher: { algorithm: 'aes256gcm', nonce: bytes(12, 4), ciphertext: bytes(48, 5) },
                },
                proof: {
                    challengeId: 'challenge', publicKey: bytes(32, 2), signature: bytes(64, 6),
                    contentPublicKey: bytes(32, 7), contentPublicKeySig: bytes(64, 8),
                },
            },
        };
        expect(NativeEmailPasswordProvisionRequestV1Schema.safeParse(e2ee).success).toBe(true);
        expect(NativeEmailPasswordProvisionRequestV1Schema.safeParse({
            ...e2ee,
            admission: { kind: 'native_email_verification', token: 'a'.repeat(43), emailVerificationToken: 'b'.repeat(43) },
        }).success).toBe(false);
    });

    it('keeps the successful result closed', () => {
        const response = { token: 'token', accountId: 'account', teamId: null };
        expect(NativeEmailPasswordProvisionResponseV1Schema.safeParse(response).success).toBe(true);
        expect(NativeEmailPasswordProvisionResponseV1Schema.safeParse({ ...response, password: 'leak' }).success).toBe(false);
    });

    it('publishes only provision-owned typed errors', () => {
        expect(NativeEmailPasswordProvisionErrorResponseV1Schema.safeParse({ error: 'authentication_failed' }).success).toBe(true);
        expect(NativeEmailPasswordProvisionErrorResponseV1Schema.safeParse({ error: 'method_not_available' }).success).toBe(true);
        expect(NativeEmailPasswordProvisionErrorResponseV1Schema.safeParse({ error: 'password_hash_overloaded' }).success).toBe(true);
        expect(NativeEmailPasswordProvisionErrorResponseV1Schema.safeParse({ error: 'invalid-token' }).success).toBe(false);
        expect(NativeEmailPasswordProvisionErrorResponseV1Schema.safeParse({ error: 'authentication_failed', detail: 'leak' }).success).toBe(false);
    });
});
