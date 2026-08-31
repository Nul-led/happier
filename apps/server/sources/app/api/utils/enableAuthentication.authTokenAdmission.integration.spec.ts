import * as privacyKit from "privacy-kit";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { enableAuthentication } from "./enableAuthentication";
import { requirePresentUser } from "./requirePresentUser";

function createApp() {
    const app = Fastify({ logger: false }) as any;
    enableAuthentication(app);
    const requireDirectoryAuthority = async (request: any, reply: any) => {
        if (request.authTokenKind === "account" || request.authTokenKind === "account_directory") return;
        return reply.code(403).send({ error: "account_directory_authority_required" });
    };
    app.get("/ordinary", { preHandler: app.authenticate }, async (request: any) => ({
        tokenKind: request.authTokenKind,
    }));
    app.get(
        "/directory",
        {
            config: { allowAccountDirectoryToken: true },
            preHandler: [app.authenticate, requireDirectoryAuthority],
        },
        async (request: any) => ({ tokenKind: request.authTokenKind }),
    );
    app.get(
        "/present-only",
        {
            config: { allowAccountDirectoryToken: true },
            preHandler: [app.authenticate, requirePresentUser],
        },
        async (request: any) => ({ tokenKind: request.authTokenKind }),
    );
    app.get(
        "/pat",
        {
            config: { allowApiToken: true },
            preHandler: app.authenticate,
        },
        async (request: any) => ({ tokenKind: request.authTokenKind }),
    );
    return app;
}

describe("authentication token admission (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-admission-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
                AUTH_LOGIN_ELIGIBILITY_ACCOUNT_SNAPSHOT_CACHE_TTL_MS: "0",
                AUTH_TOKEN_CACHE_MAX_ENTRIES: "32",
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

    it("keeps a published pre-marker Home token on ordinary routes but never admits it to Directory routes", async () => {
        const account = await db.account.create({ data: { publicKey: "auth-admission-legacy" }, select: { id: true } });
        const generator = await privacyKit.createPersistentTokenGenerator({ service: "handy", seed: process.env.HANDY_MASTER_SECRET! });
        const legacyToken = await generator.new({ user: account.id, extras: { tokenEpoch: 0 } });
        const app = createApp();
        try {
            const ordinaryResponse = await app.inject({
                method: "GET",
                url: "/ordinary",
                headers: { authorization: `Bearer ${legacyToken}` },
            });
            const directoryResponse = await app.inject({
                method: "GET",
                url: "/directory",
                headers: { authorization: `Bearer ${legacyToken}` },
            });

            expect(ordinaryResponse.statusCode).toBe(200);
            expect(ordinaryResponse.json()).toEqual({ tokenKind: "account" });
            expect(directoryResponse.statusCode).toBe(401);
            expect(directoryResponse.json()).toEqual({ error: "invalid_token" });
        } finally {
            await app.close();
        }
    });

    it("admits Directory credentials only on an explicit Directory route", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-admission-directory" },
            select: { id: true },
        });
        const [accountToken, terminalToken, directoryToken, pat] = await Promise.all([
            auth.createToken(account.id, undefined, {
                kind: "account",
                authority: "present_user",
            }),
            auth.createToken(account.id, { session: "admission-terminal" }, {
                kind: "terminal",
                authority: "account_automation",
            }),
            auth.createToken(account.id, undefined, {
                kind: "account_directory",
                authority: "present_user",
            }),
            auth.createApiToken({ accountId: account.id, label: "admission PAT" }),
        ]);
        const app = createApp();
        await app.ready();

        try {
            const response = async (path: string, token: string) => app.inject({
                method: "GET",
                url: path,
                headers: { authorization: `Bearer ${token}` },
            });
            const [accountOrdinary, accountDirectory, terminalOrdinary, directoryOrdinary,
                directoryDirectory, directoryPresentOnly, patOrdinary, patRoute] = await Promise.all([
                response("/ordinary", accountToken),
                response("/directory", accountToken),
                response("/ordinary", terminalToken),
                response("/ordinary", directoryToken),
                response("/directory", directoryToken),
                response("/present-only", directoryToken),
                response("/ordinary", pat.token),
                response("/pat", pat.token),
            ]);

            expect(accountOrdinary.statusCode).toBe(200);
            expect(accountDirectory.statusCode).toBe(200);
            expect(terminalOrdinary.statusCode).toBe(200);
            expect(directoryOrdinary.statusCode).toBe(403);
            expect(directoryDirectory.statusCode).toBe(200);
            expect(directoryPresentOnly.statusCode).toBe(403);
            expect(patOrdinary.statusCode).toBe(403);
            expect(patRoute.statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it("rejects missing and malformed provenance before route handlers", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-admission-malformed" },
            select: { id: true },
        });
        const generator = await privacyKit.createPersistentTokenGenerator({
            service: "handy",
            seed: String(process.env.HANDY_MASTER_SECRET),
        });
        const token = await generator.new({
            user: account.id,
            extras: { tokenEpoch: 0, provenance: { v: 2, kind: "account", authority: "present_user" } },
        });
        const app = createApp();
        await app.ready();
        try {
            const response = await app.inject({
                method: "GET",
                url: "/ordinary",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(response.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

});
