import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RedisMockInstance = EventEmitter & {
    disconnect: ReturnType<typeof vi.fn>;
    duplicate: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    xadd: ReturnType<typeof vi.fn>;
};

const redisInstances: RedisMockInstance[] = [];
const redisConstructor = vi.fn(function RedisMock(_url?: string, _options?: unknown) {
    const instance: RedisMockInstance = Object.assign(new EventEmitter(), {
        disconnect: vi.fn(),
        // Raw ioredis `duplicate()` copies the same options object, which is
        // exactly the shared-state hazard the socket-cluster owner must avoid.
        duplicate: vi.fn(() => redisConstructor(_url, _options)),
        ping: vi.fn(),
        publish: vi.fn(),
        set: vi.fn(),
        xadd: vi.fn(),
    });
    redisInstances.push(instance);
    return instance;
});
const warn = vi.fn();

function redisConstructorOptions(index: number): {
    connectionName?: string;
    retryStrategy: (attempt: number) => number;
    socketTimeout?: number;
    maxRetriesPerRequest?: number | null;
} {
    return redisConstructor.mock.calls[index]?.[1] as {
        connectionName?: string;
        retryStrategy: (attempt: number) => number;
        socketTimeout?: number;
    };
}

vi.mock("ioredis", () => ({
    Redis: redisConstructor,
}));

vi.mock("@/utils/logging/log", () => ({
    warn,
}));

describe("getRedisClient", () => {
    beforeEach(() => {
        vi.resetModules();
        redisConstructor.mockClear();
        redisInstances.length = 0;
        warn.mockClear();
        process.env.REDIS_URL = "redis://user:secret@redis.example:6379";
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.REDIS_URL;
    });

    it("keeps ordinary shared-client blocking command semantics", async () => {
        const { getRedisClient } = await import("./redis.js");

        getRedisClient();

        expect(redisConstructor).toHaveBeenCalledWith("redis://user:secret@redis.example:6379");
        expect(redisInstances[0]?.listenerCount("error")).toBe(0);
    });

    it("bounds silent stalls only on the Socket.IO cluster client", async () => {
        const { getRedisSocketClusterClient } = await import("./redis.js");

        getRedisSocketClusterClient();

        expect(redisConstructor).toHaveBeenCalledWith(
            "redis://user:secret@redis.example:6379",
            expect.objectContaining({
                connectionName: "happier-socket-cluster:root",
                retryStrategy: expect.any(Function),
                socketTimeout: 5_000,
            }),
        );
        const options = redisConstructorOptions(0);
        expect(options.retryStrategy(1)).toBe(50);
        expect(options.retryStrategy(2)).toBe(100);
        expect(options.retryStrategy(100)).toBe(2_000);
        redisInstances[0]?.emit("connect");
        redisInstances[0]?.emit(
            "error",
            Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
        );
        expect(options.retryStrategy(2)).toBe(5_050);
        redisInstances[0]?.emit("connect");
        redisInstances[0]?.emit(
            "error",
            new Error("Socket timeout. Expecting data, but didn't receive any in 5000ms."),
        );
        expect(options.retryStrategy(1)).toBe(50);
    });

    it("bounds and sanitizes repeated Socket.IO cluster client error diagnostics", async () => {
        const { getRedisSocketClusterClient } = await import("./redis.js");
        const redis = getRedisSocketClusterClient();
        const rawError = Object.assign(
            new Error("getaddrinfo ENOTFOUND redis.example redis://user:secret@redis.example:6379"),
            { code: "ENOTFOUND" },
        );
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

        expect(() => {
            for (let index = 0; index < 100; index += 1) redis.emit("error", rawError);
        }).not.toThrow();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            {
                module: "redis-socket-cluster",
                event: "client_error",
                connection: "happier-socket-cluster:root",
                errorClass: "dns",
                suppressedSinceLastDiagnostic: 0,
            },
            "Socket.IO cluster Redis client error",
        );
        now.mockReturnValue(61_000);
        redis.emit("error", rawError);
        expect(warn).toHaveBeenLastCalledWith(
            {
                module: "redis-socket-cluster",
                event: "client_error",
                connection: "happier-socket-cluster:root",
                errorClass: "dns",
                suppressedSinceLastDiagnostic: 99,
            },
            "Socket.IO cluster Redis client error",
        );
        expect(warn).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("redis.example");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("getaddrinfo");
    });

    it("disconnects and resets only the dedicated Socket.IO cluster client", async () => {
        const {
            closeRedisSocketClusterClient,
            getRedisClient,
            getRedisSocketClusterClient,
        } = await import("./redis.js");
        getRedisClient();
        const cluster = getRedisSocketClusterClient();

        closeRedisSocketClusterClient();

        expect(redisInstances[1]?.disconnect).toHaveBeenCalledWith(false);
        expect(redisInstances[0]?.disconnect).not.toHaveBeenCalled();
        expect(getRedisSocketClusterClient()).not.toBe(cluster);
    });
});

