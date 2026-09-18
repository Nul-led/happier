import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";
import { registerAuthEntryRoute } from "./registerAuthEntryRoute";

describe("registerAuthEntryRoute rate limit", () => {
    it("protects the public database-backed projection with an IP rate limit", () => {
        const app = createFakeRouteApp();
        registerAuthEntryRoute(app as unknown as Parameters<typeof registerAuthEntryRoute>[0]);

        expect(getRouteEntry(app, "POST", "/v1/auth/entry").opts.config?.rateLimit).toEqual(
            expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }),
        );
    });
});
