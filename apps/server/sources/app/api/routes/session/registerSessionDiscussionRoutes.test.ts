import { describe, expect, it, vi } from "vitest";

import { SESSION_DISCUSSION_HTTP_PATHS_V1 } from "@happier-dev/protocol";

import { isRestrictedAuthTokenDeniedForRoute } from "@/app/api/utils/apiTokenRouteAdmission";
import {
    registerSessionDiscussionRoutes,
    requirePresentUserOrExternalDiscussionPost,
} from "./registerSessionDiscussionRoutes";

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
    const configs = new Map<string, AdmissionRouteConfig>();
    const record = (method: string) => (path: string, options: { config?: AdmissionRouteConfig }) => {
        configs.set(`${method} ${path}`, options.config);
    };
    const app = {
        authenticate: vi.fn(),
        get: record("GET"),
        post: record("POST"),
        put: record("PUT"),
        patch: record("PATCH"),
        delete: record("DELETE"),
    };
    registerSessionDiscussionRoutes(app as never);
    return configs;
}

describe("registerSessionDiscussionRoutes Runner admission", () => {
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

    // Every other Discussion mutation stays a present-user write, so it must
    // not declare a Runner binding at all.
    it("leaves the present-user Discussion mutations outside the Runner surface", () => {
        const configs = registeredDiscussionRouteConfigs();
        for (const key of [
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.collection}`,
            `PATCH ${SESSION_DISCUSSION_HTTP_PATHS_V1.discussion}`,
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.archive}`,
            `POST ${SESSION_DISCUSSION_HTTP_PATHS_V1.restore}`,
            `PUT ${SESSION_DISCUSSION_HTTP_PATHS_V1.read}`,
        ]) {
            expect((configs.get(key) as { ephemeralSessionRunnerBinding?: unknown })
                ?.ephemeralSessionRunnerBinding, key).toBeUndefined();
        }
    });

    it("admits the Session's own Runner runtime through the discussion post guard", async () => {
        const reply = { code: vi.fn(() => ({ send: vi.fn(() => "refused") })) };
        await expect(requirePresentUserOrExternalDiscussionPost({
            authAuthority: "account_automation",
            authTokenKind: "ephemeral_session_runner",
            params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBeUndefined();
        expect(reply.code).not.toHaveBeenCalled();

        await expect(requirePresentUserOrExternalDiscussionPost({
            authAuthority: "account_automation",
            authTokenKind: "api_token",
            params: { sessionId: "session-1" },
        } as never, reply as never)).resolves.toBe("refused");
        expect(reply.code).toHaveBeenCalledWith(403);
    });
});
