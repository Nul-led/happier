import Fastify from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { enableAuthentication } from "./enableAuthentication";

describe("API-token HTTP origin admission", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-api-token-origins-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
                HAPPIER_WEBAPP_URL: "https://happier.test/app",
            },
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    async function createToken(origins: string[]) {
        const account = await db.account.create({
            data: { publicKey: crypto.randomUUID() },
            select: { id: true },
        });
        const input = {
            accountId: account.id,
            tokenId: crypto.randomUUID(),
            label: "Origin admission",
            grant: {
                v: 1 as const,
                actions: null,
                targets: null,
                approve: false,
                origins,
                models: null,
                permissionModes: null,
                create: null,
            },
        };
        return auth.createApiToken(input);
    }

    function createApp() {
        const app = Fastify({ logger: false, bodyLimit: 1024 }).withTypeProvider<ZodTypeProvider>();
        enableAuthentication(app);
        // preHandler matches existing authenticated routes: origin admission must
        // still precede the Fastify parser rather than rely on route hook order.
        app.post("/api-token-enabled", {
            config: { allowApiToken: true },
            preHandler: app.authenticate,
        }, async (request) => ({ tokenKind: request.authTokenKind }));
        return app;
    }

    it("rejects an ungranted origin before an oversized JSON body is parsed", async () => {
        const token = await createToken([]);
        const app = createApp();
        try {
            const response = await app.inject({
                method: "POST",
                url: "/api-token-enabled",
                headers: { authorization: `Bearer ${token.token}`, origin: "https://denied.test" },
                payload: { blob: "x".repeat(2048) },
            });
            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({ error: "credential_origin_denied" });
        } finally {
            await app.close();
        }
    });

    it.each([
        { origin: "https://dashboard.test", origins: ["https://dashboard.test"] },
        { origin: "https://happier.test", origins: [] },
        { origin: undefined, origins: [] },
    ])("admits origin $origin through the verified grant and Happier origin union", async ({ origin, origins }) => {
        const token = await createToken(origins);
        const app = createApp();
        try {
            const response = await app.inject({
                method: "POST",
                url: "/api-token-enabled",
                headers: { authorization: `Bearer ${token.token}`, ...(origin === undefined ? {} : { origin }) },
                payload: { text: "hello" },
            });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ tokenKind: "api_token" });
        } finally {
            await app.close();
        }
    });
});