describe("getRedisSocketClusterAdapterClient", () => {
    beforeEach(() => {
        vi.resetModules();
        redisConstructor.mockClear();
        redisInstances.length = 0;
        warn.mockClear();
        process.env.REDIS_URL = "redis://user:secret@redis.example:6379";
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.REDIS_URL;
    });

    it("forwards ordinary commands to the same instrumented root the tunnel owner consumes", async () => {
        const { getRedisSocketClusterAdapterClient, getRedisSocketClusterClient } =
            await import("./redis.js");

        getRedisSocketClusterClient();
        const adapterClient = getRedisSocketClusterAdapterClient();

        // The adapter-facing wrapper must not become a second root connection.
        expect(redisConstructor).toHaveBeenCalledTimes(1);
        adapterClient.ping();
        expect(redisInstances[0]?.ping).toHaveBeenCalledTimes(1);
    });

    it("gives every adapter-created duplicate independent retry state, diagnostics, and instrumentation", async () => {
        const { getRedisSocketClusterAdapterClient } = await import("./redis.js");
        const adapterClient = getRedisSocketClusterAdapterClient();

        const readerClient = adapterClient.duplicate();
        const subscriberClient = adapterClient.duplicate();

        // Root + blocking stream reader + Pub/Sub subscriber at streamCount = 1.
        expect(redisConstructor).toHaveBeenCalledTimes(3);
        expect([0, 1, 2].map((index) => redisConstructorOptions(index).connectionName)).toEqual([
            "happier-socket-cluster:root",
            "happier-socket-cluster:adapter-1",
            "happier-socket-cluster:adapter-2",
        ]);
        const { redisCommandsCounter } = await import("@/app/monitoring/metrics/redisMetrics");
        const pingCount = async (): Promise<number> => (await redisCommandsCounter.get()).values
            .filter((entry) => entry.labels.command === "ping" && entry.labels.result === "ok")
            .reduce((total, entry) => total + entry.value, 0);
        const beforePings = await pingCount();
        await readerClient.ping();
        await subscriberClient.ping();
        expect(await pingCount()).toBe(beforePings + 2);

        // Each duplicate keeps its own socketTimeout stall bound.
        expect(redisConstructorOptions(1).socketTimeout).toBe(5_000);
        expect(redisConstructorOptions(2).socketTimeout).toBe(5_000);
        // The upstream adapter starts its subscriber without awaiting the
        // subscribe promise. Keep an outage from surfacing as an unhandled
        // max-retries rejection on that adapter-owned connection.
        expect(redisConstructorOptions(1).maxRetriesPerRequest).toBeNull();
        expect(redisConstructorOptions(2).maxRetriesPerRequest).toBeNull();

        // A transport close observed by the reader must not stretch the
        // subscriber's reconnect delay. Sharing one retry closure (the raw
        // ioredis `duplicate()` behavior) would answer 5_050 here.
        redisInstances[1]?.emit("connect");
        expect(redisConstructorOptions(2).retryStrategy(2)).toBe(100);
        expect(redisConstructorOptions(1).retryStrategy(2)).toBe(5_050);
    });

    it("labels each connection's error diagnostics so a failing duplicate is identifiable", async () => {
        const { getRedisSocketClusterAdapterClient } = await import("./redis.js");
        const adapterClient = getRedisSocketClusterAdapterClient();
        adapterClient.duplicate();

        redisInstances[1]?.emit(
            "error",
            Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        );

        expect(warn).toHaveBeenCalledWith(
            {
                module: "redis-socket-cluster",
                event: "client_error",
                connection: "happier-socket-cluster:adapter-1",
                errorClass: "connection",
                suppressedSinceLastDiagnostic: 0,
            },
            "Socket.IO cluster Redis client error",
        );
    });

    it("closes only the root and leaves duplicate lifecycle to the adapter", async () => {
        const {
            closeRedisSocketClusterClient,
            getRedisSocketClusterAdapterClient,
        } = await import("./redis.js");
        const adapterClient = getRedisSocketClusterAdapterClient();
        adapterClient.duplicate();

        closeRedisSocketClusterClient();

        expect(redisInstances[0]?.disconnect).toHaveBeenCalledWith(false);
        expect(redisInstances[1]?.disconnect).not.toHaveBeenCalled();
        expect(getRedisSocketClusterAdapterClient()).not.toBe(adapterClient);
        expect(redisConstructorOptions(2).connectionName).toBe("happier-socket-cluster:root");
    });

    it("marks adapter fire-and-forget command failures handled without changing their returned promise", async () => {
        const { getRedisSocketClusterAdapterClient } = await import("./redis.js");
        const adapterClient = getRedisSocketClusterAdapterClient();
        const error = new Error("adapter publish failed");
        redisInstances[0]!.publish.mockRejectedValue(error);
        redisInstances[0]!.set.mockRejectedValue(error);
        redisInstances[0]!.xadd.mockRejectedValue(error);

        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
        process.on("unhandledRejection", onUnhandled);
        try {
            // The upstream adapter deliberately does not await these calls.
            await expect(adapterClient.publish("socket.io", "payload")).rejects.toBe(error);
            adapterClient.set("socket.io:session", "payload");
            adapterClient.xadd("socket.io", "payload");
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });
});

describe("createRedisSocketClusterRelayAdmissionClient", () => {
    beforeEach(() => {
        vi.resetModules();
        redisConstructor.mockClear();
        redisInstances.length = 0;
        warn.mockClear();
        process.env.REDIS_URL = "redis://user:secret@redis.example:6379";
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.REDIS_URL;
    });

    it("creates a distinct independently instrumented fail-closed relay-admission connection", async () => {
        const {
            closeRedisSocketClusterClient,
            createRedisSocketClusterRelayAdmissionClient,
            getRedisSocketClusterClient,
        } = await import("./redis.js");

        const root = getRedisSocketClusterClient();
        const relayAdmission = createRedisSocketClusterRelayAdmissionClient();

        expect(redisConstructor).toHaveBeenCalledTimes(2);
        expect(redisConstructorOptions(1)).toMatchObject({
            connectionName: "happier-socket-cluster:relay-admission",
            maxRetriesPerRequest: 0,
            socketTimeout: 2_000,
        });
        expect(redisConstructorOptions(1).retryStrategy(1)).toBe(50);
        expect(redisConstructorOptions(1).retryStrategy(100)).toBe(2_000);

        const { redisCommandsCounter } = await import("@/app/monitoring/metrics/redisMetrics");
        const pingCount = async (): Promise<number> => (await redisCommandsCounter.get()).values
            .filter((entry) => entry.labels.command === "ping" && entry.labels.result === "ok")
            .reduce((total, entry) => total + entry.value, 0);
        const beforePings = await pingCount();
        await relayAdmission.ping();
        expect(await pingCount()).toBe(beforePings + 1);

        redisInstances[1]?.emit(
            "error",
            Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        );
        expect(warn).toHaveBeenCalledWith(
            {
                module: "redis-socket-cluster",
                event: "client_error",
                connection: "happier-socket-cluster:relay-admission",
                errorClass: "connection",
                suppressedSinceLastDiagnostic: 0,
            },
            "Socket.IO cluster Redis client error",
        );

        closeRedisSocketClusterClient();
        expect(redisInstances[0]?.disconnect).toHaveBeenCalledWith(false);
        expect(redisInstances[1]?.disconnect).not.toHaveBeenCalled();
        expect(root).not.toBe(relayAdmission);
    });
});
