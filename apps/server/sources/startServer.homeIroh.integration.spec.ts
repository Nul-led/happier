import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createStartServerDbMocks,
    installStartServerDbModuleMock,
    installStartServerCommonWiringMocks,
} from "@/testkit/startServerMocks";
import { createStartServerHarness } from "@/testkit/startServerHarness";
import type { EnsureHomeIrohEndpointParams, HomeIrohEndpointState } from "@/app/iroh/homeIrohEndpoint";

const ensureHomeIrohEndpoint = vi.fn<(
    params: EnsureHomeIrohEndpointParams,
) => Promise<HomeIrohEndpointState>>(async (_params) => ({
    status: "unavailable",
    snapshot: null,
    failureReason: null,
}));
const stopHomeIrohEndpoint = vi.fn(async () => {});
vi.mock("@/app/iroh/homeIrohEndpoint", async () => {
    const actual = await vi.importActual<typeof import("@/app/iroh/homeIrohEndpoint")>("@/app/iroh/homeIrohEndpoint");
    return {
        ...actual,
        ensureHomeIrohEndpoint,
        stopHomeIrohEndpoint,
    };
});

const ping = vi.fn(async () => "PONG");
vi.mock("@/storage/redis/redis", () => ({
    getRedisClient: () => ({ ping }),
}));
vi.mock("@/app/events/createRedisStreamsRoomEmitter", () => ({
    createRedisStreamsRoomEmitter: vi.fn(() => ({})),
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { setIo: vi.fn() },
}));

const startServerDbMocks = createStartServerDbMocks({
    // Keep light-flavor startup out of the real sqlite migration path in tests.
    getDbProviderFromEnv: () => "pglite",
});

installStartServerDbModuleMock(startServerDbMocks);

installStartServerCommonWiringMocks();

// Avoid hanging in tests: startServer calls awaitShutdown().
vi.mock("@/utils/process/shutdown", async () => {
    const actual = await vi.importActual<any>("@/utils/process/shutdown");
    return { ...actual, awaitShutdown: vi.fn(async () => {}) };
});

describe("startServer managed Home Iroh composition", () => {
    const startServerHarness = createStartServerHarness({
        SERVER_ROLE: undefined,
        REDIS_URL: undefined,
        HAPPIER_SOCKET_ADAPTER: undefined,
        HAPPY_SOCKET_ADAPTER: undefined,
        HAPPIER_DB_PROVIDER: undefined,
        HAPPY_DB_PROVIDER: undefined,
        HAPPIER_SERVER_LIGHT_DATA_DIR: "/tmp/happier-home-iroh-startup",
        HAPPY_SERVER_LIGHT_DATA_DIR: "/tmp/happier-home-iroh-startup",
    });

    beforeEach(() => {
        startServerDbMocks.reset();
        ensureHomeIrohEndpoint.mockClear();
        stopHomeIrohEndpoint.mockClear();
        ping.mockClear();
        startServerHarness.reset();
    });

    afterEach(() => {
        startServerHarness.restore();
    });

    it.each(["all", "api"] as const)("composes the Home Iroh endpoint from the actual bound API port for the light flavor with role %s once anonymous signup is explicitly disabled", async (role) => {
        await startServerHarness.start("light", {
            SERVER_ROLE: role,
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            HAPPIER_PUBLIC_SERVER_URL: "http://127.0.0.1:3005",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).toHaveBeenCalledTimes(1);
        expect(ensureHomeIrohEndpoint.mock.calls[0]?.[0]).toMatchObject({ apiPort: 3005 });

        const { initiateShutdown } = await import("@/utils/process/shutdown");
        await initiateShutdown("test");
        expect(stopHomeIrohEndpoint).toHaveBeenCalledTimes(1);
    });

    it("keeps HTTP startup available and starts no Iroh endpoint when the canonical closure proof fails", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            HAPPIER_PUBLIC_SERVER_URL: "http://127.0.0.1:3005",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
        });

        expect(startServerHarness.startApi).toHaveBeenCalledTimes(1);
        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("starts no Iroh endpoint when the actual listener port differs from the managed port", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            PORT: "43123",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            HAPPIER_PUBLIC_SERVER_URL: "http://127.0.0.1:43123",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("does not compose the Personal Home acceptor for a generic light runtime with signup disabled", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "generic",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("never composes Iroh for the full server flavor", async () => {
        await startServerHarness.start("full", {
            SERVER_ROLE: "all",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("never composes Iroh for the worker-only role", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "worker",
            REDIS_URL: "redis://localhost:6379",
            HAPPIER_SOCKET_ADAPTER: "redis-streams",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("keeps the Home loopback-only and composes no Iroh while anonymous signup is explicitly enabled", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "1",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();

        const { initiateShutdown } = await import("@/utils/process/shutdown");
        await initiateShutdown("test");
        expect(stopHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("fails closed for the managed bootstrap default: unset anonymous signup composes no Iroh", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();

        const { initiateShutdown } = await import("@/utils/process/shutdown");
        await initiateShutdown("test");
        expect(stopHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("fails closed on a malformed anonymous-signup value instead of composing Iroh", async () => {
        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "not-a-boolean",
        });

        expect(ensureHomeIrohEndpoint).not.toHaveBeenCalled();

        const { initiateShutdown } = await import("@/utils/process/shutdown");
        await initiateShutdown("test");
        expect(stopHomeIrohEndpoint).not.toHaveBeenCalled();
    });

    it("keeps startup healthy and registers Iroh shutdown when the composed endpoint fails with signup closed", async () => {
        ensureHomeIrohEndpoint.mockImplementationOnce(async () => ({
            status: "failed" as const,
            snapshot: null,
            failureReason: "native_error" as const,
        }));

        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            HAPPIER_PUBLIC_SERVER_URL: "http://127.0.0.1:3005",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
        });

        expect(ensureHomeIrohEndpoint).toHaveBeenCalledTimes(1);

        const { initiateShutdown } = await import("@/utils/process/shutdown");
        await initiateShutdown("test");
        expect(stopHomeIrohEndpoint).toHaveBeenCalledTimes(1);
    });

    it("keeps the standard Home server usable when configured Iroh relay support is unavailable", async () => {
        ensureHomeIrohEndpoint.mockImplementationOnce(async () => ({
            status: "unavailable" as const,
            snapshot: null,
            failureReason: null,
        }));

        await startServerHarness.start("light", {
            SERVER_ROLE: "all",
            HAPPIER_MANAGED_RELAY_PURPOSE: "personal-home",
            HAPPIER_PUBLIC_SERVER_URL: "http://127.0.0.1:3005",
            AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
            HAPPIER_IROH_RELAY_POLICY: "automatic",
            HAPPIER_IROH_RELAY_URLS: "https://relay.example.test",
        });

        expect(ensureHomeIrohEndpoint).toHaveBeenCalledTimes(1);
    });
});
