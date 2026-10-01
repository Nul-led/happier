import Fastify from "fastify";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { io as ioClient } from "socket.io-client";

import { auth } from "@/app/auth/auth";
import { RedisStreamsRoomEmitter } from "@/app/events/createRedisStreamsRoomEmitter";
import { eventRouter } from "@/app/events/connectionEventRouter";
import type { CredentialQualifiedSessionDeliveryV1 } from "@/app/events/socketRoomEmitter";
import { emitSessionDeletedUpdate } from "@/app/session/delete/emitSessionDeletedUpdate";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { resolveRedisAdapterValidationRedisUrl } from "../../../scripts/resolveRedisAdapterValidationRedisUrl";
import { startSocket } from "./socket";
import type { Fastify as AppFastify } from "./types";

const redisRuntime = vi.hoisted(() => ({
    activeClient: null as unknown,
}));

const shutdownRuntime = vi.hoisted(() => ({
    callbacks: [] as Array<() => Promise<void>>,
}));

vi.mock("@/storage/redis/redis", () => ({
    // Separate production replicas own separate process-local clients. This
    // in-process harness preserves that topology with two real Redis clients;
    // it does not replace the Redis Streams adapter or its transport.
    getRedisClient: () => redisRuntime.activeClient,
    getRedisSocketClusterAdapterClient: () => redisRuntime.activeClient,
    getRedisSocketClusterClient: () => redisRuntime.activeClient,
    closeRedisSocketClusterClient: () => {},
}));

vi.mock("@/utils/process/shutdown", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/utils/process/shutdown")>();
    return {
        ...actual,
        onShutdown: (_name: string, callback: () => Promise<void>) => {
            // startSocket owns its Socket.IO close through this lifecycle,
            // which a plain Fastify close deliberately does not invoke.
            shutdownRuntime.callbacks.push(callback);
            return () => {
                const index = shutdownRuntime.callbacks.indexOf(callback);
                if (index >= 0) shutdownRuntime.callbacks.splice(index, 1);
            };
        },
    };
});

type RedisMemoryInstance = Awaited<ReturnType<typeof resolveRedisAdapterValidationRedisUrl>>["redisMemory"];

type StartedReplica = Readonly<{
    app: AppFastify;
    port: number;
    stopSocket: () => Promise<void>;
}>;

async function startReplica(params: Readonly<{
    instanceId: string;
    redis: Redis;
}>): Promise<StartedReplica> {
    redisRuntime.activeClient = params.redis;
    process.env.HAPPIER_INSTANCE_ID = params.instanceId;

    const app = Fastify({ logger: false }) as unknown as AppFastify;
    const priorShutdownCallbacks = shutdownRuntime.callbacks.length;
    startSocket(app);
    const stopSocket = shutdownRuntime.callbacks.at(priorShutdownCallbacks);
    if (!stopSocket) {
        throw new Error("Socket replica did not register its shutdown callback");
    }
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) {
        await app.close();
        throw new Error("Failed to bind Socket.IO replica");
    }
    return { app, port, stopSocket };
}

async function connectClient(params: Readonly<{
    port: number;
    auth: Record<string, string>;
}>): Promise<ReturnType<typeof ioClient>> {
    const socket = ioClient(`http://127.0.0.1:${params.port}`, {
        path: "/v1/updates",
        transports: ["websocket"],
        reconnection: false,
        auth: params.auth,
    });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out connecting Socket.IO replica client"));
        }, 6_000);
        const cleanup = () => {
            clearTimeout(timeout);
            socket.off("connect", onConnect);
            socket.off("connect_error", onConnectError);
        };
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onConnectError = (error: unknown) => {
            cleanup();
            reject(error);
        };
        socket.on("connect", onConnect);
        socket.on("connect_error", onConnectError);
    });
    return socket;
}

async function waitForDisconnect(socket: ReturnType<typeof ioClient>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for remote replica socket revocation"));
        }, 6_000);
        const cleanup = () => {
            clearTimeout(timeout);
            socket.off("disconnect", onDisconnect);
        };
        const onDisconnect = () => {
            cleanup();
            resolve();
        };
        socket.on("disconnect", onDisconnect);
    });
}

