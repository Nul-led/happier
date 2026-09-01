import { join } from "node:path";
import type { AddressInfo } from "node:net";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { io as ioClient } from "socket.io-client";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    createIrohNodeNativeModule,
    loadIrohNodeNative,
    loadIrohNodeNativeAddon,
} from "@happier-dev/iroh-native/node";
import { resolvePersonalHomeRuntimeLayout } from "@happier-dev/cli-common/firstPartyRuntime";
import { FeaturesResponseSchema, type HomeConnectionDescriptorV1 } from "@happier-dev/protocol";

import { registerApiRoutes } from "@/app/api/api";
import { startSocket } from "@/app/api/socket";
import type { Fastify as AppFastify } from "@/app/api/types";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { enableMonitoring } from "@/app/api/utils/enableMonitoring";
import { resolveApiRateLimitPluginOptions } from "@/app/api/utils/apiRateLimitPolicy";
import { auth } from "@/app/auth/auth";
import { initializeServerIdentityCache } from "@/app/serverIdentity/serverIdentity";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    ensureHomeIrohEndpoint,
    getHomeIrohEndpointState,
    stopHomeIrohEndpoint,
} from "./homeIrohEndpoint";
import {
    HOME_IROH_RELAY_POLICY_ENV_KEY,
    HOME_IROH_RELAY_URLS_ENV_KEY,
} from "./homeIrohEndpointConfig";
import { loadHomeIrohNativeLifecycleFromModule } from "./homeIrohNativeLifecycle";

type TestDaemonIrohRuntime = Readonly<{
    available: boolean;
    ensureHomeTunnel?: (input: Readonly<{
        descriptor: HomeConnectionDescriptorV1;
    }>) => Promise<Readonly<{
        runtimeOrigin: string;
        observedPath: "direct" | "relay" | "unknown";
        release: () => Promise<void>;
    }>>;
    shutdown: () => Promise<void>;
}>;

type CreateTestDaemonIrohRuntime = (input: Readonly<{
    happyHomeDir: string;
    relayConfig: Readonly<{
        relayPolicy: "automatic" | "disabled";
        relayUrls: readonly string[];
    }>;
    native: ReturnType<typeof createIrohNodeNativeModule>;
}>) => Promise<TestDaemonIrohRuntime>;

async function loadTestDaemonIrohRuntimeFactory(): Promise<CreateTestDaemonIrohRuntime> {
    // This is a cross-process composition fixture. Resolve the CLI composition
    // root at runtime so the server package's source-only typecheck does not
    // absorb the CLI application's private source tree into its rootDir.
    const modulePath = "../../../../cli/src/daemon/peer/iroh/daemonMachineIrohRuntime";
    const module = await vi.importActual<Readonly<{
        createDaemonMachineIrohRuntime: CreateTestDaemonIrohRuntime;
    }>>(modulePath);
    return module.createDaemonMachineIrohRuntime;
}

const CANONICAL_HOME_URL = "https://home-iroh-composed.invalid";

type NativeIrohTestController = Readonly<{
    forceDirectOnly(): Promise<string>;
    forceRelayOnly(): Promise<string>;
    restoreAutomatic(): Promise<string>;
    getObservedPath(): "direct" | "relay" | "unknown";
    getTestRelayUrl(): string | null;
}>;

function requireSuccessfulTestControllerOperation(raw: string): void {
    const envelope = JSON.parse(raw) as { ok?: unknown; error?: { message?: unknown } };
    if (envelope.ok !== true) {
        throw new Error(
            typeof envelope.error?.message === "string"
                ? envelope.error.message
                : "Iroh native test controller operation failed",
        );
    }
}

async function setTestTopology(
    controller: NativeIrohTestController,
    topology: "direct" | "relay",
): Promise<void> {
    const raw = topology === "direct"
        ? await controller.forceDirectOnly()
        : await controller.forceRelayOnly();
    requireSuccessfulTestControllerOperation(raw);
}

async function restoreTestTopology(controller: NativeIrohTestController): Promise<void> {
    requireSuccessfulTestControllerOperation(await controller.restoreAutomatic());
}

