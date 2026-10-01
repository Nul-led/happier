import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { io as ioClient } from "socket.io-client";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";
import { ACCOUNT_TERMINAL_PRESENT_USER_POLICY_PATH_V1, AUTHORITY_CEILING_HEADER_V1 } from "@happier-dev/protocol";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { enableAuthentication } from "./utils/enableAuthentication";
import { registerAccountSecurityRoutes } from "./routes/auth/registerAccountSecurityRoutes";
import { startSocket } from "./socket";

function connect(socket: ReturnType<typeof ioClient>): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
        socket.connect();
    });
}

async function waitForHandlers(socket: ReturnType<typeof ioClient>): Promise<void> {
    // Socket.IO connect precedes the server's async final currentness check.
    // Ping is a transport-only readiness observation, safe to retry before RPC.
    await vi.waitFor(async () => {
        await expect(socket.timeout(250).emitWithAck("ping")).resolves.toEqual({});
    }, { timeout: 5_000 });
}

describe("terminal present-user policy across an admitted connection", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "terminal-policy-socket-", initAuth: true, initEncrypt: true,
            env: { AUTH_REQUIRED_LOGIN_PROVIDERS: "" } });
    }, 120_000);
    afterAll(async () => await harness.close());

    it("disconnects the same terminal connection after disable and refuses permission decisions after reconnect", async () => {
        const account = await db.account.create({ data: { publicKey: "terminal-policy-socket-account" } });
        const machine = await db.machine.create({ data: { id: "terminal-policy-machine", accountId: account.id, metadata: "{}" } });
        const session = await db.session.create({ data: { accountId: account.id, tag: "terminal-policy-session", metadata: "{}" } });
        await db.accessKey.create({ data: { accountId: account.id, machineId: machine.id, sessionId: session.id, data: "encrypted" } });
        const accountToken = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
        const terminalToken = await auth.createToken(account.id, undefined, { kind: "terminal", authority: "account_automation" });
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        registerAccountSecurityRoutes(app, { authEmailDelivery: { isReady: async () => false, deliver: async () => ({ status: "failed", reason: "not_configured", detail: "test transport unavailable" }) } });
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("expected socket server address");
        const url = `http://127.0.0.1:${address.port}`;
        const socketOptions = { path: "/v1/updates", transports: ["websocket"], reconnection: false, autoConnect: false };
        const receiver = ioClient(url, { ...socketOptions, auth: { token: accountToken, clientType: "session-scoped", sessionId: session.id, machineId: machine.id } });
        const terminal = ioClient(url, { ...socketOptions, auth: { token: terminalToken } });
        const automatedTerminal = ioClient(url, { ...socketOptions, auth: { token: terminalToken, authorityCeiling: "account_automation" } });
        const method = `${session.id}:permission`;
        const received: unknown[] = [];
        receiver.on(SOCKET_RPC_EVENTS.REQUEST, (request: unknown, acknowledge: (response: unknown) => void) => {
            received.push(request);
            acknowledge({ applied: true });
        });
        try {
            const initiallyAllowed = await app.inject({ method: "POST", url: ACCOUNT_TERMINAL_PRESENT_USER_POLICY_PATH_V1,
                headers: { authorization: `Bearer ${accountToken}` }, payload: { policy: "allowed" } });
            expect(initiallyAllowed.statusCode, initiallyAllowed.body).toBe(200);
            const narrowed = await app.inject({ method: "POST", url: ACCOUNT_TERMINAL_PRESENT_USER_POLICY_PATH_V1,
                headers: { authorization: `Bearer ${accountToken}`, [AUTHORITY_CEILING_HEADER_V1]: "account_automation" }, payload: { policy: "allowed" } });
            expect(narrowed.statusCode, narrowed.body).toBe(403);
            await connect(receiver);
            await waitForHandlers(receiver);
            const registered = new Promise<void>((resolve, reject) => {
                receiver.once(SOCKET_RPC_EVENTS.REGISTERED, () => resolve());
                receiver.once(SOCKET_RPC_EVENTS.ERROR, (error: unknown) => reject(new Error(JSON.stringify(error))));
            });
            receiver.emit(SOCKET_RPC_EVENTS.REGISTER, { method });
            await registered;
            await connect(terminal);
            await waitForHandlers(terminal);
            const originalId = terminal.id;
            const payload = { method, params: { id: "permission-request", approved: true, callerAuthority: "present_user" } };
            await connect(automatedTerminal);
            await waitForHandlers(automatedTerminal);
            await expect(automatedTerminal.timeout(5_000).emitWithAck(SOCKET_RPC_EVENTS.CALL, payload)).resolves.toMatchObject({ ok: false, error: "Forbidden" });
            expect(received).toHaveLength(0);
            await expect(terminal.timeout(5_000).emitWithAck(SOCKET_RPC_EVENTS.CALL, payload)).resolves.toMatchObject({ ok: true, result: { applied: true } });
            expect(received).toEqual([expect.objectContaining({ callerAuthority: "present_user" })]);

            const disconnected = new Promise<void>((resolve) => terminal.once("disconnect", () => resolve()));
            const disabled = await app.inject({ method: "POST", url: ACCOUNT_TERMINAL_PRESENT_USER_POLICY_PATH_V1,
                headers: { authorization: `Bearer ${accountToken}` }, payload: { policy: "disallowed" } });
            expect(disabled.statusCode, disabled.body).toBe(200);
            await disconnected;
            expect(terminal.connected).toBe(false);
            await expect(terminal.timeout(50).emitWithAck(SOCKET_RPC_EVENTS.CALL, payload)).rejects.toThrow();
            expect(received).toHaveLength(1);
            expect(receiver.connected).toBe(true);

            terminal.auth = { token: terminalToken, authorityCeiling: "present_user" };
            await connect(terminal);
            await waitForHandlers(terminal);
            expect(terminal.id).not.toBe(originalId);
            await expect(terminal.timeout(5_000).emitWithAck(SOCKET_RPC_EVENTS.CALL, payload)).resolves.toMatchObject({ ok: false, error: "Forbidden" });
            expect(received).toHaveLength(1);
            const security = await app.inject({ method: "GET", url: "/v1/account/security", headers: { authorization: `Bearer ${terminalToken}` } });
            expect(security.statusCode, security.body).toBe(200);
            expect(security.json()).toMatchObject({ terminalPresentUserPolicy: "disallowed" });
            const forbidden = await app.inject({ method: "POST", url: ACCOUNT_TERMINAL_PRESENT_USER_POLICY_PATH_V1,
                headers: { authorization: `Bearer ${terminalToken}` }, payload: { policy: "allowed" } });
            expect(forbidden.statusCode).toBe(403);
        } finally {
            receiver.close();
            terminal.close();
            automatedTerminal.close();
            await app.close();
        }
    });
});
