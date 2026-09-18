import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import * as privacyKit from "privacy-kit";

import { db } from "@/storage/db";
import { registerExternalAuthFinalizeKeylessRoute } from "./oauthExternal/registerExternalAuthFinalizeKeylessRoute";
import { auth } from "@/app/auth/auth";
import { enableAuthentication } from "../../utils/enableAuthentication";
import { decryptString, encryptString } from "@/modules/encrypt";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import { authPendingSchema } from "./oauthExternal/oauthExternalSchemas";
import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { registerTeamMemberRoutes } from "@/app/teams/memberships/registerTeamMemberRoutes";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";


function createTestApp() {
    const app = Fastify({ logger: false, trustProxy: true });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    return trackApp(typed);
}

describe("connectRoutes (external auth finalize keyless) (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-external-finalize-keyless-",
            initAuth: true,
            initEncrypt: true,
            initFiles: true,
        });
    }, 120_000);
    afterEach(async () => {
        await closeTrackedApps();
        harness.resetEnv();
        await db.userFeedItem.deleteMany();
        await db.userRelationship.deleteMany();
        await db.repeatKey.deleteMany();
        await db.uploadedFile.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.teamMembership.deleteMany();
        await db.teamIdentityConnection.deleteMany();
        await db.identityProviderInstance.deleteMany();
        await db.team.deleteMany();
        await db.account.deleteMany();
        await db.homeGovernancePolicy.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it.each(["admitted", "policy_revoked", "membership_storage_failure"] as const)(
        "finalizes bounded Team keyless admission independently of public signup (%s)", async (outcome) => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "0",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: "0",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
            HAPPIER_FEATURE_TEAMS__ENABLED: "1",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });
        await db.homeGovernancePolicy.create({ data: {
            id: "home",
            teamProviderPolicy: {
                v: 1, allowedTeamProviderKinds: ["oidc"], teamJitAllowed: true,
                approvedGitHubEnterpriseOrigins: [],
            },
        } });
        const team = await db.team.create({ data: {
            name: "Bounded Team",
            admissionMode: "jit",
            authenticationPolicy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "home_method", methodId: "key_challenge" }],
            },
        } });
        const provider = await db.identityProviderInstance.create({ data: {
            ownerTeamId: team.id, kind: "oidc", displayName: "Team SSO", enabled: true,
            firstEnabledAt: new Date(),
            config: {
                v: 1, kind: "oidc", issuer: "https://id.example.test", clientId: "client", clientAuthenticationMethod: "client_secret_post", scopes: "openid",
                httpTimeoutSeconds: 30, claims: { login: "preferred_username", email: "email", groups: "groups" },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null },
            },
        } });
        await db.identityProviderInstance.update({ where: { id: provider.id }, data: {
            encryptedSecrets: encryptString(
                ["storage", "identity_provider_instance", provider.id, "oidc", "secrets", "v1"],
                JSON.stringify({ v: 1, kind: "oidc", clientSecret: "secret" }),
            ),
        } });
        const connection = await db.teamIdentityConnection.create({ data: {
            teamId: team.id, providerInstanceId: provider.id, enabled: true, firstEnabledAt: new Date(),
            externalReference: { v: 1, kind: "oidc" },
            settings: { v: 1, kind: "oidc", allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
        } });
        const runtime = await resolveOAuthRuntimeById(process.env, provider.id, { kind: "team", teamId: team.id });
        expect(runtime).not.toBeNull();
        const pendingKey = "oauth_pending_boundedTeamKeyless";
        const proof = "bounded-team-proof";
        await db.repeatKey.create({ data: {
            key: pendingKey, expiresAt: new Date(Date.now() + 60_000),
            value: JSON.stringify({
                v: 2, flow: "auth", provider: provider.id,
                proofHash: createHash("sha256").update(proof).digest("hex"),
                securityBinding: {
                    provider: runtime!.reference, purpose: "team_admission",
                    connection: { id: connection.id, revision: connection.revision },
                    admission: {
                        kind: "team_jit_identity", teamId: team.id, providerId: provider.id,
                        connectionId: connection.id, connectionRevision: connection.revision,
                        admissionMode: "jit", authAttemptId: "bounded-team-attempt",
                    },
                },
                profileEnc: privacyKit.encodeBase64(encryptString(
                    ["auth", "external", provider.id, "pending_v2", pendingKey, "profile"],
                    JSON.stringify({ sub: "exact-subject", preferred_username: "team-member" }),
                )),
                accessTokenEnc: privacyKit.encodeBase64(encryptString(
                    ["auth", "external", provider.id, "pending_v2", pendingKey, "token"], "token",
                )),
            }),
        } });
        if (outcome === "policy_revoked") {
            await db.team.update({ where: { id: team.id }, data: { admissionMode: "invite_only" } });
        }
        if (outcome === "membership_storage_failure") {
            await db.$executeRawUnsafe(`CREATE TRIGGER fail_bounded_team_membership
                BEFORE INSERT ON TeamMembership
                BEGIN SELECT RAISE(ABORT, 'membership storage unavailable'); END`);
        }
        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        registerTeamMemberRoutes(app);
        await app.ready();
        const response = await app.inject({
            method: "POST", url: `/v1/auth/external/${provider.id}/finalize-keyless`,
            payload: { pending: pendingKey, proof },
        });
        if (outcome === "membership_storage_failure") {
            await db.$executeRawUnsafe("DROP TRIGGER fail_bounded_team_membership");
        }
        if (outcome !== "admitted") {
            expect(response.statusCode, response.body).toBe(outcome === "policy_revoked" ? 403 : 500);
            expect(await db.account.count()).toBe(0);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.teamMembership.count()).toBe(0);
            expect(await db.repeatKey.findUnique({ where: { key: pendingKey } })).not.toBeNull();
            return;
        }
        expect(response.statusCode, response.body).toBe(200);
        const verified = await auth.verifyToken(response.json().token);
        expect(verified).toMatchObject({ authTokenKind: "account", authority: "present_user" });
        expect(verified?.authenticationEvidence).toEqual([expect.objectContaining({
            kind: "provider", providerId: provider.id, teamConnectionId: connection.id,
        })]);
        expect(await db.account.findMany({ select: { encryptionMode: true, publicKey: true } }))
            .toEqual([{ encryptionMode: "plain", publicKey: null }]);
        expect(await db.accountIdentity.count()).toBe(1);
        expect(await db.teamMembership.findMany({ select: { teamId: true, status: true } }))
            .toEqual([{ teamId: team.id, status: "active" }]);
        expect(await db.repeatKey.findUnique({ where: { key: pendingKey } })).toBeNull();
        const protectedOperation = await app.inject({
            method: "POST",
            url: "/v1/teams/members/list",
            headers: { authorization: `Bearer ${response.json().token}` },
            payload: { v: 1, teamId: team.id, filter: "all" },
        });
        expect(protectedOperation.statusCode, protectedOperation.body).toBe(403);
        expect(protectedOperation.json()).toEqual({ error: "team_authentication_required" });
    });

    it.each([false, true])("finalize-keyless atomically consumes admission and creates the identity (storage failure: %s)", async (failIdentity) => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "test_client",
            GITHUB_CLIENT_SECRET: "test_secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: "1",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
        });

        const pendingKey = "oauth_pending_keylessA1";
        const proof = "proof_secret_1";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");

        const githubProfile = {
            id: 123,
            login: "octocat",
            avatar_url: "",
            name: "The Octocat",
        };

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash,
                    profileEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "profile"], JSON.stringify(githubProfile)),
                    ),
                    accessTokenEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "token"], "tok_1"),
                    ),
                    suggestedUsername: "octocat",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        if (failIdentity) {
            // Real database failure: the Account and pending bearer must both
            // remain governed by the enclosing admission transaction.
            await db.$executeRawUnsafe(`CREATE TRIGGER fail_oauth_identity_insert
                BEFORE INSERT ON AccountIdentity WHEN NEW.provider = 'github'
                BEGIN SELECT RAISE(ABORT, 'identity storage unavailable'); END`);
        }
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json" },
            payload: { pending: pendingKey, proof },
        });
        if (failIdentity) {
            await db.$executeRawUnsafe("DROP TRIGGER fail_oauth_identity_insert");
            expect(res.statusCode, res.body).toBe(500);
            expect(await db.account.count()).toBe(0);
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.repeatKey.findUnique({ where: { key: pendingKey } })).not.toBeNull();
            return;
        }

        expect(res.statusCode, res.body).toBe(200);
        const json = res.json();
        expect(json).toMatchObject({ success: true });
        expect(typeof json.token).toBe("string");

        const verified = await auth.verifyToken(json.token);
        expect(verified).toMatchObject({ authTokenKind: "account", authority: "present_user", legacy: false });
        expect(verified?.authenticationEvidence).toBeUndefined();

        const accounts = await db.account.findMany({ select: { id: true, publicKey: true, encryptionMode: true } });
        expect(accounts.length).toBe(1);
        expect(accounts[0].publicKey).toBeNull();
        expect(accounts[0].encryptionMode).toBe("plain");

        const identities = await db.accountIdentity.findMany({
            where: { provider: "github", providerUserId: "123" },
            select: { accountId: true },
        });
        expect(identities.length).toBe(1);
        expect(identities[0].accountId).toBe(accounts[0].id);

        const pending = await db.repeatKey.findUnique({ where: { key: pendingKey } });
        expect(pending).toBeNull();

        await app.close();
    });

    it("authenticates the exact plain Account that wins an external-identity provisioning race", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "test_client",
            GITHUB_CLIENT_SECRET: "test_secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: "1",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
        });

        const winner = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain", username: "race-winner" },
            select: { id: true, updatedAt: true },
        });
        const pendingKey = "oauth_pending_keylessIdentityRaceA1";
        const proof = "proof_secret_identity_race";
        const githubProfile = {
            id: 124,
            login: "identity-race",
            avatar_url: "",
            name: "Identity Race",
        };
        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash: createHash("sha256").update(proof, "utf8").digest("hex"),
                    profileEnc: privacyKit.encodeBase64(encryptString(
                        ["auth", "external", "github", "pending_keyless", pendingKey, "profile"],
                        JSON.stringify(githubProfile),
                    )),
                    accessTokenEnc: privacyKit.encodeBase64(encryptString(
                        ["auth", "external", "github", "pending_keyless", pendingKey, "token"],
                        "tok_identity_race",
                    )),
                    suggestedUsername: "identity-race",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        // Schedule the winner after the route's initial lookup but before its
        // identity preparation repeats the canonical collision check.
        const identityDelegate = db.accountIdentity as any;
        const originalFindFirst = identityDelegate.findFirst;
        let injectedRaceWinner = false;
        identityDelegate.findFirst = async (args: any) => {
            const result = await originalFindFirst.call(identityDelegate, args);
            if (
                !injectedRaceWinner
                && result === null
                && args?.where?.provider === "github"
                && args?.where?.providerUserId === String(githubProfile.id)
            ) {
                injectedRaceWinner = true;
                await db.accountIdentity.create({
                    data: {
                        accountId: winner.id,
                        provider: "github",
                        providerUserId: String(githubProfile.id),
                        providerLogin: githubProfile.login,
                        profile: githubProfile,
                        showOnProfile: false,
                    },
                });
            }
            return result;
        };

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();
        let response;
        try {
            response = await app.inject({
                method: "POST",
                url: "/v1/auth/external/github/finalize-keyless",
                headers: { "content-type": "application/json" },
                payload: { pending: pendingKey, proof },
            });
        } finally {
            identityDelegate.findFirst = originalFindFirst;
        }

        expect(injectedRaceWinner).toBe(true);
        expect(response!.statusCode, response!.body).toBe(200);
        const verifiedToken = await auth.verifyToken(response!.json().token);
        expect(verifiedToken).toMatchObject({ userId: winner.id, authTokenKind: "account" });
        await expect(db.repeatKey.findUnique({ where: { key: pendingKey } })).resolves.toBeNull();
        await expect(db.account.findUniqueOrThrow({
            where: { id: winner.id },
            select: { username: true, updatedAt: true },
        })).resolves.toEqual({ username: "race-winner", updatedAt: winner.updatedAt });

        await app.close();
    });

    it("POST /v1/auth/external/:provider/finalize-keyless returns 403 not-eligible when keyless provisioning is denied for public requests", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: "1",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: "github",
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_MODES: "keyless",
        });

        const pendingKey = "oauth_pending_keylessPublicBlockedA1";
        const proof = "proof_secret_public_block";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");
        const githubProfile = {
            id: 345,
            login: "octocat",
            avatar_url: "",
            name: "The Octocat",
        };

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash,
                    profileEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "profile"], JSON.stringify(githubProfile)),
                    ),
                    accessTokenEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "token"], "tok_public"),
                    ),
                    suggestedUsername: "octocat",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
            payload: { pending: pendingKey, proof },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: "not-eligible" });
        expect((await db.account.findMany({ select: { id: true } })).length).toBe(0);

        await app.close();
    });

    it("POST /v1/auth/external/:provider/finalize-keyless returns 409 restore-required for an e2ee account missing its signing key", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
        });

        const keyedAccount = await db.account.create({
            data: { publicKey: null, encryptionMode: "e2ee" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: keyedAccount.id,
                provider: "github",
                providerUserId: "123",
                providerLogin: "octocat",
                profile: { id: 123, login: "octocat" },
                showOnProfile: false,
            },
        });

        const pendingKey = "oauth_pending_keylessB1";
        const proof = "proof_secret_2";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");

        const githubProfile = {
            id: 123,
            login: "octocat",
            avatar_url: "",
            name: "The Octocat",
        };

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash,
                    profileEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "profile"], JSON.stringify(githubProfile)),
                    ),
                    accessTokenEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "token"], "tok_2"),
                    ),
                    suggestedUsername: "octocat",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json" },
            payload: { pending: pendingKey, proof },
        });

        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: "restore-required" });

        const pending = await db.repeatKey.findUnique({ where: { key: pendingKey } });
        expect(pending).toBeNull();

        await app.close();
    });

    it("POST /v1/auth/external/:provider/finalize-keyless mints only a restricted Directory token for a server-persisted account_directory purpose", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            AUTH_SIGNUP_PROVIDERS: "github",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_CANONICAL_SERVER_URL: "https://accounts.example.test",
            HAPPIER_PUBLIC_SERVER_URL: "https://accounts.example.test",
            HAPPIER_SERVER_IDENTITY_ID: "srv_accounts_1",
        });

        const e2eeAccount = await db.account.create({
            data: { publicKey: null, encryptionMode: "e2ee" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: e2eeAccount.id,
                provider: "github",
                providerUserId: "987",
                providerLogin: "directory-user",
                profile: { id: "directory-user-123", login: "directory-user" },
                showOnProfile: false,
            },
        });

        const pendingKey = "oauth_pending_AccountDirectoryA1";
        const proof = "directory_proof_secret_1";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");
        const githubProfile = {
            id: 987,
            login: "directory-user",
            avatar_url: "",
            name: "Directory User",
        };
        const runtime = await resolveOAuthRuntimeById(process.env, "github");
        expect(runtime).not.toBeNull();
        const pendingPrefix = [
            "auth",
            "external",
            "github",
            "pending_v2",
            pendingKey,
        ];

        const pendingValue = {
            v: 2 as const,
            flow: "auth" as const,
            authMode: "keyless" as const,
            purpose: "account_directory" as const,
            provider: "github",
            endpointUrl: "https://accounts.example.test",
            endpointServerIdentityId: "srv_accounts_1",
            canonicalServerUrl: "https://accounts.example.test",
            proofHash,
            securityBinding: {
                provider: runtime!.reference,
                connection: null,
                admission: null,
                purpose: "account_directory" as const,
            },
            profileEnc: privacyKit.encodeBase64(
                encryptString([...pendingPrefix, "profile"], JSON.stringify(githubProfile)),
            ),
            accessTokenEnc: privacyKit.encodeBase64(
                encryptString([...pendingPrefix, "token"], "directory_access_token"),
            ),
            suggestedUsername: "directory-user",
            usernameRequired: false,
            usernameReason: null,
        };
        const parsedPending = authPendingSchema.parse(pendingValue);
        expect(decryptString(
            [...pendingPrefix, "profile"],
            privacyKit.decodeBase64(parsedPending.profileEnc),
        )).toBe(JSON.stringify(githubProfile));
        expect(
            runtime?.provider.getProviderUserId(githubProfile),
        ).toBe("987");

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify(pendingValue),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json" },
            payload: { pending: pendingKey, proof },
        });

        const responseBody = res.json() as {
            token?: string;
            error?: string;
        };
        expect({ statusCode: res.statusCode, responseBody }).toEqual({
            statusCode: 200,
            responseBody: expect.objectContaining({ token: expect.any(String) }),
        });
        const token = responseBody.token!;
        const verified = await auth.verifyToken(token);
        expect(verified).toMatchObject({
            userId: e2eeAccount.id,
            authTokenKind: "account_directory",
            authority: "present_user",
        });
        expect(await db.repeatKey.findUnique({ where: { key: pendingKey } })).toBeNull();

        await app.close();
    });

    it("POST /v1/auth/external/:provider/finalize-keyless succeeds when the external identity is linked to a keyed-but-plain account", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
        });

        const keyedPlainAccount = await db.account.create({
            data: { publicKey: "pk_hex_2", encryptionMode: "plain" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: keyedPlainAccount.id,
                provider: "github",
                providerUserId: "123",
                providerLogin: "octocat",
                profile: { id: 123, login: "octocat" },
                showOnProfile: false,
            },
        });

        const pendingKey = "oauth_pending_keylessB2";
        const proof = "proof_secret_2b";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");

        const githubProfile = {
            id: 123,
            login: "octocat",
            avatar_url: "",
            name: "The Octocat",
        };

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash,
                    profileEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "profile"], JSON.stringify(githubProfile)),
                    ),
                    accessTokenEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "token"], "tok_2b"),
                    ),
                    suggestedUsername: "octocat",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        const responses = await Promise.all([0, 1].map(() => app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json" },
            payload: { pending: pendingKey, proof },
        })));
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
        const res = responses.find((response) => response.statusCode === 200)!;

        expect(res.statusCode).toBe(200);
        const json = res.json();
        expect(json).toMatchObject({ success: true });
        expect(typeof json.token).toBe("string");

        const pending = await db.repeatKey.findUnique({ where: { key: pendingKey } });
        expect(pending).toBeNull();

        await app.close();
    });

    it("resolves trailing-space OIDC subjects to only their exact linked Account", async () => {
        const providerId = "exact-oidc";
        harness.resetEnv({
            AUTH_SIGNUP_PROVIDERS: providerId,
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                id: providerId,
                type: "oidc",
                displayName: "Exact OIDC",
                issuer: "https://id.example.test",
                clientId: "client",
                clientSecret: "secret",
                redirectUrl: `https://home.example.test/v1/oauth/${providerId}/callback`,
            }]),
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: providerId,
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
        });
        expect(await resolveOAuthRuntimeById(process.env, providerId, { kind: "home" })).not.toBeNull();
        const [withoutSpace, withSpace] = await Promise.all([
            db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } }),
            db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } }),
        ]);
        await db.accountIdentity.createMany({ data: [
            { accountId: withoutSpace.id, provider: providerId, providerUserId: "subject", profile: {} },
            { accountId: withSpace.id, provider: providerId, providerUserId: "subject ", profile: {} },
        ] });

        const pendingKey = "oauth_pending_exactOidcTrailingSpace1";
        const proof = "proof_exact_oidc_trailing_space";
        await db.repeatKey.create({ data: {
            key: pendingKey,
            expiresAt: new Date(Date.now() + 60_000),
            value: JSON.stringify({
                flow: "auth",
                provider: providerId,
                authMode: "keyless",
                proofHash: createHash("sha256").update(proof, "utf8").digest("hex"),
                profileEnc: privacyKit.encodeBase64(encryptString(
                    ["auth", "external", providerId, "pending_keyless", pendingKey, "profile"],
                    JSON.stringify({ sub: "subject " }),
                )),
                accessTokenEnc: privacyKit.encodeBase64(encryptString(
                    ["auth", "external", providerId, "pending_keyless", pendingKey, "token"],
                    "token",
                )),
            }),
        } });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();
        const response = await app.inject({
            method: "POST",
            url: `/v1/auth/external/${providerId}/finalize-keyless`,
            payload: { pending: pendingKey, proof },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(await auth.verifyToken(response.json().token)).toMatchObject({ userId: withSpace.id });
        expect(await db.account.count()).toBe(2);
        expect(await db.accountIdentity.findMany({
            where: { provider: providerId },
            orderBy: { providerUserId: "asc" },
            select: { accountId: true, providerUserId: true },
        })).toEqual([
            { accountId: withoutSpace.id, providerUserId: "subject" },
            { accountId: withSpace.id, providerUserId: "subject " },
        ]);
        await app.close();
    });

    it("POST /v1/auth/external/:provider/finalize-keyless returns 403 e2ee-required when server storagePolicy=required_e2ee", async () => {
        harness.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "required_e2ee",
        });

        const keylessAccount = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: keylessAccount.id,
                provider: "github",
                providerUserId: "123",
                providerLogin: "octocat",
                profile: { id: 123, login: "octocat" },
                showOnProfile: false,
            },
        });

        const pendingKey = "oauth_pending_keylessC1";
        const proof = "proof_secret_3";
        const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");

        const githubProfile = {
            id: 123,
            login: "octocat",
            avatar_url: "",
            name: "The Octocat",
        };

        await db.repeatKey.create({
            data: {
                key: pendingKey,
                value: JSON.stringify({
                    flow: "auth",
                    provider: "github",
                    authMode: "keyless",
                    proofHash,
                    profileEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "profile"], JSON.stringify(githubProfile)),
                    ),
                    accessTokenEnc: privacyKit.encodeBase64(
                        encryptString(["auth", "external", "github", "pending_keyless", pendingKey, "token"], "tok_3"),
                    ),
                    suggestedUsername: "octocat",
                    usernameRequired: false,
                    usernameReason: null,
                }),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        const app = createTestApp();
        registerExternalAuthFinalizeKeylessRoute(app);
        await app.ready();

        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/external/github/finalize-keyless",
            headers: { "content-type": "application/json" },
            payload: { pending: pendingKey, proof },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: "e2ee-required" });

        const pending = await db.repeatKey.findUnique({ where: { key: pendingKey } });
        expect(pending).toBeNull();

        await app.close();
    });
});