async function waitFor(
    predicate: () => boolean,
    description: string,
    timeoutMs = 6_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function expectUnchangedFor(values: readonly unknown[], durationMs = 350): Promise<void> {
    const initialLength = values.length;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    expect(values).toHaveLength(initialLength);
}

describe("startSocket account revocation with the configured Redis adapter", () => {
    let harness: LightSqliteHarness;
    let redisMemory: RedisMemoryInstance = null;
    const replicas: StartedReplica[] = [];
    const redisClients: Redis[] = [];
    const clients: Array<ReturnType<typeof ioClient>> = [];

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-socket-redis-auth-policy-",
            initAuth: true,
            initEncrypt: true,
        });
    }, 120_000);

    afterEach(async () => {
        while (clients.length > 0) {
            clients.pop()?.disconnect();
        }
        while (replicas.length > 0) {
            const replica = replicas.pop();
            if (!replica) continue;
            await replica.stopSocket();
            await replica.app.close();
        }
        while (redisClients.length > 0) {
            await redisClients.pop()?.quit();
        }
        if (redisMemory) {
            await redisMemory.stop();
            redisMemory = null;
        }
        redisRuntime.activeClient = null;
        eventRouter.clearIo();
        harness.resetEnv();
        await db.accessKey.deleteMany();
        await db.session.deleteMany();
        await db.team.deleteMany();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("disconnects user, session, and machine sockets from a different configured replica", async () => {
        const resolvedRedis = await resolveRedisAdapterValidationRedisUrl({ env: process.env });
        redisMemory = resolvedRedis.redisMemory;
        harness.resetEnv({
            HAPPIER_SOCKET_ADAPTER: "redis-streams",
            REDIS_URL: resolvedRedis.redisUrl,
            HAPPY_SERVER_FLAVOR: "full",
        });

        const redisA = new Redis(resolvedRedis.redisUrl);
        const redisB = new Redis(resolvedRedis.redisUrl);
        redisClients.push(redisA, redisB);
        const replicaA = await startReplica({ instanceId: "auth-policy-replica-a", redis: redisA });
        const replicaB = await startReplica({ instanceId: "auth-policy-replica-b", redis: redisB });
        replicas.push(replicaA, replicaB);

        const admissions = [
            {
                name: "user",
                configure: async (_accountId: string): Promise<Record<string, string>> => ({}),
            },
            {
                name: "session",
                configure: async (accountId: string): Promise<Record<string, string>> => {
                    const sessionId = `s-redis-revocation-${Date.now()}`;
                    await db.session.create({
                        data: {
                            id: sessionId,
                            tag: `t-redis-revocation-${Date.now()}`,
                            accountId,
                            encryptionMode: "e2ee",
                            metadata: "{}",
                        },
                    });
                    return { clientType: "session-scoped", sessionId };
                },
            },
            {
                name: "machine",
                configure: async (accountId: string): Promise<Record<string, string>> => {
                    const machineId = `m-redis-revocation-${Date.now()}`;
                    await db.machine.create({
                        data: {
                            id: machineId,
                            accountId,
                            metadata: "metadata",
                            metadataVersion: 1,
                            daemonState: null,
                            daemonStateVersion: 0,
                            active: false,
                        },
                    });
                    return { clientType: "machine-scoped", machineId };
                },
            },
        ] as const;

        for (const admission of admissions) {
            const account = await db.account.create({
                data: { publicKey: `pk-redis-revocation-${admission.name}-${Date.now()}` },
                select: { id: true },
            });
            const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
            const socketAuth = await admission.configure(account.id);
            const socket = await connectClient({
                port: replicaB.port,
                auth: { token, ...socketAuth },
            });
            clients.push(socket);
            expect(socket.connected, admission.name).toBe(true);

            const disconnected = waitForDisconnect(socket);
            await auth.signOutEverywhere(account.id);
            replicaA.app.disconnectAccountSockets(account.id);

            await disconnected;
            expect(socket.connected, admission.name).toBe(false);
        }
    }, 45_000);

    it("re-enters credential-qualified Session fanout on the receiving node for headless publishers", async () => {
        const resolvedRedis = await resolveRedisAdapterValidationRedisUrl({ env: process.env });
        redisMemory = resolvedRedis.redisMemory;
        harness.resetEnv({
            HAPPIER_SOCKET_ADAPTER: "redis-streams",
            REDIS_URL: resolvedRedis.redisUrl,
            HAPPY_SERVER_FLAVOR: "full",
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1",
        });

        const redisA = new Redis(resolvedRedis.redisUrl);
        const redisB = new Redis(resolvedRedis.redisUrl);
        const redisWorker = new Redis(resolvedRedis.redisUrl);
        redisClients.push(redisA, redisB, redisWorker);
        const replicaA = await startReplica({ instanceId: "protected-fanout-replica-a", redis: redisA });
        const replicaB = await startReplica({ instanceId: "protected-fanout-replica-b", redis: redisB });
        replicas.push(replicaA, replicaB);

        const owner = await db.account.create({ data: { publicKey: `pk-owner-${crypto.randomUUID()}` } });
        const actor = await db.account.create({ data: { publicKey: `pk-actor-${crypto.randomUUID()}` } });
        const directActor = await db.account.create({ data: { publicKey: `pk-direct-${crypto.randomUUID()}` } });
        const session = await db.session.create({ data: {
            accountId: owner.id,
            tag: `session-${crypto.randomUUID()}`,
            encryptionMode: "e2ee",
            metadata: "{}",
        } });
        const team = await db.team.create({ data: {
            name: `Team ${crypto.randomUUID()}`,
            authenticationPolicy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "home_method", methodId: "key_challenge" }],
            },
        } });
        const membership = await db.teamMembership.create({ data: {
            teamId: team.id,
            accountId: actor.id,
            role: "member",
        } });
        await db.sessionTeamGrant.create({ data: {
            sessionId: session.id,
            teamId: team.id,
            accessLevel: "view",
            effectiveAt: new Date(),
        } });
        await db.sessionShare.create({ data: {
            sessionId: session.id,
            sharedByUserId: owner.id,
            sharedWithUserId: directActor.id,
            accessLevel: "view",
        } });

        const qualifiedToken = await auth.createToken(actor.id, undefined, {
            kind: "account",
            authority: "present_user",
            authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
        });
        const unqualifiedToken = await auth.createToken(actor.id, undefined, {
            kind: "account",
            authority: "present_user",
        });
        const directToken = await auth.createToken(directActor.id, undefined, {
            kind: "account",
            authority: "present_user",
        });
        const qualified = await connectClient({ port: replicaB.port, auth: { token: qualifiedToken } });
        const unqualified = await connectClient({ port: replicaB.port, auth: { token: unqualifiedToken } });
        const direct = await connectClient({ port: replicaB.port, auth: { token: directToken } });
        clients.push(qualified, unqualified, direct);

        const qualifiedUpdates: unknown[] = [];
        const unqualifiedUpdates: unknown[] = [];
        const directUpdates: unknown[] = [];
        qualified.on("update", (value) => qualifiedUpdates.push(value));
        unqualified.on("update", (value) => unqualifiedUpdates.push(value));
        direct.on("update", (value) => directUpdates.push(value));

        const workerEmitter = new RedisStreamsRoomEmitter(redisWorker, {
            maxLen: 2_000,
            streamName: "socket.io",
        });
        eventRouter.setIo(workerEmitter);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));

        const protectedPayload = { body: { t: "update-session", id: session.id, phase: "initial" } };
        await eventRouter.emitUpdate({
            userId: actor.id,
            payload: protectedPayload as never,
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        await eventRouter.emitUpdate({
            userId: directActor.id,
            payload: protectedPayload as never,
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        await waitFor(() => qualifiedUpdates.length === 1 && directUpdates.length === 1, "qualified and direct delivery");
        await expectUnchangedFor(unqualifiedUpdates);
        expect(qualifiedUpdates).toEqual([protectedPayload]);
        expect(directUpdates).toEqual([protectedPayload]);
        expect(unqualifiedUpdates).toEqual([]);

        await workerEmitter.forwardCredentialQualifiedSessionDelivery({
            v: 1,
            accountId: actor.id,
            sessionId: session.id,
            eventName: "update",
            payload: { body: { t: "update-session", phase: "forged" } },
            authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
        } as unknown as CredentialQualifiedSessionDeliveryV1);
        await expectUnchangedFor(qualifiedUpdates);

        await db.teamMembership.update({ where: { id: membership.id }, data: { status: "suspended" } });
        await eventRouter.emitUpdate({
            userId: actor.id,
            payload: { body: { t: "update-session", phase: "revoked" } } as never,
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        await expectUnchangedFor(qualifiedUpdates);

        await db.teamMembership.update({ where: { id: membership.id }, data: { status: "active" } });
        process.env.HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED = "0";
        await eventRouter.emitUpdate({
            userId: actor.id,
            payload: { body: { t: "update-session", phase: "disabled" } } as never,
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        await expectUnchangedFor(qualifiedUpdates);

        process.env.HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED = "1";
        await db.session.delete({ where: { id: session.id } });
        const unqualifiedCountBeforeDelete = unqualifiedUpdates.length;
        await eventRouter.emitUpdate({
            userId: actor.id,
            payload: { body: { t: "new-message", sid: session.id, msg: {} } } as never,
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        await expectUnchangedFor(qualifiedUpdates);
        await expectUnchangedFor(unqualifiedUpdates);

        await emitSessionDeletedUpdate({
            sessionId: session.id,
            accountId: actor.id,
            cursor: 99,
        });
        await waitFor(
            () => qualifiedUpdates.length === 2 && unqualifiedUpdates.length === unqualifiedCountBeforeDelete + 1,
            "typed post-delete Account hint",
        );
        await expectUnchangedFor(qualifiedUpdates);
        expect(qualifiedUpdates[1]).toMatchObject({ body: { t: "delete-session", sid: session.id } });
        expect(unqualifiedUpdates.at(-1)).toMatchObject({ body: { t: "delete-session", sid: session.id } });
    }, 60_000);
});
