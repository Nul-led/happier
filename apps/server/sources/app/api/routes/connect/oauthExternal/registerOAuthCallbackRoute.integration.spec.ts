import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import { createOidcProviderModule } from "@/app/auth/providers/oidc/oidcProviderModuleFactory";
import { deploymentConfiguredOidcNetworkPolicy } from "@/app/oauth/providers/oidc/oidcDiscovery";
import { readDirectoryProvisionedIdentityCandidatesInTx } from "@/app/teams/directory/provisionedIdentityBinding";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createAppCloseTracker } from "../../../testkit/appLifecycle";
import { startOidcStubServer, type OidcStubServer } from "../../../testkit/oidcStub";
import { createExternalAuthorizeAttempt, createExternalAuthorizeUrl } from "./createExternalAuthorizeUrl";
import { registerOAuthCallbackRoute } from "./registerOAuthCallbackRoute";
import { encryptString } from "@/modules/encrypt";
import { inTx } from "@/storage/inTx";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

const workosExchange = vi.hoisted(() => vi.fn());
// WorkOS is the external SDK boundary; catalog, normalization, OAuth and storage stay real.
vi.mock("@workos-inc/node", () => ({
    WorkOS: class {
        sso = {
            getAuthorizationUrl: ({ state }: { state: string }) =>
                `https://api.workos.test/sso/authorize?state=${encodeURIComponent(state)}`,
            getProfileAndToken: workosExchange,
        };
    },
}));

