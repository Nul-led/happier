import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { issueNativeAuthOneTimeOperationInTx, readNativeAuthOneTimeOperation } from "@/app/auth/email/nativeAuthOneTimeOperations";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { auth } from "@/app/auth/auth";
import { createTeamInvitationForActorInTx } from "@/app/teams/invitations/invitationService";
import { mintTeamInvitationToken } from "@/app/teams/invitations/token";
import { resolveAuthEntry } from "@/app/auth/entry/resolveAuthEntry";
import { authRoutes } from "./authRoutes";
import { createKeyChallengeV2SigningInput, encodePasswordCredentialFieldV1, KeyChallengeV2IssueResponseSchema, signAccountContentKeyBindingV1 } from "@happier-dev/protocol";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import type { AuthEmailDelivery } from "@/app/auth/email/authEmailDelivery";

describe("native fresh Account admission through the registered method", () => {
    let harness: LightSqliteHarness;
    const password = "correct password with spaces";
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-native-provision-", initAuth: true,
            env: {
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "true",
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "true",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                HAPPIER_FEATURE_TEAMS__ENABLED: "true",
                HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
                HAPPIER_SERVER_IDENTITY_ID: "srv_native_provision",
            },
        });
    }, 120_000);
    afterEach(async () => {
        harness.resetEnv();
        await db.homeGovernancePolicy.deleteMany();
        await db.team.deleteMany();
        await db.account.deleteMany();
        await db.repeatKey.deleteMany();
    });
    afterAll(async () => { if (harness) await harness.close(); });

    async function proof(email = "signup@example.test") {
        return inTx((tx) => issueNativeAuthOneTimeOperationInTx(tx, {
            v: 1, purpose: "verify_native_email", normalizedEmail: email,
            consumer: { kind: "fresh_account", continuationId: null },
        }));
    }

    function app(deliveredVerificationUrls: string[] = []) {
        const server = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        server.setValidatorCompiler(validatorCompiler);
        server.setSerializerCompiler(serializerCompiler);
        enableAuthentication(server);
        const delivery: AuthEmailDelivery = {
            isReady: async () => true,
            deliver: async (message) => {
                if (message.kind === "native_email_verification") {
                    deliveredVerificationUrls.push(message.verifyUrl);
                }
                return { status: "sent" };
            },
        };
        authRoutes(server, {
            authEmailDelivery: delivery,
            isEmailDeliveryReady: () => true,
            resolveApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: "opaque-home-target",
                serverId: "home",
            }),
        });
        return server;
    }

    async function invitation(recipientEmailNormalized: string | null = "invited@example.test") {
        const inviter = await db.account.create({ data: { encryptionMode: "plain", publicKey: null } });
        const team = await db.team.create({ data: { name: "Native admission team" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: inviter.id, role: "owner" } });
        const result = await inTx((tx) => createTeamInvitationForActorInTx(tx, {
            teamId: team.id, actorAccountId: inviter.id, role: "member", historyAccess: "from_membership",
            recipientEmailNormalized, emailDeliveryAvailable: true, requestKey: crypto.randomUUID(),
        }));
        if (!result.ok || !result.value.token) throw new Error("invitation issuance failed");
        return { team, token: result.value.token, invitation: result.value.invitation };
    }

    it("consumes proven email with a keyless Account, locator and password, then issues a narrowed terminal token", async () => {
        const issued = await proof();
        const server = app();
        try {
            const payload = {
                v: 1, email: " SIGNUP@EXAMPLE.TEST ",
                admission: { kind: "native_email_verification", token: issued.rawBearer },
                credentialKind: "terminal",
                account: { mode: "plain", password },
            };
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload });
            expect(result.statusCode, result.statusCode >= 400 ? result.body : undefined).toBe(200);
            const account = await db.account.findFirstOrThrow();
            expect(account).toMatchObject({ encryptionMode: "plain", publicKey: null, contentPublicKey: null, contentPublicKeySig: null });
            expect(result.json()).toEqual({ token: expect.any(String), accountId: account.id, teamId: null });
            expect(await auth.verifyToken(result.json().token)).toMatchObject({ userId: account.id, authTokenKind: "terminal" });
            expect(await db.accountIdentity.findFirst()).toMatchObject({ accountId: account.id, provider: "email", providerUserId: "signup@example.test" });
            expect(await db.accountEmail.findFirst()).toMatchObject({ accountId: account.id, normalizedEmail: "signup@example.test" });
            expect(await db.accountPasswordCredential.findFirst()).toMatchObject({ accountId: account.id, revision: 1, credential: { kind: "plain_password_hash" } });
            const login = await server.inject({ method: "POST", url: "/v1/auth/email/login", payload: { v: 1, email: "signup@example.test", password } });
            expect(login.statusCode).toBe(200);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, { purpose: "verify_native_email", token: issued.rawBearer }))).toBeNull();
            expect((await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload })).statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
            const sibling = await proof();
            const collision = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload, admission: { kind: "native_email_verification", token: sibling.rawBearer },
            } });
            expect(collision.statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, { purpose: "verify_native_email", token: sibling.rawBearer }))).not.toBeNull();
        } finally { await server.close(); }
    });

    it("creates an Account for Account Service sign-in: the mail link names the purpose and creation mints a Directory credential", async () => {
        const deliveredVerificationUrls: string[] = [];
        const server = app(deliveredVerificationUrls);
        try {
            const requested = await server.inject({ method: "POST", url: "/v1/auth/email/verify/request",
                payload: { v: 1, email: "directory-signup@example.test", purpose: "account_service" } });
            expect(requested.statusCode, requested.body).toBe(200);
            expect(deliveredVerificationUrls).toHaveLength(1);
            const link = new URL(deliveredVerificationUrls[0]!);
            expect(link.searchParams.get("purpose")).toBe("account_service");
            expect(link.searchParams.get("target")).toBe("opaque-home-target");
            const token = link.pathname.split("/").at(-1)!;
            const created = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: "directory-signup@example.test",
                admission: { kind: "native_email_verification", token },
                account: { mode: "plain", password },
                credentialTarget: "account_directory",
                credentialKind: "terminal",
            } });
            expect(created.statusCode, created.body).toBe(200);
            expect(await auth.verifyToken(created.json().token)).toMatchObject({
                userId: created.json().accountId, authTokenKind: "account_directory", authority: "present_user",
            });
            // An ordinary Home request keeps its ordinary link.
            await server.inject({ method: "POST", url: "/v1/auth/email/verify/request",
                payload: { v: 1, email: "home-signup@example.test" } });
            expect(new URL(deliveredVerificationUrls[1]!).searchParams.has("purpose")).toBe(false);
        } finally { await server.close(); }
    });

    it("adds the same-service Home when an existing password Account signs in to the Account Service", async () => {
        harness.resetEnv({
            HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: "self",
            HAPPIER_CANONICAL_SERVER_URL: "https://cloud.example.test",
            HAPPIER_PUBLIC_SERVER_URL: "https://cloud.example.test",
        });
        const issued = await proof("returning@example.test");
        const server = app();
        try {
            const created = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: "returning@example.test",
                admission: { kind: "native_email_verification", token: issued.rawBearer },
                account: { mode: "plain", password },
            } });
            expect(created.statusCode, created.body).toBe(200);
            const accountId = created.json().accountId as string;
            expect(await db.accountHomeDirectoryEntry.count({ where: { accountId } })).toBe(0);

            const login = await server.inject({ method: "POST", url: "/v1/auth/email/login", payload: {
                v: 1, email: "returning@example.test", password, credentialTarget: "account_directory",
            } });
            expect(login.statusCode, login.body).toBe(200);
            expect(await auth.verifyToken(login.json().token)).toMatchObject({
                userId: accountId, authTokenKind: "account_directory",
            });
            expect(await db.accountHomeDirectoryEntry.findMany({ where: { accountId } })).toEqual([
                expect.objectContaining({ homeServerIdentityId: "srv_native_provision" }),
            ]);
            expect(await db.accountDirectoryLink.findMany({ where: { accountId } })).toEqual([
                expect.objectContaining({ issuerServerIdentityId: "srv_native_provision", issuerSubjectId: accountId }),
            ]);
            expect(await db.account.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({
                preferredHomeServerIdentityId: "srv_native_provision",
            });
        } finally { await server.close(); }
    });

    it("adds the same-service Home in the Account Service provisioning transaction", async () => {
        harness.resetEnv({
            HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: "self",
            HAPPIER_CANONICAL_SERVER_URL: "https://cloud.example.test",
            HAPPIER_PUBLIC_SERVER_URL: "https://cloud.example.test",
        });
        const issued = await proof("new-service@example.test");
        const server = app();
        try {
            const created = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: "new-service@example.test",
                admission: { kind: "native_email_verification", token: issued.rawBearer },
                account: { mode: "plain", password },
                credentialTarget: "account_directory",
            } });
            expect(created.statusCode, created.body).toBe(200);
            const accountId = created.json().accountId as string;
            expect(await auth.verifyToken(created.json().token)).toMatchObject({
                userId: accountId, authTokenKind: "account_directory",
            });
            expect(await db.accountHomeDirectoryEntry.findMany({ where: { accountId } })).toEqual([
                expect.objectContaining({ homeServerIdentityId: "srv_native_provision" }),
            ]);
            expect(await db.accountDirectoryLink.findMany({ where: { accountId } })).toEqual([
                expect.objectContaining({ issuerServerIdentityId: "srv_native_provision", issuerSubjectId: accountId }),
            ]);
        } finally { await server.close(); }
    });

    it("offers no mail-dependent action when SMTP works but no Home link can be built", async () => {
        const deliveredVerificationUrls: string[] = [];
        const server = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        server.setValidatorCompiler(validatorCompiler);
        server.setSerializerCompiler(serializerCompiler);
        enableAuthentication(server);
        // SMTP is configured, but this Home publishes no connection descriptor, so no link exists.
        authRoutes(server, {
            authEmailDelivery: {
                isReady: async () => true,
                deliver: async (message) => {
                    if (message.kind === "native_email_verification") deliveredVerificationUrls.push(message.verifyUrl);
                    return { status: "sent" };
                },
            },
            resolveApplicationLinkTarget: async () => ({ applicationOrigin: "https://app.example.test", homeTarget: null, serverId: null }),
        });
        await server.ready();
        try {
            const entry = await server.inject({ method: "POST", url: "/v1/auth/entry",
                payload: { v: 1, scope: { kind: "home" }, purpose: "account_service" } });
            expect(entry.statusCode, entry.body).toBe(200);
            const actions = (entry.json().actions ?? []) as Array<{ methodId: string; action: string; passwordReset?: string }>;
            expect(actions.some((action) => action.methodId === "email_password" && action.action === "login")).toBe(true);
            expect(actions.some((action) => action.methodId === "email_password" && action.action === "provision")).toBe(false);
            expect(actions.find((action) => action.methodId === "email_password" && action.action === "login")?.passwordReset)
                .toBeUndefined();
            const requested = await server.inject({ method: "POST", url: "/v1/auth/email/verify/request",
                payload: { v: 1, email: "nobody-mailed@example.test" } });
            expect(requested.json()).toEqual({ accepted: true });
            expect(deliveredVerificationUrls).toEqual([]);
        } finally { await server.close(); }
    });

    it("says on the password sign-in action whether a reset link can be mailed", async () => {
        const request = { v: 1 as const, scope: { kind: "home" as const }, purpose: "account_service" as const };
        const loginAction = (projection: Awaited<ReturnType<typeof resolveAuthEntry>>) => projection.state === "ready"
            ? projection.actions.find((action) => action.methodId === "email_password" && action.action === "login")
            : undefined;
        const withMail = await resolveAuthEntry(request, { env: process.env, emailDeliveryReady: true });
        expect(loginAction(withMail)).toMatchObject({ passwordReset: "email" });
        const withoutMail = await resolveAuthEntry(request, { env: process.env, emailDeliveryReady: false });
        expect(loginAction(withoutMail)).toBeDefined();
        expect(loginAction(withoutMail)).not.toHaveProperty("passwordReset");
    });

    it("rolls mailbox consumption, Account and identity back when password persistence fails", async () => {
        const issued = await proof();
        const server = app();
        await db.$executeRawUnsafe(`CREATE TRIGGER fail_native_password_insert BEFORE INSERT ON AccountPasswordCredential BEGIN SELECT RAISE(ABORT, 'password persistence unavailable'); END`);
        try {
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: "signup@example.test",
                admission: { kind: "native_email_verification", token: issued.rawBearer }, account: { mode: "plain", password },
            } });
            expect(result.statusCode).toBe(500);
            expect(await db.account.count()).toBe(0);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, { purpose: "verify_native_email", token: issued.rawBearer }))).not.toBeNull();
        } finally {
            await db.$executeRawUnsafe("DROP TRIGGER fail_native_password_insert");
            await server.close();
        }
    });

    it("rechecks closed Home policy without consuming a public mailbox proof", async () => {
        const issued = await proof();
        await db.homeGovernancePolicy.create({ data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } } });
        const server = app();
        try {
            const unknownProof = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: "signup@example.test",
                admission: { kind: "native_email_verification", token: "z".repeat(43) },
                account: { mode: "plain", password },
            } });
            expect(unknownProof.statusCode).toBe(401);
            expect(unknownProof.json()).toEqual({ error: "authentication_failed" });
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: "signup@example.test", admission: { kind: "native_email_verification", token: issued.rawBearer },
                account: { mode: "plain", password },
            } });
            expect(result.statusCode).toBe(403);
            expect(result.json()).toEqual({ error: "method_not_available" });
            expect(await db.account.count()).toBe(0);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, { purpose: "verify_native_email", token: issued.rawBearer }))).not.toBeNull();
        } finally { await server.close(); }
    });

    it("honours the public-signup provisioning restriction and exempts invitation admission", async () => {
        harness.resetEnv({ HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "email_password" });
        const issued = await proof();
        const server = app();
        try {
            const denied = await server.inject({
                method: "POST", url: "/v1/auth/email/provision", remoteAddress: "203.0.113.10",
                payload: {
                    v: 1, email: "signup@example.test",
                    admission: { kind: "native_email_verification", token: issued.rawBearer },
                    account: { mode: "plain", password },
                },
            });
            expect(denied.statusCode, denied.body).toBe(403);
            expect(denied.json()).toEqual({ error: "method_not_available" });
            expect(await db.account.count()).toBe(0);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email", token: issued.rawBearer,
            }))).not.toBeNull();

            const invited = await invitation();
            const admitted = await server.inject({
                method: "POST", url: "/v1/auth/email/provision", remoteAddress: "203.0.113.10",
                payload: {
                    v: 1, email: "invited@example.test",
                    admission: { kind: "team_invitation", token: invited.token },
                    account: { mode: "plain", password },
                },
            });
            expect(admitted.statusCode, admitted.body).toBe(200);
            expect(admitted.json().teamId).toBe(invited.team.id);
        } finally { await server.close(); }
    });

    it("uses an addressed invitation as bounded admission and mailbox proof, committing membership atomically", async () => {
        const invited = await invitation();
        await db.team.update({ where: { id: invited.team.id }, data: { authenticationPolicy: {
            v: 1,
            mode: "restricted",
            accepted: [{ kind: "home_method", methodId: "email_password" }],
        } } });
        await db.homeGovernancePolicy.create({ data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } } });
        const server = app();
        try {
            const entry = await server.inject({ method: "POST", url: "/v1/auth/entry", payload: {
                v: 1, purpose: "home", scope: { kind: "invitation", token: invited.token },
            } });
            expect(entry.statusCode, entry.body).toBe(200);
            expect(entry.json().actions).toEqual(expect.arrayContaining([expect.objectContaining({ methodId: "email_password", action: "provision" })]));
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1, email: " INVITED@EXAMPLE.TEST ", admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            } });
            expect(result.statusCode, result.statusCode >= 400 ? result.body : undefined).toBe(200);
            expect(result.json().teamId).toBe(invited.team.id);
            const accountId = result.json().accountId;
            expect(await db.teamMembership.findUnique({ where: { teamId_accountId: { teamId: invited.team.id, accountId } } })).toMatchObject({ role: "member" });
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } })).toMatchObject({ acceptedByAccountId: accountId, acceptedAt: expect.any(Date) });
            expect(await db.accountEmail.findFirst({ where: { accountId } })).toMatchObject({ normalizedEmail: "invited@example.test" });
            expect(await db.accountHomeDirectoryEntry.count()).toBe(0);
        } finally { await server.close(); }
    });

    it("does not consume a Team invitation or create an Account when Teams is unavailable", async () => {
        const invited = await invitation();
        const server = app();
        const previous = process.env.HAPPIER_BUILD_FEATURES_DENY;
        process.env.HAPPIER_BUILD_FEATURES_DENY = "teams";
        try {
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: "invited@example.test",
                admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            } });
            expect(result.statusCode, result.body).toBe(403);
            expect(result.json()).toEqual({ error: "method_not_available" });
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(1);
            await expect(db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                .resolves.toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
        } finally {
            if (previous === undefined) delete process.env.HAPPIER_BUILD_FEATURES_DENY;
            else process.env.HAPPIER_BUILD_FEATURES_DENY = previous;
            await server.close();
        }
    });

    it("does not require restricted Team qualification for structural invitation admission", async () => {
        const invited = await invitation();
        await db.team.update({ where: { id: invited.team.id }, data: { authenticationPolicy: {
            v: 1,
            mode: "restricted",
            accepted: [{ kind: "home_method", methodId: "key_challenge" }],
        } } });
        await db.homeGovernancePolicy.create({ data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } } });
        const server = app();
        try {
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: "invited@example.test",
                admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            } });
            expect(result.statusCode, result.body).toBe(200);
            const accountId = result.json().accountId as string;
            expect(await db.account.count()).toBe(2);
            expect(await db.accountIdentity.count({ where: { accountId } })).toBe(1);
            expect(await db.accountEmail.count({ where: { accountId } })).toBe(1);
            expect(await db.accountPasswordCredential.count({ where: { accountId } })).toBe(1);
            expect(await db.teamMembership.count()).toBe(2);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                .toMatchObject({ acceptedAt: expect.any(Date), acceptedByAccountId: accountId });
        } finally { await server.close(); }
    });

    it("returns email_mismatch without consuming any fresh-Account fact, then accepts the normalized invited mailbox", async () => {
        const invited = await invitation("invited@example.test");
        await db.homeGovernancePolicy.create({ data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } } });
        const server = app();
        try {
            const repeatKeysBefore = await db.repeatKey.findMany({ orderBy: { key: "asc" } });
            const unknown = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: "different@example.test",
                admission: { kind: "team_invitation", token: "z".repeat(43) },
                account: { mode: "plain", password },
            } });
            expect(unknown.statusCode).toBe(401);
            expect(unknown.json()).toEqual({ error: "authentication_failed" });
            const result = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: " DIFFERENT@EXAMPLE.TEST ",
                admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            } });
            expect(result.statusCode).toBe(403);
            expect(result.json()).toEqual({ error: "email_mismatch" });
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(1);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                .toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
            expect(await db.repeatKey.findMany({ orderBy: { key: "asc" } })).toEqual(repeatKeysBefore);

            const retried = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                v: 1,
                email: " INVITED@EXAMPLE.TEST ",
                admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            } });
            expect(retried.statusCode, retried.body).toBe(200);
            const accountId = retried.json().accountId;
            expect(await db.account.count()).toBe(2);
            expect(await db.accountIdentity.findFirst({ where: { accountId } }))
                .toMatchObject({ provider: "email", providerUserId: "invited@example.test" });
            expect(await db.accountEmail.findFirst({ where: { accountId } }))
                .toMatchObject({ normalizedEmail: "invited@example.test" });
            expect(await db.accountPasswordCredential.count({ where: { accountId } })).toBe(1);
            expect(await db.teamMembership.findUnique({ where: { teamId_accountId: { teamId: invited.team.id, accountId } } }))
                .toMatchObject({ role: "member" });
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                .toMatchObject({ acceptedAt: expect.any(Date), acceptedByAccountId: accountId });
        } finally { await server.close(); }
    });

    it("cannot use a transferable invitation as arbitrary native-email proof", async () => {
        const invited = await invitation(null);
        const server = app();
        try {
            const payload = {
                v: 1, email: "signup@example.test", admission: { kind: "team_invitation", token: invited.token },
                account: { mode: "plain", password },
            };
            expect((await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload })).statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } })).toMatchObject({ acceptedAt: null });
            const wrongProof = await proof("different@example.test");
            expect((await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload,
                admission: { ...payload.admission, emailVerificationToken: wrongProof.rawBearer },
            } })).statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(1);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } })).toMatchObject({ acceptedAt: null });
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: wrongProof.rawBearer,
            }))).not.toBeNull();
            const issued = await proof();
            const unbound = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload, admission: { ...payload.admission, emailVerificationToken: issued.rawBearer },
            } });
            expect(unbound.statusCode).toBe(401);
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: issued.rawBearer,
            }))).not.toBeNull();
        } finally { await server.close(); }
    });

    it("uses a transferable invitation only after its separately bound mailbox proof", async () => {
        const invited = await invitation(null);
        await db.homeGovernancePolicy.create({
            data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } },
        });
        const deliveredVerificationUrls: string[] = [];
        const server = app(deliveredVerificationUrls);
        try {
            const requested = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "new-member@example.test",
                    admission: { kind: "team_invitation", token: invited.token },
                },
            });
            expect(requested.statusCode, requested.body).toBe(200);
            expect(requested.json()).toEqual({ accepted: true });
            expect(deliveredVerificationUrls).toHaveLength(1);
            const verificationToken = new URL(deliveredVerificationUrls[0]!).pathname.split("/").at(-1)!;
            const operationBeforeProvision = await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: verificationToken,
            }));
            expect(operationBeforeProvision).toMatchObject({
                purpose: "verify_native_email",
                normalizedEmail: "new-member@example.test",
                consumer: {
                    kind: "team_invitation",
                    invitationId: invited.invitation.id,
                    teamId: invited.team.id,
                },
            });

            const previousFeatureDeny = process.env.HAPPIER_BUILD_FEATURES_DENY;
            try {
                process.env.HAPPIER_BUILD_FEATURES_DENY = "teams";
                const featureDenied = await server.inject({
                    method: "POST",
                    url: "/v1/auth/email/provision",
                    payload: {
                        v: 1,
                        email: "new-member@example.test",
                        admission: { kind: "native_email_verification", token: verificationToken },
                        account: { mode: "plain", password },
                    },
                });
                expect(featureDenied.statusCode, featureDenied.body).toBe(403);
                expect(featureDenied.json()).toEqual({ error: "method_not_available" });
                expect(await db.account.count()).toBe(1);
                expect(await db.teamMembership.count({ where: { teamId: invited.team.id } })).toBe(1);
                await expect(db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                    .resolves.toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
                await expect(inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                    purpose: "verify_native_email",
                    token: verificationToken,
                }))).resolves.not.toBeNull();
            } finally {
                if (previousFeatureDeny === undefined) delete process.env.HAPPIER_BUILD_FEATURES_DENY;
                else process.env.HAPPIER_BUILD_FEATURES_DENY = previousFeatureDeny;
            }

            const provisioned = await server.inject({
                method: "POST",
                url: "/v1/auth/email/provision",
                payload: {
                    v: 1,
                    email: "new-member@example.test",
                    admission: { kind: "native_email_verification", token: verificationToken },
                    account: { mode: "plain", password },
                },
            });
            expect(provisioned.statusCode, provisioned.statusCode >= 400 ? provisioned.body : undefined).toBe(200);
            expect(provisioned.json()).toMatchObject({ teamId: invited.team.id, token: expect.any(String) });
            const accountId = provisioned.json().accountId;
            expect(await db.account.findUnique({ where: { id: accountId } })).toMatchObject({ encryptionMode: "plain" });
            expect(await db.accountIdentity.findUnique({
                where: { provider_providerUserId: { provider: "email", providerUserId: "new-member@example.test" } },
            })).toMatchObject({ accountId });
            expect(await db.accountEmail.findFirst({ where: { accountId } })).toMatchObject({
                normalizedEmail: "new-member@example.test",
            });
            expect(await db.accountPasswordCredential.findUnique({ where: { accountId } })).toMatchObject({ revision: 1 });
            expect(await db.teamMembership.findUnique({
                where: { teamId_accountId: { teamId: invited.team.id, accountId } },
            })).toMatchObject({ role: "member" });
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } })).toMatchObject({
                acceptedByAccountId: accountId,
                acceptedAt: expect.any(Date),
            });
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: verificationToken,
            }))).toBeNull();
        } finally {
            await server.close();
        }
    });

    it("keeps invalid or missing transferable-invitation verification requests neutral", async () => {
        await db.homeGovernancePolicy.create({
            data: { id: "home", authenticationPolicy: { v: 1, admission: "invitation_only" } },
        });
        const deliveredVerificationUrls: string[] = [];
        const server = app(deliveredVerificationUrls);
        try {
            const invalidInvitation = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "new-member@example.test",
                    admission: { kind: "team_invitation", token: mintTeamInvitationToken() },
                },
            });
            const missingInvitation = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: { v: 1, email: "new-member@example.test" },
            });
            expect(invalidInvitation.statusCode).toBe(200);
            expect(invalidInvitation.json()).toEqual({ accepted: true });
            expect(missingInvitation.statusCode).toBe(200);
            expect(missingInvitation.json()).toEqual({ accepted: true });
            expect(deliveredVerificationUrls).toEqual([]);
            expect(await db.repeatKey.count()).toBe(0);
        } finally {
            await server.close();
        }
    });

    it("mints fresh mailbox proof only for a current ordinary server-authored continuation", async () => {
        const validContinuation = "oauth_pending_validNativeEmailContinuation";
        const wrongPurposeContinuation = "oauth_pending_wrongNativeEmailPurpose";
        const expiredContinuation = "oauth_pending_expiredNativeEmailContinuation";
        await db.repeatKey.createMany({ data: [
            {
                key: validContinuation,
                expiresAt: new Date(Date.now() + 60_000),
                value: JSON.stringify({
                    v: 2,
                    flow: "auth",
                    provider: "github",
                    proofHash: "proof-hash",
                    profileEnc: "profile",
                    accessTokenEnc: "token",
                }),
            },
            {
                key: wrongPurposeContinuation,
                expiresAt: new Date(Date.now() + 60_000),
                value: JSON.stringify({
                    v: 2,
                    flow: "auth",
                    authMode: "keyless",
                    purpose: "account_directory",
                    provider: "github",
                    securityBinding: {
                        provider: { id: "github", context: { kind: "home" } },
                        connection: null,
                        admission: null,
                        purpose: "account_directory",
                    },
                    proofHash: "proof-hash",
                    profileEnc: "profile",
                    accessTokenEnc: "token",
                    endpointUrl: "https://other-home.example.test",
                    endpointServerIdentityId: "other_home",
                    canonicalServerUrl: "https://other-home.example.test",
                }),
            },
            {
                key: expiredContinuation,
                expiresAt: new Date(Date.now() - 1),
                value: JSON.stringify({
                    v: 2,
                    flow: "auth",
                    provider: "github",
                    proofHash: "proof-hash",
                    profileEnc: "profile",
                    accessTokenEnc: "token",
                }),
            },
        ] });
        const deliveredVerificationUrls: string[] = [];
        const server = app(deliveredVerificationUrls);
        try {
            const random = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "random@example.test",
                    continuationId: "oauth_pending_randomMissingContinuation",
                },
            });
            const wrongPurpose = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "wrong-purpose@example.test",
                    continuationId: wrongPurposeContinuation,
                },
            });
            const expired = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "expired@example.test",
                    continuationId: expiredContinuation,
                },
            });
            const valid = await server.inject({
                method: "POST",
                url: "/v1/auth/email/verify/request",
                payload: {
                    v: 1,
                    email: "continued@example.test",
                    continuationId: validContinuation,
                },
            });
            expect(random.json()).toEqual({ accepted: true });
            expect(wrongPurpose.json()).toEqual({ accepted: true });
            expect(expired.json()).toEqual({ accepted: true });
            expect(valid.json()).toEqual({ accepted: true });
            expect(deliveredVerificationUrls).toHaveLength(1);
            const verificationToken = new URL(deliveredVerificationUrls[0]!).pathname.split("/").at(-1)!;
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: verificationToken,
            }))).toMatchObject({
                normalizedEmail: "continued@example.test",
                consumer: { kind: "fresh_account", continuationId: validContinuation },
            });
            expect(await db.repeatKey.findUnique({ where: { key: validContinuation } })).not.toBeNull();
            expect(await db.repeatKey.findUnique({ where: { key: wrongPurposeContinuation } })).not.toBeNull();
        } finally {
            await server.close();
        }
    });

    it.each(["password_enrollment", "sign_in_email_change"] as const)(
        "rejects a %s mailbox proof for fresh provisioning without consuming it",
        async (consumerKind) => {
            const accountId = crypto.randomUUID();
            const issued = await inTx((tx) => issueNativeAuthOneTimeOperationInTx(tx, {
                v: 1,
                purpose: "verify_native_email",
                normalizedEmail: "existing-account@example.test",
                consumer: consumerKind === "password_enrollment"
                    ? { kind: "password_enrollment", accountId }
                    : { kind: "sign_in_email_change", accountId, nativeIdentityId: "previous-identity", expectedNativeIdentity: "old@example.test" },
            }));
            const server = app();
            try {
                const result = await server.inject({
                    method: "POST",
                    url: "/v1/auth/email/provision",
                    payload: {
                        v: 1,
                        email: "existing-account@example.test",
                        admission: { kind: "native_email_verification", token: issued.rawBearer },
                        account: { mode: "plain", password },
                    },
                });
                expect(result.statusCode).toBe(401);
                expect(result.json()).toEqual({ error: "authentication_failed" });
                expect(await db.account.count()).toBe(0);
                expect(await db.accountIdentity.count()).toBe(0);
                expect(await db.accountEmail.count()).toBe(0);
                expect(await db.accountPasswordCredential.count()).toBe(0);
                expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                    purpose: "verify_native_email",
                    token: issued.rawBearer,
                }))).toMatchObject({ consumer: { kind: consumerKind } });

                const invited = await invitation(null);
                const invitationWrappedResult = await server.inject({
                    method: "POST",
                    url: "/v1/auth/email/provision",
                    payload: {
                        v: 1,
                        email: "existing-account@example.test",
                        admission: {
                            kind: "team_invitation",
                            token: invited.token,
                            emailVerificationToken: issued.rawBearer,
                        },
                        account: { mode: "plain", password },
                    },
                });
                expect(invitationWrappedResult.statusCode).toBe(401);
                expect(await db.account.count()).toBe(1);
                expect(await db.accountIdentity.count()).toBe(0);
                expect(await db.accountEmail.count()).toBe(0);
                expect(await db.accountPasswordCredential.count()).toBe(0);
                expect(await db.teamMembership.count()).toBe(1);
                expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                    purpose: "verify_native_email",
                    token: issued.rawBearer,
                }))).toMatchObject({ consumer: { kind: consumerKind } });
            } finally {
                await server.close();
            }
        },
    );

    it("rolls fresh admission back with failed membership and refuses revoked invitations", async () => {
        const invited = await invitation();
        const server = app();
        const payload = {
            v: 1, email: "invited@example.test", admission: { kind: "team_invitation", token: invited.token },
            account: { mode: "plain", password },
        };
        await db.$executeRawUnsafe(`CREATE TRIGGER fail_native_membership_insert BEFORE INSERT ON TeamMembership BEGIN SELECT RAISE(ABORT, 'membership persistence unavailable'); END`);
        try {
            expect((await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload })).statusCode).toBe(500);
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(1);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } })).toMatchObject({ acceptedAt: null });
        } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_native_membership_insert"); }
        try {
            await db.teamInvitation.update({ where: { id: invited.invitation.id }, data: { revokedAt: new Date() } });
            expect((await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload })).statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
        } finally { await server.close(); }
    });

    it("verifies signing possession and content binding before any E2EE Account write", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0" });
        const server = app();
        try {
            const issued = await proof();
            const signing = tweetnacl.sign.keyPair();
            const content = tweetnacl.box.keyPair();
            // Native E2EE construction uses this shared protocol even when ordinary
            // recovery-key login is disabled. Exercise production composition.
            const challengeResponse = await server.inject({ method: "POST", url: "/v1/auth/challenge", payload: {} });
            expect(challengeResponse.statusCode, challengeResponse.body).toBe(200);
            const challenge = KeyChallengeV2IssueResponseSchema.parse(challengeResponse.json());
            const encode = (bytes: Uint8Array) => privacyKit.encodeBase64(new Uint8Array(bytes));
            const envelope = {
                v: 1, accountSigningPublicKey: encodePasswordCredentialFieldV1(signing.publicKey),
                kdf: { algorithm: "argon2id13", salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(23)),
                    opsLimit: 3, memLimitBytes: 64 * 1024 * 1024, outputBytes: 32 },
                cipher: { algorithm: "aes256gcm", nonce: encodePasswordCredentialFieldV1(new Uint8Array(12).fill(11)),
                    ciphertext: encodePasswordCredentialFieldV1(new Uint8Array(48).fill(17)) },
            };
            const proofInput = {
                challengeId: challenge.challengeId, publicKey: encode(signing.publicKey),
                signature: encode(tweetnacl.sign.detached(createKeyChallengeV2SigningInput(challenge), signing.secretKey)),
                contentPublicKey: encode(content.publicKey),
                contentPublicKeySig: encode(signAccountContentKeyBindingV1({ accountSigningSecretKey: signing.secretKey, contentPublicKey: content.publicKey })),
            };
            const payload = {
                v: 1, email: "signup@example.test", admission: { kind: "native_email_verification", token: issued.rawBearer },
                account: { mode: "e2ee", authKey: encodePasswordCredentialFieldV1(new Uint8Array(32).fill(7)), envelope, proof: proofInput },
            };
            const invalid = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload, account: { ...payload.account, proof: { ...proofInput, signature: encode(new Uint8Array(64)) } },
            } });
            expect(invalid.statusCode).toBe(401);
            expect(await db.account.count()).toBe(0);
            expect(await db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } })).toMatchObject({ consumedAt: null });
            const invalidBinding = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload, account: { ...payload.account, proof: { ...proofInput, contentPublicKeySig: encode(new Uint8Array(64)) } },
            } });
            expect(invalidBinding.statusCode).toBe(401);
            const swappedEnvelope = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload, account: { ...payload.account, envelope: { ...envelope,
                    accountSigningPublicKey: encodePasswordCredentialFieldV1(tweetnacl.sign.keyPair().publicKey) } },
            } });
            expect(swappedEnvelope.statusCode).toBe(401);
            expect(await db.account.count()).toBe(0);
            expect(await db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } })).toMatchObject({ consumedAt: null });

            const preExisting = await db.account.create({ data: {
                encryptionMode: "e2ee",
                publicKey: privacyKit.encodeHex(new Uint8Array(signing.publicKey)),
                contentPublicKey: new Uint8Array(content.publicKey),
                contentPublicKeySig: signAccountContentKeyBindingV1({
                    accountSigningSecretKey: signing.secretKey,
                    contentPublicKey: content.publicKey,
                }),
            } });
            const collision = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload });
            expect(collision.statusCode).toBe(401);
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } })).toMatchObject({ consumedAt: null });
            expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
                purpose: "verify_native_email",
                token: issued.rawBearer,
            }))).not.toBeNull();
            await db.account.delete({ where: { id: preExisting.id } });

            const invited = await invitation();
            const repeatKeysBeforeMismatch = await db.repeatKey.findMany({ orderBy: { key: "asc" } });
            const mismatch = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload: {
                ...payload,
                admission: { kind: "team_invitation", token: invited.token },
            } });
            expect(mismatch.statusCode).toBe(403);
            expect(mismatch.json()).toEqual({ error: "email_mismatch" });
            expect(await db.account.count()).toBe(1);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.accountEmail.count()).toBe(0);
            expect(await db.accountPasswordCredential.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(1);
            expect(await db.teamInvitation.findUnique({ where: { id: invited.invitation.id } }))
                .toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
            expect(await db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } }))
                .toMatchObject({ consumedAt: null });
            expect(await db.repeatKey.findMany({ orderBy: { key: "asc" } })).toEqual(repeatKeysBeforeMismatch);

            const accepted = await server.inject({ method: "POST", url: "/v1/auth/email/provision", payload });
            expect(accepted.statusCode, accepted.statusCode >= 400 ? accepted.body : undefined).toBe(200);
            expect(await db.account.findUnique({ where: { id: accepted.json().accountId } })).toMatchObject({
                encryptionMode: "e2ee", publicKey: privacyKit.encodeHex(new Uint8Array(signing.publicKey)),
                contentPublicKey: new Uint8Array(content.publicKey),
            });
            expect(await db.accountPasswordCredential.findFirst()).toMatchObject({ credential: { kind: "e2ee_password_envelope", envelope } });
            expect(await db.keyChallengeV2.findUnique({ where: { id: challenge.challengeId } })).toMatchObject({ consumedAt: expect.any(Date) });
        } finally { await server.close(); }
    });
});
