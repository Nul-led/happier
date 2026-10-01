import { describe, expect, it, vi } from "vitest";

import { SESSION_DISCUSSION_HTTP_PATHS_V1 } from "@happier-dev/protocol";
import { API_TOKEN_FULL_GRANT_V1 } from "@happier-dev/protocol/auth/apiTokenGrant";
import type { ActionId } from "@happier-dev/protocol/actions";

import { isRestrictedAuthTokenDeniedForRoute } from "@/app/api/utils/apiTokenRouteAdmission";
import { requireRouteActionAuthority } from "@/app/api/utils/requireRouteActionAuthority";
import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";
import { registerSessionReadStateRoutes } from "./registerSessionReadStateRoutes";
import { registerSessionDiscussionRoutes } from "./registerSessionDiscussionRoutes";

type AdmissionRouteConfig = NonNullable<
    Parameters<typeof isRestrictedAuthTokenDeniedForRoute>[0]["routeOptions"]
>["config"];

const runnerPrincipal = {
    kind: "ephemeral_session_runner",
    authority: "session_runtime",
    accountId: "account-1",
    activationId: "activation-1",
    sessionId: "session-1",
    machineId: "machine-1",
    installationId: "installation-1",
    installationPublicKey: "public-key-1",
    creatorTokenEpoch: 0,
} as never;

function registeredDiscussionRouteConfigs() {
    const app = createFakeRouteApp();
    registerSessionDiscussionRoutes(app as never);
    return new Map(Array.from(app.routes, ([key, entry]) => [key, entry.opts.config as AdmissionRouteConfig]));
}

function registeredMutationGuard(
    register: typeof registerSessionDiscussionRoutes,
    method: Parameters<typeof getRouteEntry>[1],
    path: string,
) {
    const app = createFakeRouteApp();
    register(app as never);
    const preHandlers = getRouteEntry(app, method, path).opts.preHandler;
    return Array.isArray(preHandlers)
        ? preHandlers.at(-1) as ReturnType<typeof requireRouteActionAuthority> | undefined
        : undefined;
}

