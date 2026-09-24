import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server, Socket } from "socket.io";

import { RPC_ERROR_CODES, SESSION_RPC_METHODS } from "@happier-dev/protocol/rpc";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { createAuthenticatedFakeSocket, triggerSocketHandler } from "../../testkit/socketHarness";
import { registerSocketRpcHandlers } from "./registerSocketRpcHandlers";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe("Session RPC final access admission on SQLite", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-dev-session-rpc-access-race-",
            initAuth: false,
            initEncrypt: false,
            initFiles: false,
        });
    }, 120_000);
    beforeEach(() => harness.resetEnv());
    afterAll(async () => await harness.close());

    async function seedDirectEditor() {
        const owner = await db.account.create({
            data: { publicKey: `owner-${randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const editor = await db.account.create({
            data: { publicKey: `editor-${randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: `session-${randomUUID()}`,
                metadata: JSON.stringify({ t: "plain", v: {} }),
                encryptionMode: "plain",
            },
            select: { id: true },
        });
        await db.sessionShare.create({
            data: {
                sessionId: session.id,
                sharedByUserId: owner.id,
                sharedWithUserId: editor.id,
                accessLevel: "edit",
                canApprovePermissions: false,
            },
        });
        return { owner, editor, session };
    }

    async function seedRestrictedTeamEditor() {
        const owner = await db.account.create({
            data: { publicKey: `owner-${randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        // The editor qualifies with native Key-Challenge evidence, and that route
        // is only available to a keyed Account (`key_challenge` is a keyed-mode
        // action), so this Account is e2ee exactly like the sibling qualification
        // fixtures in `resolveTeamAuthenticationPolicy.sqlite.integration.spec.ts`.
        const editor = await db.account.create({
            data: { publicKey: `editor-${randomUUID()}`, encryptionMode: "e2ee" },
            select: { id: true },
        });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: `session-${randomUUID()}`,
                metadata: JSON.stringify({ t: "plain", v: {} }),
                encryptionMode: "plain",
            },
            select: { id: true },
        });
        const team = await db.team.create({ data: { name: `Team ${randomUUID()}` }, select: { id: true } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: owner.id, role: "owner" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: editor.id, role: "member" } });
        await db.sessionTeamGrant.create({
            data: {
                sessionId: session.id,
                teamId: team.id,
                accessLevel: "edit",
                canApprovePermissions: false,
                effectiveAt: new Date(0),
            },
        });
        return { owner, editor, session, team };
    }

    function createCaller(
        evidence: readonly Readonly<{ kind: "home_method"; methodId: string }>[] = [],
    ) {
        return createAuthenticatedFakeSocket({
            id: `caller-${randomUUID()}`,
            data: { clientType: "user-scoped", authTokenAuthenticationEvidence: evidence },
        });
    }

    it("answers an unqualified restricted-Team editor with the typed authentication requirement", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const { owner, editor, session, team } = await seedRestrictedTeamEditor();
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            },
        });
        const method = `${session.id}:${SESSION_RPC_METHODS.SESSION_GOAL_SET}`;
        const targetEffect = vi.fn(async () => ({ ok: true, status: "applied" }));
        const target = {
            id: "owner-daemon",
            data: { clientType: "session-scoped" },
            timeout: vi.fn(() => ({ emitWithAck: targetEffect })),
        };
        const io = {
            in: vi.fn((room: string) => ({
                timeout: vi.fn(() => ({
                    fetchSockets: vi.fn(async () =>
                        room === `rpc:${owner.id}:${method}` || room === target.id ? [target] : []),
                })),
                fetchSockets: vi.fn(async () => room === target.id ? [target] : []),
            })),
        } as unknown as Server;

        const unqualified = createCaller();
        const refusal = vi.fn();
        registerSocketRpcHandlers({ userId: editor.id, socket: unqualified as unknown as Socket, io });
        await triggerSocketHandler(unqualified, SOCKET_RPC_EVENTS.CALL, {
            method,
            params: { v: 1, goal: "do the work" },
        }, refusal);

        expect(targetEffect).not.toHaveBeenCalled();
        expect(refusal).toHaveBeenCalledWith({
            ok: false,
            error: "Team authentication required",
            errorCode: RPC_ERROR_CODES.TEAM_AUTHENTICATION_REQUIRED,
        });

        const qualified = createCaller([{ kind: "home_method", methodId: "key_challenge" }]);
        const accepted = vi.fn();
        registerSocketRpcHandlers({ userId: editor.id, socket: qualified as unknown as Socket, io });
        await triggerSocketHandler(qualified, SOCKET_RPC_EVENTS.CALL, {
            method,
            params: { v: 1, goal: "do the work" },
        }, accepted);

        expect(targetEffect).toHaveBeenCalledOnce();
        expect(accepted).toHaveBeenCalledWith({ ok: true, result: { ok: true, status: "applied" } });
    });

    it("surfaces the typed authentication requirement lost during target discovery", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: "1" });
        const { owner, editor, session, team } = await seedRestrictedTeamEditor();
        const method = `${session.id}:${SESSION_RPC_METHODS.SESSION_GOAL_SET}`;
        const targetEffect = vi.fn(async () => ({ ok: true }));
        const target = {
            id: "owner-daemon",
            data: { clientType: "session-scoped" },
            timeout: vi.fn(() => ({ emitWithAck: targetEffect })),
        };
        const discoveryStarted = deferred<void>();
        const resumeDiscovery = deferred<void>();
        const io = {
            in: vi.fn((room: string) => ({
                timeout: vi.fn(() => ({
                    fetchSockets: vi.fn(async () => {
                        if (room === `rpc:${owner.id}:${method}`) {
                            discoveryStarted.resolve();
                            await resumeDiscovery.promise;
                            return [target];
                        }
                        return room === target.id ? [target] : [];
                    }),
                })),
                fetchSockets: vi.fn(async () => room === target.id ? [target] : []),
            })),
        } as unknown as Server;
        const caller = createCaller();
        const callback = vi.fn();

        registerSocketRpcHandlers({ userId: editor.id, socket: caller as unknown as Socket, io });
        const call = triggerSocketHandler(caller, SOCKET_RPC_EVENTS.CALL, {
            method,
            params: { v: 1, goal: "do the work" },
        }, callback);

        await discoveryStarted.promise;
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            },
        });
        resumeDiscovery.resolve();
        await call;

        expect(targetEffect).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledWith({
            ok: false,
            error: "Team authentication required",
            errorCode: RPC_ERROR_CODES.TEAM_AUTHENTICATION_REQUIRED,
        });
    });

    it("does not dispatch an ordinary effectful Session RPC when access is revoked during target discovery", async () => {
        const { owner, editor, session } = await seedDirectEditor();
        const method = `${session.id}:${SESSION_RPC_METHODS.SESSION_GOAL_SET}`;
        const targetEffect = vi.fn(async () => ({ ok: true }));
        const target = {
            id: "owner-daemon",
            data: { clientType: "session-scoped" },
            timeout: vi.fn(() => ({ emitWithAck: targetEffect })),
        };
        const discoveryStarted = deferred<void>();
        const resumeDiscovery = deferred<void>();
        const io = {
            in: vi.fn((room: string) => ({
                timeout: vi.fn(() => ({
                    fetchSockets: vi.fn(async () => {
                        if (room === `rpc:${owner.id}:${method}`) {
                            discoveryStarted.resolve();
                            await resumeDiscovery.promise;
                            return [target];
                        }
                        return room === target.id ? [target] : [];
                    }),
                })),
                fetchSockets: vi.fn(async () => room === target.id ? [target] : []),
            })),
        } as unknown as Server;
        const caller = createCaller();
        const callback = vi.fn();

        registerSocketRpcHandlers({
            userId: editor.id,
            socket: caller as unknown as Socket,
            io,
        });
        const call = triggerSocketHandler(caller, SOCKET_RPC_EVENTS.CALL, {
            method,
            params: { v: 1, goal: "do the work" },
        }, callback);

        await discoveryStarted.promise;
        await db.sessionShare.delete({
            where: {
                sessionId_sharedWithUserId: {
                    sessionId: session.id,
                    sharedWithUserId: editor.id,
                },
            },
        });
        resumeDiscovery.resolve();
        await call;

        expect(targetEffect).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledWith({
            ok: false,
            error: "RPC method not available",
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        });
    });

    it("allows an already-dispatched Session RPC to finish when access is revoked after emission starts", async () => {
        const { owner, editor, session } = await seedDirectEditor();
        const method = `${session.id}:${SESSION_RPC_METHODS.SESSION_GOAL_SET}`;
        const emissionStarted = deferred<void>();
        const finishEmission = deferred<void>();
        const targetEffect = vi.fn(async () => {
            emissionStarted.resolve();
            await finishEmission.promise;
            return { ok: true, status: "applied" };
        });
        const target = {
            id: "owner-daemon",
            data: { clientType: "session-scoped" },
            timeout: vi.fn(() => ({ emitWithAck: targetEffect })),
        };
        const io = {
            in: vi.fn((room: string) => ({
                timeout: vi.fn(() => ({ fetchSockets: vi.fn(async () => [target]) })),
                fetchSockets: vi.fn(async () => room === target.id ? [target] : []),
            })),
        } as unknown as Server;
        const caller = createCaller();
        const callback = vi.fn();

        registerSocketRpcHandlers({
            userId: editor.id,
            socket: caller as unknown as Socket,
            io,
        });
        const call = triggerSocketHandler(caller, SOCKET_RPC_EVENTS.CALL, {
            method,
            params: { v: 1, goal: "do the work" },
        }, callback);

        await emissionStarted.promise;
        await db.sessionShare.delete({
            where: {
                sessionId_sharedWithUserId: {
                    sessionId: session.id,
                    sharedWithUserId: editor.id,
                },
            },
        });
        finishEmission.resolve();
        await call;

        expect(targetEffect).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith({
            ok: true,
            result: { ok: true, status: "applied" },
        });
    });
});
