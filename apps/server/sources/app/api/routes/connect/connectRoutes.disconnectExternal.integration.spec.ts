import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { connectConnectExternalRoutes } from "./connectRoutes.connectExternal";

describe("external identity disconnect route", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-external-identity-disconnect-",
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 120_000);

    afterAll(async () => await harness.close());

    afterEach(async () => {
        harness.resetEnv();
        await db.teamIdentityConnection.deleteMany();
        await db.identityProviderInstance.deleteMany();
        await db.teamMembership.deleteMany();
        await db.team.deleteMany();
        await db.accountPasswordCredential.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.account.deleteMany();
    });

    it("returns the current lifecycle denial when disconnecting the last login method", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            GITHUB_CLIENT_ID: "id",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
        });
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: "plain" } });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "github",
                providerUserId: "github-subject",
                providerLogin: "octocat",
                profile: {},
            },
        });

        await withAuthenticatedTestApp(connectConnectExternalRoutes, async (app) => {
            const response = await app.inject({
                method: "DELETE",
                url: "/v1/connect/external/github",
                headers: { "x-test-user-id": account.id },
            });
            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({
                error: "identity-management-denied",
                reason: "last_login_method",
            });
        });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(1);
    });

    it("disconnects an existing identity whose deployment runtime was removed", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const account = await db.account.create({ data: { publicKey: "account-key" } });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "removed-provider",
                providerUserId: "removed-subject",
                providerLogin: "alice",
                profile: {},
            },
        });

        await withAuthenticatedTestApp(connectConnectExternalRoutes, async (app) => {
            const response = await app.inject({
                method: "DELETE",
                url: "/v1/connect/external/removed-provider",
                headers: { "x-test-user-id": account.id },
            });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });
        });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(0);
    });

    it("does not route a native email identity through the external-provider fallback", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true" });
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: "plain" } });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "email",
                providerUserId: "alice@example.test",
                providerLogin: "alice@example.test",
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: account.id,
                credential: { v: 1, kind: "plain_password_hash", hash: "test-only-hash" },
            },
        });

        await withAuthenticatedTestApp(connectConnectExternalRoutes, async (app) => {
            const response = await app.inject({
                method: "DELETE",
                url: "/v1/connect/external/email",
                headers: { "x-test-user-id": account.id },
            });
            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ error: "unsupported-provider" });
        });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(1);
    });

    it("allows unlink when the Team's sole connection is already authoritatively disabled", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const account = await db.account.create({ data: { publicKey: "account-key" } });
        const team = await db.team.create({ data: { id: "team-required", name: "Required Team" } });
        await db.teamMembership.create({
            data: { id: "membership-required", teamId: team.id, accountId: account.id, role: "member" },
        });
        const provider = await db.identityProviderInstance.create({
            data: {
                id: "disabled-provider",
                ownerTeamId: team.id,
                kind: "oidc",
                displayName: "Disabled Provider",
                enabled: false,
                config: {
                    v: 1,
                    kind: "oidc",
                    issuer: "https://id.example.test",
                    clientId: "happier",
                    clientAuthenticationMethod: "client_secret_post",
                    scopes: "openid profile email",
                    httpTimeoutSeconds: 30,
                    claims: { login: "preferred_username", email: "email", groups: "groups" },
                    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                    fetchUserInfo: true,
                    storeRefreshToken: false,
                    ui: { buttonColor: null, iconHint: null },
                },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                id: "connection-required",
                teamId: team.id,
                providerInstanceId: provider.id,
                enabled: true,
                externalReference: { v: 1, kind: "oidc" },
                settings: {
                    v: 1,
                    kind: "oidc",
                    allowedUsers: [],
                    allowedEmailDomains: [],
                    groupsAny: [],
                    groupsAll: [],
                },
            },
        });
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "team_connection", connectionId: connection.id }],
                },
            },
        });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: provider.id,
                providerUserId: "disabled-subject",
                providerLogin: "alice",
                profile: {},
            },
        });

        await withAuthenticatedTestApp(connectConnectExternalRoutes, async (app) => {
            const response = await app.inject({
                method: "DELETE",
                url: `/v1/connect/external/${provider.id}`,
                headers: { "x-test-user-id": account.id },
            });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });
        });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(0);
    });

    it("fails unlink closed when an active Team policy is unreadable", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const account = await db.account.create({ data: { publicKey: "account-key" } });
        const team = await db.team.create({
            data: {
                id: "team-unreadable-policy",
                name: "Unreadable Team",
                authenticationPolicy: { v: 1, mode: "restricted", accepted: [] },
            },
        });
        await db.teamMembership.create({
            data: { id: "membership-unreadable", teamId: team.id, accountId: account.id, role: "member" },
        });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "removed-provider",
                providerUserId: "removed-subject",
                providerLogin: "alice",
                profile: {},
            },
        });

        await withAuthenticatedTestApp(connectConnectExternalRoutes, async (app) => {
            const response = await app.inject({
                method: "DELETE",
                url: "/v1/connect/external/removed-provider",
                headers: { "x-test-user-id": account.id },
            });
            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({
                error: "identity-management-denied",
                reason: "management_unavailable",
            });
        });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(1);
    });
});
