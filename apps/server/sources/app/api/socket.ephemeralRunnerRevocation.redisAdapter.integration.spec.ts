import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { Redis } from "ioredis";
import { io as ioClient } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createMaterializedEphemeralRunnerFixture } from "@/app/ephemeralRunner/materializedRunner.testkit";
import { eventRouter } from "@/app/events/connectionEventRouter";
import { runPresenceTimeoutTick } from "@/app/presence/timeout";
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
    // in-process harness preserves that topology with two real Redis clients.
    getRedisClient: () => redisRuntime.activeClient,
    getRedisSocketClusterAdapterClient: () => redisRuntime.activeClient,
    getRedisSocketClusterClient: () => redisRuntime.activeClient,
    createRedisSocketClusterRelayAdmissionClient: () => redisRuntime.activeClient,
    closeRedisSocketClusterClient: () => {},
}));

vi.mock("@/utils/process/shutdown", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/utils/process/shutdown")>();
    return {
        ...actual,
        onShutdown: (_name: string, callback: () => Promise<void>) => {
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

async function startReplica(params: Readonly<{ instanceId: string; redis: Redis }>): Promise<StartedReplica> {
    redisRuntime.activeClient = params.redis;
    process.env.HAPPIER_INSTANCE_ID = params.instanceId;

    const app = Fastify({ logger: false }) as unknown as AppFastify;
    const priorShutdownCallbacks = shutdownRuntime.callbacks.length;
    startSocket(app);
    const stopSocket = shutdownRuntime.callbacks.at(priorShutdownCallbacks);
    if (!stopSocket) throw new Error("Socket replica did not register its shutdown callback");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) {
        await app.close();
        throw new Error("Failed to bind Socket.IO replica");
    }
    return { app, port, stopSocket };
}

function createClient(params: Readonly<{
    port: number;
    auth: Readonly<Record<string, unknown>>;
}>): ReturnType<typeof ioClient> {
    return ioClient(`http://127.0.0.1:${params.port}`, {
        path: "/v1/updates",
        transports: ["websocket"],
        reconnection: false,
        autoConnect: false,
        auth: { ...params.auth },
    });
}

function waitForConnection(socket: ReturnType<typeof ioClient>): Promise<"connected" | "rejected"> {
    return new Promise((resolve) => {
        socket.once("connect", () => resolve("connected"));
        socket.once("connect_error", () => resolve("rejected"));
        socket.connect();
    });
}

function waitForDisconnect(socket: ReturnType<typeof ioClient>, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} stayed connected after Runner revocation`)), 8_000);
        socket.once("disconnect", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

describe("ephemeral Runner revocation with the configured Redis adapter", () => {
    let harness: LightSqliteHarness;
    let redisMemory: RedisMemoryInstance = null;
    const replicas: StartedReplica[] = [];
    const redisClients: Redis[] = [];
    const clients: Array<ReturnType<typeof ioClient>> = [];

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-runner-socket-redis-",
            initAuth: true,
            env: {
                HANDY_MASTER_SECRET: "runner-socket-redis-secret",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            },
        });
    }, 120_000);

    afterEach(async () => {
        while (clients.length > 0) clients.pop()?.close();
        while (replicas.length > 0) {
            const replica = replicas.pop();
            if (!replica) continue;
            await replica.stopSocket();
            await replica.app.close();
        }
        while (redisClients.length > 0) await redisClients.pop()?.quit();
        if (redisMemory) {
            await redisMemory.stop();
            redisMemory = null;
        }
        redisRuntime.activeClient = null;
        eventRouter.clearIo();
        harness.resetEnv();
        await db.ephemeralRunnerActivation.deleteMany();
        await db.accessKey.deleteMany();
        await db.session.deleteMany();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("disconnects the exact Runner Session and Machine sockets on another replica when control-loss expiry revokes them", async () => {
        const resolvedRedis = await resolveRedisAdapterValidationRedisUrl({ env: process.env });
        redisMemory = resolvedRedis.redisMemory;
        harness.resetEnv({
            HANDY_MASTER_SECRET: "runner-socket-redis-secret",
            AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            HAPPIER_SOCKET_ADAPTER: "redis-streams",
            REDIS_URL: resolvedRedis.redisUrl,
            HAPPY_SERVER_FLAVOR: "full",
        });

        const controlLossFence = new Date(Date.now() - 30 * 60 * 1000);
        const fixture = await createMaterializedEphemeralRunnerFixture({
            sessionActive: true,
            sessionLastActiveAt: controlLossFence,
        });
        // An ordinary persistent Machine on the same Account proves the revoke
        // targets the exact Machine room rather than the Account fanout.
        const siblingMachineId = `sibling-machine-${randomUUID()}`;
        await db.machine.create({
            data: { id: siblingMachineId, accountId: fixture.accountId, metadata: "{}" },
        });

        const redisA = new Redis(resolvedRedis.redisUrl);
        const redisB = new Redis(resolvedRedis.redisUrl);
        redisClients.push(redisA, redisB);
        // Replica B starts last, so the timeout owner publishes through B while the
        // Runner sockets stay admitted on A: the disconnect must cross the adapter.
        const replicaA = await startReplica({ instanceId: "runner-revocation-replica-a", redis: redisA });
        const replicaB = await startReplica({ instanceId: "runner-revocation-replica-b", redis: redisB });
        replicas.push(replicaA, replicaB);

        const runnerSession = createClient({
            port: replicaA.port,
            auth: {
                token: fixture.token,
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
                machineId: fixture.machineId,
            },
        });
        const runnerMachine = createClient({
            port: replicaA.port,
            auth: {
                token: fixture.token,
                clientType: "machine-scoped",
                machineId: fixture.machineId,
                runtimeId: fixture.activationId,
                startupSource: "ephemeral-runner",
                installationId: fixture.installationId,
                installationPublicKey: fixture.installationPublicKey,
                installationProof: fixture.installationProof,
            },
        });
        const creator = createClient({
            port: replicaA.port,
            auth: { token: fixture.accountToken, clientType: "user-scoped" },
        });
        const siblingMachine = createClient({
            port: replicaA.port,
            auth: {
                token: fixture.accountToken,
                clientType: "machine-scoped",
                machineId: siblingMachineId,
            },
        });
        // The creator's own Session socket carries no Machine binding, so it is a
        // participant of the shared Session rather than a member of the exact
        // Session+Machine room the revoke disconnects.
        const humanSession = createClient({
            port: replicaB.port,
            auth: {
                token: fixture.accountToken,
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
            },
        });
        clients.push(runnerSession, runnerMachine, creator, siblingMachine, humanSession);
        await expect(Promise.all([
            waitForConnection(runnerSession),
            waitForConnection(runnerMachine),
            waitForConnection(creator),
            waitForConnection(siblingMachine),
            waitForConnection(humanSession),
        ])).resolves.toEqual(["connected", "connected", "connected", "connected", "connected"]);

        // Transport loss before the control-loss transition is not revocation:
        // the same bearer is still admitted on reconnect.
        runnerSession.close();
        const runnerSessionAfterTransientLoss = createClient({
            port: replicaA.port,
            auth: {
                token: fixture.token,
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
                machineId: fixture.machineId,
            },
        });
        clients.push(runnerSessionAfterTransientLoss);
        await expect(waitForConnection(runnerSessionAfterTransientLoss)).resolves.toBe("connected");

        const disconnected = Promise.all([
            waitForDisconnect(runnerSessionAfterTransientLoss, "Runner Session socket"),
            waitForDisconnect(runnerMachine, "Runner Machine socket"),
        ]);
        await runPresenceTimeoutTick({
            sessionTimeoutMs: 60_000,
            machineTimeoutMs: 60_000,
            tickMs: 60_000,
        });
        await disconnected;

        expect(creator.connected).toBe(true);
        expect(siblingMachine.connected).toBe(true);
        expect(humanSession.connected).toBe(true);
        await expect(db.machine.findUniqueOrThrow({
            where: { id: fixture.machineId },
            select: { active: true, revokedAt: true },
        })).resolves.toEqual({ active: false, revokedAt: expect.any(Date) });
        expect(await db.accessKey.count({
            where: { accountId: fixture.accountId, machineId: fixture.machineId },
        })).toBe(0);

        const sessionReconnect = createClient({
            port: replicaA.port,
            auth: {
                token: fixture.token,
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
                machineId: fixture.machineId,
            },
        });
        const machineReconnect = createClient({
            port: replicaB.port,
            auth: {
                token: fixture.token,
                clientType: "machine-scoped",
                machineId: fixture.machineId,
                runtimeId: fixture.activationId,
                startupSource: "ephemeral-runner",
                installationId: fixture.installationId,
                installationPublicKey: fixture.installationPublicKey,
                installationProof: fixture.installationProof,
            },
        });
        clients.push(sessionReconnect, machineReconnect);
        await expect(Promise.all([
            waitForConnection(sessionReconnect),
            waitForConnection(machineReconnect),
        ])).resolves.toEqual(["rejected", "rejected"]);
    }, 60_000);
});
