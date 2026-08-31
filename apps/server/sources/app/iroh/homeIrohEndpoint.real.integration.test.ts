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

import { registerApiRoutes } from "@/app/api/api";
import { startSocket } from "@/app/api/socket";
import type { Fastify as AppFastify } from "@/app/api/types";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { enableMonitoring } from "@/app/api/utils/enableMonitoring";
import { resolveApiRateLimitPluginOptions } from "@/app/api/utils/apiRateLimitPolicy";
import { auth } from "@/app/auth/auth";
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
                HAPPIER_PUBLIC_SERVER_URL: CANONICAL_HOME_URL,
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
        const app = createProductionProtocolApp();
        let clientEndpointHandle: string | null = null;
        let tunnelId: string | null = null;
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

            const clientEndpoint = await native.createEndpoint({
                keyPath: join(harness.baseDir, "client-iroh-endpoint.key"),
                relayPolicy: "disabled",
                capProfile: "homeInteractive",
            });
            clientEndpointHandle = clientEndpoint.endpointHandle;
            const tunnel = await native.ensureHomeTunnel({
                endpointHandle: clientEndpoint.endpointHandle,
                homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                endpointId: homeState.snapshot.endpoint.endpointId,
                directAddresses: homeState.snapshot.endpoint.directAddresses,
                relayUrls: homeState.snapshot.endpoint.relayUrls,
                descriptorRevision: homeState.snapshot.revision,
            });
            tunnelId = tunnel.tunnelId;
            runtimeOrigin = tunnel.runtimeOrigin;

            expect(tunnel).toMatchObject({
                homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                homeEndpointId: homeState.snapshot.endpoint.endpointId,
                carrier: "iroh",
                observedPath: expectedPath,
                descriptorRevision: homeState.snapshot.revision,
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

            // Product discovery uses the ordinary Home feature response. Prove
            // the endpoint owner projects the exact live descriptor through the
            // same direct/relay tunnel; the fixture must not rely on its private
            // Home state snapshot as a substitute for production publication.
            const featuresResponse = await fetch(`${runtimeOrigin}/v1/features`);
            expect(featuresResponse.status).toBe(200);
            await expect(featuresResponse.json()).resolves.toMatchObject({
                homeConnectionDescriptor: {
                    v: 1,
                    homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                    canonicalServerUrl: homeState.snapshot.canonicalServerUrl,
                    revision: homeState.snapshot.revision,
                    endpoints: [
                        {
                            kind: "iroh",
                            endpointId: homeState.snapshot.endpoint.endpointId,
                            ...(topology === "relay"
                                ? { relayUrls: homeState.snapshot.endpoint.relayUrls }
                                : { directAddresses: homeState.snapshot.endpoint.directAddresses }),
                        },
                    ],
                },
            });

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
            await expect(socket.timeout(5_000).emitWithAck("ping")).resolves.toEqual({});
            expect(socket.io.engine.transport.name).toBe("websocket");

            const tunnelStatus = await native.getTunnelStatus(tunnel.tunnelId);
            expect(tunnelStatus).toMatchObject({
                tunnelId: tunnel.tunnelId,
                homeServerIdentityId: homeState.snapshot.homeServerIdentityId,
                runtimeOrigin,
                observedPath: expectedPath,
                connectionActive: true,
                descriptorRevision: homeState.snapshot.revision,
            });
            expect(tunnelStatus?.streamsOpened).toBeGreaterThanOrEqual(2);
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
                if (tunnelId) {
                    await native.releaseHomeTunnel(tunnelId);
                    await expect(native.getTunnelStatus(tunnelId)).resolves.toBeNull();
                }
                if (runtimeOrigin) await expectOriginDown(runtimeOrigin);
                if (clientEndpointHandle) {
                    await native.shutdownEndpoint({ endpointHandle: clientEndpointHandle });
                    await expect(native.getEndpointStatus(clientEndpointHandle)).resolves.toBeNull();
                }
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
