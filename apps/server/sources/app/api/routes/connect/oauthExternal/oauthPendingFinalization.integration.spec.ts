import Fastify from "fastify";
import type { Fastify as ServerApp } from "../../../types";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import * as privacyKit from "privacy-kit";
import { createHash } from "node:crypto";
import { db } from "@/storage/db";
import { encryptString } from "@/modules/encrypt";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { registerExternalConnectFinalizeRoute } from "./registerExternalConnectFinalizeRoute";
import { registerExternalAuthFinalizeRoute } from "./registerExternalAuthFinalizeRoute";
import { registerExternalAuthFinalizeKeylessRoute } from "./registerExternalAuthFinalizeKeylessRoute";
import { auth } from "@/app/auth/auth";
import type { AuthTokenAuthenticationEvidenceV1 } from "@happier-dev/protocol";
import { HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1 } from "@happier-dev/protocol/changes";

describe("OAuth pending finalization mutation boundary", () => {
    let harness: LightSqliteHarness | undefined;
    const apps: ServerApp[] = [];
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-oauth-finalization-",
            initAuth: true,
            initEncrypt: true,
        });
    }, 120_000);
    afterEach(async () => {
        await Promise.all(apps.splice(0).map((app) => app.close()));
        vi.unstubAllGlobals();
        if (!harness) return;
        harness.resetEnv();
        await db.homeGovernancePolicy.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.teamMembership.deleteMany();
        await db.teamIdentityConnection.deleteMany();
        await db.identityProviderInstance.deleteMany();
        await db.team.deleteMany();
        await db.repeatKey.deleteMany();
        await db.account.deleteMany();
    });
    afterAll(async () => { await harness?.close(); });

    async function fixture(
        mode: "connect" | "keyed" | "keyless" = "connect",
        options: Readonly<{
            providerId?: "github" | "oidc-test";
            profile?: Readonly<Record<string, unknown>>;
            initiatingEvidence?: readonly AuthTokenAuthenticationEvidenceV1[];
            providerReset?: boolean;
        }> = {},
    ) {
        const providerId = options.providerId ?? "github";
        const profile = options.profile ?? { id: 987, login: "octocat" };
        harness!.resetEnv({
            GITHUB_CLIENT_ID: "client",
            GITHUB_CLIENT_SECRET: "secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            AUTH_SIGNUP_PROVIDERS: providerId,
            ...(options.providerReset ? {
                HAPPIER_FEATURE_AUTH_RECOVERY__PROVIDER_RESET_ENABLED: "1",
            } : {}),
            ...(providerId === "oidc-test" ? {
                AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                    id: providerId,
                    type: "oidc",
                    displayName: "OIDC Test",
                    issuer: "https://issuer.example.test",
                    clientId: "cid",
                    clientAuthenticationMethod: "client_secret_post",
                    clientSecret: "secret",
                    redirectUrl: `https://home.example.test/v1/oauth/${providerId}/callback`,
                }]),
            } : {}),
            ...(mode === "keyless" ? {
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: providerId,
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            } : {}),
        });
        const runtime = (await resolveOAuthRuntimeById(process.env, providerId))!;
        const keyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(19));
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(keyPair.publicKey));
        const challenge = new Uint8Array(32).fill(7);
        const proof = "test-proof";
        const hasCurrentKeyChallengeEvidence = options.initiatingEvidence?.some(
            (evidence) => evidence.kind === "home_method" && evidence.methodId === "key_challenge",
        ) === true;
        const account = await db.account.create({ data: {
            publicKey: mode === "keyed"
                ? (options.providerReset ? "replaced-public-key" : publicKeyHex)
                : hasCurrentKeyChallengeEvidence
                    ? publicKeyHex
                    : null,
            encryptionMode: hasCurrentKeyChallengeEvidence ? "e2ee" : "plain",
        } });
        if (options.providerReset) {
            await db.accountIdentity.create({ data: {
                accountId: account.id,
                provider: providerId,
                providerUserId: providerId === "github" ? "987" : "subject-987",
                providerLogin: "octocat",
            } });
        }
        if (mode === "keyless") {
            await db.accountIdentity.create({
                data: {
                    accountId: account.id,
                    provider: providerId,
                    providerUserId: providerId === "github" ? "987" : "subject-987",
                    providerLogin: "octocat",
                },
            });
        }
        const pending = "oauth_pending_connectMutation1";
        const prefix = mode === "connect"
            ? ["user", account.id, "connect", providerId, "pending", pending]
            : ["auth", "external", providerId, "pending_v2", pending];
        await db.repeatKey.create({ data: { key: pending, expiresAt: new Date(Date.now() + 60_000), value: JSON.stringify({
            flow: mode === "connect" ? "connect" : "auth", provider: providerId,
            ...(mode === "connect" ? { userId: account.id } : {
                v: 2,
                proofHash: createHash("sha256").update(proof, "utf8").digest("hex"),
            }),
            securityBinding: { provider: runtime.reference, purpose: null, connection: null, admission: null },
            accessTokenEnc: privacyKit.encodeBase64(encryptString(mode === "connect" ? prefix : [...prefix, "token"], "token")),
            profileEnc: privacyKit.encodeBase64(encryptString([...prefix, "profile"], JSON.stringify({
                ...profile, avatar_url: "https://avatar.example.test/image", name: "Octocat" }))),
        }) } });
        const app = Fastify().withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        // Supply the authenticated transport principal; all catalog and identity logic stays real.
        app.decorate("authenticate", async (request: { userId: string; authTokenAuthenticationEvidence?: readonly AuthTokenAuthenticationEvidenceV1[] }) => {
            request.userId = account.id;
            request.authTokenAuthenticationEvidence = options.initiatingEvidence;
        });
        if (mode === "connect") registerExternalConnectFinalizeRoute(app);
        else if (mode === "keyed") registerExternalAuthFinalizeRoute(app);
        else registerExternalAuthFinalizeKeylessRoute(app);
        apps.push(app);
        await app.ready();
        const submit = () => app.inject({ method: "POST",
            url: mode === "connect"
                ? `/v1/connect/external/${providerId}/finalize`
                : mode === "keyed"
                    ? `/v1/auth/external/${providerId}/finalize`
                    : `/v1/auth/external/${providerId}/finalize-keyless`,
            payload: {
                pending,
                username: "octocat",
                ...(mode === "connect" ? {} : { proof }),
                ...(options.providerReset ? { reset: true } : {}),
                ...(mode === "keyed" ? {
                publicKey: privacyKit.encodeBase64(new Uint8Array(keyPair.publicKey)), challenge: privacyKit.encodeBase64(challenge),
                signature: privacyKit.encodeBase64(new Uint8Array(tweetnacl.sign.detached(challenge, keyPair.secretKey))),
                } : {}),
            },
        });
        return { account, pending, submit };
    }

    it.each(["connect", "keyed"] as const)("allows only one concurrent use of a %s pending proof", async (mode) => {
        const { pending, submit } = await fixture(mode);
        let arrivals = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>((resolve) => { release = resolve; });
        // Remote avatar HTTP is the only substituted boundary. It holds both
        // requests after initial pending validation and before the mutation transaction.
        vi.stubGlobal("fetch", async () => {
            arrivals += 1;
            if (arrivals === 2) release();
            await bothArrived;
            return new Response(null, { status: 404 });
        });
        const responses = await Promise.all([submit(), submit()]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
        expect(await db.accountIdentity.count()).toBe(1);
        expect(await db.repeatKey.findUnique({ where: { key: pending } })).toBeNull();
    });

    it("publishes provider replacement to each remaining Home administrator exactly once", async () => {
        const { account: replaced, submit } = await fixture("keyed", { providerReset: true });
        await db.account.update({ where: { id: replaced.id }, data: { homeRole: "owner" } });
        const administrator = await db.account.create({ data: {
            homeRole: "admin",
            encryptionMode: "plain",
        } });
        vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));

        const response = await submit();

        expect(response.statusCode, response.body).toBe(200);
        const replacement = await db.account.findFirstOrThrow({
            where: { id: { notIn: [replaced.id, administrator.id] } },
        });
        expect(await db.accountChange.findUnique({ where: { accountId_kind_entityId: {
            accountId: administrator.id,
            kind: "account",
            entityId: HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1,
        } } })).toMatchObject({ cursor: administrator.seq + 1, hint: null });
        expect(await db.accountChange.findUnique({ where: { accountId_kind_entityId: {
            accountId: replacement.id,
            kind: "account",
            entityId: HOME_GOVERNANCE_ACCOUNT_CHANGE_ENTITY_ID_V1,
        } } })).toMatchObject({ cursor: 1, hint: null });
    });

    it("keeps the one-shot pending proof when the replaced Account disappears before the reset transaction", async () => {
        const { account: replaced, pending, submit } = await fixture("keyed", { providerReset: true });
        let removed = false;
        // Avatar retrieval is the genuine external boundary between the route's
        // optimistic identity read and its serializable replacement transaction.
        vi.stubGlobal("fetch", async () => {
            if (!removed) {
                removed = true;
                await db.accountIdentity.deleteMany({ where: { accountId: replaced.id } });
                await db.account.delete({ where: { id: replaced.id } });
            }
            return new Response(null, { status: 404 });
        });

        const response = await submit();

        expect(response.statusCode, response.body).toBe(409);
        expect(response.json()).toEqual({ error: "provider-already-linked", provider: "github" });
        await expect(db.repeatKey.findUnique({ where: { key: pending } })).resolves.not.toBeNull();
        await expect(db.account.count()).resolves.toBe(0);
    });

    it("rolls back provider replacement when the replacement credential cannot be minted", async () => {
        const { account: replaced, pending, submit } = await fixture("keyed", { providerReset: true });
        vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
        // Make only the replacement row non-mintable at the real persistence
        // boundary. The route must not publish any earlier replacement effect
        // when its final credential cannot be produced.
        await db.$executeRawUnsafe(`CREATE TRIGGER disable_oauth_replacement_account
            AFTER INSERT ON Account
            BEGIN UPDATE Account SET status = 'disabled' WHERE id = NEW.id; END`);
        let response: Awaited<ReturnType<typeof submit>>;
        try {
            response = await submit();
        } finally {
            await db.$executeRawUnsafe("DROP TRIGGER disable_oauth_replacement_account");
        }

        expect(response.statusCode, response.body).toBe(403);
        expect(response.json()).toEqual({ error: "account-disabled" });
        await expect(db.account.findUnique({ where: { id: replaced.id } })).resolves.toEqual(replaced);
        await expect(db.accountIdentity.findFirst({
            where: { accountId: replaced.id, provider: "github", providerUserId: "987" },
        })).resolves.not.toBeNull();
        await expect(db.account.count()).resolves.toBe(1);
        await expect(db.repeatKey.findUnique({ where: { key: pending } })).resolves.not.toBeNull();
    });

    it("allows only one concurrent use of a keyless pending proof", async () => {
        const { pending, submit } = await fixture("keyless");
        vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
        const responses = await Promise.all([submit(), submit()]);
        expect(
            responses.map((response) => response.statusCode).sort(),
            JSON.stringify(responses.map((response) => response.json())),
        ).toEqual([200, 400]);
        expect(await db.accountIdentity.count()).toBe(1);
        expect(await db.repeatKey.findUnique({ where: { key: pending } })).toBeNull();
    });

    it("rejects keyed OAuth finalization when persisted Home policy disables the provider", async () => {
        const { account, pending, submit } = await fixture("keyed");
        await db.homeGovernancePolicy.create({ data: {
            id: "home",
            authenticationPolicy: { v: 1, enabledMethodIds: ["key_challenge"] },
        } });

        const response = await submit();

        expect(response.statusCode, response.body).toBe(403);
        expect(response.json()).toEqual({ error: "signup-provider-disabled" });
        await expect(db.accountIdentity.count({ where: { accountId: account.id } })).resolves.toBe(0);
        await expect(db.repeatKey.findUnique({ where: { key: pending } })).resolves.not.toBeNull();
    });

    it("refreshes an existing keyless identity through the bound provider before minting the token", async () => {
        const { account, submit } = await fixture("keyless", {
            providerId: "oidc-test",
            profile: { sub: "subject-987", preferred_username: "renamed-octocat" },
        });

        const response = await submit();

        expect(response.statusCode, response.body).toBe(200);
        await expect(db.accountIdentity.findFirstOrThrow({
            where: { accountId: account.id, provider: "oidc-test" },
            select: { providerLogin: true },
        })).resolves.toEqual({ providerLogin: "renamed-octocat" });
    });

    it("rolls back keyed Account changes and pending consumption when identity storage fails", async () => {
        const { account, pending, submit } = await fixture("keyed");
        vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
        await db.$executeRawUnsafe(`CREATE TRIGGER fail_oauth_identity_insert
            BEFORE INSERT ON AccountIdentity WHEN NEW.provider = 'github'
            BEGIN SELECT RAISE(ABORT, 'identity storage unavailable'); END`);
        let response: Awaited<ReturnType<typeof submit>>;
        try {
            response = await submit();
        } finally {
            await db.$executeRawUnsafe("DROP TRIGGER fail_oauth_identity_insert");
        }

        expect(response.statusCode).toBe(500);
        expect(await db.account.findUnique({ where: { id: account.id } })).toEqual(account);
        expect(await db.accountIdentity.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.repeatKey.findUnique({ where: { key: pending } })).not.toBeNull();
    });

    it("links a Team-owned provider to the existing Account and retains its current Home authentication evidence", async () => {
        const initiatingEvidence = [{ kind: "home_method", methodId: "key_challenge" }] as const;
        const { account, pending } = await fixture("connect", { initiatingEvidence });
        harness!.resetEnv({ HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test", HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const team = await db.team.create({ data: { name: "Linked Team", admissionMode: "invite_only" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: account.id, role: "member", status: "active" } });
        const provider = await db.identityProviderInstance.create({ data: {
            kind: "oidc", ownerTeamId: team.id, displayName: "Team SSO", enabled: true, firstEnabledAt: new Date(),
            config: { v: 1, kind: "oidc", issuer: "https://id.example.test", clientId: "client", clientAuthenticationMethod: "client_secret_post", scopes: "openid", httpTimeoutSeconds: 30,
                claims: { login: "preferred_username", email: "email", groups: "groups" },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null } },
        } });
        await db.identityProviderInstance.update({ where: { id: provider.id }, data: {
            encryptedSecrets: encryptString(["storage", "identity_provider_instance", provider.id, "oidc", "secrets", "v1"], JSON.stringify({ v: 1, kind: "oidc", clientSecret: "secret" })),
        } });
        const connection = await db.teamIdentityConnection.create({ data: {
            teamId: team.id, providerInstanceId: provider.id, enabled: true, firstEnabledAt: new Date(),
            externalReference: { v: 1, kind: "oidc" },
            settings: { v: 1, kind: "oidc", allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
        } });
        await db.homeGovernancePolicy.create({ data: {
            id: "home",
            teamProviderPolicy: {
                v: 1,
                allowedTeamProviderKinds: ["oidc"],
                teamJitAllowed: false,
                approvedGitHubEnterpriseOrigins: [],
            },
        } });
        await db.team.update({ where: { id: team.id }, data: {
            authenticationPolicy: { v: 1, mode: "restricted", accepted: [{ kind: "team_connection", connectionId: connection.id }] },
        } });
        const runtime = await resolveOAuthRuntimeById(process.env, provider.id, { kind: "team", teamId: team.id });
        expect(runtime).not.toBeNull();
        const prefix = ["user", account.id, "connect", provider.id, "pending", pending];
        await db.repeatKey.update({ where: { key: pending }, data: { value: JSON.stringify({
            flow: "connect", provider: provider.id, userId: account.id,
            securityBinding: { provider: runtime!.reference, purpose: "team_admission", connection: { id: connection.id, revision: connection.revision }, admission: null },
            accessTokenEnc: privacyKit.encodeBase64(encryptString(prefix, "token")),
            profileEnc: privacyKit.encodeBase64(encryptString([...prefix, "profile"], JSON.stringify({ sub: "team-subject", preferred_username: "octocat" }))),
        }) } });
        const response = await apps[0].inject({ method: "POST", url: `/v1/connect/external/${provider.id}/finalize`, payload: { pending, username: "octocat" } });
        expect(response.statusCode, response.body).toBe(200);
        const credential = await auth.verifyToken(response.json().token);
        expect(credential?.userId).toBe(account.id);
        expect(credential?.authenticationEvidence).toEqual([
            ...initiatingEvidence,
            expect.objectContaining({ kind: "provider", providerId: provider.id, teamConnectionId: connection.id }),
        ]);
        expect(await db.account.count()).toBe(1);
        expect(await db.accountIdentity.findFirst({ where: { accountId: account.id, provider: provider.id } })).toMatchObject({ providerUserId: "team-subject" });
    });
});
