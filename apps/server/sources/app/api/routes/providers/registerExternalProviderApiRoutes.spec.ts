import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

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

    it("authenticates at the edge and dispatches a strict target-free application DTO", async () => {
        const routes: Record<string, unknown>[] = [];
        const dispatch = vi.fn(async (_input: unknown) => ({
            ok: true as const,
            statusCode: 200,
            headers: { "content-type": "text/event-stream", authorization: "never-forward" },
            body: (async function* () { yield Buffer.from("data: done\\n\\n"); })(),
        }));
        const app = { route: (options: Record<string, unknown>) => routes.push(options) };
        registerExternalProviderApiRoutes(app as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1",
                teamId: "team-1",
                assignedAccountId: "account-1",
                assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1",
                brokerMachineId: "machine-1",
                brokerPoolId: null,
                label: "automation",
                expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/chat/completions");
        const raw = new EventEmitter();
        const responseHeaders: Record<string, string> = {};
        const reply = {
            raw: new EventEmitter(),
            header(name: string, value: string) { responseHeaders[name] = value; return this; },
            code: vi.fn(() => reply),
            send: vi.fn((body: unknown) => body),
        };
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { authorization: "Bearer opaque", "content-type": "application/json" },
            url: "/api/provider-broker/v1/chat/completions",
            body: { model: "gpt-test", stream: true },
            raw,
        }, reply);
        expect(dispatch).toHaveBeenCalledOnce();
        const call = dispatch.mock.calls[0]?.[0] as Readonly<{
            request: Readonly<Record<string, unknown>>;
        }> | undefined;
        expect(call).toMatchObject({
            target: { custodianAccountId: "custodian-1", brokerMachineId: "machine-1" },
            request: {
                resourceId: "resource-1",
                caller: { kind: "external_api_key", assignedAccountId: "account-1" },
                pathAndQuery: "/v1/chat/completions",
            },
        });
        expect(call?.request).not.toHaveProperty("machineId");
        expect(call?.request).not.toHaveProperty("host");
        expect(call?.request).not.toHaveProperty("bearer");
        expect(call?.request.headers).toEqual({ "content-type": "application/json" });
        expect(Buffer.from(String(call?.request.bodyBase64), "base64").toString("utf8"))
            .toBe(JSON.stringify({ model: "gpt-test", stream: true }));
        expect(responseHeaders.authorization).toBeUndefined();
        expect(responseHeaders["content-type"]).toBe("text/event-stream");
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

    it("returns the stable public 429 code and Retry-After only for a deterministic exhaustion reset", async () => {
        const routes: Record<string, unknown>[] = [];
        const verified = {
            ok: true as const,
            keyId: "550e8400-e29b-41d4-a716-446655440000", resourceId: "resource-1", teamId: "team-1",
            assignedAccountId: "account-1", assignedTeamMembershipId: "membership-1",
            custodianAccountId: "custodian-1", brokerMachineId: "machine-1", brokerPoolId: null,
            label: "automation", expiresAt: null,
        };
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {}, verify: vi.fn(async () => verified),
            nowMs: () => 0,
            dispatch: vi.fn(async () => ({ ok: false as const, error: 'team_credential_usage_limit' as const, retryAtMs: 2_000 })),
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        const headers: Record<string, string> = {};
        const reply = {
            raw: new EventEmitter(),
            header(name: string, value: string) { headers[name] = value; return this; },
            code: vi.fn(() => reply), send: vi.fn((body: unknown) => body),
        };
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { authorization: "Bearer opaque", "content-type": "application/json" },
            url: "/api/provider-broker/v1/responses", body: { model: "gpt-test", input: "hello" },
            raw: new EventEmitter(),
        }, reply);
        expect(reply.code).toHaveBeenCalledWith(429);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ code: 'team_credential_usage_limit' }),
        }));
        expect(headers['Retry-After']).toBe('2');
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

    it("rejects caller proxy, cookie, forwarding, and internal-Happier header collisions", async () => {
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
        for (const collision of ["proxy-authorization", "cookie", "forwarded", "x-forwarded-for", "x-happier-machine-local-capability"]) {
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

    it("streams broker bytes without eager buffering and cancels the broker request when the client disconnects", async () => {
        const routes: Record<string, unknown>[] = [];
        const raw = new EventEmitter();
        const replyRaw = new EventEmitter();
        let yieldedChunks = 0;
        let dispatchSignal: AbortSignal | undefined;
        const dispatch = vi.fn(async (input: Readonly<{ signal: AbortSignal }>) => {
            dispatchSignal = input.signal;
            return {
                ok: true as const,
                statusCode: 200,
                headers: { "content-type": "text/event-stream" },
                body: (async function* () {
                    yieldedChunks += 1;
                    yield Buffer.from("data: first\n\n");
                    yieldedChunks += 1;
                    yield Buffer.from("data: second\n\n");
                })(),
            };
        });
        let sent: unknown;
        const reply = {
            raw: replyRaw,
            header() { return this; },
            code: vi.fn(() => reply),
            send: vi.fn((body: unknown) => { sent = body; return body; }),
        };
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1",
                teamId: "team-1",
                assignedAccountId: "account-1",
                assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1",
                brokerMachineId: "machine-1",
                brokerPoolId: null,
                label: "automation",
                expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/chat/completions");
        await (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { authorization: "Bearer opaque", "content-type": "application/json" },
            url: "/api/provider-broker/v1/chat/completions",
            body: { model: "gpt-test", stream: true },
            raw,
        }, reply);

        expect(sent).toBeInstanceOf(Readable);
        expect(yieldedChunks).toBe(0);
        raw.emit("aborted");
        expect(dispatchSignal?.aborted).toBe(true);
        expect(raw.listenerCount("aborted")).toBe(0);
        expect(replyRaw.listenerCount("close")).toBe(0);
    });

    it("does not publish a late broker response after the external caller aborts", async () => {
        const routes: Record<string, unknown>[] = [];
        const raw = new EventEmitter();
        let resolveDispatch: ((value: {
            ok: true;
            statusCode: number;
            headers: Record<string, string>;
            body: AsyncIterable<Uint8Array>;
        }) => void) | undefined;
        const dispatch = vi.fn(() => new Promise<{
            ok: true;
            statusCode: number;
            headers: Record<string, string>;
            body: AsyncIterable<Uint8Array>;
        }>((resolve) => { resolveDispatch = resolve; }));
        const reply = {
            raw: new EventEmitter(),
            header() { return this; },
            code: vi.fn(() => reply),
            send: vi.fn(),
        };
        registerExternalProviderApiRoutes({ route: (route: Record<string, unknown>) => routes.push(route) } as never, {
            env: {},
            verify: vi.fn(async () => ({
                ok: true as const,
                keyId: "550e8400-e29b-41d4-a716-446655440000",
                resourceId: "resource-1",
                teamId: "team-1",
                assignedAccountId: "account-1",
                assignedTeamMembershipId: "membership-1",
                custodianAccountId: "custodian-1",
                brokerMachineId: "machine-1",
                brokerPoolId: null,
                label: "automation",
                expiresAt: null,
            })),
            dispatch,
        });
        const selected = routes.find((route) => route.url === "/api/provider-broker/v1/responses");
        const handling = (selected?.handler as (request: unknown, reply: unknown) => Promise<unknown>)({
            headers: { authorization: "Bearer opaque", "content-type": "application/json" },
            url: "/api/provider-broker/v1/responses",
            body: { model: "gpt-test", input: "hello" },
            raw,
        }, reply);
        await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
        raw.emit("aborted");
        resolveDispatch?.({
            ok: true,
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: (async function* () { yield Buffer.from("late"); })(),
        });
        await handling;

        expect(reply.code).toHaveBeenCalledWith(499);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ code: "request_cancelled" }),
        }));
        expect(reply.send).not.toHaveBeenCalledWith(expect.any(Readable));
    });
});
