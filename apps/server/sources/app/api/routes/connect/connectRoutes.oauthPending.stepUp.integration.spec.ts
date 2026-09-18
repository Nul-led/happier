import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { createHash } from "node:crypto";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import {
    consumeAccountEncryptionFirstKeyStepUpPendingInTx,
} from "./connectRoutes.oauthPending";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";

function sha256Hex(value: string): string {
    return createHash("sha256")
        .update(value, "utf8")
        .digest("hex");
}

describe("OAuth pending first-key step-up consumption", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-oauth-step-up-pending-",
            initAuth: false,
        });
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountIdentity.deleteMany(),
            () => db.repeatKey.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    afterAll(async () => {
        await harness.close();
    });

    async function createFixture(params?: {
        expiresAt?: Date;
        requestDigest?: string;
        purpose?: "account_encryption_first_key" | "account_password_enrollment";
    }) {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://api.example.test/v1/oauth/github/callback",
        });
        const runtime = (await resolveOAuthRuntimeById(process.env, "github"))!;
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "github",
                providerUserId: "provider-user-1",
                profile: {},
            },
        });
        const proof = "fresh-browser-proof";
        const pending = "oauth_pending_stepup123";
        const purpose = params?.purpose ?? "account_encryption_first_key";
        const requestDigest = params?.requestDigest
            ?? (purpose === "account_password_enrollment" ? "A".repeat(43) : `aemrb1_${"A".repeat(43)}`);
        await db.repeatKey.create({
            data: {
                key: pending,
                value: JSON.stringify({
                    v: 3,
                    flow: "auth",
                    purpose,
                    provider: "github",
                    securityBinding: {
                        provider: runtime.reference,
                        connection: null,
                        admission: null,
                        purpose,
                    },
                    userId: account.id,
                    providerUserId: "provider-user-1",
                    proofHash: sha256Hex(proof),
                    requestDigest,
                }),
                expiresAt:
                    params?.expiresAt
                    ?? new Date(Date.now() + 60_000),
            },
        });
        return {
            accountId: account.id,
            provider: "github",
            pending,
            proof,
            requestDigest,
        };
    }

    it("keeps enrollment proof purpose-bound and rolls consumption back with credential writes", async () => {
        const fixture = await createFixture({ purpose: "account_password_enrollment" });
        expect(await inTx((tx) => consumeAccountEncryptionFirstKeyStepUpPendingInTx(tx, fixture)))
            .toMatchObject({ ok: false });
        const { consumeAccountPasswordEnrollmentExternalAuthProofInTx } =
            await import("@/app/auth/accountEncryptionFirstKeyExternalAuthProof");
        const input = {
            accountId: fixture.accountId,
            requestDigest: fixture.requestDigest,
            externalAuthProof: { provider: fixture.provider, pending: fixture.pending, proof: fixture.proof },
        };
        expect(await inTx((tx) => consumeAccountPasswordEnrollmentExternalAuthProofInTx(tx, {
            ...input, requestDigest: "B".repeat(42) + "A",
        }))).toMatchObject({ ok: false });
        await expect(inTx(async (tx) => {
            expect(await consumeAccountPasswordEnrollmentExternalAuthProofInTx(tx, input)).toMatchObject({ ok: true });
            throw new Error("credential-write-rejected");
        })).rejects.toThrow("credential-write-rejected");
        expect(await db.repeatKey.findUnique({ where: { key: fixture.pending } })).not.toBeNull();
        expect(await inTx((tx) => consumeAccountPasswordEnrollmentExternalAuthProofInTx(tx, input)))
            .toEqual({ ok: true, provider: "github", providerUserId: "provider-user-1" });
        expect(await inTx((tx) => consumeAccountPasswordEnrollmentExternalAuthProofInTx(tx, input)))
            .toEqual({ ok: false, reason: "invalid_or_consumed" });
    });

    it("atomically consumes the existing pending row after every binding matches", async () => {
        const fixture = await createFixture();

        const consumed = await inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                fixture,
            ));
        expect(consumed).toEqual({
            ok: true,
            provider: "github",
            providerUserId: "provider-user-1",
        });
        expect(await db.repeatKey.findUnique({
            where: { key: fixture.pending },
        })).toBeNull();

        const replay = await inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                fixture,
            ));
        expect(replay).toEqual({
            ok: false,
            reason: "invalid_or_consumed",
        });
    });

    it("rolls proof consumption back with a rejected migration transaction so the exact request can retry", async () => {
        const fixture = await createFixture();

        await expect(inTx(async (tx) => {
            const consumed =
                await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                    tx,
                    fixture,
                );
            expect(consumed.ok).toBe(true);
            throw new Error("later-migration-write-rejected");
        })).rejects.toThrow("later-migration-write-rejected");
        expect(await db.repeatKey.findUnique({
            where: { key: fixture.pending },
        })).not.toBeNull();

        await expect(inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                fixture,
            ))).resolves.toEqual({
            ok: true,
            provider: "github",
            providerUserId: "provider-user-1",
        });
    });

    it("consumes a first-key proof missing its configuration binding without touching the Account or identity", async () => {
        const fixture = await createFixture();
        const row = await db.repeatKey.findUniqueOrThrow({ where: { key: fixture.pending } });
        const value: Record<string, unknown> = JSON.parse(row.value);
        delete value.securityBinding;
        await db.repeatKey.update({ where: { key: fixture.pending }, data: { value: JSON.stringify(value) } });
        const accountBefore = await db.account.findUnique({ where: { id: fixture.accountId } });
        const identitiesBefore = await db.accountIdentity.findMany({ where: { accountId: fixture.accountId } });

        expect(await inTx((tx) => consumeAccountEncryptionFirstKeyStepUpPendingInTx(tx, fixture))).toEqual({
            ok: false, reason: "configuration_changed",
        });
        expect(await db.repeatKey.findUnique({ where: { key: fixture.pending } })).toBeNull();
        expect(await db.account.findUnique({ where: { id: fixture.accountId } })).toEqual(accountBefore);
        expect(await db.accountIdentity.findMany({ where: { accountId: fixture.accountId } })).toEqual(identitiesBefore);
    });

    it.each([
        ["wrong Account", { accountId: "another-account" }],
        ["wrong request", {
            requestDigest: `aemrb1_${"B".repeat(43)}`,
        }],
        ["wrong browser proof", { proof: "wrong-proof" }],
    ])("fails closed for %s without consuming the proof", async (_label, mismatch) => {
        const fixture = await createFixture();

        const result = await inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                { ...fixture, ...mismatch },
            ));
        expect(result).toEqual({
            ok: false,
            reason: "binding_mismatch",
        });
        expect(await db.repeatKey.findUnique({
            where: { key: fixture.pending },
        })).not.toBeNull();
    });

    it("fails closed when expired or when the bound external identity is no longer current", async () => {
        const expired = await createFixture({
            expiresAt: new Date(Date.now() - 1),
        });
        await expect(inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                expired,
            ))).resolves.toEqual({
            ok: false,
            reason: "expired",
        });

        await harness.resetDbTables([
            () => db.accountIdentity.deleteMany(),
            () => db.repeatKey.deleteMany(),
            () => db.account.deleteMany(),
        ]);
        const staleIdentity = await createFixture();
        await db.accountIdentity.deleteMany({
            where: { accountId: staleIdentity.accountId },
        });
        await expect(inTx(async (tx) =>
            await consumeAccountEncryptionFirstKeyStepUpPendingInTx(
                tx,
                staleIdentity,
            ))).resolves.toEqual({
            ok: false,
            reason: "identity_mismatch",
        });
        expect(await db.repeatKey.findUnique({
            where: { key: staleIdentity.pending },
        })).not.toBeNull();
    });
});
