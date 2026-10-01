import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";

import {
    createExpectedAccountKeyChallengeSigningInputV1,
    createKeyChallengeV2SigningInput,
    KeyChallengeV2IssueResponseSchema,
    signAccountContentKeyBindingV1,
} from "@happier-dev/protocol";

import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { digestTeamInvitationToken, mintTeamInvitationToken } from "@/app/teams/invitations/token";

import {
    registerKeyChallengeAuthRoute,
    resolveStableKeyChallengeV2AudienceOrigin,
} from "./registerKeyChallengeAuthRoute";

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    return app.withTypeProvider<ZodTypeProvider>() as any;
}

describe("key-challenge v2 policy and stable audience (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-key-challenge-policy-",
            initAuth: false,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
                HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
                HAPPIER_SERVER_IDENTITY_ID: "stable-policy-server",
            },
        });
    }, 120_000);

    afterEach(() => {
        harness.resetEnv({
            HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
            HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
            HAPPIER_SERVER_IDENTITY_ID: "stable-policy-server",
        });
    });

    afterAll(async () => {
        await harness.close();
    });

    it("preserves ordinary Home v1 when its compatibility switch is disabled", async () => {
        harness.resetEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
        });
        const signing = tweetnacl.sign.keyPair();
        const challenge = new Uint8Array(32).fill(7);
        const signature = tweetnacl.sign.detached(challenge, signing.secretKey);
        const payload = {
            publicKey: privacyKit.encodeBase64(new Uint8Array(signing.publicKey)),
            challenge: privacyKit.encodeBase64(challenge),
            signature: privacyKit.encodeBase64(new Uint8Array(signature)),
        };

        const ordinaryApp = createTestApp();
        registerKeyChallengeAuthRoute(ordinaryApp);
        await ordinaryApp.ready();
        const ordinaryResponse = await ordinaryApp.inject({
            method: "POST",
            url: "/v1/auth",
            payload,
        });
        expect(ordinaryResponse.statusCode, ordinaryResponse.body).toBe(200);
        expect(ordinaryResponse.json()).toMatchObject({ success: true });
        await ordinaryApp.close();
    });

    it("uses the Home recommended protection for direct fresh Key Challenge provisioning", async () => {
        harness.resetEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
        });
        await db.homeGovernancePolicy.create({
            data: {
                id: "home",
                authenticationPolicy: {
                    v: 1,
                    permittedAccountModes: ["plain", "e2ee"],
                    recommendedProvisioningMode: "e2ee",
                },
            },
        });

        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const contentPublicKey = new Uint8Array(content.publicKey);
        const contentPublicKeySig = signAccountContentKeyBindingV1({
            accountSigningSecretKey: new Uint8Array(signing.secretKey),
            contentPublicKey,
        });
        const challenge = new Uint8Array(32).fill(19);
        const signature = tweetnacl.sign.detached(challenge, signing.secretKey);
        const app = createTestApp();
        registerKeyChallengeAuthRoute(app);
        await app.ready();
        try {
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth",
                payload: {
                    publicKey: privacyKit.encodeBase64(new Uint8Array(signing.publicKey)),
                    challenge: privacyKit.encodeBase64(challenge),
                    signature: privacyKit.encodeBase64(new Uint8Array(signature)),
                    contentPublicKey: privacyKit.encodeBase64(contentPublicKey),
                    contentPublicKeySig: privacyKit.encodeBase64(contentPublicKeySig),
                },
            });
            expect(response.statusCode, response.body).toBe(200);
            const persisted = await db.account.findUnique({
                where: { publicKey: privacyKit.encodeHex(new Uint8Array(signing.publicKey)) },
                select: { encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true },
            });
            expect(persisted?.encryptionMode).toBe("e2ee");
            expect(Buffer.from(persisted?.contentPublicKey ?? [])).toEqual(Buffer.from(contentPublicKey));
            expect(Buffer.from(persisted?.contentPublicKeySig ?? [])).toEqual(Buffer.from(contentPublicKeySig));
        } finally {
            await app.close();
        }
    });

    it("forwards the retryable upstream failure to an incumbent device instead of an opaque invalid token", async () => {
        // An already-proven device signing for its own expected Account must be
        // told to retry when the provider catalog is temporarily unreachable;
        // clients follow their sign-out/recovery owner on 401.
        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const contentPublicKey = new Uint8Array(content.publicKey);
        const contentPublicKeySig = signAccountContentKeyBindingV1({
            accountSigningSecretKey: new Uint8Array(signing.secretKey),
            contentPublicKey,
        });
        const account = await db.account.create({
            data: {
                publicKey: privacyKit.encodeHex(new Uint8Array(signing.publicKey)),
                encryptionMode: "e2ee",
                contentPublicKey: Buffer.from(contentPublicKey),
                contentPublicKeySig: Buffer.from(contentPublicKeySig),
            },
        });
        const challenge = new Uint8Array(32).fill(11);
        const signature = tweetnacl.sign.detached(
            createExpectedAccountKeyChallengeSigningInputV1({ challenge, expectedAccountId: account.id }),
            signing.secretKey,
        );

        harness.resetEnv({
            HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
            HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
            HAPPIER_SERVER_IDENTITY_ID: "stable-policy-server",
            // A required provider the deployment never registered is exactly the
            // catalog-resolution failure `enforceLoginEligibility` types as 503.
            AUTH_REQUIRED_LOGIN_PROVIDERS: "never-registered-provider",
        });

        const app = createTestApp();
        registerKeyChallengeAuthRoute(app);
        await app.ready();
        try {
            const response = await app.inject({
                method: "POST",
                url: "/v1/auth",
                payload: {
                    publicKey: privacyKit.encodeBase64(new Uint8Array(signing.publicKey)),
                    challenge: privacyKit.encodeBase64(challenge),
                    signature: privacyKit.encodeBase64(new Uint8Array(signature)),
                    expectedAccountId: account.id,
                    contentPublicKey: privacyKit.encodeBase64(contentPublicKey),
                    contentPublicKeySig: privacyKit.encodeBase64(contentPublicKeySig),
                },
            });
            expect(response.statusCode, response.body).toBe(503);
            expect(response.json()).toMatchObject({ error: "upstream_error" });
        } finally {
            await app.close();
        }
    });

    it("ignores runtime/public URL candidates when resolving the stable audience", () => {
        const env = {
            HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
            HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
            HAPPIER_RUNTIME_ORIGIN: "http://127.0.0.1:44001",
        } as NodeJS.ProcessEnv;
        expect(resolveStableKeyChallengeV2AudienceOrigin(env)).toBe("https://stable.example.test");
    });

    it.each(["invitation", "credential"] as const)(
        "rolls back the fresh invitation and one-time challenge after a %s refusal",
        async (failure) => {
            harness.resetEnv({ HAPPIER_SERVER_IDENTITY_ID: "srv_key_admission" });
            const signing = tweetnacl.sign.keyPair();
            const content = tweetnacl.box.keyPair();
            const publicKeyHex = privacyKit.encodeHex(new Uint8Array(signing.publicKey));
            const invitationToken = mintTeamInvitationToken();
            const team = await db.team.create({ data: { name: "Atomic key admission", admissionMode: "invite_only" } });
            const invitation = await db.teamInvitation.create({
                data: {
                    teamId: team.id,
                    tokenHash: new Uint8Array(digestTeamInvitationToken(invitationToken)),
                    recipientEmailNormalized: "key-admission@example.test",
                    role: "member",
                    historyAccess: "from_membership",
                    expiresAt: new Date(Date.now() + 60_000),
                    ...(failure === "invitation" ? { revokedAt: new Date() } : {}),
                },
            });
            const mailboxCount = await db.accountEmail.count();
            const identityCount = await db.accountIdentity.count();
            const accountCount = await db.account.count();
            const app = createTestApp();
            registerKeyChallengeAuthRoute(app);
            await app.ready();
            try {
                const issued = await app.inject({ method: "POST", url: "/v1/auth/challenge", payload: {} });
                expect(issued.statusCode, issued.body).toBe(200);
                const challenge = KeyChallengeV2IssueResponseSchema.parse(issued.json());
                const signature = tweetnacl.sign.detached(createKeyChallengeV2SigningInput(challenge), signing.secretKey);
                const payload = {
                    publicKey: privacyKit.encodeBase64(new Uint8Array(signing.publicKey)),
                    challengeId: challenge.challengeId,
                    signature: privacyKit.encodeBase64(new Uint8Array(signature)),
                    contentPublicKey: privacyKit.encodeBase64(new Uint8Array(content.publicKey)),
                    contentPublicKeySig: privacyKit.encodeBase64(signAccountContentKeyBindingV1({
                        accountSigningSecretKey: new Uint8Array(signing.secretKey),
                        contentPublicKey: new Uint8Array(content.publicKey),
                    })),
                    admission: { kind: "team_invitation", token: invitationToken },
                };
                if (failure === "credential") {
                    // Inject at the persistent DB boundary after membership writes. The
                    // real credential owner must reject this now-inactive fresh Account.
                    await db.$executeRawUnsafe(`CREATE TRIGGER reject_fresh_invitation_credential
                        AFTER INSERT ON "TeamMembership"
                        BEGIN UPDATE "Account" SET "status" = 'disabled' WHERE "id" = NEW."accountId"; END`);
                }
                const response = await app.inject({ method: "POST", url: "/v1/auth", payload });
                expect(response.statusCode, response.body).toBe(403);
                expect(response.json()).not.toHaveProperty("token");
                await expect(db.account.findUnique({ where: { publicKey: publicKeyHex } })).resolves.toBeNull();
                await expect(db.account.count()).resolves.toBe(accountCount);
                await expect(db.accountEmail.count()).resolves.toBe(mailboxCount);
                await expect(db.accountIdentity.count()).resolves.toBe(identityCount);
                await expect(db.teamMembership.count({ where: { teamId: team.id } })).resolves.toBe(0);
                await expect(db.teamInvitation.findUnique({ where: { id: invitation.id } }))
                    .resolves.toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
                await expect(db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } }))
                    .resolves.toMatchObject({ consumedAt: null });

                if (failure === "credential") {
                    await db.$executeRawUnsafe('DROP TRIGGER "reject_fresh_invitation_credential"');
                    const retried = await app.inject({ method: "POST", url: "/v1/auth", payload });
                    expect(retried.statusCode, retried.body).toBe(200);
                    const account = await db.account.findUniqueOrThrow({ where: { publicKey: publicKeyHex } });
                    expect(account.contentPublicKey).toEqual(new Uint8Array(content.publicKey));
                    await expect(auth.verifyToken(retried.json().token)).resolves.toMatchObject({
                        userId: account.id, authTokenKind: "account", authority: "present_user",
                    });
                    await expect(db.accountEmail.findFirst({ where: { accountId: account.id } }))
                        .resolves.toMatchObject({ normalizedEmail: "key-admission@example.test" });
                    await expect(db.teamMembership.count({ where: { teamId: team.id } })).resolves.toBe(1);
                    await expect(db.teamInvitation.findUnique({ where: { id: invitation.id } }))
                        .resolves.toMatchObject({ acceptedByAccountId: account.id });
                    await expect(db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } }))
                        .resolves.toMatchObject({ consumedAt: expect.any(Date) });
                    const replay = await app.inject({ method: "POST", url: "/v1/auth", payload });
                    expect(replay.statusCode, replay.body).toBe(401);
                    await expect(db.teamMembership.count({ where: { teamId: team.id } })).resolves.toBe(1);
                }
            } finally {
                if (failure === "credential") {
                    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "reject_fresh_invitation_credential"');
                }
                await app.close();
            }
        },
    );
});