function createProductionProtocolApp(): AppFastify {
    const app = Fastify({ logger: false });
    app.register(import("@fastify/rate-limit"), resolveApiRateLimitPluginOptions(process.env));
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as AppFastify;
    enableMonitoring(typed);
    enableAuthentication(typed);
    startSocket(typed);
    registerApiRoutes(typed);
    return typed;
}

function waitForSocketConnection(socket: ReturnType<typeof ioClient>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for Socket.IO connection through Iroh"));
        }, 10_000);
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
}

async function expectOriginDown(origin: string): Promise<void> {
    await expect(fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
}

describe("composed Home Iroh application bytes", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-home-iroh-composed-",
            initAuth: true,
            initEncrypt: true,
            env: {
                HAPPIER_CANONICAL_SERVER_URL: CANONICAL_HOME_URL,
                HAPPIER_IROH_RELAY_POLICY: "disabled",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_ANONYMOUS_SIGNUP_ENABLED: "0",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
                AUTH_LOGIN_ELIGIBILITY_ACCOUNT_SNAPSHOT_CACHE_TTL_MS: "0",
            },
        });
    }, 120_000);

    afterEach(async () => {
        await stopHomeIrohEndpoint();
        harness.resetEnv();
        vi.unstubAllGlobals();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await stopHomeIrohEndpoint();
        await harness.close();
    });

    it.each([
        { topology: "direct" as const, expectedPath: "direct" as const },
        { topology: "relay" as const, expectedPath: "relay" as const },
    ])("moves authenticated HTTP and WebSocket bytes through the production Home acceptor over $topology", { timeout: 120_000 }, async ({ topology, expectedPath }) => {
        expect(process.env.HAPPIER_IROH_REQUIRE_NODE_ADDON).toBe("1");
        const explicitAddonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH?.trim();
        if (!explicitAddonPath) {
            throw new Error("The real Iroh application-byte fixture requires an explicit test-feature addon path");
        }
        const rawAddon = loadIrohNodeNativeAddon(explicitAddonPath);
        const testController = rawAddon as unknown as NativeIrohTestController;
        for (const operation of ["forceDirectOnly", "forceRelayOnly", "restoreAutomatic", "getObservedPath", "getTestRelayUrl"] as const) {
            if (typeof testController[operation] !== "function") {
                throw new Error(`Iroh addon is not a test-relay-fixture build: missing ${operation}`);
            }
        }
        await setTestTopology(testController, topology);
        expect(testController.getObservedPath()).toBe("unknown");
        if (topology === "relay") {
            const relayUrl = testController.getTestRelayUrl();
            if (!relayUrl) throw new Error("Forced-relay native fixture did not publish its test relay URL");
            process.env[HOME_IROH_RELAY_POLICY_ENV_KEY] = "automatic";
            process.env[HOME_IROH_RELAY_URLS_ENV_KEY] = relayUrl;
        } else {
            process.env[HOME_IROH_RELAY_POLICY_ENV_KEY] = "disabled";
            delete process.env[HOME_IROH_RELAY_URLS_ENV_KEY];
        }
        const loaded = explicitAddonPath
            ? {
                available: true as const,
                native: createIrohNodeNativeModule(rawAddon),
            }
            : loadIrohNodeNative();
        if (!loaded.available) throw new Error(`Required Iroh Node lifecycle addon unavailable: ${loaded.message}`);
        const native = loaded.native;
        const homeNativeLifecycle = loadHomeIrohNativeLifecycleFromModule(native);
        if (!homeNativeLifecycle) throw new Error("Required Iroh Home acceptor lifecycle is unavailable");
        // startServer initializes this cache before registering/serving routes.
        // This lower-level composed fixture must preserve that production order.
        await initializeServerIdentityCache(process.env);
        const app = createProductionProtocolApp();
        let daemonIrohRuntime: TestDaemonIrohRuntime | null = null;
        let releaseDaemonHomeTunnel: (() => Promise<void>) | null = null;
        let runtimeOrigin: string | null = null;
        let socket: ReturnType<typeof ioClient> | null = null;

        try {
            await app.listen({ port: 0, host: "127.0.0.1" });
            const address = app.server.address() as AddressInfo | null;
            if (!address?.port) throw new Error("Fastify did not bind a loopback port");

            const homeState = await ensureHomeIrohEndpoint({
                env: process.env,
                apiPort: address.port,
                native: homeNativeLifecycle,
            });
            expect(homeState).toMatchObject({
                status: "active",
                failureReason: null,
                snapshot: {
                    canonicalServerUrl: CANONICAL_HOME_URL,
                    revision: expect.any(Number),
                    endpoint: {
                        endpointId: expect.any(String),
                        ...(topology === "relay"
                            ? { relayUrls: expect.arrayContaining([expect.any(String)]) }
                            : { directAddresses: expect.arrayContaining([expect.any(String)]) }),
                    },
                },
            });
            if (!homeState.snapshot) throw new Error("Home Iroh endpoint did not publish its descriptor");

            const createDaemonMachineIrohRuntime = await loadTestDaemonIrohRuntimeFactory();
            daemonIrohRuntime = await createDaemonMachineIrohRuntime({
                happyHomeDir: join(harness.baseDir, "remote-daemon"),
                relayConfig: {
                    relayPolicy: topology === "relay" ? "automatic" : "disabled",
                    relayUrls: homeState.snapshot.endpoint.relayUrls ?? [],
                },
                native,
            });
            if (!daemonIrohRuntime.available || !daemonIrohRuntime.ensureHomeTunnel) {
                throw new Error("Required daemon Iroh runtime is unavailable");
            }
            const tunnel = await daemonIrohRuntime.ensureHomeTunnel({
                descriptor: {
                    v: 1,
                    homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                    canonicalServerUrl: homeState.snapshot.canonicalServerUrl,
                    revision: homeState.snapshot.revision,
                    endpoints: [{
                        kind: "iroh",
                        ...homeState.snapshot.endpoint,
                    }],
                },
            });
            releaseDaemonHomeTunnel = tunnel.release;
            runtimeOrigin = tunnel.runtimeOrigin;

            expect(tunnel).toMatchObject({
                observedPath: expectedPath,
            });
            expect(runtimeOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
            expect(new URL(runtimeOrigin).port).not.toBe(String(address.port));
            expect(runtimeOrigin).not.toBe(CANONICAL_HOME_URL);

            const healthResponse = await fetch(`${runtimeOrigin}/health`);
            expect(healthResponse.status).toBe(200);
            await expect(healthResponse.json()).resolves.toMatchObject({
                status: "ok",
                service: "happier-server",
            });

            // The public response never exposes direct-address hints. A relay-backed
            // descriptor remains useful without them; a direct-only descriptor is
            // intentionally available only after Home authentication.
            const featuresResponse = await fetch(`${runtimeOrigin}/v1/features`);
            expect(featuresResponse.status).toBe(200);
            const featuresPayload = FeaturesResponseSchema.parse(await featuresResponse.json());
            const publishedDescriptor = featuresPayload.homeConnectionDescriptor;
            expect(publishedDescriptor).toMatchObject({
                homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                endpoints: [{ kind: "iroh", endpointId: homeState.snapshot.endpoint.endpointId }],
            });
            if (!publishedDescriptor) throw new Error("Home feature response omitted its public descriptor");
            expect(publishedDescriptor?.endpoints[0]).not.toHaveProperty("directAddresses");

            const missingAuthResponse = await fetch(`${runtimeOrigin}/v1/auth/ping`);
            expect(missingAuthResponse.status).toBe(401);
            const invalidAuthResponse = await fetch(`${runtimeOrigin}/v1/auth/ping`, {
                headers: { authorization: "Bearer invalid-home-token" },
            });
            expect(invalidAuthResponse.status).toBe(401);

            const signupSeed = new Uint8Array(32).fill(31);
            const signupKeyPair = tweetnacl.sign.keyPair.fromSeed(signupSeed);
            const signupChallenge = new Uint8Array(32).fill(17);
            const signupSignature = tweetnacl.sign.detached(signupChallenge, signupKeyPair.secretKey);
            const signupResponse = await fetch(`${runtimeOrigin}/v1/auth`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    publicKey: privacyKit.encodeBase64(new Uint8Array(signupKeyPair.publicKey)),
                    challenge: privacyKit.encodeBase64(signupChallenge),
                    signature: privacyKit.encodeBase64(new Uint8Array(signupSignature)),
                }),
            });
            expect(signupResponse.status).toBe(403);
            await expect(signupResponse.json()).resolves.toEqual({ error: "signup-disabled" });

            const account = await db.account.create({
                data: { publicKey: "composed-home-iroh-account" },
                select: { id: true },
            });
            const token = await auth.createToken(account.id, undefined, {
                kind: "account",
                authority: "present_user",
            });
            const authorization = `Bearer ${token}`;
            const pingResponse = await fetch(`${runtimeOrigin}/v1/auth/ping`, {
                headers: { authorization },
            });
            expect(pingResponse.status).toBe(200);
            await expect(pingResponse.json()).resolves.toEqual({ ok: true });

            const authenticatedFeaturesResponse = await fetch(`${runtimeOrigin}/v1/features/authenticated`, {
                headers: { authorization },
            });
            expect(authenticatedFeaturesResponse.status).toBe(200);
            const authenticatedFeatures = FeaturesResponseSchema.parse(await authenticatedFeaturesResponse.json());
            expect(authenticatedFeatures.homeConnectionDescriptor).toEqual({
                v: 1,
                homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                canonicalServerUrl: homeState.snapshot.canonicalServerUrl,
                revision: publishedDescriptor.revision,
                endpoints: [{ kind: "iroh", ...homeState.snapshot.endpoint }],
            });

            const profileResponse = await fetch(`${runtimeOrigin}/v1/account/profile`, {
                headers: { authorization },
            });
            expect(profileResponse.status).toBe(200);
            await expect(profileResponse.json()).resolves.toMatchObject({ id: account.id });

            const sessionsResponse = await fetch(`${runtimeOrigin}/v1/sessions`, {
                headers: { authorization },
            });
            expect(sessionsResponse.status).toBe(200);
            await expect(sessionsResponse.json()).resolves.toMatchObject({ sessions: [] });

            socket = ioClient(runtimeOrigin, {
                path: "/v1/updates",
                transports: ["websocket"],
                upgrade: false,
                reconnection: false,
                autoConnect: false,
                auth: { token },
            });
            const connected = waitForSocketConnection(socket);
            socket.connect();
            await connected;
            await expect(socket.timeout(15_000).emitWithAck("ping")).resolves.toEqual({});
            expect(socket.io.engine.transport.name).toBe("websocket");

            expect(testController.getObservedPath()).toBe(expectedPath);
            const acceptor = await native.startHomeAcceptor({
                endpointHandle: resolvePersonalHomeRuntimeLayout({ env: process.env }).irohEndpointKeyPath,
                targetHost: "127.0.0.1",
                targetPort: address.port,
            });
            expect(acceptor).toMatchObject({
                reused: true,
                status: {
                    running: true,
                    streamsAccepted: expect.any(Number),
                    lastPath: {
                        observedPath: expectedPath,
                        isRelay: expectedPath === "relay",
                    },
                },
            });
            expect(acceptor.status.streamsAccepted).toBeGreaterThanOrEqual(2);
            await expect(restoreTestTopology(testController)).rejects.toThrow(
                /cannot change while native endpoints are active/,
            );
        } finally {
            try {
                socket?.close();
                await releaseDaemonHomeTunnel?.();
                if (runtimeOrigin) await expectOriginDown(runtimeOrigin);
                await daemonIrohRuntime?.shutdown();
                await stopHomeIrohEndpoint();
                await expect(getHomeIrohEndpointState()).resolves.toEqual({
                    status: "not-composed",
                    snapshot: null,
                    failureReason: null,
                });
            } finally {
                try {
                    await app.close();
                } finally {
                    await restoreTestTopology(testController);
                    expect(testController.getObservedPath()).toBe("unknown");
                }
            }
        }
    });
});
