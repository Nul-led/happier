import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import {
    createKeyChallengeV2SigningInput,
    encodePasswordCredentialFieldV1,
    KeyChallengeV2IssueResponseSchema,
    NativeEmailPasswordUnlockResponseV1Schema,
    signAccountContentKeyBindingV1,
    type KeyChallengeV2IssueResponse,
} from "@happier-dev/protocol";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { hashPasswordMaterial } from "@/app/auth/password/passwordMaterialVerifier";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { authRoutes } from "./authRoutes";

/**
 * Deciding checks for 02.05 §5 "verified native-method evidence through
 * finalization": only a Key Challenge the unlock boundary issued after
 * verifying the derived authentication key may finalize into a credential
 * that records `email_password`. Recovery-key login over the same Account and
 * the same signing identity must record only `key_challenge`.
 */
describe("native password credential provenance through Key Challenge finalization", () => {
    let harness: LightSqliteHarness;
    const authKey = new Uint8Array(32).fill(53);

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-native-password-provenance-", initAuth: true,
            env: {
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                HAPPIER_CANONICAL_SERVER_URL: "https://provenance.example.test",
                HAPPIER_SERVER_IDENTITY_ID: "srv_provenance_home",
            },
        });
    }, 120_000);
    afterAll(async () => { await harness.close(); });
    afterEach(() => { harness.resetEnv(); });

    function createApp() {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        authRoutes(app);
        return app;
    }

    /** One E2EE Account whose signing secret the test retains so it can answer challenges. */
    async function createEnrolledAccount(email: string) {
        const signing = tweetnacl.sign.keyPair();
        const contentPublicKey = tweetnacl.box.keyPair().publicKey;
        const contentPublicKeySig = signAccountContentKeyBindingV1({
            accountSigningSecretKey: signing.secretKey, contentPublicKey,
        });
        const account = await db.account.create({ data: {
            encryptionMode: "e2ee",
            publicKey: privacyKit.encodeHex(new Uint8Array(signing.publicKey)),
            contentPublicKey: Buffer.from(contentPublicKey),
            contentPublicKeySig: Buffer.from(contentPublicKeySig),
        } });
        await db.accountIdentity.create({ data: {
            accountId: account.id, provider: "email", providerUserId: email, profile: {},
        } });
        await db.accountPasswordCredential.create({ data: {
            accountId: account.id,
            credential: {
                v: 1, kind: "e2ee_password_envelope",
                envelope: {
                    v: 1, accountSigningPublicKey: encodePasswordCredentialFieldV1(new Uint8Array(signing.publicKey)),
                    kdf: {
                        algorithm: "argon2id13", salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(9)),
                        opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32,
                    },
                    cipher: {
                        algorithm: "aes256gcm", nonce: encodePasswordCredentialFieldV1(new Uint8Array(12).fill(5)),
                        ciphertext: encodePasswordCredentialFieldV1(new Uint8Array(48).fill(3)),
                    },
                },
                authVerifier: { v: 1, hash: await hashPasswordMaterial(authKey) },
            },
        } });
        return { account, signing, contentPublicKey, contentPublicKeySig };
    }

    function redeemPayload(
        enrolled: Awaited<ReturnType<typeof createEnrolledAccount>>,
        challenge: KeyChallengeV2IssueResponse,
    ) {
        const { origin, serverIdentityId } = challenge.audience;
        if (!serverIdentityId) throw new Error("challenge audience is missing its server identity");
        const signature = tweetnacl.sign.detached(
            createKeyChallengeV2SigningInput({
                challengeId: challenge.challengeId, nonce: challenge.nonce,
                issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt,
                audience: { origin, serverIdentityId }, expectedAccountId: enrolled.account.id,
            }),
            enrolled.signing.secretKey,
        );
        return {
            challengeId: challenge.challengeId,
            publicKey: privacyKit.encodeBase64(new Uint8Array(enrolled.signing.publicKey)),
            signature: privacyKit.encodeBase64(new Uint8Array(signature)),
            expectedAccountId: enrolled.account.id,
            contentPublicKey: privacyKit.encodeBase64(new Uint8Array(enrolled.contentPublicKey)),
            contentPublicKeySig: privacyKit.encodeBase64(new Uint8Array(enrolled.contentPublicKeySig)),
        };
    }

    it("stamps email_password only for the challenge the verified unlock issued", async () => {
        const enrolled = await createEnrolledAccount("provenance@example.test");
        const app = createApp();
        await app.ready();
        try {
            const unlockResponse = await app.inject({ method: "POST", url: "/v1/auth/email/unlock",
                payload: { v: 1, email: "provenance@example.test", authKey: encodePasswordCredentialFieldV1(authKey) } });
            expect(unlockResponse.statusCode, unlockResponse.body).toBe(200);
            const unlocked = NativeEmailPasswordUnlockResponseV1Schema.parse(unlockResponse.json());
            expect(unlocked.expectedAccountId).toBe(enrolled.account.id);

            const redeemed = await app.inject({ method: "POST", url: "/v1/auth",
                payload: { ...redeemPayload(enrolled, unlocked.challenge), credentialKind: "terminal" } });
            expect(redeemed.statusCode, redeemed.body).toBe(200);
            const verified = await auth.verifyToken(redeemed.json().token);
            expect(verified).toMatchObject({
                userId: enrolled.account.id,
                authTokenKind: "terminal",
                authenticationEvidence: [{ kind: "home_method", methodId: "email_password" }],
            });

            // The proof is one-time: the same unlock challenge cannot mint a
            // second password-qualified credential.
            const replayed = await app.inject({ method: "POST", url: "/v1/auth",
                payload: redeemPayload(enrolled, unlocked.challenge) });
            expect(replayed.statusCode).toBe(401);
        } finally { await app.close(); }
    });

    it("does not stamp password provenance from a replaced native identity with the same email and revision", async () => {
        const email = "replaced-provenance@example.test";
        const enrolled = await createEnrolledAccount(email);
        const app = createApp();
        try {
            const response = await app.inject({ method: "POST", url: "/v1/auth/email/unlock", payload: {
                v: 1, email, authKey: encodePasswordCredentialFieldV1(authKey),
            } });
            expect(response.statusCode, response.body).toBe(200);
            const unlocked = NativeEmailPasswordUnlockResponseV1Schema.parse(response.json());
            await db.accountIdentity.delete({ where: { accountId_provider: { accountId: enrolled.account.id, provider: "email" } } });
            await db.accountIdentity.create({ data: { accountId: enrolled.account.id, provider: "email", providerUserId: email, profile: {} } });
            const redeemed = await app.inject({ method: "POST", url: "/v1/auth", payload: redeemPayload(enrolled, unlocked.challenge) });
            expect(redeemed.statusCode, redeemed.body).toBe(200);
            // The Account key still proves ordinary recovery-key login, but
            // the removed native factor cannot qualify this credential.
            expect(await auth.verifyToken(redeemed.json().token)).toMatchObject({
                userId: enrolled.account.id,
                authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
            });
        } finally { await app.close(); }
    });

    it("keeps native E2EE login reachable but refuses ordinary key login when that deployment method is disabled", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0" });
        const enrolled = await createEnrolledAccount("native-without-key-login@example.test");
        const app = createApp();
        try {
            const response = await app.inject({ method: "POST", url: "/v1/auth/email/unlock", payload: {
                v: 1, email: "native-without-key-login@example.test", authKey: encodePasswordCredentialFieldV1(authKey),
            } });
            expect(response.statusCode, response.body).toBe(200);
            const unlocked = NativeEmailPasswordUnlockResponseV1Schema.parse(response.json());
            const redeemed = await app.inject({ method: "POST", url: "/v1/auth", payload: redeemPayload(enrolled, unlocked.challenge) });
            expect(redeemed.statusCode, redeemed.body).toBe(200);
            expect(await auth.verifyToken(redeemed.json().token)).toMatchObject({
                userId: enrolled.account.id,
                authenticationEvidence: [{ kind: "home_method", methodId: "email_password" }],
            });
            const ordinaryChallenge = await app.inject({ method: "POST", url: "/v1/auth/challenge",
                payload: { expectedAccountId: enrolled.account.id } });
            expect(ordinaryChallenge.statusCode, ordinaryChallenge.body).toBe(200);
            const refused = await app.inject({ method: "POST", url: "/v1/auth", payload: redeemPayload(
                enrolled, KeyChallengeV2IssueResponseSchema.parse(ordinaryChallenge.json()),
            ) });
            expect(refused.statusCode, refused.body).toBe(403);
            // Directory recovery-key routes previously shared the deployment
            // switch; exposing native Home completion must not open that path.
            for (const url of ["/v1/auth/account-directory/challenge", "/v1/auth/account-directory"]) {
                expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(404);
            }
        } finally { await app.close(); }
    });

    it("records only key_challenge for a recovery-key login over the same signing identity", async () => {
        const enrolled = await createEnrolledAccount("recovery-only@example.test");
        const app = createApp();
        await app.ready();
        try {
            const issued = await app.inject({ method: "POST", url: "/v1/auth/challenge",
                payload: { expectedAccountId: enrolled.account.id } });
            expect(issued.statusCode, issued.body).toBe(200);
            const challenge = KeyChallengeV2IssueResponseSchema.parse(issued.json());
            const redeemed = await app.inject({ method: "POST", url: "/v1/auth",
                payload: redeemPayload(enrolled, challenge) });
            expect(redeemed.statusCode, redeemed.body).toBe(200);
            const verified = await auth.verifyToken(redeemed.json().token);
            expect(verified).toMatchObject({
                userId: enrolled.account.id,
                authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
            });
        } finally { await app.close(); }
    });

    it("mints no password-qualified challenge when the derived key fails to verify", async () => {
        const enrolled = await createEnrolledAccount("failed-proof@example.test");
        const app = createApp();
        await app.ready();
        try {
            const rejected = await app.inject({ method: "POST", url: "/v1/auth/email/unlock",
                payload: { v: 1, email: "failed-proof@example.test",
                    authKey: encodePasswordCredentialFieldV1(new Uint8Array(32).fill(1)) } });
            expect(rejected.statusCode).toBe(401);
            expect(await db.keyChallengeV2.count({
                where: { expectedAccountId: enrolled.account.id },
            })).toBe(0);
        } finally { await app.close(); }
    });

    it("cannot carry another Account's verified unlock evidence", async () => {
        const enrolled = await createEnrolledAccount("bound@example.test");
        const other = await createEnrolledAccount("other@example.test");
        const app = createApp();
        await app.ready();
        try {
            const unlocked = NativeEmailPasswordUnlockResponseV1Schema.parse((await app.inject({
                method: "POST", url: "/v1/auth/email/unlock",
                payload: { v: 1, email: "bound@example.test", authKey: encodePasswordCredentialFieldV1(authKey) },
            })).json());
            // `other` signs the challenge that was bound to `enrolled`.
            const redeemed = await app.inject({ method: "POST", url: "/v1/auth",
                payload: redeemPayload(other, unlocked.challenge) });
            expect(redeemed.statusCode).toBe(401);
        } finally { await app.close(); }
    });

    it.each(["revision_changed", "revision_only_evidence", "incomplete_evidence"])("does not stamp stale password evidence: %s", async (reason) => {
        const email = `stale-proof-${reason}@example.test`;
        const enrolled = await createEnrolledAccount(email);
        const app = createApp();
        await app.ready();
        try {
            const unlocked = NativeEmailPasswordUnlockResponseV1Schema.parse((await app.inject({
                method: "POST", url: "/v1/auth/email/unlock",
                payload: { v: 1, email, authKey: encodePasswordCredentialFieldV1(authKey) },
            })).json());
            if (reason === "revision_changed") {
                await db.accountPasswordCredential.update({
                    where: { accountId: enrolled.account.id }, data: { revision: { increment: 1 } },
                });
            } else {
                await db.keyChallengeV2.update({ where: { id: unlocked.challenge.challengeId }, data: {
                    verifiedNativeMethodId: reason === "revision_only_evidence"
                        ? "email_password:v1:1"
                        : 'email_password:v1:{"credentialRevision":1}',
                } });
            }
            const redeemed = await app.inject({ method: "POST", url: "/v1/auth",
                payload: redeemPayload(enrolled, unlocked.challenge) });
            expect(redeemed.statusCode, redeemed.body).toBe(200);
            expect(await auth.verifyToken(redeemed.json().token)).toMatchObject({
                authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
            });
        } finally { await app.close(); }
    });
});
