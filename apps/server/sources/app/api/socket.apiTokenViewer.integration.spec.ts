import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auth } from "@/app/auth/auth";
import { eventRouter, type UpdatePayload } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { startSocket } from "./socket";
import type { Fastify as AppFastify } from "./types";

describe("API-token Session viewer", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-api-token-viewer-", initAuth: true,
            env: { AUTH_REQUIRED_LOGIN_PROVIDERS: "", HAPPIER_SOCKET_ADAPTER: "memory" },
        });
    }, 120_000);
    afterAll(async () => harness.close());

    it("isolates Session delivery, strips access, and disconnects the revoked credential", async () => {
        const account = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: account.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        const otherSession = await db.session.create({ data: {
            accountId: account.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        const token = await auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: "viewer",
            expiresAt: new Date(Date.now() + 60_000), grant: {
                v: 1, actions: { families: ["session_transcripts"], ids: [] },
                targets: { sessions: [session.id], machines: [] }, approve: false,
                origins: [], models: null, permissionModes: null, create: null,
            } });
        const app = Fastify({ logger: false }) as AppFastify;
        startSocket(app);
        const io = app.machineDaemonPresence;
        if (!(io instanceof Server)) throw new Error("Missing socket test server");
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("Missing socket test address");
        const client = ioClient(`http://127.0.0.1:${address.port}`, {
            path: "/v1/updates", transports: ["websocket"], reconnection: false, autoConnect: false,
            auth: { token: token.token, clientType: "session-scoped", sessionId: session.id },
        });
        try {
            await new Promise<void>((resolve, reject) => {
                client.once("connect", resolve); client.once("connect_error", reject); client.connect();
            });
            await vi.waitFor(() => expect(io.sockets.sockets.get(client.id!)?.rooms.has(`session:${session.id}:${account.id}`)).toBe(true));
            const admitted = io.sockets.sockets.get(client.id!)!;
            expect(admitted.rooms.has(`user:${account.id}`)).toBe(false);
            expect(admitted.rooms.has(`api-token-revocation:${token.tokenId}`)).toBe(true);
            const updates: unknown[] = [];
            client.on("update", update => updates.push(update));
            const access = { v: 1 as const, level: "owner" as const, sources: [{ kind: "owner" as const }], capabilities: {}, audienceContext: null };
            const payload = { id: "viewer-update", seq: 1, createdAt: Date.now(), body: { t: "update-session" as const, id: session.id, access } } satisfies UpdatePayload;
            await eventRouter.emitUpdate({ userId: account.id, payload,
                recipientFilter: { type: "all-interested-in-session", sessionId: session.id } });
            await vi.waitFor(() => expect(updates).toHaveLength(1));
            expect(updates[0]).toEqual({ ...payload, body: { t: "update-session", id: session.id } });
            expect(payload.body.access).toBe(access);
            await eventRouter.emitUpdate({ userId: account.id, payload: { ...payload, id: "other-update", body: { ...payload.body, id: otherSession.id } },
                recipientFilter: { type: "all-interested-in-session", sessionId: otherSession.id } });
            const ping = await client.timeout(5_000).emitWithAck("ping");
            expect(ping).toBeDefined();
            expect(updates).toHaveLength(1);
            const revoked = await auth.revokeApiToken({ accountId: account.id, tokenId: token.tokenId });
            expect(revoked.revoked).toBe(true);
            const disconnected = new Promise<void>(resolve => client.once("disconnect", () => resolve()));
            if (!app.disconnectApiTokenSockets) throw new Error("Missing token socket revocation callback");
            app.disconnectApiTokenSockets(revoked.revokedTokenIds);
            await disconnected;
            expect(client.connected).toBe(false);
        } finally {
            client.disconnect(); await io.close(); await app.close();
            await db.account.delete({ where: { id: account.id } });
        }
    });
});
