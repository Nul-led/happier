import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";

describe("featuresRoutes rate limits", () => {
    it("registers public and authenticated feature reads with the same explicit rate limit", async () => {
        const { featuresRoutes } = await import("./featuresRoutes");
        const app = createFakeRouteApp();
        featuresRoutes(app as any);

        const publicRateLimit = getRouteEntry(app, "GET", "/v1/features").opts.config?.rateLimit;
        expect(publicRateLimit).toEqual(
            expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }),
        );
        const authenticated = getRouteEntry(app, "GET", "/v1/features/authenticated");
        expect(authenticated.opts.preHandler).toBe(app.authenticate);
        expect(authenticated.opts.config?.rateLimit).toEqual(publicRateLimit);
    });
});
