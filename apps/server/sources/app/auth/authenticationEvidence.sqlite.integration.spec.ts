import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPasswordMaterial } from "@/app/auth/password/passwordMaterialVerifier";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { isAuthenticationEvidenceCurrentInTx } from "./authenticationEvidence";

describe("authentication-evidence native method currentness", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "authentication-evidence-currentness-",
            initAuth: false,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "true",
                HAPPIER_FEATURE_AUTH_MTLS__ENABLED: "true",
                HAPPIER_FEATURE_AUTH_MTLS__MODE: "forwarded",
                HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: "true",
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "true",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            },
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    const isCurrent = async (accountId: string, methodId: string): Promise<boolean> =>
        await inTx((tx) => isAuthenticationEvidenceCurrentInTx(tx, {
            env: process.env,
            accountId,
            evidence: { kind: "home_method", methodId },
        }));

    it("requires the exact Account to retain each native factor while ignoring session epoch changes", async () => {
        const emailAccount = await db.account.create({
            data: { encryptionMode: "plain", publicKey: null },
        });
        await db.accountIdentity.create({
            data: {
                accountId: emailAccount.id,
                provider: "email",
                providerUserId: "current-factor@example.test",
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: emailAccount.id,
                credential: {
                    v: 1,
                    kind: "plain_password_hash",
                    hash: await hashPasswordMaterial(new TextEncoder().encode("current password factor")),
                },
            },
        });
        const otherEmailAccount = await db.account.create({
            data: { encryptionMode: "plain", publicKey: null },
        });
        await db.accountIdentity.create({
            data: {
                accountId: otherEmailAccount.id,
                provider: "email",
                providerUserId: "other-factor@example.test",
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: otherEmailAccount.id,
                credential: {
                    v: 1,
                    kind: "plain_password_hash",
                    hash: await hashPasswordMaterial(new TextEncoder().encode("other account password factor")),
                },
            },
        });

        expect(await isCurrent(emailAccount.id, "email_password")).toBe(true);
        await db.account.update({
            where: { id: emailAccount.id },
            data: { tokenEpoch: { increment: 1 } },
        });
        await db.accountPasswordCredential.update({
            where: { accountId: emailAccount.id },
            data: { revision: { increment: 1 } },
        });
        expect(await isCurrent(emailAccount.id, "email_password")).toBe(true);
        await db.accountPasswordCredential.delete({ where: { accountId: emailAccount.id } });
        expect(await isCurrent(emailAccount.id, "email_password")).toBe(false);
        expect(await isCurrent(otherEmailAccount.id, "email_password")).toBe(true);

        const keyAccount = await db.account.create({
            data: { encryptionMode: "e2ee", publicKey: "current-key-challenge-factor" },
        });
        expect(await isCurrent(keyAccount.id, "key_challenge")).toBe(true);
        await db.account.update({
            where: { id: keyAccount.id },
            data: { encryptionMode: "plain" },
        });
        expect(await isCurrent(keyAccount.id, "key_challenge")).toBe(false);
        await db.account.update({
            where: { id: keyAccount.id },
            data: { encryptionMode: "e2ee", publicKey: null },
        });
        expect(await isCurrent(keyAccount.id, "key_challenge")).toBe(false);

        const mtlsAccount = await db.account.create({
            data: { encryptionMode: "plain", publicKey: null },
        });
        await db.accountIdentity.create({
            data: {
                accountId: mtlsAccount.id,
                provider: "mtls",
                providerUserId: "current-mtls-factor",
                profile: {},
            },
        });
        expect(await isCurrent(mtlsAccount.id, "mtls")).toBe(true);
        await db.accountIdentity.delete({
            where: { accountId_provider: { accountId: mtlsAccount.id, provider: "mtls" } },
        });
        expect(await isCurrent(mtlsAccount.id, "mtls")).toBe(false);
    });
});
