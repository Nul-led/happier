import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    NATIVE_AUTH_EMAIL_VERIFY_PREVIEW_PATH_V1,
    NATIVE_AUTH_EMAIL_VERIFY_REQUEST_PATH_V1,
    NATIVE_AUTH_PASSWORD_RESET_PREVIEW_PATH_V1,
    NATIVE_AUTH_PASSWORD_RESET_REQUEST_PATH_V1,
    acceptPasswordTextV1,
} from "@happier-dev/protocol";

import type { AuthEmailDelivery, AuthEmailMessage } from "@/app/auth/email/authEmailDelivery";
import { hashPasswordMaterial } from "@/app/auth/password/passwordMaterialVerifier";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { resolveApiRateLimitPluginOptions } from "@/app/api/utils/apiRateLimitPolicy";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";
import type { Fastify as TypedFastify } from "./types";
import { registerApiRoutes } from "./api";

describe("native auth email production composition", () => {
    let harness: LightSqliteHarness;
    let messages: AuthEmailMessage[];

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-native-email-composer-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "true",
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: "true",
                HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
                HAPPIER_WEBAPP_URL: "https://app.example.test",
            },
        });
    }, 120_000);

    afterEach(async () => {
        messages = [];
        await db.repeatKey.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => { await harness.close(); });

    function app() {
        messages = [];
        const delivery: AuthEmailDelivery = {
            isReady: true,
            deliver: async (message) => {
                messages.push(message);
                return { status: "sent" };
            },
        };
        const server = Fastify({ logger: false });
        server.register(import("@fastify/rate-limit"), resolveApiRateLimitPluginOptions(process.env));
        server.setValidatorCompiler(validatorCompiler);
        server.setSerializerCompiler(serializerCompiler);
        const typed = server.withTypeProvider<ZodTypeProvider>() as unknown as TypedFastify;
        enableAuthentication(typed);
        registerApiRoutes(typed, {
            authEmailDelivery: delivery,
            resolveAuthEmailApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                serverId: "home-1",
                homeTarget: JSON.stringify({
                    kind: "descriptor",
                    authority: "trusted_enrollment",
                    descriptor: { v: 1, homeServerIdentityId: "home-1", canonicalServerUrl: "https://home.example.test", revision: 1, endpoints: [{ kind: "https", url: "https://home.example.test" }] },
                }),
            }),
        });
        return server;
    }

    it("reaches verification request and read-only preview through the real API composer", async () => {
        const server = app();
        try {
            const requested = await server.inject({
                method: "POST",
                url: NATIVE_AUTH_EMAIL_VERIFY_REQUEST_PATH_V1,
                payload: { v: 1, email: " PERSON@EXAMPLE.TEST " },
            });
            expect(requested.statusCode, requested.body).toBe(200);
            expect(requested.json()).toEqual({ accepted: true });
            expect(requested.headers["referrer-policy"]).toBe("no-referrer");
            expect(messages).toHaveLength(1);
            const message = messages[0];
            if (message?.kind !== "native_email_verification") throw new Error("verification mail not delivered");
            expect(new URL(message.verifyUrl).searchParams.get("target")).not.toBeNull();
            const token = new URL(message.verifyUrl).pathname.split("/").at(-1)!;

            const preview = await server.inject({
                method: "POST",
                url: NATIVE_AUTH_EMAIL_VERIFY_PREVIEW_PATH_V1,
                payload: { v: 1, token },
            });
            expect(preview.statusCode, preview.body).toBe(200);
            expect(preview.json()).toMatchObject({ v: 1, valid: true, continuation: "account_admission" });
            expect(preview.headers["referrer-policy"]).toBe("no-referrer");
            expect(messages).toHaveLength(1);
        } finally { await server.close(); }
    });

    it("delivers a Plain reset operation while unknown recipients remain neutral", async () => {
        const accepted = acceptPasswordTextV1("original password with spaces");
        if (!accepted.accepted) throw new Error("invalid fixture password");
        const account = await db.account.create({ data: { encryptionMode: "plain", publicKey: null } });
        await db.accountIdentity.create({ data: {
            accountId: account.id,
            provider: "email",
            providerUserId: "reset@example.test",
            providerLogin: null,
            profile: {},
            showOnProfile: false,
        } });
        await db.accountPasswordCredential.create({ data: {
            accountId: account.id,
            credential: { v: 1, kind: "plain_password_hash", hash: await hashPasswordMaterial(accepted.utf8) },
        } });
        const server = app();
        try {
            const request = (email: string) => server.inject({
                method: "POST",
                url: NATIVE_AUTH_PASSWORD_RESET_REQUEST_PATH_V1,
                payload: { v: 1, email },
            });
            const known = await request(" RESET@EXAMPLE.TEST ");
            const unknown = await request("unknown@example.test");
            expect(known.statusCode, known.body).toBe(200);
            expect(unknown.statusCode, unknown.body).toBe(200);
            expect(known.json()).toEqual({ accepted: true });
            expect(unknown.json()).toEqual(known.json());
            expect(known.headers["referrer-policy"]).toBe("no-referrer");
            expect(unknown.headers["referrer-policy"]).toBe("no-referrer");
            expect(messages).toHaveLength(1);
            const message = messages[0];
            if (message?.kind !== "plain_password_reset") throw new Error("reset mail not delivered");
            expect(new URL(message.resetUrl).searchParams.get("target")).not.toBeNull();
            const token = new URL(message.resetUrl).pathname.split("/").at(-1)!;
            const preview = await server.inject({
                method: "POST",
                url: NATIVE_AUTH_PASSWORD_RESET_PREVIEW_PATH_V1,
                payload: { v: 1, token },
            });
            expect(preview.statusCode, preview.body).toBe(200);
            expect(preview.json()).toEqual({ v: 1, valid: true });
            expect(preview.headers["referrer-policy"]).toBe("no-referrer");
        } finally { await server.close(); }
    });
});
