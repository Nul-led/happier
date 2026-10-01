import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { registerAccountSecurityRoutes } from "./registerAccountSecurityRoutes";

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === "object" && value !== null;
}

function readResponseSchemas(value: unknown): Record<PropertyKey, unknown> {
    if (!isRecord(value) || !isRecord(value.response)) throw new Error("route response schemas missing");
    return value.response;
}

describe("Account Security route rate limits", () => {
    it("fails closed instead of installing authenticated routes without the auth prehandler", () => {
        const app = createFakeRouteApp() as unknown as { authenticate?: unknown };
        delete app.authenticate;
        expect(() => registerAccountSecurityRoutes(app as never)).toThrow(/require app\.authenticate/);
    });

    it("registers every public or credential-mutating endpoint with canonical rate limits and strict success/error schemas", () => {
        const app = createFakeRouteApp();
        registerAccountSecurityRoutes(app as never);

        for (const [method, path] of [
            ["POST", "/v1/auth/password/mutation/challenge"],
            ["POST", "/v1/auth/password/reset/submit"],
            ["GET", "/v1/account/security"],
            ["POST", "/v1/account/password/enroll/email/request"],
            ["POST", "/v1/account/password/enroll"],
            ["POST", "/v1/account/password/change"],
            ["POST", "/v1/account/password/remove"],
            ["POST", "/v1/account/email/change/request"],
            ["POST", "/v1/account/email/change"],
        ] as const) {
            expect(getRouteEntry(app, method, path).opts.config?.rateLimit).toEqual(
                expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }),
            );
            expect(getRouteEntry(app, method, path).opts.attachValidation).toBe(true);
            const responses = readResponseSchemas(getRouteEntry(app, method, path).opts.schema);
            expect(responses[200]).toBeDefined();
            for (const statusCode of [400, 401, 403, 404, 409, 503] as const) {
                expect(responses[statusCode]).toBeDefined();
            }
        }
        for (const [method, path] of [
            ["POST", "/v1/auth/password/mutation/challenge"],
            ["GET", "/v1/account/security"],
            ["POST", "/v1/account/password/enroll/email/request"],
            ["POST", "/v1/account/password/enroll"],
            ["POST", "/v1/account/password/change"],
            ["POST", "/v1/account/password/remove"],
            ["POST", "/v1/account/email/change/request"],
            ["POST", "/v1/account/email/change"],
        ] as const) {
            expect(getRouteEntry(app, method, path).opts.config?.connectionAuthFailureError).toBe("invalid_token");
        }
    });

    it("bounds authenticated first-enrollment mail by the user-keyed profile, not the IP-keyed public one", () => {
        const app = createFakeRouteApp();
        registerAccountSecurityRoutes(app as never);

        const authenticatedProfile = resolveApiHotEndpointRateLimit(process.env, "auth.email.verify.requestAuthenticated");
        const publicProfile = resolveApiHotEndpointRateLimit(process.env, "auth.email.verify.request");
        if (authenticatedProfile === false || publicProfile === false) throw new Error("mail profiles must resolve");
        // The two profiles are deliberately distinct; the assertion below would
        // not discriminate if a deployment collapsed them.
        expect(authenticatedProfile.max).not.toBe(publicProfile.max);

        // Both authenticated mail routes are the same resource — the present
        // Account — so they share one profile.
        for (const path of [
            "/v1/account/password/enroll/email/request",
            "/v1/account/email/change/request",
        ] as const) {
            expect(getRouteEntry(app, "POST", path).opts.config?.rateLimit).toMatchObject({
                max: authenticatedProfile.max,
                timeWindow: authenticatedProfile.timeWindow,
            });
        }
    });
});
