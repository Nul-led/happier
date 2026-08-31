import Fastify from "fastify";
import { createHash } from "node:crypto";
import {
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from "fastify-type-provider-zod";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import {
    ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
    createKeyChallengeV2SigningInput,
    type KeyChallengeV2IssueResponse,
} from "@happier-dev/protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { auth } from "@/app/auth/auth";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import { db } from "@/storage/db";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";

import { registerApiRoutes } from "./api";
import type { Fastify as TypedFastify } from "./types";
import { enableAuthentication } from "./utils/enableAuthentication";
import { resolveApiRateLimitPluginOptions } from "./utils/apiRateLimitPolicy";

const DIRECTORY_PROOF = "directory-composition-proof";
const DIRECTORY_PROOF_HASH = createHash("sha256")
    .update(DIRECTORY_PROOF, "utf8")
    .digest("hex");
const SERVING_ENDPOINT_URL = "https://accounts-composition.example.test";

function encodeOwned(bytes: Uint8Array): string {
    return privacyKit.encodeBase64(new Uint8Array(bytes));
}

function createDirectoryKeyLoginPayload(
    signing: tweetnacl.SignKeyPair,
    challenge: KeyChallengeV2IssueResponse,
) {
    return {
        challengeId: challenge.challengeId,
        publicKey: encodeOwned(signing.publicKey),
        signature: encodeOwned(
            tweetnacl.sign.detached(
                createKeyChallengeV2SigningInput(challenge),
                signing.secretKey,
            ),
        ),
    };
}

function createProductionCompositionApp() {
    const app = Fastify({ logger: false });
    app.register(
        import("@fastify/rate-limit"),
        resolveApiRateLimitPluginOptions(process.env),
    );
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as TypedFastify;
    enableAuthentication(typed);
    registerApiRoutes(typed);
    return app;
}

describe("API auth-token composition (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-api-auth-composition-",
            initAuth: true,
            initEncrypt: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
                AUTH_LOGIN_ELIGIBILITY_ACCOUNT_SNAPSHOT_CACHE_TTL_MS: "0",
            },
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        vi.unstubAllGlobals();
        await db.repeatKey.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("admits a restricted Directory credential only through the production Directory registrations", async () => {
        const account = await db.account.create({
            data: { publicKey: "api-auth-composition-directory" },
            select: { id: true },
        });
        const [directoryToken, accountToken, terminalToken, apiToken] = await Promise.all([
            auth.createToken(account.id, undefined, {
                kind: "account_directory",
                authority: "present_user",
            }),
            auth.createToken(account.id, undefined, {
                kind: "account",
                authority: "present_user",
            }),
            auth.createToken(account.id, { session: "composition-terminal" }, {
                kind: "terminal",
                authority: "account_automation",
            }),
            auth.createApiToken({ accountId: account.id, label: "Composition PAT" }),
        ]);
        const app = createProductionCompositionApp();

        try {
            await app.ready();
            const directoryResponse = await app.inject({
                method: "GET",
                url: "/v1/account-directory/me",
                headers: { authorization: `Bearer ${directoryToken}` },
            });
            expect(directoryResponse.statusCode).toBe(200);
            expect(directoryResponse.json()).toMatchObject({
                v: 1,
                accountId: account.id,
            });
            const accountDirectoryResponse = await app.inject({
                method: "GET",
                url: "/v1/account-directory/me",
                headers: { authorization: `Bearer ${accountToken}` },
            });
            expect(accountDirectoryResponse.statusCode).toBe(200);

            for (const url of [
                "/v1/auth/ping",
                "/v1/machines",
                "/v1/sessions",
                "/v1/artifacts",
            ]) {
                const response = await app.inject({
                    method: "GET",
                    url,
                    headers: { authorization: `Bearer ${directoryToken}` },
                });
                expect(response.statusCode, url).toBe(403);
                expect(response.json(), url).toEqual({
                    error: "present_user_required",
                });
            }
            const apiTokenManagementResponse = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
                payload: {},
                headers: { authorization: `Bearer ${directoryToken}` },
            });
            expect(apiTokenManagementResponse.statusCode).toBe(403);
            expect(apiTokenManagementResponse.json()).toEqual({
                error: "present_user_required",
            });
            for (const restrictedToken of [terminalToken, apiToken.token]) {
                const response = await app.inject({
                    method: "GET",
                    url: "/v1/account-directory/me",
                    headers: { authorization: `Bearer ${restrictedToken}` },
                });
                expect(response.statusCode).toBe(403);
                expect(response.json()).toEqual({
                    error: "invalid_request",
                });
            }
        } finally {
            await app.close();
        }
    });

    it("acquires a restricted Directory credential through production OAuth and enforces production route admission", async () => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: SERVING_ENDPOINT_URL,
            GITHUB_CLIENT_ID: "gh_client",
            GITHUB_CLIENT_SECRET: "gh_secret",
            GITHUB_REDIRECT_URL: "https://api.example.test/v1/oauth/github/callback",
            HAPPIER_WEBAPP_URL: "https://app.example.test",
            AUTH_SIGNUP_PROVIDERS: "github",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: "1",
            HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: "github",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
        });
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("https://github.com/login/oauth/access_token")) {
                return new Response(JSON.stringify({ access_token: "tok_composition" }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            if (url.includes("https://api.github.com/user")) {
                return new Response(JSON.stringify({ id: 741, login: "composition-user" }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
            select: { id: true },
        });
        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: "github",
                providerUserId: "741",
                providerLogin: "composition-user",
            },
        });
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const app = createProductionCompositionApp();

        try {
            await app.ready();
            const params = new URLSearchParams({
                purpose: "account_directory",
                mode: "keyless",
                proofHash: DIRECTORY_PROOF_HASH,
                endpointUrl: SERVING_ENDPOINT_URL,
                endpointServerIdentityId: serverIdentityId,
            });
            const paramsResponse = await app.inject({
                method: "GET",
                url: `/v1/auth/external/github/params?${params.toString()}`,
            });
            expect(paramsResponse.statusCode).toBe(200);
            const paramsBody = paramsResponse.json() as {
                url: string;
                purpose: string;
                credentialTarget: string;
                endpointUrl: string;
                endpointServerIdentityId: string;
            };
            expect(paramsBody).toMatchObject({
                purpose: "account_directory",
                credentialTarget: "account_directory",
                endpointUrl: SERVING_ENDPOINT_URL,
                endpointServerIdentityId: serverIdentityId,
            });
            const authorizeUrl = paramsBody.url;
            const state = new URL(authorizeUrl).searchParams.get("state");
            expect(state).toBeTruthy();

            const callbackResponse = await app.inject({
                method: "GET",
                url: `/v1/oauth/github/callback?code=composition-code&state=${encodeURIComponent(state!)}`,
            });
            expect(callbackResponse.statusCode).toBe(302);
            const callbackRedirect = new URL(callbackResponse.headers.location!);
            expect(callbackRedirect.searchParams.get("purpose"))
                .toBe("account_directory");
            expect(callbackRedirect.searchParams.get("credentialTarget"))
                .toBe("account_directory");
            expect(callbackRedirect.searchParams.get("endpointUrl"))
                .toBe(SERVING_ENDPOINT_URL);
            expect(callbackRedirect.searchParams.get("endpointServerIdentityId"))
                .toBe(serverIdentityId);
            const pending = callbackRedirect.searchParams.get("pending");
            expect(pending).toMatch(/^oauth_pending_/);

            const finalizeResponse = await app.inject({
                method: "POST",
                url: "/v1/auth/external/github/finalize-keyless",
                headers: { "content-type": "application/json" },
                payload: { pending, proof: DIRECTORY_PROOF },
            });
            expect(finalizeResponse.statusCode).toBe(200);
            const { token } = finalizeResponse.json() as { token: string };

            expect(await auth.verifyToken(token)).toMatchObject({
                userId: account.id,
                authTokenKind: "account_directory",
                authority: "present_user",
            });

            const directoryResponse = await app.inject({
                method: "GET",
                url: "/v1/account-directory/me",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(directoryResponse.statusCode).toBe(200);
            expect(directoryResponse.json()).toMatchObject({
                v: 1,
                accountId: account.id,
            });

            const homeResponse = await app.inject({
                method: "GET",
                url: "/v1/auth/ping",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(homeResponse.statusCode).toBe(403);
            expect(homeResponse.json()).toEqual({
                error: "present_user_required",
            });
        } finally {
            await app.close();
        }
    });

    it("acquires a v2-only restricted Directory credential through production key routes and enforces production admission", async () => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: SERVING_ENDPOINT_URL,
            HAPPIER_SERVER_IDENTITY_ID: "srv_account_service_composition",
            HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2: "0",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
        });
        const app = createProductionCompositionApp();
        const signing = tweetnacl.sign.keyPair();

        try {
            await app.ready();
            const issueResponse = await app.inject({
                method: "POST",
                url: "/v1/auth/account-directory/challenge",
                payload: {},
            });
            expect(issueResponse.statusCode).toBe(200);
            const challenge = issueResponse.json() as KeyChallengeV2IssueResponse;
            expect(challenge.challengeId).toMatch(/^account_directory:/);

            const loginResponse = await app.inject({
                method: "POST",
                url: "/v1/auth/account-directory",
                payload: createDirectoryKeyLoginPayload(signing, challenge),
            });
            expect(loginResponse.statusCode).toBe(200);
            const { token } = loginResponse.json() as { token: string };
            expect(await auth.verifyToken(token)).toMatchObject({
                authTokenKind: "account_directory",
                authority: "present_user",
            });

            const directoryResponse = await app.inject({
                method: "GET",
                url: "/v1/account-directory/me",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(directoryResponse.statusCode).toBe(200);

            const homeResponse = await app.inject({
                method: "GET",
                url: "/v1/auth/ping",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(homeResponse.statusCode).toBe(403);
            expect(homeResponse.json()).toEqual({
                error: "present_user_required",
            });
        } finally {
            await app.close();
        }
    });
});
