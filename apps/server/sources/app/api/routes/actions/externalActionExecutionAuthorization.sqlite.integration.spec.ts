import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    EXTERNAL_ACTION_EFFECT_ACTION_HEADER,
    EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER,
    EXTERNAL_ACTION_MACHINE_SIGNATURE_HEADER,
    EXTERNAL_ACTION_RESOLVED_TARGET_HEADER,
    ExternalActionExecutionAuthorizationV1Schema,
    ExternalActionRequestEnvelopeV1Schema,
    computeExternalActionRequestEnvelopeDigestV1,
    bindExternalActionExecutionAuthorizationHttpPathV1,
    bindExternalActionExecutionAuthorizationVerifyHttpPathV1,
    getActionSpec,
    encodeExternalActionResolvedTargetV1,
    signExternalActionMachineRequestV1,
    signExternalActionMachineRpcRequestV1,
    type ExternalActionRequestEnvelopeV1,
} from "@happier-dev/protocol/actions";
import { encodePasswordCredentialFieldV1, type AccountPasswordCredentialV1 } from "@happier-dev/protocol";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";

import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { requirePresentUser } from "@/app/api/utils/requirePresentUser";
import { registerAccountEncryptionRoutes } from "@/app/api/routes/account/registerAccountEncryptionRoutes";
import { registerAccountSettingsRoutes } from "@/app/api/routes/account/registerAccountSettingsRoutes";
import { homeGovernanceRoutes } from "@/app/api/routes/home/homeGovernanceRoutes";
import { featuresRoutes } from "@/app/api/routes/features/featuresRoutes";
import { registerSessionListingRoutes } from "@/app/api/routes/session/registerSessionListingRoutes";
import { registerSessionMessageRoutes } from "@/app/api/routes/session/registerSessionMessageRoutes";
import { registerSessionFollowSourceRoutes } from "@/app/api/routes/session/registerSessionFollowSourceRoutes";
import { auth } from "@/app/auth/auth";
import { verifyExternalActionMachineRpcExecution } from "@/app/auth/externalActionExecutionAuthorization";
import { qualifyTeamAuthenticationInTx } from "@/app/auth/entry/qualifyTeamAuthentication";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { registerTeamRoutes } from "@/app/teams/registerTeamRoutes";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { currentAccountStoredContentCompatibilityHeaders } from "@/app/api/testkit/accountStoredContentCompatibility";

import { registerExternalActionRoutes } from "./registerExternalActionRoutes";

const ACTION_ID = "teams.policy.set" as const;
const authorizationRequests = new Map<string, Readonly<{
    target: NonNullable<ExternalActionRequestEnvelopeV1["target"]>;
    installationId: string;
    requestId: string;
}>>();

