import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";
import { resolveTerminalAuthRequestPolicyFromEnv } from "./terminalAuthRequestPolicy";

describe("enrollment auth route rate limits", () => {
    it("registers account, terminal, and Home approval endpoints with canonical rate limits", async () => {
        const [
            { registerAccountAuthRoutes },
            { registerTerminalAuthRequestRoutes },
            { registerHomeLoginApprovalRoutes },
        ] = await Promise.all([
            import("./registerAccountAuthRoutes"),
            import("./registerTerminalAuthRequestRoutes"),
            import("./homeApprovalGate"),
        ]);
        const app = createFakeRouteApp();
        registerAccountAuthRoutes(app as any);
        const terminalAuthPolicy = resolveTerminalAuthRequestPolicyFromEnv({});
        registerTerminalAuthRequestRoutes(app as any, {
            terminalAuthPolicy,
            isTerminalAuthExpired: (createdAt) => Date.now() - createdAt.getTime() > terminalAuthPolicy.ttlMs,
        });
        registerHomeLoginApprovalRoutes(app as any);

        for (const key of [
            "POST /v1/auth/account/request",
            "POST /v2/auth/account/request",
            "POST /v1/auth/account/response",
            "POST /v1/auth/request",
            "GET /v1/auth/request/status",
            "POST /v1/auth/request/claim",
            "POST /v1/auth/response",
            "GET /v1/auth/home-login/approvals",
            "POST /v1/auth/home-login/approvals/:approvalId/decision",
        ]) {
            const [method, path] = key.split(" ") as ["GET" | "POST", string];
            expect(getRouteEntry(app, method, path).opts.config?.rateLimit).toEqual(
                expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }),
            );
        }
    });
});
