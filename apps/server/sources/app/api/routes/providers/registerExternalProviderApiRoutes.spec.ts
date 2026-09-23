import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

import {
    readExternalProviderApiCredential,
    registerExternalProviderApiRoutes,
} from "./registerExternalProviderApiRoutes";

describe("public external Provider API ingress", () => {
    it("accepts either supported credential header and requires duplicate credentials to agree", () => {
        expect(readExternalProviderApiCredential({ authorization: "Bearer token-1" })).toBe("token-1");
        expect(readExternalProviderApiCredential({ "x-api-key": "token-1" })).toBe("token-1");
        expect(readExternalProviderApiCredential({ authorization: "Bearer token-1", "x-api-key": "token-1" })).toBe("token-1");
        expect(readExternalProviderApiCredential({ authorization: "Bearer token-1", "x-api-key": "token-2" })).toBeNull();
        expect(readExternalProviderApiCredential({ authorization: "Bearer token-1", "x-api-key": "" })).toBeNull();
        expect(readExternalProviderApiCredential({ authorization: "Bearer token-1", "x-api-key": "   " })).toBeNull();
        expect(readExternalProviderApiCredential({ authorization: "Basic token-1" })).toBeNull();
    });

    it("rejects repeated authentication header lines even when Node collapsed their values", () => {
        expect(readExternalProviderApiCredential(
            { authorization: "Bearer token-1" },
            ["Authorization", "Bearer token-1", "authorization", "Bearer token-1"],
        )).toBeNull();
        expect(readExternalProviderApiCredential(
            { "x-api-key": "token-1" },
            ["X-Api-Key", "token-1", "x-api-key", "token-1"],
        )).toBeNull();
        expect(readExternalProviderApiCredential(
            { authorization: "Bearer token-1", "x-api-key": "token-1" },
            ["Authorization", "Bearer token-1", "X-Api-Key", "token-1"],
        )).toBe("token-1");
    });

    it("does not dispatch when key verification fails", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({ ok: false as const, reason: "invalid_token" as const })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/models");
        const raw = new EventEmitter();
        const reply = {
            header() { return this; },
            code: vi.fn(() => reply),
            send: vi.fn(),
        };
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { "x-api-key": "hapek_v1_secret-that-must-not-appear" },
            url: "/api/provider-broker/v1/models",
            raw,
        }, reply);
        expect(dispatch).not.toHaveBeenCalled();
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(JSON.stringify(reply.send.mock.calls)).not.toContain("secret-that-must-not-appear");
    });

    it("fails closed at the feature gate before credential verification", async () => {
        const routes: Record<string, unknown>[] = [];
        const verify = vi.fn();
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify,
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/models");
        const reply = {
            code: vi.fn(() => reply),
            send: vi.fn(),
        };

        await (selected?.preHandler as (request: unknown, reply: unknown) => Promise<unknown>)({}, reply);

        expect(reply.code).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith({ error: "not_found" });
        expect(verify).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([
        ['missing public ingress', undefined],
        ['plain HTTP ingress', 'http://home.example.test'],
        ['missing route-grant signer', 'https://home.example.test'],
    ])('fails closed before key verification when the bit is on but %s is not deployment-ready', async (_label, publicServerUrl) => {
        const routes: Record<string, unknown>[] = [];
        const verify = vi.fn();
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: '1',
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_EXTERNAL_API__ENABLED: '1',
                ...(publicServerUrl ? { HAPPIER_PUBLIC_SERVER_URL: publicServerUrl } : {}),
            },
            verify,
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/models");
        const reply = {
            code: vi.fn(() => reply),
            send: vi.fn(),
        };

        await (selected?.preHandler as (request: unknown, reply: unknown) => Promise<unknown>)({}, reply);

        expect(reply.code).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith({ error: 'not_found' });
        expect(verify).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('keeps the feature gate open when public HTTPS and route-grant signing are ready', async () => {
        const routes: Record<string, unknown>[] = [];
        const verify = vi.fn();
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: '1',
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_EXTERNAL_API__ENABLED: '1',
                HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
                HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: 'route-grant-key',
                HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: Buffer.from(new Uint8Array(32).fill(9)).toString('base64url'),
            },
            verify,
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/models");
        const reply = {
            code: vi.fn(() => reply),
            send: vi.fn(),
        };

        await (selected?.preHandler as (request: unknown, reply: unknown) => Promise<unknown>)({}, reply);

        expect(reply.code).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
        expect(verify).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("rejects caller proxy, cookie, and internal-Happier header collisions", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1", teamId: "team-1",
                assignedAccountId: "account-1", assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1", brokerMachineId: "machine-1", brokerPoolId: null,
                label: "automation", expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        for (const collision of ["proxy-authorization", "cookie", "x-happier-machine-local-capability"]) {
            const raw = new EventEmitter();
            const reply = {
                raw: new EventEmitter(),
                header() { return this; },
                code: vi.fn(() => reply),
                send: vi.fn(),
            };
            await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
                headers: {
                    authorization: "Bearer opaque",
                    "content-type": "application/json",
                    [collision]: "must-not-cross",
                },
                url: "/api/provider-broker/v1/responses",
                body: { model: "gpt-test", input: "hello" },
                raw,
            }, reply);
            expect(reply.code).toHaveBeenCalledWith(400);
        }
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("admits the documented reverse proxy's forwarding headers instead of refusing the request", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1", teamId: "team-1",
                assignedAccountId: "account-1", assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1", brokerMachineId: "machine-1", brokerPoolId: null,
                label: "automation", expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        const sent: unknown[] = [];
        const reply = {
            raw: new EventEmitter(),
            header() { return this; },
            code: vi.fn(() => reply),
            send: vi.fn((body: unknown) => { sent.push(body); return body; }),
        };
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            // Exactly what the documented Nginx sample puts in front of the
            // public Provider API. The forward allowlist keeps them out of the
            // broker DTO and `trustProxy` owns the client address, so ingress
            // must carry on rather than answer `invalid_request`.
            headers: {
                authorization: "Bearer opaque",
                "content-type": "application/json",
                forwarded: "for=203.0.113.7;proto=https",
                "x-forwarded-for": "203.0.113.7",
                "x-forwarded-proto": "https",
                "x-forwarded-host": "api.example.com",
                "x-real-ip": "203.0.113.7",
            },
            url: "/api/provider-broker/v1/responses",
            body: { model: "gpt-test", input: "hello" },
            raw: new EventEmitter(),
        }, reply);
        expect(reply.code).not.toHaveBeenCalledWith(400);
        expect(sent).not.toContainEqual(expect.objectContaining({
            error: expect.objectContaining({ code: "invalid_request" }),
        }));
    });

    it("fails closed for array-valued public or forbidden headers", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1", teamId: "team-1",
                assignedAccountId: "account-1", assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1", brokerMachineId: "machine-1", brokerPoolId: null,
                label: "automation", expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        for (const headers of [
            { authorization: "Bearer opaque", cookie: ["a=1", "b=2"], "content-type": "application/json" },
            { authorization: "Bearer opaque", accept: ["application/json", "text/event-stream"], "content-type": "application/json" },
        ]) {
            const raw = new EventEmitter();
            const reply = {
                raw: new EventEmitter(),
                header() { return this; },
                code: vi.fn(() => reply),
                send: vi.fn(),
            };
            await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
                headers,
                url: "/api/provider-broker/v1/responses",
                body: { model: "gpt-test", input: "hello" },
                raw,
            }, reply);
            expect(reply.code).toHaveBeenCalledWith(400);
        }
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("rejects repeated forwarded header lines even when Node collapsed their values", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn();
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1", teamId: "team-1",
                assignedAccountId: "account-1", assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1", brokerMachineId: "machine-1", brokerPoolId: null,
                label: "automation", expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        const raw = Object.assign(new EventEmitter(), {
            rawHeaders: [
                "Authorization", "Bearer opaque",
                "Content-Type", "application/json",
                "content-type", "application/json",
            ],
        });
        const reply = {
            raw: new EventEmitter(),
            header() { return this; },
            code: vi.fn(() => reply),
            send: vi.fn(),
        };
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { authorization: "Bearer opaque", "content-type": "application/json" },
            url: "/api/provider-broker/v1/responses",
            body: { model: "gpt-test", input: "hello" },
            raw,
        }, reply);

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("registers only the explicit public matrix with the feature gate and IP limiter before dispatch", () => {
        const routes: Array<{ method: string; path: string; options: Record<string, unknown> }> = [];
        const app = {
            route: (options: Record<string, unknown>) => routes.push({
                method: String(options.method),
                path: String(options.url),
                options,
            }),
        };
        registerExternalProviderApiRoutes(app as never, {
            env: {
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_ENABLED: "true",
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_EXTERNAL_API_ENABLED: "true",
            },
            verify: vi.fn(),
            dispatch: vi.fn(),
        });
        expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
            "GET /api/provider-broker/v1/models",
            "POST /api/provider-broker/v1/chat/completions",
            "POST /api/provider-broker/v1/responses",
            "POST /api/provider-broker/v1/messages",
            "POST /api/provider-broker/v1/messages/count_tokens",
        ]);
        for (const route of routes) {
            expect(route.options).toMatchObject({
                config: { cors: false, rateLimit: { max: 600, timeWindow: "1 minute" } },
            });
            expect(route.options).not.toHaveProperty("bodyLimit");
            expect(route.options.preHandler).toEqual(expect.any(Function));
        }
    });

});
