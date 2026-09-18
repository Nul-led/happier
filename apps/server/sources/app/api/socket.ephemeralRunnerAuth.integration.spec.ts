import Fastify from "fastify";
import * as privacyKit from "privacy-kit";
import { randomUUID } from "node:crypto";
import { io as ioClient } from "socket.io-client";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signMachineInstallationProof } from "@happier-dev/protocol/machines/identity/installationIdentity";
import {
    encodePeerTcpTunnelBinaryFrameV2,
    PEER_TCP_TUNNEL_BINARY_FRAME_ENCODING_V2,
    PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT,
    type PeerTcpTunnelRelayEnvelope,
} from "@happier-dev/protocol";
import { RPC_ERROR_CODES, RPC_METHODS } from "@happier-dev/protocol/rpc";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";

import { auth } from "@/app/auth/auth";
import { revokeMachineInTx } from "@/app/machines/machineMutations";
import { mintProviderBrokerRelayAuthorizationV2 } from "@/app/machines/peer/mediation/tunnel/authorization";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { peerMediationGrantSigningEnv } from "@/testkit/env";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { startSocket } from "./socket";
import type { Fastify as AppFastify } from "./types";

function waitForConnection(socket: ReturnType<typeof ioClient>): Promise<"connected" | "rejected"> {
    return new Promise((resolve) => {
        socket.once("connect", () => resolve("connected"));
        socket.once("connect_error", () => resolve("rejected"));
        socket.connect();
    });
}

