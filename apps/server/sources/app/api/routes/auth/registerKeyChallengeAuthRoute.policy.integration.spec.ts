import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";

import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    registerKeyChallengeAuthRoute,
    resolveStableKeyChallengeV2AudienceOrigin,
} from "./registerKeyChallengeAuthRoute";

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    return app.withTypeProvider<ZodTypeProvider>() as any;
}

describe("key-challenge v2 policy and stable audience (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-key-challenge-policy-",
            initAuth: false,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
                HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
                HAPPIER_SERVER_IDENTITY_ID: "stable-policy-server",
            },
        });
    }, 120_000);

    afterEach(() => {
        harness.resetEnv({
            HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
            HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
            HAPPIER_SERVER_IDENTITY_ID: "stable-policy-server",
        });
    });

    afterAll(async () => {
        await harness.close();
    });

    it("preserves ordinary Home v1 when its compatibility switch is disabled", async () => {
        const signing = tweetnacl.sign.keyPair();
        const challenge = new Uint8Array(32).fill(7);
        const signature = tweetnacl.sign.detached(challenge, signing.secretKey);
        const payload = {
            publicKey: privacyKit.encodeBase64(new Uint8Array(signing.publicKey)),
            challenge: privacyKit.encodeBase64(challenge),
            signature: privacyKit.encodeBase64(new Uint8Array(signature)),
        };

        const ordinaryApp = createTestApp();
        registerKeyChallengeAuthRoute(ordinaryApp);
        await ordinaryApp.ready();
        const ordinaryResponse = await ordinaryApp.inject({
            method: "POST",
            url: "/v1/auth",
            payload,
        });
        expect(ordinaryResponse.statusCode, ordinaryResponse.body).toBe(200);
        expect(ordinaryResponse.json()).toMatchObject({ success: true });
        await ordinaryApp.close();
    });

    it("ignores runtime/public URL candidates when resolving the stable audience", () => {
        const env = {
            HAPPIER_CANONICAL_SERVER_URL: "https://stable.example.test/base",
            HAPPIER_PUBLIC_SERVER_URL: "https://public.example.test/edge",
            HAPPIER_RUNTIME_ORIGIN: "http://127.0.0.1:44001",
        } as NodeJS.ProcessEnv;
        expect(resolveStableKeyChallengeV2AudienceOrigin(env)).toBe("https://stable.example.test");
    });
});
