import { describe, expect, it } from "vitest";
import type { RouteOptions } from "fastify";

import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";

import { registerSessionDataKeyEnvelopeRoutes } from "./registerSessionDataKeyEnvelopeRoutes";

describe("Session data-key envelope route validation", () => {
    it("declares authentication-unavailable as a 503 for both envelope routes", async () => {
        const app = createAuthenticatedTestApp();
        const responseSchemas: unknown[] = [];
        app.addHook("onRoute", (route: RouteOptions) => {
            if (
                route.url === "/v2/sessions/:sessionId/data-key/envelopes"
                && (route.method === "GET" || route.method === "PATCH")
            ) {
                responseSchemas.push(route.schema?.response);
            }
        });
        registerSessionDataKeyEnvelopeRoutes(app);
        try {
            expect(responseSchemas).toHaveLength(2);
            for (const response of responseSchemas) {
                expect(response).toHaveProperty("503");
                expect(response).not.toEqual(expect.objectContaining({
                    409: expect.objectContaining({ error: "session_access_authentication_unavailable" }),
                }));
            }
        } finally {
            await app.close();
        }
    });

    it("uses the resource error vocabulary for malformed queries and writes", async () => {
        const app = createAuthenticatedTestApp();
        registerSessionDataKeyEnvelopeRoutes(app);
        await app.ready();
        try {
            const headers = { "x-test-user-id": "account-owner" };
            const invalidCursor = await app.inject({
                method: "GET",
                url: "/v2/sessions/session-1/data-key/envelopes?cursor=not-a-data-key-cursor",
                headers,
            });
            expect(invalidCursor.statusCode).toBe(400);
            expect(invalidCursor.json()).toEqual({ error: "invalid_cursor" });

            const invalidQuery = await app.inject({
                method: "GET",
                url: "/v2/sessions/session-1/data-key/envelopes?state=pending",
                headers,
            });
            expect(invalidQuery.statusCode).toBe(400);
            expect(invalidQuery.json()).toEqual({ error: "invalid_request" });

            const invalidBody = await app.inject({
                method: "PATCH",
                url: "/v2/sessions/session-1/data-key/envelopes",
                headers,
                payload: { entries: [] },
            });
            expect(invalidBody.statusCode).toBe(400);
            expect(invalidBody.json()).toEqual({ error: "invalid_request" });
        } finally {
            await app.close();
        }
    });
});