describe("external Action execution authorization", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-external-action-execution-authorization-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "true",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                HAPPIER_FEATURE_SESSIONS_FILTERED_LISTING__ENABLED: "1",
                HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: "1",
            },
        });
    }, 300_000);

    afterEach(async () => {
        await db.accountApiToken.deleteMany();
        await db.machine.deleteMany();
        await db.teamMembership.deleteMany();
        await db.team.deleteMany();
        await db.sessionMessage.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        if (harness) await harness.close();
    });

    async function createFixture(input: Readonly<{ qualifiedPat: boolean }>) {
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
        });
        const passwordCredential: AccountPasswordCredentialV1 = {
            v: 1,
            kind: "plain_password_hash",
            hash: {
                v: 1,
                algorithm: "scrypt",
                parameters: { n: 16_384, r: 8, p: 5, keyLength: 32 },
                salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(3)),
                digest: encodePasswordCredentialFieldV1(new Uint8Array(32).fill(5)),
            },
        };
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "email",
                providerUserId: `${account.id}@external-action.test`,
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: { accountId: account.id, credential: passwordCredential },
        });
        const keyPair = tweetnacl.sign.keyPair();
        const machine = await db.machine.create({
            data: {
                id: crypto.randomUUID(),
                accountId: account.id,
                metadata: "metadata",
                metadataVersion: 1,
                daemonState: null,
                daemonStateVersion: 0,
                installationId: crypto.randomUUID(),
                installationPublicKey: new Uint8Array(keyPair.publicKey),
            },
        });
        const pat = await auth.createApiToken({
            accountId: account.id,
            tokenId: crypto.randomUUID(),
            label: input.qualifiedPat ? "qualified" : "ordinary",
            ...(input.qualifiedPat
                ? {
                    authenticationEvidence: [{ kind: "home_method" as const, methodId: "email_password" }],
                }
                : {}),
        });
        const team = await db.team.create({
            data: {
                name: "Restricted Team",
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "email_password" }],
                },
            },
        });
        await db.teamMembership.create({
            data: { teamId: team.id, accountId: account.id, role: "owner" },
        });
        const envelope: ExternalActionRequestEnvelopeV1 = {
            v: 1,
            requestId: crypto.randomUUID(),
            target: { kind: "machine", machineId: machine.id },
            input: { teamId: team.id },
        };
        return { account, machine, pat, team, envelope, keyPair };
    }

    async function createApp(teamId: string) {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>() as any;
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        registerExternalActionRoutes(app, {
            dispatch: async () => ({ kind: "placement_error", code: "target_unavailable" }),
        });
        featuresRoutes(app);
        registerAccountEncryptionRoutes(app);
        registerAccountSettingsRoutes(app);
        registerSessionListingRoutes(app);
        registerSessionMessageRoutes(app);
        registerSessionFollowSourceRoutes(app);

        const transport = getActionSpec(ACTION_ID).serverTransport;
        if (!transport) throw new Error("test Action has no server transport");
        app.post(transport.path, { preHandler: app.authenticate, config: { allowApiToken: true } }, async (request: any) => {
            const qualification = await inTx((tx) => qualifyTeamAuthenticationInTx(tx, {
                env: process.env,
                team: {
                    id: teamId,
                    authenticationPolicy: {
                        v: 1,
                        mode: "restricted",
                        accepted: [{ kind: "home_method", methodId: "email_password" }],
                    },
                },
                accountId: request.userId,
                verifiedCredentialEvidence: request.authTokenAuthenticationEvidence,
                operationContext: { kind: request.authAuthority },
            }));
            return {
                qualification: qualification.status,
                principal: request.apiTokenPrincipal,
                rootActionId: request.externalActionRootActionId,
                effectActionId: request.externalActionEffectActionId,
                target: request.externalActionExecutionTarget,
            };
        });
        app.post("/v1/sessions/:sessionId/discussions", { preHandler: app.authenticate }, async () => ({ ok: true }));
        app.post("/test/present-user-only", { preHandler: [app.authenticate, requirePresentUser] }, async () => ({ ok: true }));
        await app.ready();
        return { app, transport };
    }

    async function createRealTeamApp() {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>() as any;
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        registerExternalActionRoutes(app, {
            dispatch: async () => ({ kind: "placement_error", code: "target_unavailable" }),
        });
        registerTeamRoutes(app);
        await app.ready();
        return app;
    }

    async function createRealLane03App() {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>() as any;
        const duplicateExternalActionAdmissionRoutes: string[] = [];
        app.addHook("onRoute", (routeOptions: {
            method: string | readonly string[];
            url: string;
            config?: Readonly<Record<string, unknown>>;
        }) => {
            if (!("allowExternalActionApiTokenForActionIds" in (routeOptions.config ?? {}))) return;
            const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
            for (const method of methods) {
                duplicateExternalActionAdmissionRoutes.push(`${method} ${routeOptions.url}`);
            }
        });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        registerExternalActionRoutes(app, {
            dispatch: async () => ({ kind: "placement_error", code: "target_unavailable" }),
        });
        homeGovernanceRoutes(app);
        registerTeamRoutes(app, {
            ...process.env,
            HAPPIER_FEATURE_TEAMS__ENABLED: "1",
        });
        await app.ready();
        return { app, duplicateExternalActionAdmissionRoutes };
    }

    async function mint(
        app: Awaited<ReturnType<typeof createApp>>["app"],
        fixture: Awaited<ReturnType<typeof createFixture>>,
        actionId: string = ACTION_ID,
        envelope: ExternalActionRequestEnvelopeV1 = fixture.envelope,
    ) {
        const response = await app.inject({
            method: "POST",
            url: bindExternalActionExecutionAuthorizationHttpPathV1(actionId),
            headers: { authorization: `Bearer ${fixture.pat.token}` },
            payload: { v: 1, machineId: fixture.machine.id, envelope },
        });
        expect(response.statusCode).toBe(200);
        const authorization = ExternalActionExecutionAuthorizationV1Schema.parse(response.json());
        authorizationRequests.set(authorization.token, {
            target: authorization.binding.target,
            installationId: fixture.machine.installationId!,
            requestId: authorization.binding.requestId,
        });
        return authorization;
    }

    function machineHeaders(input: Readonly<{
        authorizationToken: string;
        method: string;
        path: string;
        body: unknown;
        privateKey: Uint8Array;
        effectActionId?: string;
        target?: ExternalActionRequestEnvelopeV1["target"];
    }>): Record<string, string> {
        const effectActionId = input.effectActionId ?? ACTION_ID;
        const request = authorizationRequests.get(input.authorizationToken);
        const target = input.target ?? request?.target;
        if (!target) throw new Error("test machine request requires a target");
        if (!request) throw new Error("test machine request requires authorization identity");
        return {
            // The production CLI declares its current stored-content reader on every
            // Session request. Without this declaration the server correctly projects
            // the legacy-compatible corpus and omits current metadata-layout rows.
            ...currentAccountStoredContentCompatibilityHeaders,
            [EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER]: input.authorizationToken,
            [EXTERNAL_ACTION_EFFECT_ACTION_HEADER]: effectActionId,
            [EXTERNAL_ACTION_RESOLVED_TARGET_HEADER]: encodeExternalActionResolvedTargetV1(target),
            [EXTERNAL_ACTION_MACHINE_SIGNATURE_HEADER]: signExternalActionMachineRequestV1({
                ...input,
                effectActionId,
                target,
                installationId: request.installationId,
                requestId: request.requestId,
            }),
        };
    }

    it.each([
        {
            actionId: "identity.providers.test.start",
            body: {
                owner: { kind: "home" },
                id: "missing-provider",
                expectedRevision: 1,
                expectedSecurityRevision: 1,
            },
            expectedStatus: 403,
            expectedDomainError: "identity_provider_forbidden",
        },
        {
            actionId: "teams.identity.connections.test.start",
            body: {
                v: 1,
                teamId: "team_missing",
                connectionId: "missing-connection",
                expectedRevision: 1,
            },
            expectedStatus: 404,
            expectedDomainError: "team_not_found",
        },
    ] as const)(
        "admits signed external PAT execution for Lane 03 action $actionId only as far as domain authorization",
        async ({ actionId, body, expectedStatus, expectedDomainError }) => {
            const fixture = await createFixture({ qualifiedPat: false });
            const { app } = await createRealLane03App();
            try {
                const envelope = ExternalActionRequestEnvelopeV1Schema.parse({
                    v: 1,
                    requestId: crypto.randomUUID(),
                    target: { kind: "machine", machineId: fixture.machine.id },
                    input: body,
                });
                const authorization = await mint(app, fixture, actionId, envelope);
                const transport = getActionSpec(actionId).serverTransport;
                if (!transport) throw new Error(`test Action ${actionId} has no server transport`);
                const response = await app.inject({
                    method: transport.method,
                    url: transport.path,
                    headers: machineHeaders({
                        authorizationToken: authorization.token,
                        target: authorization.binding.target,
                        effectActionId: actionId,
                        method: transport.method,
                        path: transport.path,
                        body,
                        privateKey: fixture.keyPair.secretKey,
                    }),
                    payload: body,
                });

                expect(response.json()).toEqual({ error: expectedDomainError });
                expect(response.statusCode).toBe(expectedStatus);
            } finally {
                await app.close();
            }
        },
    );

    it("keeps Lane 03 external Action admission at the canonical proof owner without route-local Action lists", async () => {
        const { app, duplicateExternalActionAdmissionRoutes } = await createRealLane03App();
        try {
            expect(duplicateExternalActionAdmissionRoutes).toEqual([]);
        } finally {
            await app.close();
        }
    });

    it("reconstructs the current PAT for one exact signed cross-Machine RPC and rejects substitution", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const method = `${fixture.machine.id}:daemon.mergedContributionRegistry.projection.describe`;
            const requestId = crypto.randomUUID();
            const params = { machineId: fixture.machine.id };
            const execution = {
                v: 1 as const,
                authorization,
                effectActionId: ACTION_ID,
                target: authorization.binding.target,
                installationId: fixture.machine.installationId!,
                machineSignature: signExternalActionMachineRpcRequestV1({
                    authorizationToken: authorization.token,
                    effectActionId: ACTION_ID,
                    target: authorization.binding.target,
                    installationId: fixture.machine.installationId!,
                    event: SOCKET_RPC_EVENTS.CALL,
                    method,
                    requestId,
                    params,
                    privateKey: fixture.keyPair.secretKey,
                }),
            };

            const verified = await verifyExternalActionMachineRpcExecution(execution, { method, requestId, params });
            expect(verified?.principal).toMatchObject({
                accountId: fixture.account.id,
                credentialId: fixture.pat.tokenId,
                authority: "account_automation",
            });
            for (const bindingPatch of [
                { accountId: "account-substituted" },
                { principalId: "principal-substituted" },
                { credentialId: "credential-substituted" },
                { actionId: "teams.list" },
                { requestId: "request-substituted" },
                { requestEnvelopeDigest: "digest-substituted" },
                { target: { kind: "machine" as const, machineId: "target-machine-substituted" } },
            ]) {
                await expect(verifyExternalActionMachineRpcExecution({
                    ...execution,
                    authorization: {
                        ...execution.authorization,
                        binding: {
                            ...execution.authorization.binding,
                            ...bindingPatch,
                        },
                    },
                }, { method, requestId, params })).resolves.toBeNull();
            }
            await expect(verifyExternalActionMachineRpcExecution({
                ...execution,
                effectActionId: "teams.list",
            }, { method, requestId, params })).resolves.toBeNull();
            await expect(verifyExternalActionMachineRpcExecution({
                ...execution,
                authorization: {
                    ...execution.authorization,
                    binding: {
                        ...execution.authorization.binding,
                        serverIdentityId: "srv_substituted_home",
                    },
                },
            }, { method, requestId, params })).resolves.toBeNull();
            await expect(verifyExternalActionMachineRpcExecution(execution, {
                method,
                requestId,
                params: { machineId: "substituted" },
            })).resolves.toBeNull();
            const otherMachineMethod = `other-machine:daemon.mergedContributionRegistry.projection.describe`;
            const otherMachineExecution = {
                ...execution,
                machineSignature: signExternalActionMachineRpcRequestV1({
                    authorizationToken: authorization.token,
                    effectActionId: ACTION_ID,
                    target: authorization.binding.target,
                    installationId: fixture.machine.installationId!,
                    event: SOCKET_RPC_EVENTS.CALL,
                    method: otherMachineMethod,
                    requestId,
                    params,
                    privateKey: fixture.keyPair.secretKey,
                }),
            };
            await expect(verifyExternalActionMachineRpcExecution(otherMachineExecution, {
                method: otherMachineMethod,
                requestId,
                params,
            })).resolves.toMatchObject({
                principal: {
                    accountId: fixture.account.id,
                    credentialId: fixture.pat.tokenId,
                    authority: "account_automation",
                },
            });
            await expect(verifyExternalActionMachineRpcExecution({
                ...otherMachineExecution,
                authorization: {
                    ...otherMachineExecution.authorization,
                    binding: {
                        ...otherMachineExecution.authorization.binding,
                        machineId: "substituted-relay-machine",
                    },
                },
            }, {
                method: otherMachineMethod,
                requestId,
                params,
            })).resolves.toBeNull();
            await expect(verifyExternalActionMachineRpcExecution(otherMachineExecution, {
                method: `${otherMachineMethod}.substituted`,
                requestId,
                params,
            })).resolves.toBeNull();
        } finally {
            await app.close();
        }
    });

    it("uses the originating PAT evidence rather than daemon ambient qualification", async () => {
        const qualified = await createFixture({ qualifiedPat: true });
        const qualifiedRoute = await createApp(qualified.team.id);
        try {
            const authorization = await mint(qualifiedRoute.app, qualified);
            const body = { teamId: qualified.team.id };
            const response = await qualifiedRoute.app.inject({
                method: qualifiedRoute.transport.method,
                url: qualifiedRoute.transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: qualifiedRoute.transport.method,
                    path: qualifiedRoute.transport.path,
                    body,
                    privateKey: qualified.keyPair.secretKey,
                }),
                payload: body,
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                qualification: "satisfied",
                rootActionId: ACTION_ID,
                effectActionId: ACTION_ID,
                target: authorization.binding.target,
                principal: {
                    accountId: qualified.account.id,
                    principalId: qualified.account.id,
                    credentialId: qualified.pat.tokenId,
                    authority: "account_automation",
                    authenticationEvidence: [{ kind: "home_method", methodId: "email_password" }],
                },
            });
        } finally {
            await qualifiedRoute.app.close();
        }

        const unqualified = await createFixture({ qualifiedPat: false });
        const unqualifiedRoute = await createApp(unqualified.team.id);
        try {
            const authorization = await mint(unqualifiedRoute.app, unqualified);
            const body = { teamId: unqualified.team.id };
            const response = await unqualifiedRoute.app.inject({
                method: unqualifiedRoute.transport.method,
                url: unqualifiedRoute.transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: unqualifiedRoute.transport.method,
                    path: unqualifiedRoute.transport.path,
                    body,
                    privateKey: unqualified.keyPair.secretKey,
                }),
                payload: body,
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({ qualification: "authentication_required" });
        } finally {
            await unqualifiedRoute.app.close();
        }
    });

    it("revalidates current Home login eligibility before accepting a signed PAT effect", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app, transport } = await createApp(fixture.team.id);
        const previous = process.env.AUTH_REQUIRED_LOGIN_PROVIDERS;
        try {
            const authorization = await mint(app, fixture);
            process.env.AUTH_REQUIRED_LOGIN_PROVIDERS = "not-configured";
            const body = { teamId: fixture.team.id };
            const response = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: transport.method,
                    path: transport.path,
                    body,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: body,
            });
            expect(response.statusCode).toBe(401);
        } finally {
            if (previous === undefined) delete process.env.AUTH_REQUIRED_LOGIN_PROVIDERS;
            else process.env.AUTH_REQUIRED_LOGIN_PROVIDERS = previous;
            await app.close();
        }
    });

    it("binds the proof to the exact body, route, Machine, current PAT, and current evidence row", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app, transport } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const body = { teamId: fixture.team.id };
            const validHeaders = machineHeaders({
                authorizationToken: authorization.token,
                target: authorization.binding.target,
                method: transport.method,
                path: transport.path,
                body,
                privateKey: fixture.keyPair.secretKey,
            });

            const tamperedBody = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: validHeaders,
                payload: { teamId: "another-team" },
            });
            expect(tamperedBody.statusCode).toBe(401);

            const wrongRoute = await app.inject({
                method: "POST",
                url: bindExternalActionExecutionAuthorizationVerifyHttpPathV1("teams.list"),
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: "POST",
                    path: bindExternalActionExecutionAuthorizationVerifyHttpPathV1("teams.list"),
                    body: { v: 1 },
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: { v: 1 },
            });
            expect(wrongRoute.statusCode).toBe(401);

            const otherKey = tweetnacl.sign.keyPair();
            await db.machine.create({
                data: {
                    id: crypto.randomUUID(),
                    accountId: fixture.account.id,
                    metadata: "substitute",
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                    installationId: crypto.randomUUID(),
                    installationPublicKey: new Uint8Array(otherKey.publicKey),
                },
            });
            const wrongMachine = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: transport.method,
                    path: transport.path,
                    body,
                    privateKey: otherKey.secretKey,
                }),
                payload: body,
            });
            expect(wrongMachine.statusCode).toBe(401);

            const originalInstallationId = fixture.machine.installationId!;
            await db.machine.update({
                where: { id: fixture.machine.id },
                data: { installationId: crypto.randomUUID() },
            });
            const replacedInstallation = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: validHeaders,
                payload: body,
            });
            expect(replacedInstallation.statusCode).toBe(401);
            await db.machine.update({
                where: { id: fixture.machine.id },
                data: { installationId: originalInstallationId },
            });

            await db.accountApiToken.update({
                where: { id: fixture.pat.tokenId },
                data: { authenticationEvidence: { v: 1, evidence: [] } },
            });
            const evidenceChanged = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: validHeaders,
                payload: body,
            });
            expect(evidenceChanged.statusCode).toBe(200);
            expect(evidenceChanged.json()).toMatchObject({ qualification: "authentication_required" });

            await auth.revokeApiToken({ accountId: fixture.account.id, tokenId: fixture.pat.tokenId });
            const revoked = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: validHeaders,
                payload: body,
            });
            expect(revoked.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("keeps the authorization useless without the exact registered Machine signature and preserves allowed bearer admission", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app, transport } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const body = { teamId: fixture.team.id };

            const tokenOnly = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: { [EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER]: authorization.token },
                payload: body,
            });
            expect(tokenOnly.statusCode).toBe(401);

            const rawPat = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: { authorization: `Bearer ${fixture.pat.token}` },
                payload: body,
            });
            expect(rawPat.statusCode).toBe(200);

            const accountToken = await auth.createToken(fixture.account.id, undefined, {
                kind: "account",
                authority: "present_user",
            });
            const ordinary = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: { authorization: `Bearer ${accountToken}` },
                payload: body,
            });
            expect(ordinary.statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it("admits a signed auxiliary production read without treating Action serverTransport as a route allowlist", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const path = "/v1/features/authenticated";
            const response = await app.inject({
                method: "GET",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: "GET",
                    path,
                    body: undefined,
                    privateKey: fixture.keyPair.secretKey,
                }),
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({ capabilities: { serverIdentity: {} } });
        } finally {
            await app.close();
        }
    });

    it("admits the real Follow source-list handler from the exact signed PAT invocation without a duplicate route allowlist", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const destination = await db.session.create({
            data: {
                tag: `external-follow-destination-${crypto.randomUUID()}`,
                accountId: fixture.account.id,
                encryptionMode: "plain",
                metadataLayoutVersion: 1,
                metadata: JSON.stringify({ v: 1 }),
                ownerMetadata: JSON.stringify({ t: "plain", v: { v: 1 } }),
                agentState: null,
            },
        });
        const { app } = await createApp(fixture.team.id);
        try {
            const actionId = "session.follow.sources.list";
            const envelope: ExternalActionRequestEnvelopeV1 = {
                v: 1,
                requestId: crypto.randomUUID(),
                target: { kind: "machine", machineId: fixture.machine.id },
                input: { destinationSessionId: destination.id },
            };
            const authorization = await mint(app, fixture, actionId, envelope);
            const path = `/v2/sessions/${destination.id}/follows/sessions`;
            const response = await app.inject({
                method: "GET",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    effectActionId: actionId,
                    method: "GET",
                    path,
                    body: undefined,
                    privateKey: fixture.keyPair.secretKey,
                }),
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ sources: [] });
        } finally {
            await app.close();
        }
    });

    it("admits the proof-bound PAT through normal handlers while handler-specific effect, target, resource, and revocation checks stay closed", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const now = Date.now();
        const [activeSession, archivedSession] = await Promise.all([
            db.session.create({
                data: {
                    tag: `external-list-active-${crypto.randomUUID()}`,
                    accountId: fixture.account.id,
                    encryptionMode: "plain",
                    metadataLayoutVersion: 1,
                    metadata: JSON.stringify({ v: 1 }),
                    ownerMetadata: JSON.stringify({ t: "plain", v: { v: 1 } }),
                    agentState: null,
                    active: true,
                    lastActiveAt: new Date(now),
                    meaningfulActivityAt: new Date(now),
                    currentStorageState: "hosted",
                },
            }),
            db.session.create({
                data: {
                    tag: `external-list-archived-${crypto.randomUUID()}`,
                    accountId: fixture.account.id,
                    encryptionMode: "plain",
                    metadataLayoutVersion: 1,
                    metadata: JSON.stringify({ v: 1 }),
                    ownerMetadata: JSON.stringify({ t: "plain", v: { v: 1 } }),
                    agentState: null,
                    active: false,
                    archivedAt: new Date(now - 1_000),
                    meaningfulActivityAt: new Date(now - 1_000),
                },
            }),
        ]);
        const foreignAccount = await db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" },
        });
        const foreignSession = await db.session.create({
            data: {
                tag: `external-list-foreign-${crypto.randomUUID()}`,
                accountId: foreignAccount.id,
                encryptionMode: "plain",
                metadataLayoutVersion: 1,
                metadata: JSON.stringify({ v: 1 }),
                ownerMetadata: JSON.stringify({ t: "plain", v: { v: 1 } }),
                agentState: null,
            },
        });
        await db.sessionMessage.create({
            data: {
                sessionId: activeSession.id,
                localId: `external-list-preview-${crypto.randomUUID()}`,
                seq: 1,
                messageRole: "user",
                content: {
                    t: "plain",
                    v: {
                        role: "user",
                        content: { type: "text", text: "signed session.list preview" },
                    },
                },
                inputAdmissionReceipt: {
                    v: 1,
                    issuer: "authenticatedAccount",
                    actorAccountId: fixture.account.id,
                    sessionRelationship: "owner",
                },
            },
        });
        const { app } = await createApp(fixture.team.id);
        try {
            const envelope: ExternalActionRequestEnvelopeV1 = {
                v: 1,
                requestId: crypto.randomUUID(),
                target: { kind: "machine", machineId: fixture.machine.id },
                input: {},
            };
            const authorization = await mint(app, fixture, "session.list", envelope);
            const signedGet = (
                path: string,
                effectActionId = "session.list",
                target: ExternalActionRequestEnvelopeV1["target"] = authorization.binding.target,
            ) => app.inject({
                method: "GET",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target,
                    effectActionId,
                    method: "GET",
                    path,
                    body: undefined,
                    privateKey: fixture.keyPair.secretKey,
                }),
            });
            const signedPost = (
                path: string,
                body: unknown,
                effectActionId = "session.list",
            ) => app.inject({
                method: "POST",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    effectActionId,
                    method: "POST",
                    path,
                    body,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: body,
            });
            const previewPath = `/v1/sessions/${activeSession.id}/messages?limit=1&scope=main&roles=user%2Cagent`;
            const filteredPath = "/v2/sessions/query";
            const filteredBody = {
                v: 1,
                storage: "active",
                includeInactive: true,
                scope: "all_accessible",
                attention: "any",
                audiences: [],
                tagIds: [],
            } as const;
            const [legacyListed, listed, active, archived, detail, filtered, currentness, previewMessages] = await Promise.all([
                signedGet("/v1/sessions"),
                signedGet("/v2/sessions?limit=10"),
                signedGet("/v2/sessions/active?limit=10"),
                signedGet("/v2/sessions/archived?limit=10"),
                signedGet(`/v2/sessions/${activeSession.id}`),
                signedPost(filteredPath, filteredBody),
                signedGet("/v1/account/encryption/currentness"),
                signedGet(previewPath),
            ]);
            expect(legacyListed.statusCode).toBe(200);
            expect(legacyListed.json().sessions.map((session: { id: string }) => session.id))
                .toContain(activeSession.id);
            expect(listed.statusCode).toBe(200);
            expect(listed.json().sessions.map((session: { id: string }) => session.id))
                .toContain(activeSession.id);
            expect(active.statusCode).toBe(200);
            expect(active.json().sessions.map((session: { id: string }) => session.id))
                .toEqual([activeSession.id]);
            expect(archived.statusCode).toBe(200);
            expect(archived.json().sessions.map((session: { id: string }) => session.id))
                .toEqual([archivedSession.id]);
            expect(detail.statusCode).toBe(200);
            expect(detail.json()).toMatchObject({ session: { id: activeSession.id } });
            expect(filtered.statusCode).toBe(200);
            expect(filtered.json().sessions.map((session: { id: string }) => session.id))
                .toContain(activeSession.id);
            expect(currentness.statusCode).toBe(200);
            expect(currentness.json()).toMatchObject({ mode: "plain" });
            expect(previewMessages.statusCode).toBe(200);
            expect(previewMessages.json()).toEqual({
                messages: [{
                    id: expect.any(String),
                    seq: 1,
                    localId: expect.any(String),
                    messageRole: "user",
                    content: {
                        t: "plain",
                        v: {
                            role: "user",
                            content: { type: "text", text: "signed session.list preview" },
                        },
                    },
                    createdAt: expect.any(Number),
                    updatedAt: expect.any(Number),
                }],
                hasMore: false,
                nextBeforeSeq: null,
                nextAfterSeq: null,
            });

            for (const path of [
                "/v1/sessions",
                "/v2/sessions?limit=10",
                "/v2/sessions/active?limit=10",
                "/v2/sessions/archived?limit=10",
                `/v2/sessions/${activeSession.id}`,
                "/v1/account/encryption/currentness",
                previewPath,
            ]) {
                const raw = await app.inject({
                    method: "GET",
                    url: path,
                    headers: { authorization: `Bearer ${fixture.pat.token}` },
                });
                expect(raw.statusCode, path).toBe(403);
                expect(raw.json(), path).toEqual({ error: "present_user_required" });
            }
            const rawFiltered = await app.inject({
                method: "POST",
                url: filteredPath,
                headers: { authorization: `Bearer ${fixture.pat.token}` },
                payload: filteredBody,
            });
            expect(rawFiltered.statusCode).toBe(403);
            const [
                accountSettings,
                accountEncryption,
                alternateEffectListing,
                alternateEffectPreview,
                previewSidechainTraversal,
                previewCursorTraversal,
                previewOversizedRead,
                previewNarrowedRole,
                previewOutsideSessionTarget,
                inaccessibleSessionPreview,
                alternateEffectFiltered,
            ] = await Promise.all([
                signedGet("/v2/account/settings"),
                signedGet("/v1/account/encryption"),
                signedGet("/v2/sessions?limit=10", ACTION_ID),
                signedGet(previewPath, ACTION_ID),
                signedGet(`/v1/sessions/${activeSession.id}/messages?limit=1&scope=all&roles=user%2Cagent`),
                signedGet(`/v1/sessions/${activeSession.id}/messages?limit=1&afterSeq=0&scope=main&roles=user%2Cagent`),
                signedGet(`/v1/sessions/${activeSession.id}/messages?limit=2&scope=main&roles=user%2Cagent`),
                signedGet(`/v1/sessions/${activeSession.id}/messages?limit=1&scope=main&roles=user`),
                signedGet(previewPath, "session.list", { kind: "session", sessionId: archivedSession.id }),
                signedGet(`/v1/sessions/${foreignSession.id}/messages?limit=1&scope=main&roles=user%2Cagent`),
                signedPost(filteredPath, filteredBody, ACTION_ID),
            ]);
            expect(accountSettings.statusCode).toBe(200);
            expect(accountEncryption.statusCode).toBe(200);
            expect(alternateEffectListing.statusCode).toBe(200);
            expect(alternateEffectPreview.statusCode).toBe(200);
            expect(previewSidechainTraversal.statusCode).toBe(403);
            expect(previewCursorTraversal.statusCode).toBe(403);
            expect(previewOversizedRead.statusCode).toBe(403);
            expect(previewNarrowedRole.statusCode).toBe(403);
            expect(previewOutsideSessionTarget.statusCode).toBe(403);
            expect(inaccessibleSessionPreview.statusCode).toBe(404);
            expect(alternateEffectFiltered.statusCode).toBe(200);

            await auth.revokeApiToken({
                accountId: fixture.account.id,
                tokenId: fixture.pat.tokenId,
            });
            expect((await signedGet("/v2/sessions?limit=10")).statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("preserves explicit present-user domain admission after reconstructing the originating PAT", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const path = "/test/present-user-only";
            const body = { operation: "interactive-only" };
            const response = await app.inject({
                method: "POST",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: "POST",
                    path,
                    body,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: body,
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({ error: "present_user_required" });
        } finally {
            await app.close();
        }
    });

    it("lets the ordinary Session handler deny a signed resolved target the originating PAT cannot read", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const foreignAccount = await db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" },
        });
        const foreignSession = await db.session.create({
            data: {
                tag: crypto.randomUUID(),
                accountId: foreignAccount.id,
                encryptionMode: "plain",
                metadata: "foreign",
                metadataVersion: 1,
            },
        });
        const { app } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const path = `/v2/sessions/${foreignSession.id}`;
            const target = { kind: "session" as const, sessionId: foreignSession.id };
            const response = await app.inject({
                method: "GET",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target,
                    method: "GET",
                    path,
                    body: undefined,
                    privateKey: fixture.keyPair.secretKey,
                }),
            });

            expect(response.statusCode).toBe(404);
        } finally {
            await app.close();
        }
    });

    it("rechecks the same authorization and Machine at the signed currentness endpoint", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        try {
            const authorization = await mint(app, fixture);
            const path = bindExternalActionExecutionAuthorizationVerifyHttpPathV1(ACTION_ID);
            const body = { v: 1 } as const;
            const unsigned = await app.inject({ method: "POST", url: path, payload: body });
            expect(unsigned.statusCode).toBe(401);
            const headers = machineHeaders({
                authorizationToken: authorization.token,
                target: authorization.binding.target,
                method: "POST",
                path,
                body,
                privateKey: fixture.keyPair.secretKey,
            });
            const current = await app.inject({ method: "POST", url: path, headers, payload: body });
            expect(current.statusCode).toBe(200);
            expect(current.json()).toEqual({ ok: true });

            const queryPath = `${path}?bypass=1`;
            const queryBypass = await app.inject({
                method: "POST",
                url: queryPath,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: "POST",
                    path: queryPath,
                    body,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: body,
            });
            expect(queryBypass.statusCode).toBe(401);

            const invalidBody = { v: 1, unexpected: true };
            const invalid = await app.inject({
                method: "POST",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: "POST",
                    path,
                    body: invalidBody,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: invalidBody,
            });
            expect(invalid.statusCode).toBe(400);

            await db.machine.update({ where: { id: fixture.machine.id }, data: { revokedAt: new Date() } });
            const revokedMachine = await app.inject({ method: "POST", url: path, headers, payload: body });
            expect(revokedMachine.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("binds a V1 invocation without optional correlation or target to the selected Machine", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        const envelope = { v: 1 as const, input: { teamId: fixture.team.id } };
        try {
            const response = await app.inject({
                method: "POST",
                url: bindExternalActionExecutionAuthorizationHttpPathV1(ACTION_ID),
                headers: { authorization: `Bearer ${fixture.pat.token}` },
                payload: { v: 1, machineId: fixture.machine.id, envelope },
            });
            expect(response.statusCode).toBe(200);
            const authorization = ExternalActionExecutionAuthorizationV1Schema.parse(response.json());
            authorizationRequests.set(authorization.token, {
                target: authorization.binding.target,
                installationId: fixture.machine.installationId!,
                requestId: authorization.binding.requestId,
            });
            expect(authorization.binding).toMatchObject({
                machineId: fixture.machine.id,
                target: { kind: "machine", machineId: fixture.machine.id },
                requestEnvelopeDigest: computeExternalActionRequestEnvelopeDigestV1(envelope),
            });
            expect(authorization.binding.requestId.length).toBeGreaterThan(0);
        } finally {
            await app.close();
        }
    });

    it.each(["approval.request.create", "action.invoke", "acme.workflow/actions/update-team"] as const)(
        "allows the trusted Machine to bind a resolved effect for outer %s",
        async (outerActionId) => {
            const fixture = await createFixture({ qualifiedPat: true });
            const { app, transport } = await createApp(fixture.team.id);
            try {
                const response = await app.inject({
                    method: "POST",
                    url: bindExternalActionExecutionAuthorizationHttpPathV1(outerActionId),
                    headers: { authorization: `Bearer ${fixture.pat.token}` },
                    payload: { v: 1, machineId: fixture.machine.id, envelope: fixture.envelope },
                });
                expect(response.statusCode).toBe(200);
                const authorization = ExternalActionExecutionAuthorizationV1Schema.parse(response.json());
                authorizationRequests.set(authorization.token, {
                    target: authorization.binding.target,
                    installationId: fixture.machine.installationId!,
                    requestId: authorization.binding.requestId,
                });
                expect(authorization.binding.actionId).toBe(outerActionId);

                const body = { teamId: fixture.team.id };
                const effect = await app.inject({
                    method: transport.method,
                    url: transport.path,
                    headers: machineHeaders({
                        authorizationToken: authorization.token,
                        target: authorization.binding.target,
                        effectActionId: ACTION_ID,
                        method: transport.method,
                        path: transport.path,
                        body,
                        privateKey: fixture.keyPair.secretKey,
                    }),
                    payload: body,
                });
                expect(effect.statusCode).toBe(200);
                expect(effect.json()).toMatchObject({ qualification: "satisfied" });
            } finally {
                await app.close();
            }
        },
    );

    it("does not let an invocation wrapper authorize a present-user-only Discussion mutation", async () => {
        const fixture = await createFixture({ qualifiedPat: true });
        const { app } = await createApp(fixture.team.id);
        try {
            const response = await app.inject({
                method: "POST",
                url: bindExternalActionExecutionAuthorizationHttpPathV1("action.invoke"),
                headers: { authorization: `Bearer ${fixture.pat.token}` },
                payload: { v: 1, machineId: fixture.machine.id, envelope: fixture.envelope },
            });
            expect(response.statusCode).toBe(200);
            const authorization = ExternalActionExecutionAuthorizationV1Schema.parse(response.json());
            authorizationRequests.set(authorization.token, {
                target: authorization.binding.target,
                installationId: fixture.machine.installationId!,
                requestId: authorization.binding.requestId,
            });
            const path = "/v1/sessions/session-1/discussions";
            const body = {
                sessionId: "session-1",
                title: "Private discussion",
                firstMessage: { content: "must remain present-user-only" },
            };
            const effect = await app.inject({
                method: "POST",
                url: path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    effectActionId: "session.discussion.create",
                    method: "POST",
                    path,
                    body,
                    privateKey: fixture.keyPair.secretKey,
                }),
                payload: body,
            });
            expect(effect.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("admits the qualified PAT through the real Team policy mutation and persists its result", async () => {
        const qualified = await createFixture({ qualifiedPat: true });
        const app = await createRealTeamApp();
        try {
            const authorization = await mint(app, qualified);
            const transport = getActionSpec(ACTION_ID).serverTransport;
            if (!transport) throw new Error("test Action has no server transport");
            const body = {
                v: 1 as const,
                teamId: qualified.team.id,
                previousAuthenticationPolicy: qualified.team.authenticationPolicy,
                authenticationPolicy: { v: 1 as const, mode: "inherit" as const },
            };
            const response = await app.inject({
                method: transport.method,
                url: transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: transport.method,
                    path: transport.path,
                    body,
                    privateKey: qualified.keyPair.secretKey,
                }),
                payload: body,
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().policy.authenticationPolicy).toBeNull();
            expect((await db.team.findUniqueOrThrow({ where: { id: qualified.team.id } })).authenticationPolicy)
                .toBeNull();
        } finally {
            await app.close();
        }

        const unqualified = await createFixture({ qualifiedPat: false });
        const unqualifiedApp = await createRealTeamApp();
        try {
            const authorization = await mint(unqualifiedApp, unqualified);
            const transport = getActionSpec(ACTION_ID).serverTransport;
            if (!transport) throw new Error("test Action has no server transport");
            const body = {
                v: 1 as const,
                teamId: unqualified.team.id,
                previousAuthenticationPolicy: unqualified.team.authenticationPolicy,
                authenticationPolicy: { v: 1 as const, mode: "inherit" as const },
            };
            const response = await unqualifiedApp.inject({
                method: transport.method,
                url: transport.path,
                headers: machineHeaders({
                    authorizationToken: authorization.token,
                    target: authorization.binding.target,
                    method: transport.method,
                    path: transport.path,
                    body,
                    privateKey: unqualified.keyPair.secretKey,
                }),
                payload: body,
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({ error: "team_authentication_required" });
            expect((await db.team.findUniqueOrThrow({ where: { id: unqualified.team.id } })).authenticationPolicy)
                .toEqual(unqualified.team.authenticationPolicy);
        } finally {
            await unqualifiedApp.close();
        }
    });
});
