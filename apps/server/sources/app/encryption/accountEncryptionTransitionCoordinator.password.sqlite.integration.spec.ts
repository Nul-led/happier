import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";
import * as privacyKit from "privacy-kit";
import {
    encodePasswordCredentialFieldV1,
    signAccountContentKeyBindingV1,
    type AccountPasswordCredentialV1,
} from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { verifyAccountContentKeyBinding } from "@/app/encryption/accountContentKeyAdmission";
import {
    activateAccountEncryptionTransitionCoordinatorInTx,
    authorizeAccountEncryptionTransitionCoordinatorInTx,
    inventoryAccountEncryptionTransitionCoordinatorInTx,
    prepareAccountEncryptionTransitionCoordinatorInTx,
} from "./accountEncryptionTransitionCoordinator";
import { deriveAccountEncryptionMigrationKeyFingerprints } from "./accountEncryptionTransition";

const ACCOUNT_ID = "account-transition-password";

const PLAIN_CREDENTIAL = {
    v: 1, kind: "plain_password_hash",
    hash: {
        v: 1, algorithm: "scrypt", parameters: { n: 16384, r: 8, p: 5, keyLength: 32 },
        salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(4)),
        digest: encodePasswordCredentialFieldV1(new Uint8Array(32).fill(8)),
    },
} satisfies AccountPasswordCredentialV1;

function requireFingerprint(value: string | null): string {
    if (value === null) throw new Error("missing fixture key fingerprint");
    return value;
}

function e2eeCredential(signingPublicKey: Uint8Array): AccountPasswordCredentialV1 {
    return {
        v: 1, kind: "e2ee_password_envelope",
        envelope: {
            v: 1, accountSigningPublicKey: encodePasswordCredentialFieldV1(signingPublicKey),
            kdf: {
                algorithm: "argon2id13", salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(2)),
                opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32,
            },
            cipher: {
                algorithm: "aes256gcm", nonce: encodePasswordCredentialFieldV1(new Uint8Array(12).fill(6)),
                ciphertext: encodePasswordCredentialFieldV1(new Uint8Array(48).fill(1)),
            },
        },
        authVerifier: { v: 1, hash: PLAIN_CREDENTIAL.hash },
    };
}

/**
 * 02.05 §7: a password-backed mode transition must commit the prepared
 * replacement credential with the same Account mode flip. The Account can never
 * be published in one mode beside a credential of the other, and a refused
 * authorization must leave both persisted facts untouched.
 */
