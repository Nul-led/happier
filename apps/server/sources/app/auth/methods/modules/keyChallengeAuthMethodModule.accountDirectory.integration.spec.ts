import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createKeyChallengeV2SigningInput, type KeyChallengeV2IssueResponse } from "@happier-dev/protocol";

import { auth } from "@/app/auth/auth";
import { type Fastify as TypedFastify } from "@/app/api/types";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { keyChallengeAuthMethodModule } from "./keyChallengeAuthMethodModule";

function createProductionRegisteredApp(): TypedFastify {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as TypedFastify;
    keyChallengeAuthMethodModule.registerRoutes(typed);
    return typed;
}

function encodeOwned(bytes: Uint8Array): string {
    return privacyKit.encodeBase64(new Uint8Array(bytes));
}

function createV1LoginPayload(signing: tweetnacl.SignKeyPair) {
    const challenge = new Uint8Array(32).fill(7);
    return {
        publicKey: encodeOwned(signing.publicKey),
        challenge: encodeOwned(challenge),
        signature: encodeOwned(tweetnacl.sign.detached(challenge, signing.secretKey)),
    };
}

function createV2LoginPayload(
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

describe("keyChallengeAuthMethodModule Account Directory registration (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-key-account-directory-",
            initAuth: true,
            initEncrypt: false,
            initFiles: false,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2: "0",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
                HAPPIER_PUBLIC_SERVER_URL: "https://account-service.example.test",
                HAPPIER_SERVER_IDENTITY_ID: "srv_account_service_key",
            },
        });
    }, 120_000);

    afterEach(() => {
        harness.resetEnv({
            AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2: "0",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: "plain",
            HAPPIER_PUBLIC_SERVER_URL: "https://account-service.example.test",
            HAPPIER_SERVER_IDENTITY_ID: "srv_account_service_key",
        });
    });

    afterAll(async () => {
        await harness.close();
    });

    it("registers v2-only purpose-bound Directory key login without broadening ordinary Home tokens", async () => {
        const app = createProductionRegisteredApp();
        await app.ready();
        const signing = tweetnacl.sign.keyPair();

        const directoryV1 = await app.inject({
            method: "POST",
            url: "/v1/auth/account-directory",
            payload: createV1LoginPayload(signing),
        });
        expect(directoryV1.statusCode).toBe(426);
        expect(directoryV1.json()).toEqual({ error: "key_challenge_v2_required" });

        const ordinaryV1 = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: createV1LoginPayload(signing),
        });
        expect(ordinaryV1.statusCode).toBe(200);
        await expect(auth.verifyToken(ordinaryV1.json().token)).resolves.toMatchObject({
            authTokenKind: "account",
            authority: "present_user",
        });

        const [ordinaryIssue, directoryIssue] = await Promise.all([
            app.inject({ method: "POST", url: "/v1/auth/challenge", payload: {} }),
            app.inject({ method: "POST", url: "/v1/auth/account-directory/challenge", payload: {} }),
        ]);
        expect(ordinaryIssue.statusCode).toBe(200);
        expect(directoryIssue.statusCode).toBe(200);
        const ordinaryChallenge = ordinaryIssue.json() as KeyChallengeV2IssueResponse;
        const directoryChallenge = directoryIssue.json() as KeyChallengeV2IssueResponse;
        expect(ordinaryChallenge.challengeId).not.toMatch(/^account_directory:/);
        expect(directoryChallenge.challengeId).toMatch(/^account_directory:/);

        const [ordinaryRejectsDirectory, directoryRejectsOrdinary] = await Promise.all([
            app.inject({
                method: "POST",
                url: "/v1/auth",
                payload: createV2LoginPayload(signing, directoryChallenge),
            }),
            app.inject({
                method: "POST",
                url: "/v1/auth/account-directory",
                payload: createV2LoginPayload(signing, ordinaryChallenge),
            }),
        ]);
        expect(ordinaryRejectsDirectory.statusCode).toBe(401);
        expect(directoryRejectsOrdinary.statusCode).toBe(401);

        const [ordinaryLogin, directoryLogin] = await Promise.all([
            app.inject({
                method: "POST",
                url: "/v1/auth",
                payload: createV2LoginPayload(signing, ordinaryChallenge),
            }),
            app.inject({
                method: "POST",
                url: "/v1/auth/account-directory",
                payload: createV2LoginPayload(signing, directoryChallenge),
            }),
        ]);
        expect(ordinaryLogin.statusCode).toBe(200);
        expect(directoryLogin.statusCode).toBe(200);
        await expect(auth.verifyToken(ordinaryLogin.json().token)).resolves.toMatchObject({
            authTokenKind: "account",
            authority: "present_user",
        });
        await expect(auth.verifyToken(directoryLogin.json().token)).resolves.toMatchObject({
            authTokenKind: "account_directory",
            authority: "present_user",
        });
        const directoryReplay = await app.inject({
            method: "POST",
            url: "/v1/auth/account-directory",
            payload: createV2LoginPayload(signing, directoryChallenge),
        });
        expect(directoryReplay.statusCode).toBe(401);

        await app.close();
    });
});