function registerRpcMethod(socket: ReturnType<typeof ioClient>, method: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out registering RPC method: ${method}`));
        }, 5_000);
        const cleanup = () => {
            clearTimeout(timeout);
            socket.off(SOCKET_RPC_EVENTS.REGISTERED, onRegistered);
            socket.off(SOCKET_RPC_EVENTS.ERROR, onError);
        };
        const onRegistered = (payload: unknown) => {
            if (
                payload
                && typeof payload === "object"
                && (payload as { method?: unknown }).method === method
            ) {
                cleanup();
                resolve();
            }
        };
        const onError = (payload: unknown) => {
            cleanup();
            reject(new Error(`RPC registration failed: ${JSON.stringify(payload)}`));
        };
        socket.on(SOCKET_RPC_EVENTS.REGISTERED, onRegistered);
        socket.on(SOCKET_RPC_EVENTS.ERROR, onError);
        socket.emit(SOCKET_RPC_EVENTS.REGISTER, { method });
    });
}

describe("ephemeral Runner socket admission", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-runner-socket-",
            initAuth: true,
            env: {
                HANDY_MASTER_SECRET: "runner-socket-secret",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: "1",
                ...peerMediationGrantSigningEnv(),
            },
        });
    }, 120_000);

    afterEach(async () => {
        await db.ephemeralRunnerActivation.deleteMany();
        await db.accessKey.deleteMany();
        await db.session.deleteMany();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    async function createFixture() {
        const account = await db.account.create({
            data: { publicKey: `runner-socket-${randomUUID()}`, encryptionMode: "plain" },
        });
        const activationId = randomUUID();
        const sessionId = `runner-session-${randomUUID()}`;
        const machineId = `runner-machine-${randomUUID()}`;
        const installationId = `runner-installation-${randomUUID()}`;
        const installation = tweetnacl.sign.keyPair();
        const installationPublicKey = privacyKit.encodeBase64(
            Uint8Array.from(installation.publicKey),
            "base64url",
        ).replace(/=+$/u, "");
        const installationPrivateKey = privacyKit.encodeBase64(
            Uint8Array.from(installation.secretKey),
            "base64url",
        ).replace(/=+$/u, "");
        await db.session.create({
            data: {
                id: sessionId,
                accountId: account.id,
                tag: `runner-tag-${randomUUID()}`,
                metadata: "{}",
                encryptionMode: "plain",
                metadataLayoutVersion: 1,
            },
        });
        await db.machine.create({
            data: {
                id: machineId,
                accountId: account.id,
                kind: "ephemeral_session_runner",
                metadata: "{}",
                installationId,
                installationPublicKey: Buffer.from(installation.publicKey),
            },
        });
        await db.accessKey.create({
            data: { accountId: account.id, sessionId, machineId, data: "runner-scoped-access" },
        });
        await db.ephemeralRunnerActivation.create({
            data: {
                id: activationId,
                creatorAccountId: account.id,
                creatorTokenEpoch: account.tokenEpoch,
                draftId: `runner-draft-${randomUUID()}`,
                sessionId,
                machineId,
                state: "materialized",
                workspacePolicy: "choose_on_endpoint",
                homeServerIdentityId: "srv_runner_socket",
                activationSigningPublicKey: installationPublicKey,
                authoringCommitment: "a".repeat(43),
                artifact: {},
                endpointFactsRecipient: { mode: "plain", creatorAccountId: account.id },
            },
        });
        const principal = {
            kind: "ephemeral_session_runner" as const,
            authority: "session_runtime" as const,
            accountId: account.id,
            activationId,
            sessionId,
            machineId,
            installationId,
            installationPublicKey,
            creatorTokenEpoch: account.tokenEpoch,
        };
        const token = await auth.createToken(
            account.id,
            { ephemeralSessionRunnerPrincipal: principal },
            { kind: "ephemeral_session_runner", authority: "session_runtime" },
        );
        const accountToken = await auth.createToken(
            account.id,
            undefined,
            { kind: "account", authority: "present_user" },
        );
        const installationProof = signMachineInstallationProof({
            payload: { version: 1, installationId, machineId, accountId: account.id },
            privateKey: installationPrivateKey,
        });
        return { account, activationId, sessionId, machineId, installationId, installationPublicKey, installationProof, token, accountToken };
    }

    function createProviderBrokerOpen(input: Readonly<{
        accountId: string;
        targetMachineId: string;
        relaySocketId: string;
        tunnelId: string;
    }>): PeerTcpTunnelRelayEnvelope {
        const signing = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
        const minted = mintProviderBrokerRelayAuthorizationV2({
            accountId: input.accountId,
            targetMachineId: input.targetMachineId,
            relaySocketId: input.relaySocketId,
            binding: {
                v: 1,
                kind: "external_api_key",
                teamId: "runner-relay-team",
                resourceId: "runner-relay-resource",
                requestId: `request-${input.tunnelId}`,
                externalApiKeyId: "550e8400-e29b-41d4-a716-446655440000",
                assignedAccountId: input.accountId,
                assignedTeamMembershipId: "runner-relay-membership",
            },
            tunnelId: input.tunnelId,
            nowMs: Date.now(),
            ttlMs: 30_000,
            serverGateEnabled: true,
            serverCaps: {
                maxBytes: 1024 * 1024,
                maxFrameBytes: 64 * 1024,
                maxIdleMs: 10_000,
                maxDurationMs: 30_000,
            },
            signingKey: { keyId: "testkit_signing_key", secretKey: signing.secretKey },
        });
        if (!minted.ok) throw new Error(`failed to mint test relay grant: ${minted.reasonCode}`);
        return {
            v: 1,
            scopeUserId: input.accountId,
            sender: { kind: "user", socketId: input.relaySocketId },
            recipient: { kind: "machine", machineId: input.targetMachineId },
            frame: {
                v: 1,
                kind: "open",
                open: {
                    v: 1,
                    kind: "open",
                    tunnelId: input.tunnelId,
                    targetMachineId: input.targetMachineId,
                    routeKind: "server_relay",
                    selectedEncoding: PEER_TCP_TUNNEL_BINARY_FRAME_ENCODING_V2,
                    relayAuthorization: minted.relayAuthorization,
                },
            },
        };
    }

    function waitForRelayEnvelope(
        socket: ReturnType<typeof ioClient>,
        predicate: (envelope: PeerTcpTunnelRelayEnvelope) => boolean,
    ): Promise<PeerTcpTunnelRelayEnvelope> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error("Timed out waiting for peer tunnel relay envelope"));
            }, 2_000);
            const cleanup = () => {
                clearTimeout(timeout);
                socket.off(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, onEnvelope);
            };
            const onEnvelope = (raw: unknown) => {
                const envelope = raw as PeerTcpTunnelRelayEnvelope;
                if (!predicate(envelope)) return;
                cleanup();
                resolve(envelope);
            };
            socket.on(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, onEnvelope);
        });
    }

    it("admits only the exact materialized Session and Machine sockets", async () => {
        const fixture = await createFixture();
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const createSocket = (authPayload: Readonly<Record<string, unknown>>, token = fixture.token) => ioClient(origin, {
            path: "/v1/updates",
            transports: ["websocket"],
            reconnection: false,
            autoConnect: false,
            auth: { token, ...authPayload },
        });
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const session = createSocket({
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
                machineId: fixture.machineId,
            });
            sockets.push(session);
            await expect(waitForConnection(session)).resolves.toBe("connected");

            const machine = createSocket({
                clientType: "machine-scoped",
                machineId: fixture.machineId,
                runtimeId: fixture.activationId,
                startupSource: "ephemeral-runner",
                installationId: fixture.installationId,
                installationPublicKey: fixture.installationPublicKey,
                installationProof: fixture.installationProof,
            });
            sockets.push(machine);
            await expect(waitForConnection(machine)).resolves.toBe("connected");

            for (const authPayload of [
                { clientType: "user-scoped" },
                { clientType: "session-scoped", sessionId: "other", machineId: fixture.machineId },
                { clientType: "session-scoped", sessionId: fixture.sessionId, machineId: "other" },
                { clientType: "session-scoped", sessionId: fixture.sessionId },
                { clientType: "machine-scoped", machineId: "other" },
            ]) {
                const denied = createSocket(authPayload);
                sockets.push(denied);
                await expect(waitForConnection(denied)).resolves.toBe("rejected");
            }

            const accountTokenImpostor = createSocket({
                clientType: "machine-scoped",
                machineId: fixture.machineId,
            }, fixture.accountToken);
            sockets.push(accountTokenImpostor);
            await expect(waitForConnection(accountTokenImpostor)).resolves.toBe("rejected");
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);

    it("rejects Runner-bearer replay without the installation proof while preserving the current Machine owner", async () => {
        const fixture = await createFixture();
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const machineAuth = {
            token: fixture.token,
            clientType: "machine-scoped",
            machineId: fixture.machineId,
            runtimeId: fixture.activationId,
            startupSource: "ephemeral-runner",
            installationId: fixture.installationId,
            installationPublicKey: fixture.installationPublicKey,
            installationProof: fixture.installationProof,
        } as const;
        const createMachineSocket = () => ioClient(origin, {
            path: "/v1/updates",
            transports: ["websocket"],
            reconnection: false,
            autoConnect: false,
            auth: machineAuth,
        });
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const owner = createMachineSocket();
            sockets.push(owner);
            await expect(waitForConnection(owner)).resolves.toBe("connected");

            const replay = ioClient(origin, {
                path: "/v1/updates",
                transports: ["websocket"],
                reconnection: false,
                autoConnect: false,
                auth: {
                    token: fixture.token,
                    clientType: "machine-scoped",
                    machineId: fixture.machineId,
                    runtimeId: fixture.activationId,
                    startupSource: "ephemeral-runner",
                },
            });
            sockets.push(replay);
            await expect(waitForConnection(replay)).resolves.toBe("rejected");
            expect(owner.connected).toBe(true);
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);

    it("denies Runner-originated RPC calls before an ordinary Machine receives them", async () => {
        const fixture = await createFixture();
        const ordinaryMachineId = `persistent-machine-${randomUUID()}`;
        await db.machine.create({
            data: { id: ordinaryMachineId, accountId: fixture.account.id, metadata: "{}" },
        });
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const target = ioClient(origin, {
                path: "/v1/updates",
                transports: ["websocket"],
                reconnection: false,
                autoConnect: false,
                auth: {
                    token: fixture.accountToken,
                    clientType: "machine-scoped",
                    machineId: ordinaryMachineId,
                },
            });
            const runner = ioClient(origin, {
                path: "/v1/updates",
                transports: ["websocket"],
                reconnection: false,
                autoConnect: false,
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
            sockets.push(target, runner);
            await expect(Promise.all([
                waitForConnection(target),
                waitForConnection(runner),
            ])).resolves.toEqual(["connected", "connected"]);

            const methods = [
                `${ordinaryMachineId}:${RPC_METHODS.STOP_DAEMON}`,
                `${ordinaryMachineId}:${RPC_METHODS.DAEMON_VOICE_CLIENT_RAW_CREDENTIAL_MATERIALIZE}`,
            ];
            const receivedRequests: unknown[] = [];
            target.on(SOCKET_RPC_EVENTS.REQUEST, (request: unknown) => {
                receivedRequests.push(request);
            });
            for (const method of methods) {
                await registerRpcMethod(target, method);
            }

            for (const method of methods) {
                await expect(runner.timeout(5_000).emitWithAck(SOCKET_RPC_EVENTS.CALL, {
                    method,
                    params: { request: "restricted-runner-call" },
                })).resolves.toEqual({
                    ok: false,
                    error: "Forbidden",
                    errorCode: RPC_ERROR_CODES.FORBIDDEN,
                });
            }
            expect(receivedRequests).toEqual([]);
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);

    it("relays a valid signed provider-broker flow through only the current Runner Machine socket", async () => {
        const fixture = await createFixture();
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const createSocket = (
            authPayload: Readonly<Record<string, unknown>>,
            token = fixture.token,
        ) => ioClient(origin, {
            path: "/v1/updates",
            transports: ["websocket"],
            reconnection: false,
            autoConnect: false,
            auth: { token, ...authPayload },
        });
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const owner = createSocket({ clientType: "user-scoped" }, fixture.accountToken);
            const runnerMachine = createSocket({
                clientType: "machine-scoped",
                machineId: fixture.machineId,
                runtimeId: fixture.activationId,
                startupSource: "ephemeral-runner",
                installationId: fixture.installationId,
                installationPublicKey: fixture.installationPublicKey,
                installationProof: fixture.installationProof,
            });
            const runnerSession = createSocket({
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
                machineId: fixture.machineId,
            });
            sockets.push(owner, runnerMachine, runnerSession);
            await expect(Promise.all([
                waitForConnection(owner),
                waitForConnection(runnerMachine),
                waitForConnection(runnerSession),
            ])).resolves.toEqual(["connected", "connected", "connected"]);
            if (!owner.id || !runnerSession.id) throw new Error("socket identity unavailable");

            const tunnelId = `runner-provider-relay-${randomUUID()}`;
            const runnerReceivedOpen = waitForRelayEnvelope(
                runnerMachine,
                (envelope) => envelope.v === 1
                    && envelope.frame.kind === "open"
                    && envelope.frame.open.tunnelId === tunnelId,
            );
            owner.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, createProviderBrokerOpen({
                accountId: fixture.account.id,
                targetMachineId: fixture.machineId,
                relaySocketId: owner.id,
                tunnelId,
            }));
            await expect(runnerReceivedOpen).resolves.toMatchObject({
                recipient: { kind: "machine", machineId: fixture.machineId },
                frame: { kind: "open", open: { tunnelId } },
            });

            const responsePayload = new TextEncoder().encode("provider-response");
            const ownerReceivedResponse = waitForRelayEnvelope(
                owner,
                (envelope) => envelope.v === 2,
            );
            runnerMachine.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, {
                v: 2,
                scopeUserId: fixture.account.id,
                sender: { kind: "machine", machineId: fixture.machineId },
                recipient: { kind: "user", socketId: owner.id },
                encoding: PEER_TCP_TUNNEL_BINARY_FRAME_ENCODING_V2,
                frame: encodePeerTcpTunnelBinaryFrameV2({
                    header: {
                        version: 2,
                        kind: "data",
                        tunnelId,
                        direction: "daemon_to_client",
                        sequence: 0,
                        payloadLength: responsePayload.byteLength,
                    },
                    payload: responsePayload,
                }),
            } satisfies PeerTcpTunnelRelayEnvelope);
            await expect(ownerReceivedResponse).resolves.toMatchObject({
                sender: { kind: "machine", machineId: fixture.machineId },
                recipient: { kind: "user", socketId: owner.id },
            });

            const sessionTunnelId = `runner-session-relay-${randomUUID()}`;
            let sessionRelayReachedMachine = false;
            const observeSessionRelay = (envelope: PeerTcpTunnelRelayEnvelope) => {
                if (
                    envelope.v === 1
                    && envelope.frame.kind === "open"
                    && envelope.frame.open.tunnelId === sessionTunnelId
                ) {
                    sessionRelayReachedMachine = true;
                }
            };
            runnerMachine.on(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, observeSessionRelay);
            runnerSession.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, createProviderBrokerOpen({
                accountId: fixture.account.id,
                targetMachineId: fixture.machineId,
                relaySocketId: runnerSession.id,
                tunnelId: sessionTunnelId,
            }));
            await new Promise((resolve) => setTimeout(resolve, 100));
            runnerMachine.off(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, observeSessionRelay);
            expect(sessionRelayReachedMachine).toBe(false);

            const invalidGrant = createProviderBrokerOpen({
                accountId: fixture.account.id,
                targetMachineId: fixture.machineId,
                relaySocketId: owner.id,
                tunnelId: `invalid-grant-${randomUUID()}`,
            });
            if (invalidGrant.v !== 1 || invalidGrant.frame.kind !== "open") {
                throw new Error("unexpected relay test envelope");
            }
            const invalidGrantOpen = invalidGrant.frame.open;
            const invalidGrantAuthorization = invalidGrantOpen.relayAuthorization;
            if (invalidGrantAuthorization === undefined) {
                throw new Error("expected signed relay authorization");
            }
            const invalidSignatureRejection = waitForRelayEnvelope(
                owner,
                (envelope) => envelope.v === 1
                    && envelope.frame.kind === "abort"
                    && envelope.frame.tunnelId === invalidGrantOpen.tunnelId,
            );
            owner.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, {
                ...invalidGrant,
                frame: {
                    ...invalidGrant.frame,
                    open: {
                        ...invalidGrantOpen,
                        relayAuthorization: {
                            ...invalidGrantAuthorization,
                            signature: {
                                ...invalidGrantAuthorization.signature,
                                valueBase64Url: Buffer.from(new Uint8Array(64).fill(1)).toString("base64url"),
                            },
                        },
                    },
                },
            });
            await expect(invalidSignatureRejection).resolves.toMatchObject({
                frame: { kind: "abort", reasonCode: "relay_authorization_invalid" },
            });

            const unsignedTunnelId = `unsigned-grant-${randomUUID()}`;
            const unsignedGrantRejection = new Promise<unknown>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    owner.off("error", onError);
                    reject(new Error("Timed out waiting for unsigned relay rejection"));
                }, 2_000);
                const onError = (error: unknown) => {
                    clearTimeout(timeout);
                    owner.off("error", onError);
                    resolve(error);
                };
                owner.on("error", onError);
            });
            owner.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, {
                ...createProviderBrokerOpen({
                    accountId: fixture.account.id,
                    targetMachineId: fixture.machineId,
                    relaySocketId: owner.id,
                    tunnelId: unsignedTunnelId,
                }),
                frame: {
                    v: 1,
                    kind: "open",
                    open: {
                        v: 1,
                        kind: "open",
                        tunnelId: unsignedTunnelId,
                        targetMachineId: fixture.machineId,
                        routeKind: "server_relay",
                    },
                },
            });
            await expect(unsignedGrantRejection).resolves.toMatchObject({
                type: "peer-tunnel",
            });

            const wrongTarget = createProviderBrokerOpen({
                accountId: fixture.account.id,
                targetMachineId: fixture.machineId,
                relaySocketId: owner.id,
                tunnelId: `wrong-target-${randomUUID()}`,
            });
            if (wrongTarget.v !== 1 || wrongTarget.frame.kind !== "open") {
                throw new Error("unexpected relay test envelope");
            }
            const wrongTargetOpen = wrongTarget.frame.open;
            const wrongTargetRejection = waitForRelayEnvelope(
                owner,
                (envelope) => envelope.v === 1
                    && envelope.frame.kind === "abort"
                    && envelope.frame.tunnelId === wrongTargetOpen.tunnelId,
            );
            owner.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, {
                ...wrongTarget,
                recipient: { kind: "machine", machineId: "another-machine" },
                frame: {
                    ...wrongTarget.frame,
                    open: { ...wrongTargetOpen, targetMachineId: "another-machine" },
                },
            });
            await expect(wrongTargetRejection).resolves.toMatchObject({
                frame: { kind: "abort", reasonCode: "relay_authorization_invalid" },
            });

            const disconnected = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("revoked Runner Machine stayed connected")), 2_000);
                runnerMachine.once("disconnect", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            await inTx(async (tx) => {
                const result = await revokeMachineInTx(tx, {
                    accountId: fixture.account.id,
                    machineId: fixture.machineId,
                });
                expect(result.ok).toBe(true);
            });
            await disconnected;

            const revokedTunnelId = `revoked-runner-relay-${randomUUID()}`;
            const revokedRejection = waitForRelayEnvelope(
                owner,
                (envelope) => envelope.v === 1
                    && envelope.frame.kind === "abort"
                    && envelope.frame.tunnelId === revokedTunnelId,
            );
            owner.emit(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT, createProviderBrokerOpen({
                accountId: fixture.account.id,
                targetMachineId: fixture.machineId,
                relaySocketId: owner.id,
                tunnelId: revokedTunnelId,
            }));
            await expect(revokedRejection).resolves.toMatchObject({
                frame: { kind: "abort", reasonCode: "route_unavailable" },
            });
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);

    it("keeps the temporary Runner Machine out of broad Machine activity fanout", async () => {
        const fixture = await createFixture();
        const persistentMachineId = `persistent-machine-${randomUUID()}`;
        await db.machine.create({
            data: { id: persistentMachineId, accountId: fixture.account.id, metadata: "{}" },
        });
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const createSocket = (
            authPayload: Readonly<Record<string, unknown>>,
            token = fixture.token,
        ) => ioClient(origin, {
            path: "/v1/updates",
            transports: ["websocket"],
            reconnection: false,
            autoConnect: false,
            auth: { token, ...authPayload },
        });
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const owner = createSocket({ clientType: "user-scoped" }, fixture.accountToken);
            sockets.push(owner);
            await expect(waitForConnection(owner)).resolves.toBe("connected");
            const machineActivity: Array<Readonly<{ id: string; active: boolean }>> = [];
            owner.on("ephemeral", (payload: unknown) => {
                const event = payload as { type?: string; id?: string; active?: boolean } | null;
                if (event?.type !== "machine-activity" || typeof event.id !== "string") return;
                machineActivity.push({ id: event.id, active: event.active === true });
            });

            const runnerMachine = createSocket({
                clientType: "machine-scoped",
                machineId: fixture.machineId,
                runtimeId: fixture.activationId,
                startupSource: "ephemeral-runner",
                installationId: fixture.installationId,
                installationPublicKey: fixture.installationPublicKey,
                installationProof: fixture.installationProof,
            });
            sockets.push(runnerMachine);
            await expect(waitForConnection(runnerMachine)).resolves.toBe("connected");
            runnerMachine.close();

            // The ordinary persistent daemon keeps its broad activity contract, so an
            // absent Runner event proves the exclusion rather than a silent harness.
            const persistentMachine = createSocket(
                { clientType: "machine-scoped", machineId: persistentMachineId },
                fixture.accountToken,
            );
            sockets.push(persistentMachine);
            await expect(waitForConnection(persistentMachine)).resolves.toBe("connected");
            const deadline = Date.now() + 5_000;
            while (Date.now() < deadline && !machineActivity.some(({ id }) => id === persistentMachineId)) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            expect(machineActivity).toContainEqual({ id: persistentMachineId, active: true });
            expect(machineActivity.filter(({ id }) => id === fixture.machineId)).toEqual([]);
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);

    it("disconnects both established restricted profiles after exact Machine revocation and rejects reconnect", async () => {
        const fixture = await createFixture();
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("socket server unavailable");
        const origin = `http://127.0.0.1:${address.port}`;
        const createSocket = (
            authPayload: Readonly<Record<string, unknown>>,
            token = fixture.token,
        ) => ioClient(origin, {
            path: "/v1/updates",
            transports: ["websocket"],
            reconnection: false,
            autoConnect: false,
            auth: { token, ...authPayload },
        });
        const sessionAuth = {
            clientType: "session-scoped",
            sessionId: fixture.sessionId,
            machineId: fixture.machineId,
        } as const;
        const machineAuth = {
            clientType: "machine-scoped",
            machineId: fixture.machineId,
            runtimeId: fixture.activationId,
            startupSource: "ephemeral-runner",
            installationId: fixture.installationId,
            installationPublicKey: fixture.installationPublicKey,
            installationProof: fixture.installationProof,
        } as const;
        const sockets: ReturnType<typeof ioClient>[] = [];
        try {
            const session = createSocket(sessionAuth);
            const machine = createSocket(machineAuth);
            const ownerSession = createSocket({
                clientType: "session-scoped",
                sessionId: fixture.sessionId,
            }, fixture.accountToken);
            sockets.push(session, machine, ownerSession);
            await expect(Promise.all([
                waitForConnection(session),
                waitForConnection(machine),
                waitForConnection(ownerSession),
            ])).resolves.toEqual(["connected", "connected", "connected"]);

            const disconnected = [session, machine].map((socket) => new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("restricted Runner socket stayed connected")), 5_000);
                socket.once("disconnect", () => {
                    clearTimeout(timer);
                    resolve();
                });
            }));
            await inTx(async (tx) => {
                const result = await revokeMachineInTx(tx, {
                    accountId: fixture.account.id,
                    machineId: fixture.machineId,
                });
                expect(result.ok).toBe(true);
            });
            await Promise.all(disconnected);
            expect(ownerSession.connected).toBe(true);

            const sessionReconnect = createSocket(sessionAuth);
            const machineReconnect = createSocket(machineAuth);
            sockets.push(sessionReconnect, machineReconnect);
            await expect(Promise.all([
                waitForConnection(sessionReconnect),
                waitForConnection(machineReconnect),
            ])).resolves.toEqual(["rejected", "rejected"]);
        } finally {
            for (const socket of sockets) socket.close();
            await app.close();
        }
    }, 30_000);
});
