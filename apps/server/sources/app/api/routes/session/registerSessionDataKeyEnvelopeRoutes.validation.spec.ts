import { describe, expect, it } from "vitest";

import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";

import { registerSessionDataKeyEnvelopeRoutes } from "./registerSessionDataKeyEnvelopeRoutes";

describe("Session data-key envelope route validation", () => {
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
