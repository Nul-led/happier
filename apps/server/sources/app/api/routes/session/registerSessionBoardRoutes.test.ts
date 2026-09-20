import {
    SESSION_BOARD_MUTATION_SERVER_TRANSPORT_V1,
    SessionBoardMutationV1Schema,
} from "@happier-dev/protocol/sessions/board";
import { describe, expect, it, vi } from "vitest";

import { isSessionBoardExternalActionEffectAllowed, registerSessionBoardRoutes } from "./registerSessionBoardRoutes";
import { isRestrictedAuthTokenDeniedForRoute } from "@/app/api/utils/apiTokenRouteAdmission";

describe("registerSessionBoardRoutes", () => {
    const runnerPrincipal = (sessionId: string) => ({
        kind: "ephemeral_session_runner",
        authority: "session_runtime",
        accountId: "account-1",
        activationId: "activation-1",
        sessionId,
        machineId: "machine-1",
        installationId: "installation-1",
        installationPublicKey: "public-key-1",
        creatorTokenEpoch: 0,
    }) as never;

    // A Runner is an ordinary daemon runtime for exactly one Session. The Board
    // is a promised Session surface, so its own Session's Board must be
    // reachable under the only credential the Runner holds, and another
    // Session's Board must not be.
    it("admits a Runner credential on its own Session's Board and refuses another Session's", () => {
        let registered: Readonly<{ path: string; options: any }> | undefined;
        const app = {
            authenticate: vi.fn(),
            put: (path: string, options: unknown) => {
                registered = { path, options };
            },
        };
        registerSessionBoardRoutes(app as never);
        const config = registered?.options.config;

        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "ephemeral_session_runner",
            userId: "account-1",
            sessionRuntimePrincipal: runnerPrincipal("session-1"),
            params: { sessionId: "session-1" },
            routeOptions: { config },
        })).toBe(false);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "ephemeral_session_runner",
            userId: "account-1",
            sessionRuntimePrincipal: runnerPrincipal("session-1"),
            params: { sessionId: "session-2" },
            routeOptions: { config },
        })).toBe(true);
    });

    it("registers the public Board mutation with strict family validation and the canonical API guardrails", () => {
        let registered: Readonly<{ path: string; options: any }> | undefined;
        const app = {
            authenticate: vi.fn(),
            put: (path: string, options: unknown) => {
                registered = { path, options };
            },
        };

        registerSessionBoardRoutes(app as never);

        expect(registered?.path).toBe(SESSION_BOARD_MUTATION_SERVER_TRANSPORT_V1.path);
        expect(registered?.options.config).not.toHaveProperty("allowApiToken");
        expect(registered?.options.config).not.toHaveProperty("allowExternalActionApiTokenForActionIds");
        const config = registered?.options.config;
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "api_token",
            routeOptions: { config },
        })).toBe(true);
        for (const effectActionId of [
            "session.board.item.upsert",
            "session.board.item.remove",
            "session.board.layout.update",
        ]) {
            expect(isRestrictedAuthTokenDeniedForRoute({
                authTokenKind: "api_token",
                externalActionExecutionAuthorized: true,
                externalActionEffectActionId: effectActionId,
                routeOptions: { config },
            })).toBe(false);
        }
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "api_token",
            externalActionExecutionAuthorized: true,
            externalActionEffectActionId: "session.board.get",
            routeOptions: { config },
        })).toBe(false);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "account",
            routeOptions: { config },
        })).toBe(false);
        expect(registered?.options.config).toHaveProperty("rateLimit");
        expect(registered?.options.schema.body).toBe(SessionBoardMutationV1Schema);
        expect(registered?.options.schema.body.safeParse({
            operation: "update_layout",
            expectedLayoutRevision: null,
            layoutContent: { t: "plain", v: { v: 1, tabs: [] } },
            unexpected: true,
        }).success).toBe(false);
        expect(registered?.options.schema.response[404].safeParse({
            error: "not_found",
            unexpected: true,
        }).success).toBe(false);

        const send = vi.fn();
        const code = vi.fn(() => ({ send }));
        registered?.options.errorHandler(
            { validation: [{}] },
            {},
            { code, send: vi.fn() },
        );
        expect(code).toHaveBeenCalledWith(400);
        expect(send).toHaveBeenCalledWith({ error: "session_board_invalid" });
    });

    it("binds every proof-authorized Board effect to its exact aggregate operation", () => {
        expect(isSessionBoardExternalActionEffectAllowed({
            authTokenKind: "account",
            externalActionExecutionAuthorized: false,
            sessionId: "session-a",
            operation: "remove_item",
        })).toBe(true);
        const exactUpsertProof = {
            authTokenKind: "api_token" as const,
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.item.upsert",
            externalActionEffectActionId: "session.board.item.upsert",
            externalActionExecutionTarget: { kind: "session" as const, sessionId: "session-a" },
            sessionId: "session-a",
            operation: "upsert_item" as const,
        };
        expect(isSessionBoardExternalActionEffectAllowed(exactUpsertProof)).toBe(true);
        const exactRemoveProof = {
            authTokenKind: "api_token" as const,
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.item.remove",
            externalActionEffectActionId: "session.board.item.remove",
            externalActionExecutionTarget: { kind: "session" as const, sessionId: "session-a" },
            sessionId: "session-a",
            operation: "remove_item" as const,
        };
        expect(isSessionBoardExternalActionEffectAllowed(exactRemoveProof)).toBe(true);
        expect(isSessionBoardExternalActionEffectAllowed({
            authTokenKind: "api_token",
            externalActionExecutionAuthorized: false,
            sessionId: "session-a",
            operation: "remove_item",
        })).toBe(false);
        const machineTargetProof = {
            authTokenKind: "api_token" as const,
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.layout.update",
            externalActionEffectActionId: "session.board.layout.update",
            externalActionExecutionTarget: { kind: "machine" as const, machineId: "machine-a" },
            sessionId: "session-a",
            operation: "update_layout" as const,
        };
        expect(isSessionBoardExternalActionEffectAllowed(machineTargetProof)).toBe(false);
        expect(isSessionBoardExternalActionEffectAllowed({
            ...exactUpsertProof,
            externalActionRootActionId: "session.board.item.remove",
        })).toBe(false);
        expect(isSessionBoardExternalActionEffectAllowed({
            authTokenKind: "api_token",
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.item.upsert",
            externalActionEffectActionId: "session.board.item.upsert",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-a" },
            sessionId: "session-a",
            operation: "remove_item",
        })).toBe(false);
        expect(isSessionBoardExternalActionEffectAllowed({
            authTokenKind: "api_token",
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.get",
            externalActionEffectActionId: "session.board.get",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-a" },
            sessionId: "session-a",
            operation: "update_layout",
        })).toBe(false);
        expect(isSessionBoardExternalActionEffectAllowed({
            authTokenKind: "api_token",
            externalActionExecutionAuthorized: true,
            externalActionRootActionId: "session.board.item.upsert",
            externalActionEffectActionId: "session.board.item.upsert",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-b" },
            sessionId: "session-a",
            operation: "upsert_item",
        })).toBe(false);
    });
});
