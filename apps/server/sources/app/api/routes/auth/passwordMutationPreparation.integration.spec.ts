import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    computeCanonicalDomainSeparatedDigest,
    createCanonicalJsonSigningInput,
    createPasswordCredentialMutationDigestV1,
    encodePasswordCredentialFieldV1,
    E2eeAccountPasswordCredentialV1Schema,
    PasswordMutationChallengeV1Schema,
    PlainAccountPasswordCredentialV1Schema,
} from "@happier-dev/protocol";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { emailPasswordAuthMethodModule } from "@/app/auth/methods/modules/emailPasswordAuthMethodModule";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { hashPasswordMaterial, verifyPasswordMaterial } from "@/app/auth/password/passwordMaterialVerifier";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";

describe("password mutation preparation for Account conversion", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "password-conversion-preparation-",
            initAuth: true,
            env: {
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
                HAPPIER_SERVER_IDENTITY_ID: "srv_password_home",
            },
        });
    }, 120_000);
    afterAll(async () => { await harness.close(); });

    it("prepares a target E2EE verifier for a Plain Account without persisting its authKey or issuing an E2EE challenge", async () => {
        const binding = createSignedAccountContentBinding();
        const nativeEmail = "plain-conversion@example.test";
        const existingCredential = {
            v: 1, kind: "plain_password_hash",
            hash: await hashPasswordMaterial(new TextEncoder().encode("existing plain conversion password")),
        };
        const account = await db.account.create({ data: {
            encryptionMode: "plain", publicKey: null,
            AccountPasswordCredential: { create: { revision: 2, credential: existingCredential } },
        } });
        await db.accountIdentity.create({ data: {
            accountId: account.id, provider: "email", providerUserId: nativeEmail, profile: {},
        } });
        const authKeyBytes = new Uint8Array(32).fill(62);
        const authKey = encodePasswordCredentialFieldV1(authKeyBytes);
        const envelope = {
            v: 1,
            accountSigningPublicKey: encodePasswordCredentialFieldV1(new Uint8Array(Buffer.from(binding.publicKey, "hex"))),
            kdf: {
                algorithm: "argon2id13", salt: encodePasswordCredentialFieldV1(new Uint8Array(16)),
                opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32,
            },
            cipher: {
                algorithm: "aes256gcm", nonce: encodePasswordCredentialFieldV1(new Uint8Array(12)),
                ciphertext: encodePasswordCredentialFieldV1(new Uint8Array(48)),
            },
        };
        const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user",
            authenticationEvidence: [{ kind: "home_method", methodId: "email_password" }] });
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        emailPasswordAuthMethodModule.registerRoutes(app);
        await app.ready();
        try {
            const malformed = await app.inject({
                method: "POST", url: "/v1/auth/password/mutation/challenge",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    v: 1, action: "change", expectedCredentialRevision: 2,
                    normalizedNativeEmail: nativeEmail, newE2eePassword: { envelope, authKey },
                    callerSelectedAccountId: "another-account",
                },
            });
            expect(malformed.statusCode).toBe(400);
            expect(malformed.json()).toEqual({ error: "invalid_request" });
            expect(await db.keyChallengeV2.findMany({ where: { expectedAccountId: account.id } })).toEqual([]);
            const response = await app.inject({
                method: "POST", url: "/v1/auth/password/mutation/challenge",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    v: 1, action: "change", expectedCredentialRevision: 2,
                    normalizedNativeEmail: nativeEmail, newE2eePassword: { envelope, authKey },
                },
            });
            expect(response.statusCode, response.body).toBe(200);
            const targetCredential = E2eeAccountPasswordCredentialV1Schema.parse(response.json().targetCredential);
            expect(targetCredential.envelope).toEqual(envelope);
            expect(await verifyPasswordMaterial(targetCredential.authVerifier.hash, authKeyBytes)).toBe(true);
            expect(response.body).not.toContain(authKey);
            expect(await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: account.id } }))
                .toMatchObject({ revision: 2, credential: existingCredential });
            expect(await db.keyChallengeV2.findMany({ where: { expectedAccountId: account.id } })).toEqual([]);
            expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).encryptionMode).toBe("plain");
        } finally {
            await app.close();
        }
    });

    it("prepares only the new salted verifier and binds it to the exact conversion without replacing the current credential", async () => {
        const binding = createSignedAccountContentBinding();
        const nativeEmail = "conversion@example.test";
        const existingCredential = {
            v: 1, kind: "e2ee_password_envelope",
            envelope: {
                v: 1,
                accountSigningPublicKey: encodePasswordCredentialFieldV1(new Uint8Array(Buffer.from(binding.publicKey, "hex"))),
                kdf: {
                    algorithm: "argon2id13", salt: encodePasswordCredentialFieldV1(new Uint8Array(16)),
                    opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32,
                },
                cipher: {
                    algorithm: "aes256gcm", nonce: encodePasswordCredentialFieldV1(new Uint8Array(12)),
                    ciphertext: encodePasswordCredentialFieldV1(new Uint8Array(48)),
                },
            },
            authVerifier: { v: 1, hash: await hashPasswordMaterial(new Uint8Array(32).fill(87)) },
        };
        const account = await db.account.create({ data: {
            encryptionMode: "e2ee", ...binding,
            AccountPasswordCredential: { create: { revision: 4, credential: existingCredential } },
        } });
        await db.accountIdentity.create({ data: {
            accountId: account.id, provider: "email", providerUserId: nativeEmail, profile: {},
        } });
        const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user",
            authenticationEvidence: [{ kind: "home_method", methodId: "email_password" }] });
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        emailPasswordAuthMethodModule.registerRoutes(app);
        await app.ready();
        const newPlainPassword = "new plain password chosen for conversion";
        const transitionRequestDigest = `aemrb1_${"A".repeat(43)}`;
        try {
            const response = await app.inject({
                method: "POST", url: "/v1/auth/password/mutation/challenge",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    v: 1, action: "change", expectedCredentialRevision: 4,
                    normalizedNativeEmail: nativeEmail, newPlainPassword, transitionRequestDigest,
                },
            });
            expect(response.statusCode, response.body).toBe(200);
            const body = response.json();
            const targetCredential = PlainAccountPasswordCredentialV1Schema.parse(body.targetCredential);
            const challenge = PasswordMutationChallengeV1Schema.parse(body.challenge);
            expect(await verifyPasswordMaterial(targetCredential.hash, new TextEncoder().encode(newPlainPassword))).toBe(true);
            expect(response.body).not.toContain(existingCredential.authVerifier.hash.digest);
            expect(response.body).not.toContain(newPlainPassword);
            const newCredentialDigest = computeCanonicalDomainSeparatedDigest("happier.account-encryption-password-target.v1", [
                createCanonicalJsonSigningInput({ transitionRequestDigest, targetCredential }),
            ]);
            expect(challenge.operationDigest).toBe(createPasswordCredentialMutationDigestV1({
                v: 1, action: "change", accountId: account.id, expectedCredentialRevision: 4,
                normalizedNativeEmail: nativeEmail, newCredentialDigest,
            }));
            expect(await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: account.id } }))
                .toMatchObject({ revision: 4, credential: existingCredential });
            expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).encryptionMode).toBe("e2ee");
            const persisted = await db.keyChallengeV2.findUniqueOrThrow({ where: { id: challenge.challengeId } });
            expect(persisted).toMatchObject({ operationDigest: challenge.operationDigest, consumedAt: null });
            expect(JSON.stringify(persisted)).not.toContain(newPlainPassword);
        } finally {
            await app.close();
        }
    });
});
