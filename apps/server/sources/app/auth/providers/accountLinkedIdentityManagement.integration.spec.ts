import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { buildLinkedIdentityManagementProjectionInTx } from "./accountLinkedIdentityManagement";
import { setIdentityVisibilityInTx, unlinkIdentity } from "./accountIdentityLifecycle";

let harness: LightSqliteHarness;

const providerConfig = {
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
    ui: { buttonColor: null, iconHint: "okta" },
} as const;

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: "happier-linked-identity-management-",
        initAuth: false,
        initEncrypt: true,
        initFiles: false,
    });
});
afterAll(async () => await harness.close());
beforeEach(async () => {
    harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
    await db.teamIdentityConnection.deleteMany();
    await db.identityProviderInstance.deleteMany();
    await db.teamMembership.deleteMany();
    await db.team.deleteMany();
    await db.accountPasswordCredential.deleteMany();
    await db.accountIdentity.deleteMany();
    await db.account.deleteMany();
});

describe("Account linked-identity management", () => {
    it("keeps the native email login locator out of generic linked-identity management", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "0",
        });
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

        await expect(inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: account.id,
            env: process.env,
        }))).resolves.toEqual([]);
    });

    it("blocks only the identity that is the Account's last effective login method", async () => {
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
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
        });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "github",
                providerUserId: "github-subject",
                providerLogin: "octocat",
                profile: {},
            },
        });
        const projection = await inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: account.id,
            env: process.env,
        }));
        expect(projection[0]).toMatchObject({
            providerId: "github",
            canDisconnect: false,
            disconnectReason: "last_login_method",
            canPublishProfile: true,
        });
        await expect(unlinkIdentity({ accountId: account.id, provider: "github" }))
            .rejects.toMatchObject({ reason: "last_login_method" });
    });

    it("projects only the viewer's exact managed source and requiring Teams", async () => {
        harness.resetEnv({
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
        });
        // Inheritance is not allow-all: without a Home governance row the
        // `oidc` Team-provider kind resolves `unavailable` and the catalog
        // never offers the connection this projection is about.
        await db.homeGovernancePolicy.upsert({
            where: { id: "home" },
            update: {},
            create: {
                id: "home",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["oidc"],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        const member = await db.account.create({ data: { publicKey: "member-key" } });
        const outsider = await db.account.create({ data: { publicKey: "outsider-key" } });
        const team = await db.team.create({ data: { id: "team-acme", name: "Acme" } });
        const hiddenTeam = await db.team.create({ data: { id: "team-hidden", name: "Hidden Team" } });
        await db.teamMembership.create({
            data: { id: "membership-acme", teamId: team.id, accountId: member.id, role: "member" },
        });
        const provider = await db.identityProviderInstance.create({
            data: {
                id: "managed-okta",
                ownerTeamId: team.id,
                kind: "oidc",
                displayName: "Okta",
                enabled: true,
                config: providerConfig,
            },
        });
        const required = await db.teamIdentityConnection.create({
            data: {
                id: "connection-acme",
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
                    accepted: [{ kind: "team_connection", connectionId: required.id }],
                },
            },
        });
        await db.teamIdentityConnection.create({
            data: {
                id: "connection-hidden",
                teamId: hiddenTeam.id,
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
            where: { id: hiddenTeam.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "team_connection", connectionId: "connection-hidden" }],
                },
            },
        });
        for (const account of [member, outsider]) {
            await db.accountIdentity.create({
                data: {
                    accountId: account.id,
                    provider: provider.id,
                    providerUserId: `subject-${account.id}`,
                    providerLogin: "alice@acme.example",
                    profile: {},
                },
            });
        }

        await expect(inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: member.id,
            env: process.env,
        }))).resolves.toEqual([{
            v: 1,
            providerId: provider.id,
            descriptor: { displayName: "Okta", iconHint: "okta", source: "managed" },
            managedBy: { kind: "team", team: { id: team.id, name: "Acme" } },
            requiredByTeams: [{ id: team.id, name: "Acme" }],
            canDisconnect: false,
            disconnectReason: "required_by_team",
            canPublishProfile: true,
            publishProfileReason: null,
        }]);

        const outsiderProjection = await inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: outsider.id,
            env: process.env,
        }));
        expect(JSON.stringify(outsiderProjection)).not.toContain("Acme");
        expect(JSON.stringify(outsiderProjection)).not.toContain("Hidden Team");
        expect(outsiderProjection[0]).toMatchObject({
            managedBy: null,
            requiredByTeams: [],
            canDisconnect: true,
            canPublishProfile: true,
        });

        await expect(unlinkIdentity({ accountId: member.id, provider: provider.id }))
            .rejects.toMatchObject({ reason: "required_by_team" });
        await expect(inTx((tx) => setIdentityVisibilityInTx(tx, {
            accountId: member.id,
            provider: provider.id,
            showOnProfile: false,
        }))).resolves.toBe(true);
        await expect(db.accountIdentity.findFirst({ where: { accountId: member.id, provider: provider.id } }))
            .resolves.toMatchObject({ showOnProfile: false });

        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [
                        { kind: "team_connection", connectionId: required.id },
                        { kind: "home_method", methodId: "key_challenge" },
                    ],
                },
            },
        });
        await expect(inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: member.id,
            env: process.env,
        }))).resolves.toEqual([expect.objectContaining({
            providerId: provider.id,
            requiredByTeams: [],
            canDisconnect: true,
        })]);

        const alternateProvider = await db.identityProviderInstance.create({
            data: {
                id: "managed-alternate",
                ownerTeamId: team.id,
                kind: "oidc",
                displayName: "Alternate",
                enabled: true,
                config: providerConfig,
            },
        });
        const alternateConnection = await db.teamIdentityConnection.create({
            data: {
                id: "connection-alternate",
                teamId: team.id,
                providerInstanceId: alternateProvider.id,
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
        await db.accountIdentity.create({
            data: {
                accountId: member.id,
                provider: alternateProvider.id,
                providerUserId: "alternate-subject",
                providerLogin: "alice-alternate@acme.example",
                profile: {},
            },
        });
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [
                        { kind: "team_connection", connectionId: required.id },
                        { kind: "team_connection", connectionId: alternateConnection.id },
                    ],
                },
            },
        });
        const alternatives = await inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: member.id,
            env: process.env,
        }));
        expect(alternatives.find(({ providerId }) => providerId === provider.id)).toMatchObject({
            requiredByTeams: [],
            canDisconnect: true,
        });

        harness.resetEnv({
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
        });
        const homeProvider = await db.identityProviderInstance.create({
            data: {
                id: "managed-home",
                ownerTeamId: null,
                kind: "oidc",
                displayName: "Home Identity",
                enabled: true,
                config: providerConfig,
            },
        });
        await db.accountIdentity.create({
            data: {
                accountId: member.id,
                provider: homeProvider.id,
                providerUserId: "home-subject",
                providerLogin: "alice-home@example.test",
                profile: {},
            },
        });
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: homeProvider.id }],
                },
            },
        });
        const exactManagedMethod = await inTx((tx) => buildLinkedIdentityManagementProjectionInTx(tx, {
            accountId: member.id,
            env: process.env,
        }));
        expect(exactManagedMethod.find(({ providerId }) => providerId === homeProvider.id)).toMatchObject({
            requiredByTeams: [{ id: team.id, name: "Acme" }],
            canDisconnect: false,
            disconnectReason: "required_by_team",
        });

        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [
                        { kind: "team_connection", connectionId: required.id },
                        { kind: "team_connection", connectionId: alternateConnection.id },
                    ],
                },
            },
        });
        await expect(unlinkIdentity({ accountId: member.id, provider: provider.id })).resolves.toBeUndefined();
        await expect(db.accountIdentity.findUnique({
            where: { accountId_provider: { accountId: member.id, provider: provider.id } },
        })).resolves.toBeNull();
    });
});