describe("Session discussion and read-state Action authority", () => {
    // Discussions are a promised Session surface from inside a Runner: reading
    // the Session's discussions and posting into one must work under the only
    // credential a Runner holds, and never reach another Session.
    it("binds a Runner credential to its own Session on the discussion read and post routes", () => {
        const configs = registeredDiscussionRouteConfigs();
        for (const key of [
            `GET ${SESSION_DISCUSSION_HTTP_PATHS_V1.collection}`,
            `GET ${SESSION_DISCUSSION_HTTP_PATHS_V1.discussion}`,
            `GET ${SESSION_DISCUSSION_HTTP_PATHS_V1.messages}`,
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.messages}`,
        ]) {
            const config = configs.get(key);
            expect(config, key).toBeDefined();
            expect(isRestrictedAuthTokenDeniedForRoute({
                authTokenKind: "ephemeral_session_runner",
                userId: "account-1",
                sessionRuntimePrincipal: runnerPrincipal,
                params: { sessionId: "session-1" },
                routeOptions: { config },
            }), key).toBe(false);
            expect(isRestrictedAuthTokenDeniedForRoute({
                authTokenKind: "ephemeral_session_runner",
                userId: "account-1",
                sessionRuntimePrincipal: runnerPrincipal,
                params: { sessionId: "session-2" },
                routeOptions: { config },
            }), key).toBe(true);
        }
    });

    // Declassification admits verified external effects, not the Runner
    // runtime or a raw PAT on these direct mutation routes.
    it("leaves other discussion mutations outside the Runner and raw-PAT surfaces", () => {
        const configs = registeredDiscussionRouteConfigs();
        for (const key of [
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.collection}`,
            `PATCH ${SESSION_DISCUSSION_HTTP_PATHS_V1.discussion}`,
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.archive}`,
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.restore}`,
            `PUT ${SESSION_DISCUSSION_HTTP_PATHS_V1.read}`,
        ]) {
            const config = configs.get(key);
            expect(config?.restrictedCredentialBinding, key).toBeUndefined();
            expect(isRestrictedAuthTokenDeniedForRoute({
                authTokenKind: "api_token",
                params: { sessionId: "session-1" },
                routeOptions: { config },
            }), key).toBe(true);
        }
    });

    it("admits the Session's own Runner runtime through the discussion post guard", async () => {
        const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
        await expect(requireRouteActionAuthority("session.discussion.post")({
            authAuthority: "account_automation",
            authTokenKind: "ephemeral_session_runner",
            params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBeUndefined();
        expect(reply.code).not.toHaveBeenCalled();

        await expect(requireRouteActionAuthority("session.discussion.post")({
            authAuthority: "account_automation",
            authTokenKind: "api_token",
            params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBe("refused");
        expect(reply.code).toHaveBeenCalledWith(403);
    });

    it("admits a terminal present user and only the verified matching discussion effect", async () => {
        const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
        await expect(requireRouteActionAuthority("session.discussion.post")({
            authAuthority: "present_user", authTokenKind: "terminal", params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBeUndefined();
        await expect(requireRouteActionAuthority("session.discussion.post")({
            authAuthority: "account_automation", authTokenKind: "api_token", params: { sessionId: "session-1" },
            externalActionExecutionAuthorized: true, externalActionEffectActionId: "session.discussion.post",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-1" },
        } as never, reply as never)).resolves.toBeUndefined();
        await expect(requireRouteActionAuthority("session.discussion.post")({
            authAuthority: "account_automation", authTokenKind: "api_token", params: { sessionId: "session-2" },
            externalActionExecutionAuthorized: true, externalActionEffectActionId: "session.discussion.post",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-1" },
        } as never, reply as never)).resolves.toBe("refused");
    });

    it("binds each declassified discussion mutation to its exact verified effect and Session", async () => {
        const routes = [
            ["POST", SESSION_DISCUSSION_HTTP_PATHS_V1.collection, "session.discussion.create"],
            ["PATCH", SESSION_DISCUSSION_HTTP_PATHS_V1.discussion, "session.discussion.rename"],
            ["POST", SESSION_DISCUSSION_HTTP_PATHS_V1.archive, "session.discussion.archive"],
            ["POST", SESSION_DISCUSSION_HTTP_PATHS_V1.restore, "session.discussion.restore"],
            ["PUT", SESSION_DISCUSSION_HTTP_PATHS_V1.read, "session.discussion.read_state.set"],
        ] as const satisfies readonly (readonly [string, string, ActionId])[];
        for (const [method, path, actionId] of routes) {
            const guard = registeredMutationGuard(registerSessionDiscussionRoutes, method, path);
            expect(guard, actionId).toBeDefined();
            const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
            const request = {
                authAuthority: "account_automation", authTokenKind: "api_token", params: { sessionId: "session-1" },
                externalActionExecutionAuthorized: true, externalActionEffectActionId: actionId,
                externalActionExecutionTarget: { kind: "session", sessionId: "session-1" },
            } as const;
            await expect(guard!(request as never, reply as never), actionId).resolves.toBeUndefined();
            for (const refusedRequest of [
                { ...request, externalActionExecutionAuthorized: undefined },
                { ...request, params: { sessionId: "session-2" } },
                { ...request, externalActionEffectActionId: "session.discussion.post" },
            ]) {
                await expect(guard!(refusedRequest as never, reply as never), actionId).resolves.toBe("refused");
            }
        }
    });

    it("binds read-state writes to the verified effect and refuses terminal automation", async () => {
        const guard = registeredMutationGuard(registerSessionReadStateRoutes, "POST", "/v2/sessions/:sessionId/read-state");
        expect(guard).toBeDefined();
        const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
        await expect(guard!({
            authAuthority: "account_automation", authTokenKind: "api_token", params: { sessionId: "session-1" },
            externalActionExecutionAuthorized: true, externalActionEffectActionId: "session.read_state.set",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-1" },
        } as never, reply as never)).resolves.toBeUndefined();
        await expect(guard!({
            authAuthority: "account_automation", authTokenKind: "terminal", params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBe("refused");
    });

    it("keeps present-user security Actions closed even for a verified approve token", async () => {
        const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
        await expect(requireRouteActionAuthority("account.apiTokens.create")({
            authAuthority: "account_automation",
            authTokenKind: "api_token",
            apiTokenPrincipal: {
                accountId: "account-1", principalId: "principal-1", credentialId: "credential-1",
                authority: "account_automation", expiresAt: null, parentTokenId: null, embedConfig: null,
                grant: { ...API_TOKEN_FULL_GRANT_V1, approve: true },
            },
            params: { sessionId: "session-1" },
            externalActionExecutionAuthorized: true,
            externalActionEffectActionId: "account.apiTokens.create",
            externalActionExecutionTarget: { kind: "session", sessionId: "session-1" },
        }, reply as never)).resolves.toBe("refused");
        expect(reply.code).toHaveBeenCalledWith(403);
    });
});