describe("OAuth callback provider security binding", () => {
    const originalFetch = globalThis.fetch;
    let harness: LightSqliteHarness;
    let oidc: OidcStubServer;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-oauth-binding-",
            initAuth: true,
            initEncrypt: true,
        });
        oidc = await startOidcStubServer();
    }, 120_000);

    afterEach(async () => {
        await closeTrackedApps();
        harness.resetEnv();
        globalThis.fetch = originalFetch;
        oidc.reset();
        await db.repeatKey.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.account.deleteMany();
        await db.teamProvisionedIdentity.deleteMany();
        await db.teamDirectorySource.deleteMany();
        await db.teamIdentityConnection.deleteMany();
        await db.identityProviderInstance.deleteMany();
        await db.team.deleteMany();
        await db.homeGovernancePolicy.deleteMany();
        workosExchange.mockReset();
    });

    afterAll(async () => {
        await harness.close();
        await oidc.close();
    });

    it("consumes a changed deployment attempt before code exchange", async () => {
        const config = {
            id: "okta", type: "oidc", displayName: "Acme Okta",
            issuer: oidc.issuer, clientId: "oidc_client", clientSecret: "oidc_secret",
            redirectUrl: "https://api.example.test/v1/oauth/okta/callback",
        };
        harness.resetEnv({
            AUTH_SIGNUP_PROVIDERS: "okta",
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([config]),
            HAPPIER_WEBAPP_URL: "https://app.example.test",
        });
        const app = Fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        trackApp(app);
        registerOAuthCallbackRoute(app.withTypeProvider<ZodTypeProvider>());
        const { provider, reference } = (await resolveOAuthRuntimeById(process.env, "okta"))!;
        const authorizeUrl = await createExternalAuthorizeUrl({
            flow: "auth", providerId: "okta", provider, reference, env: process.env,
            publicKeyHex: "a".repeat(64), proofHash: null,
        });
        expect(authorizeUrl).toBeTruthy();
        const authorize = await fetch(authorizeUrl!, { redirect: "manual" });
        expect(authorize.status).toBe(302);
        const callback = new URL(authorize.headers.get("location")!);
        process.env.AUTH_PROVIDERS_CONFIG_JSON = JSON.stringify([{ ...config, clientSecret: "rotated_secret" }]);
        const network = vi.fn(originalFetch);
        globalThis.fetch = network;

        const response = await app.inject({ method: "GET", url: `${callback.pathname}${callback.search}` });
        expect(response.statusCode).toBe(302);
        expect(new URL(response.headers.location as string).searchParams.get("error"))
            .toBe("auth_provider_configuration_changed");
        expect(network).not.toHaveBeenCalled();
        expect(await db.repeatKey.count()).toBe(0);
        expect(await db.account.count()).toBe(0);
        expect(await db.accountIdentity.count()).toBe(0);
    });

    it.each([
        {
            field: "purpose",
            state: {
                purpose: "account_encryption_first_key" as const,
                userId: "account-1",
                proofHash: "a".repeat(64),
                requestDigest: `aemrb1_${"A".repeat(43)}`,
            },
        },
        {
            field: "Account",
            state: {
                purpose: "account_password_enrollment" as const,
                userId: "account-2",
                proofHash: "a".repeat(64),
                requestDigest: "A".repeat(43),
            },
        },
        {
            field: "proof hash",
            state: {
                purpose: "account_password_enrollment" as const,
                userId: "account-1",
                proofHash: "b".repeat(64),
                requestDigest: "A".repeat(43),
            },
        },
        {
            field: "request digest",
            state: {
                purpose: "account_password_enrollment" as const,
                userId: "account-1",
                proofHash: "a".repeat(64),
                requestDigest: `${"A".repeat(42)}Q`,
            },
        },
    ])("consumes an Account-security attempt whose signed-state $field was replaced before code exchange", async ({ state: replacement }) => {
        const config = {
            id: "okta", type: "oidc", displayName: "Acme Okta",
            issuer: oidc.issuer, clientId: "oidc_client", clientSecret: "oidc_secret",
            redirectUrl: "https://api.example.test/v1/oauth/okta/callback",
        };
        harness.resetEnv({
            AUTH_SIGNUP_PROVIDERS: "okta",
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([config]),
            HAPPIER_WEBAPP_URL: "https://app.example.test",
        });
        const app = Fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        trackApp(app);
        registerOAuthCallbackRoute(app.withTypeProvider<ZodTypeProvider>());
        const { provider, reference } = (await resolveOAuthRuntimeById(process.env, "okta"))!;
        const attempt = await createExternalAuthorizeAttempt({
            flow: "auth",
            providerId: "okta",
            provider,
            reference,
            env: process.env,
            publicKeyHex: null,
            proofHash: "a".repeat(64),
            purpose: "account_password_enrollment",
            userId: "account-1",
            requestDigest: "A".repeat(43),
        });
        expect(attempt).not.toBeNull();
        const tamperedState = await auth.createOauthStateToken({
            flow: "auth",
            provider: "okta",
            sid: attempt!.attemptId,
            publicKey: null,
            ...replacement,
        });
        const network = vi.fn(originalFetch);
        globalThis.fetch = network;

        const response = await app.inject({
            method: "GET",
            url: `/v1/oauth/okta/callback?state=${encodeURIComponent(tamperedState)}&code=code`,
        });

        expect(response.statusCode).toBe(302);
        expect(new URL(response.headers.location as string).searchParams.get("error")).toBe("invalid_state");
        expect(network).not.toHaveBeenCalled();
        expect(await db.repeatKey.count()).toBe(0);
        expect(await db.account.count()).toBe(0);
        expect(await db.accountIdentity.count()).toBe(0);
    });

    it("consumes a Team-admission attempt whose signed state lost its exact purpose before code exchange", async () => {
        const config = {
            id: "okta", type: "oidc", displayName: "Acme Okta",
            issuer: oidc.issuer, clientId: "oidc_client", clientSecret: "oidc_secret",
            redirectUrl: "https://api.example.test/v1/oauth/okta/callback",
        };
        harness.resetEnv({
            AUTH_SIGNUP_PROVIDERS: "okta",
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([config]),
            HAPPIER_WEBAPP_URL: "https://app.example.test",
        });
        const app = Fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        trackApp(app);
        registerOAuthCallbackRoute(app.withTypeProvider<ZodTypeProvider>());
        const { provider, reference } = (await resolveOAuthRuntimeById(process.env, "okta"))!;
        const attempt = await createExternalAuthorizeAttempt({
            flow: "auth",
            providerId: "okta",
            provider,
            reference,
            env: process.env,
            publicKeyHex: "a".repeat(64),
            proofHash: null,
            purpose: "team_admission",
        });
        expect(attempt).not.toBeNull();
        const replacedState = await auth.createOauthStateToken({
            flow: "auth",
            provider: "okta",
            sid: attempt!.attemptId,
            publicKey: "a".repeat(64),
        });
        const network = vi.fn(originalFetch);
        globalThis.fetch = network;

        const response = await app.inject({
            method: "GET",
            url: `/v1/oauth/okta/callback?state=${encodeURIComponent(replacedState)}&code=code`,
        });

        expect(response.statusCode).toBe(302);
        expect(new URL(response.headers.location as string).searchParams.get("error")).toBe("invalid_state");
        expect(network).not.toHaveBeenCalled();
        expect(await db.repeatKey.count()).toBe(0);
        expect(await db.account.count()).toBe(0);
        expect(await db.accountIdentity.count()).toBe(0);
    });

    it("rejects JIT admission when its server-held source no longer names the consumed OAuth attempt", async () => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_WEBAPP_URL: "https://app.example.test",
        });
        const team = await db.team.create({ data: { name: "Exact JIT attempt", admissionMode: "jit" } });
        await db.homeGovernancePolicy.create({ data: {
            id: "home",
            teamProviderPolicy: {
                v: 1,
                allowedTeamProviderKinds: ["oidc"],
                teamJitAllowed: true,
                approvedGitHubEnterpriseOrigins: [],
            },
        } });
        const providerRow = await db.identityProviderInstance.create({ data: {
            ownerTeamId: team.id,
            kind: "oidc",
            displayName: "Exact JIT SSO",
            enabled: true,
            firstEnabledAt: new Date(),
            config: {
                v: 1,
                kind: "oidc",
                issuer: oidc.issuer,
                clientId: "oidc_client",
                clientAuthenticationMethod: "client_secret_post",
                scopes: "openid",
                httpTimeoutSeconds: 30,
                claims: { login: "preferred_username", email: "email", groups: "groups" },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false,
                storeRefreshToken: false,
                ui: { buttonColor: null, iconHint: null },
            },
        } });
        await db.identityProviderInstance.update({ where: { id: providerRow.id }, data: {
            encryptedSecrets: encryptString(
                ["storage", "identity_provider_instance", providerRow.id, "oidc", "secrets", "v1"],
                JSON.stringify({ v: 1, kind: "oidc", clientSecret: "oidc_secret" }),
            ),
        } });
        const connection = await db.teamIdentityConnection.create({ data: {
            teamId: team.id,
            providerInstanceId: providerRow.id,
            enabled: true,
            firstEnabledAt: new Date(),
            externalReference: { v: 1, kind: "oidc" },
            settings: { v: 1, kind: "oidc", allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
        } });
        const runtime = await resolveOAuthRuntimeById(process.env, providerRow.id, { kind: "team", teamId: team.id });
        expect(runtime).not.toBeNull();
        // Attempt creation needs a real OIDC authorize URL, but this test's
        // managed runtime correctly rejects loopback HTTP. Reuse the
        // deployment-configured test boundary, whose explicit authority is
        // exactly what permits the local OIDC stub, while retaining the
        // managed runtime reference that the callback must bind.
        const testOidcConfig = {
            id: providerRow.id,
            type: "oidc" as const,
            displayName: "Exact JIT SSO",
            issuer: oidc.issuer,
            clientId: "oidc_client",
            clientSecret: "oidc_secret",
            clientAuthenticationMethod: "client_secret_post" as const,
            redirectUrl: `https://home.example.test/v1/oauth/${providerRow.id}/callback`,
            scopes: "openid",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        };
        const testProvider = createOidcProviderModule(
            testOidcConfig,
            runtime!.reference.runtimeFingerprint,
            deploymentConfiguredOidcNetworkPolicy(testOidcConfig),
        ).oauth!;
        const attempt = await createExternalAuthorizeAttempt({
            flow: "auth",
            providerId: providerRow.id,
            provider: testProvider,
            reference: runtime!.reference,
            env: process.env,
            publicKeyHex: null,
            proofHash: "a".repeat(64),
            purpose: "team_admission",
            connection: { id: connection.id, revision: connection.revision },
            admission: {
                kind: "team_jit_identity",
                teamId: team.id,
                providerId: providerRow.id,
                connectionId: connection.id,
                connectionRevision: connection.revision,
                admissionMode: "jit",
            },
        });
        expect(attempt).not.toBeNull();
        const attemptRow = await db.repeatKey.findUniqueOrThrow({ where: { key: `oauth_state_${attempt!.attemptId}` } });
        const attemptValue = JSON.parse(attemptRow.value);
        await db.repeatKey.update({ where: { key: attemptRow.key }, data: { value: JSON.stringify({
            ...attemptValue,
            securityBinding: {
                ...attemptValue.securityBinding,
                admission: { ...attemptValue.securityBinding.admission, authAttemptId: "different-attempt" },
            },
        }) } });
        const app = Fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        trackApp(app);
        registerOAuthCallbackRoute(app.withTypeProvider<ZodTypeProvider>());
        const network = vi.fn(originalFetch);
        globalThis.fetch = network;
        const state = new URL(attempt!.url).searchParams.get("state")!;

        const response = await app.inject({ method: "GET", url:
            `/v1/oauth/${providerRow.id}/callback?state=${encodeURIComponent(state)}&code=code`,
        });

        expect(response.statusCode).toBe(302);
        expect(new URL(response.headers.location as string).searchParams.get("error")).toBe("invalid_state");
        expect(network).not.toHaveBeenCalled();
        expect(await db.repeatKey.count()).toBe(0);
        expect(await db.account.count()).toBe(0);
        expect(await db.accountIdentity.count()).toBe(0);
        expect(await db.teamMembership.count()).toBe(0);
    });

    it.each(["idp_exact", null])("binds WorkOS provisioned admission only by its exact IdP subject (%s)", async (idpId) => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_WEBAPP_URL: "https://app.example.test",
            HAPPIER_FEATURE_TEAMS__ENABLED: "1",
            WORKOS_API_KEY: "sk_test",
            WORKOS_CLIENT_ID: "client_test",
        });
        await db.homeGovernancePolicy.create({ data: {
            id: "home",
            teamProviderPolicy: {
                v: 1,
                allowedTeamProviderKinds: ["workos_sso"],
                teamJitAllowed: false,
                approvedGitHubEnterpriseOrigins: [],
            },
        } });
        const team = await db.team.create({ data: { name: "Provisioned Team", admissionMode: "provisioned" } });
        const providerRow = await db.identityProviderInstance.create({ data: {
            ownerTeamId: team.id, kind: "workos_sso", displayName: "SSO", enabled: true,
            firstEnabledAt: new Date(), config: { v: 1, kind: "workos_sso" },
        } });
        const connection = await db.teamIdentityConnection.create({ data: {
            teamId: team.id, providerInstanceId: providerRow.id, enabled: true, firstEnabledAt: new Date(),
            externalReference: { v: 1, kind: "workos_sso", organizationId: "org_exact", connectionId: "conn_exact" },
            settings: { v: 1, kind: "workos_sso" },
        } });
        const source = await db.teamDirectorySource.create({ data: {
            teamId: team.id, kind: "workos_directory", state: "active", displayName: "Directory",
            externalSourceKey: "directory_exact", bindingConfig: { v: 1, kind: "workos_directory" },
            teamIdentityConnectionId: connection.id,
            activeReconcileRunId: null,
            lastSuccessAt: new Date("2026-09-07T10:01:00.000Z"),
            lastFullReconcileAt: new Date("2026-09-07T10:01:00.000Z"),
        } });
        const matchingPerson = await db.teamProvisionedIdentity.create({ data: {
            teamId: team.id, directorySourceId: source.id, externalUserId: "directory_user_exact",
            externalSubjectId: "idp_exact", state: "active", lastSeenReconcileRunId: "complete-run",
        } });
        // A Profile ID is a different namespace. Matching it must never select this person.
        await db.teamProvisionedIdentity.create({ data: {
            teamId: team.id, directorySourceId: source.id, externalUserId: "directory_user_other",
            externalSubjectId: "profile_exact", state: "active", lastSeenReconcileRunId: "complete-run",
        } });
        await expect(inTx((tx) => readDirectoryProvisionedIdentityCandidatesInTx(tx, {
            teamId: team.id,
            match: {
                kind: "workos_directory",
                teamIdentityConnectionId: connection.id,
                externalSubjectId: "idp_exact",
            },
        }))).resolves.toEqual([{ id: matchingPerson.id, directorySourceId: source.id, boundAccountId: null }]);
        workosExchange.mockResolvedValue({ accessToken: "ephemeral", profile: {
            id: "profile_exact", idpId, email: "person@example.test",
            organizationId: "org_exact", connectionId: "conn_exact",
        } });
        const resolved = await resolveOAuthRuntimeById(process.env, providerRow.id, { kind: "team", teamId: team.id });
        expect(resolved).not.toBeNull();
        const url = await createExternalAuthorizeUrl({
            flow: "auth", providerId: providerRow.id, provider: resolved!.provider, reference: resolved!.reference,
            env: process.env, purpose: "team_admission", connection: { id: connection.id, revision: connection.revision },
            publicKeyHex: "a".repeat(64), proofHash: null,
        });
        const app = Fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        trackApp(app);
        registerOAuthCallbackRoute(app.withTypeProvider<ZodTypeProvider>());
        const response = await app.inject({ method: "GET", url:
            `/v1/oauth/${providerRow.id}/callback?state=${encodeURIComponent(new URL(url!).searchParams.get("state")!)}&code=code`,
        });
        expect(response.statusCode).toBe(302);
        const redirect = new URL(response.headers.location as string);
        expect(redirect.searchParams.get("error")).toBeNull();
        const pending = await db.repeatKey.findUniqueOrThrow({ where: { key: redirect.searchParams.get("pending")! } });
        const value = JSON.parse(pending.value);
        expect(value.securityBinding.admission).toEqual(idpId ? {
            kind: "team_provisioned_identity", teamId: team.id, providerId: providerRow.id,
            connectionId: connection.id, connectionRevision: connection.revision,
            admissionMode: "provisioned", provisionedIdentityId: matchingPerson.id,
        } : null);
        expect(await db.account.count()).toBe(0);
        expect(await db.accountIdentity.count()).toBe(0);
        expect(await db.teamMembership.count()).toBe(0);
    });
});