describe("Account encryption transition password credential staging", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-transition-password-",
            initAuth: false, initEncrypt: false, initFiles: false,
        });
    }, 120_000);
    afterAll(async () => { await harness.close(); });
    afterEach(async () => {
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.accountEncryptionTransition.deleteMany(),
            () => db.accountPasswordCredential.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    /** A keyless Plain Account with one enrolled Plain password credential. */
    async function createPlainPasswordAccount() {
        await db.account.create({ data: { id: ACCOUNT_ID, encryptionMode: "plain" } });
        await db.accountPasswordCredential.create({
            data: { accountId: ACCOUNT_ID, credential: PLAIN_CREDENTIAL, revision: 1 },
        });
        const signing = tweetnacl.sign.keyPair();
        const contentPublicKey = tweetnacl.box.keyPair().publicKey;
        const binding = verifyAccountContentKeyBinding({
            accountSigningPublicKey: new Uint8Array(signing.publicKey),
            contentPublicKey,
            contentPublicKeySignature: signAccountContentKeyBindingV1({
                accountSigningSecretKey: signing.secretKey, contentPublicKey,
            }),
        });
        if (!binding) throw new Error("invalid fixture content binding");
        const accountPublicKeyHex = privacyKit.encodeHex(new Uint8Array(signing.publicKey));
        return {
            signing, binding, accountPublicKeyHex,
            signingKeyFingerprint: requireFingerprint(deriveAccountEncryptionMigrationKeyFingerprints({
                publicKey: accountPublicKeyHex, contentPublicKey: binding.contentPublicKey,
            }).signingKeyFingerprint),
        };
    }

    async function prepareToE2ee() {
        const prepared = await inTx((tx) => prepareAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID,
            request: {
                toMode: "e2ee", expectedAccountVersion: 0,
                expectedSigningKeyFingerprint: null, expectedContentKeyFingerprint: null,
            },
        }));
        if (prepared.status !== "prepared") throw new Error(`unexpected prepare status ${prepared.status}`);
        return prepared.transition.transitionId;
    }

    it("commits the prepared E2EE credential with the Plain to E2EE mode flip", async () => {
        const fixture = await createPlainPasswordAccount();
        const transitionId = await prepareToE2ee();
        const credential = e2eeCredential(new Uint8Array(fixture.signing.publicKey));
        expect(await inTx((tx) => authorizeAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID, transitionId,
            authorization: {
                kind: "first_key", accountPublicKeyHex: fixture.accountPublicKeyHex,
                binding: fixture.binding, signingKeyFingerprint: fixture.signingKeyFingerprint,
                passwordCredential: { expectedRevision: 1, credential },
            },
        }))).toMatchObject({ status: "authorized" });

        const inventory = await inTx((tx) => inventoryAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID, transitionId,
        }));
        expect(inventory.status).toBe("ready");
        expect(await inTx((tx) => activateAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID, transitionId,
        }))).toMatchObject({ status: "activated", mode: "e2ee" });

        expect(await db.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } }))
            .toMatchObject({ encryptionMode: "e2ee", publicKey: fixture.accountPublicKeyHex });
        expect(await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: ACCOUNT_ID } }))
            .toMatchObject({ revision: 2, credential });
    });

    it("refuses to authorize an envelope bound to a different signing key", async () => {
        const fixture = await createPlainPasswordAccount();
        const transitionId = await prepareToE2ee();
        expect(await inTx((tx) => authorizeAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID, transitionId,
            authorization: {
                kind: "first_key", accountPublicKeyHex: fixture.accountPublicKeyHex,
                binding: fixture.binding, signingKeyFingerprint: fixture.signingKeyFingerprint,
                passwordCredential: {
                    expectedRevision: 1,
                    credential: e2eeCredential(new Uint8Array(tweetnacl.sign.keyPair().publicKey)),
                },
            },
        }))).toEqual({ status: "invalid_authorization" });
        expect(await db.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } }))
            .toMatchObject({ encryptionMode: "plain" });
        expect(await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: ACCOUNT_ID } }))
            .toMatchObject({ revision: 1, credential: PLAIN_CREDENTIAL });
    });

    it("refuses a stale source revision and a credential prepared for the source mode", async () => {
        const fixture = await createPlainPasswordAccount();
        const credential = e2eeCredential(new Uint8Array(fixture.signing.publicKey));
        const authorize = (passwordCredential: unknown) => inTx(async (tx) => {
            const prepared = await prepareAccountEncryptionTransitionCoordinatorInTx({
                tx, accountId: ACCOUNT_ID,
                request: {
                    toMode: "e2ee", expectedAccountVersion: 0,
                    expectedSigningKeyFingerprint: null, expectedContentKeyFingerprint: null,
                },
            });
            if (prepared.status !== "prepared") throw new Error(prepared.status);
            const result = await authorizeAccountEncryptionTransitionCoordinatorInTx({
                tx, accountId: ACCOUNT_ID, transitionId: prepared.transition.transitionId,
                authorization: {
                    kind: "first_key", accountPublicKeyHex: fixture.accountPublicKeyHex,
                    binding: fixture.binding, signingKeyFingerprint: fixture.signingKeyFingerprint,
                    ...(passwordCredential ? { passwordCredential } : {}),
                } as never,
            });
            await tx.accountEncryptionTransition.deleteMany({ where: { accountId: ACCOUNT_ID } });
            return result;
        });
        expect(await authorize({ expectedRevision: 2, credential }))
            .toEqual({ status: "invalid_authorization" });
        expect(await authorize({ expectedRevision: 1, credential: PLAIN_CREDENTIAL }))
            .toEqual({ status: "invalid_authorization" });
        // An enrolled credential cannot be silently stranded in the source mode.
        expect(await authorize(null)).toEqual({ status: "invalid_authorization" });
        expect(await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: ACCOUNT_ID } }))
            .toMatchObject({ revision: 1, credential: PLAIN_CREDENTIAL });
    });

    it("leaves a passwordless Account transition unchanged", async () => {
        await db.account.create({ data: { id: ACCOUNT_ID, encryptionMode: "plain" } });
        const signing = tweetnacl.sign.keyPair();
        const contentPublicKey = tweetnacl.box.keyPair().publicKey;
        const binding = verifyAccountContentKeyBinding({
            accountSigningPublicKey: new Uint8Array(signing.publicKey),
            contentPublicKey,
            contentPublicKeySignature: signAccountContentKeyBindingV1({
                accountSigningSecretKey: signing.secretKey, contentPublicKey,
            }),
        });
        if (!binding) throw new Error("invalid fixture content binding");
        const accountPublicKeyHex = privacyKit.encodeHex(new Uint8Array(signing.publicKey));
        const transitionId = await prepareToE2ee();
        expect(await inTx((tx) => authorizeAccountEncryptionTransitionCoordinatorInTx({
            tx, accountId: ACCOUNT_ID, transitionId,
            authorization: {
                kind: "first_key", accountPublicKeyHex, binding,
                signingKeyFingerprint: requireFingerprint(deriveAccountEncryptionMigrationKeyFingerprints({
                    publicKey: accountPublicKeyHex, contentPublicKey: binding.contentPublicKey,
                }).signingKeyFingerprint),
            },
        }))).toMatchObject({ status: "authorized" });
        expect(await db.accountEncryptionTransition.findFirstOrThrow({ where: { id: transitionId } }))
            .toMatchObject({ targetPasswordCredential: null, targetPasswordRevision: null });
    });
});
