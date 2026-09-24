import Fastify from "fastify";
import * as privacyKit from "privacy-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { connectAuthExternalRoutes } from "./connectRoutes.authExternal";
import { connectConnectExternalRoutes } from "./connectRoutes.connectExternal";
import { auth } from "@/app/auth/auth";
import { mintTeamInvitationToken, digestTeamInvitationToken } from "@/app/teams/invitations/token";

const { trackApp, closeTrackedApps } = createAppCloseTracker();
const PUBLIC_KEY = privacyKit.encodeBase64(new Uint8Array(32).fill(7));

type InvitationState = "accepted" | "revoked" | "expired" | "archived";

function createTestApp() {
    const app = Fastify({ logger: false, trustProxy: true });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    return trackApp(app.withTypeProvider<ZodTypeProvider>() as any);
}

describe("external OAuth Team-admission start (sqlite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-oauth-start-",
            initAuth: true,
            initEncrypt: true,
        });
        harness.resetEnv({
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
            AUTH_SIGNUP_PROVIDERS: "github",
            GITHUB_CLIENT_ID: "test_client",
            GITHUB_CLIENT_SECRET: "test_secret",
            GITHUB_REDIRECT_URL: "https://home.example.test/v1/oauth/github/callback",
            HAPPIER_FEATURE_TEAMS__ENABLED: "1",
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_WEBAPP_URL: "https://app.example.test",
            WORKOS_API_KEY: "sk_test",
            WORKOS_CLIENT_ID: "client_test",
        });
        await db.homeGovernancePolicy.create({
            data: {
                id: "home",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["workos_sso"],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
    }, 120_000);

    afterAll(async () => {
        await closeTrackedApps();
        await harness.close();
    });

    async function createInvitationFixture(state: InvitationState | "active") {
        const acceptedBy = state === "accepted"
            ? await db.account.create({
                data: {
                    publicKey: `accepted-${crypto.randomUUID()}`,
                    username: `accepted-${crypto.randomUUID()}`,
                    encryptionMode: "e2ee",
                },
            })
            : null;
        const team = await db.team.create({
            data: {
                name: `OAuth invitation ${state}-${crypto.randomUUID()}`,
                admissionMode: "invite_only",
                archivedAt: state === "archived" ? new Date() : null,
            },
        });
        const token = mintTeamInvitationToken();
        const invitation = await db.teamInvitation.create({
            data: {
                teamId: team.id,
                tokenHash: Uint8Array.from(digestTeamInvitationToken(token)),
                role: "member",
                historyAccess: "from_membership",
                expiresAt: state === "expired" ? new Date(0) : new Date(Date.now() + 60_000),
                acceptedAt: state === "accepted" ? new Date() : null,
                acceptedByAccountId: acceptedBy?.id ?? null,
                revokedAt: state === "revoked" ? new Date() : null,
            },
        });
        return { team, invitation, token };
    }

    async function createTeamProvider(teamId: string) {
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: teamId,
                kind: "workos_sso",
                displayName: "Invitation SSO",
                enabled: true,
                firstEnabledAt: new Date(),
                config: { v: 1, kind: "workos_sso" },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId,
                providerInstanceId: provider.id,
                enabled: true,
                firstEnabledAt: new Date(),
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: `org_${teamId}`,
                    connectionId: `conn_${teamId}`,
                },
                settings: { v: 1, kind: "workos_sso" },
            },
        });
        return { provider, connection };
    }

    async function start(input: Readonly<{
        providerId: string;
        teamId: string;
        token: string;
        origin: "home" | "team";
        connectionId?: string;
    }>) {
        const app = createTestApp();
        connectAuthExternalRoutes(app);
        await app.ready();
        const query = new URLSearchParams({
            purpose: "team_admission",
            origin: input.origin,
            teamId: input.teamId,
            publicKey: PUBLIC_KEY,
            ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        });
        return await app.inject({
            method: "GET",
            url: `/v1/auth/external/${input.providerId}/params?${query.toString()}`,
            headers: { "x-happier-team-invitation": input.token },
        });
    }

    /** The authenticated Team entry: the member already holds this Account. */
    async function startConnect(input: Readonly<{
        providerId: string;
        teamId: string;
        accountId: string;
        origin: "home" | "team";
        token?: string;
        connectionId?: string;
    }>) {
        const app = createTestApp();
        app.decorate("authenticate", async (request: { userId: string }) => {
            request.userId = input.accountId;
        });
        connectConnectExternalRoutes(app);
        await app.ready();
        const query = new URLSearchParams({
            purpose: "team_admission",
            origin: input.origin,
            teamId: input.teamId,
            ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        });
        return await app.inject({
            method: "GET",
            url: `/v1/connect/external/${input.providerId}/params?${query.toString()}`,
            ...(input.token ? { headers: { "x-happier-team-invitation": input.token } } : {}),
        });
    }

    it("binds the signed-in Account to a Team-owned connection in the authenticated connect attempt", async () => {
        const team = await db.team.create({
            data: { name: `Connect member ${crypto.randomUUID()}`, admissionMode: "invite_only" },
        });
        const { provider, connection } = await createTeamProvider(team.id);
        const account = await db.account.create({
            data: { publicKey: `member-${crypto.randomUUID()}`, username: `member-${crypto.randomUUID()}`, encryptionMode: "e2ee" },
        });

        const response = await startConnect({
            providerId: provider.id,
            teamId: team.id,
            accountId: account.id,
            origin: "team",
            connectionId: connection.id,
        });

        expect(response.statusCode, response.body).toBe(200);
        const body = response.json();
        expect(body).toMatchObject({ purpose: "team_admission", teamId: team.id });
        const attempt = await db.repeatKey.findUniqueOrThrow({
            where: { key: `oauth_state_${body.admissionReference}` },
        });
        const stored = JSON.parse(attempt.value);
        // Existing-member re-qualification carries the exact connection and no
        // admission source; the finalizer decides structural admission.
        expect(stored.securityBinding).toMatchObject({
            purpose: "team_admission",
            connection: { id: connection.id, revision: connection.revision },
            admission: null,
        });
        // The callback must hand this journey to the authenticated finalizer.
        expect(stored.connectFinalization).toBe("credential_adoption_v1");
        const state = new URL(body.url).searchParams.get("state");
        expect(state).toBeTruthy();
        const verified = await auth.verifyOauthStateToken(state!);
        expect(verified).toMatchObject({
            flow: "connect",
            userId: account.id,
            sid: body.admissionReference,
        });
    });

    it("rejects a revoked invitation before an authenticated Team connect attempt is created", async () => {
        const fixture = await createInvitationFixture("revoked");
        const account = await db.account.create({
            data: { publicKey: `member-${crypto.randomUUID()}`, username: `member-${crypto.randomUUID()}`, encryptionMode: "e2ee" },
        });
        const before = await db.repeatKey.count();

        const response = await startConnect({
            providerId: "github",
            teamId: fixture.team.id,
            accountId: account.id,
            origin: "home",
            token: fixture.token,
        });

        expect(response.statusCode, response.body).toBe(403);
        expect(response.json()).toEqual({ error: "invalid-team-admission" });
        expect(await db.repeatKey.count()).toBe(before);
    });

    it.each(["accepted", "revoked", "expired", "archived"] as const)(
        "rejects a %s invitation before a Home-provider OAuth attempt is created",
        async (state) => {
            const fixture = await createInvitationFixture(state);
            const before = await db.repeatKey.count();
            const response = await start({
                providerId: "github",
                teamId: fixture.team.id,
                token: fixture.token,
                origin: "home",
            });

            expect(response.statusCode, response.body).toBe(403);
            expect(response.json()).toEqual({ error: "invalid-team-admission" });
            expect(await db.repeatKey.count()).toBe(before);
        },
    );

    it.each(["accepted", "revoked", "expired", "archived"] as const)(
        "rejects a %s invitation before a Team-provider OAuth attempt is created",
        async (state) => {
            const fixture = await createInvitationFixture(state);
            const { provider, connection } = await createTeamProvider(fixture.team.id);
            const before = await db.repeatKey.count();
            const response = await start({
                providerId: provider.id,
                teamId: fixture.team.id,
                token: fixture.token,
                origin: "team",
                connectionId: connection.id,
            });

            expect(response.statusCode, response.body).toBe(403);
            expect(response.json()).toEqual({ error: "invalid-team-admission" });
            expect(await db.repeatKey.count()).toBe(before);
        },
    );

    it.each(["home", "team"] as const)(
        "preserves the exact active invitation and %s provider origin in the server-held OAuth attempt",
        async (origin) => {
            const fixture = await createInvitationFixture("active");
            const teamProvider = origin === "team" ? await createTeamProvider(fixture.team.id) : null;
            const response = await start({
                providerId: teamProvider?.provider.id ?? "github",
                teamId: fixture.team.id,
                token: fixture.token,
                origin,
                connectionId: teamProvider?.connection.id,
            });

            expect(response.statusCode, response.body).toBe(200);
            const body = response.json();
            expect(body).toMatchObject({ purpose: "team_admission", teamId: fixture.team.id });
            const attempt = await db.repeatKey.findUniqueOrThrow({
                where: { key: `oauth_state_${body.admissionReference}` },
            });
            const stored = JSON.parse(attempt.value);
            expect(stored.securityBinding.admission).toEqual({
                kind: "team_invitation",
                teamId: fixture.team.id,
                providerId: teamProvider?.provider.id ?? "github",
                providerOrigin: origin,
                connectionId: teamProvider?.connection.id ?? null,
                connectionRevision: teamProvider?.connection.revision ?? null,
                admissionMode: "invite_only",
                invitationId: fixture.invitation.id,
                tokenHash: Buffer.from(digestTeamInvitationToken(fixture.token)).toString("hex"),
            });
        },
    );

    it("rejects an active invitation before OAuth side effects when the Teams feature is unavailable", async () => {
        const fixture = await createInvitationFixture("active");
        const before = await db.repeatKey.count();
        const previous = process.env.HAPPIER_BUILD_FEATURES_DENY;
        process.env.HAPPIER_BUILD_FEATURES_DENY = "teams";
        try {
            const response = await start({
                providerId: "github",
                teamId: fixture.team.id,
                token: fixture.token,
                origin: "home",
            });
            expect(response.statusCode, response.body).toBe(403);
            expect(response.json()).toEqual({ error: "invalid-team-admission" });
            expect(await db.repeatKey.count()).toBe(before);
        } finally {
            if (previous === undefined) delete process.env.HAPPIER_BUILD_FEATURES_DENY;
            else process.env.HAPPIER_BUILD_FEATURES_DENY = previous;
        }
    });

    it("rejects archived-Team JIT before creating a Team-provider OAuth attempt", async () => {
        const team = await db.team.create({
            data: { name: `Archived JIT ${crypto.randomUUID()}`, admissionMode: "jit", archivedAt: new Date() },
        });
        const { provider, connection } = await createTeamProvider(team.id);
        const before = await db.repeatKey.count();
        const app = createTestApp();
        connectAuthExternalRoutes(app);
        await app.ready();
        const query = new URLSearchParams({
            purpose: "team_admission",
            origin: "team",
            teamId: team.id,
            connectionId: connection.id,
            publicKey: PUBLIC_KEY,
        });
        const response = await app.inject({
            method: "GET",
            url: `/v1/auth/external/${provider.id}/params?${query.toString()}`,
        });
        expect(response.statusCode, response.body).toBe(403);
        expect(response.json()).toEqual({ error: "invalid-team-admission" });
        expect(await db.repeatKey.count()).toBe(before);
    });
});
