import { describe, expect, it, vi } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";

vi.mock("@/utils/logging/log", () => ({ log: vi.fn() }));

describe("public share route rate limits", () => {
    it("registers public share endpoints with explicit rate limits and IP-keying", async () => {
        const { publicShareRoutes } = await import("./publicShareRoutes");

        const app = createFakeRouteApp();
        publicShareRoutes(app as any);

        const publicRead = getRouteEntry(app, "GET", "/v1/public-share/:token");
        expect(publicRead.opts.config?.rateLimit).toEqual(expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }));
        expect(await publicRead.opts.config?.rateLimit?.keyGenerator?.({ headers: {}, ip: "203.0.113.9" })).toBe("ip:203.0.113.9");

        const publicMessages = getRouteEntry(app, "GET", "/v1/public-share/:token/messages");
        expect(publicMessages.opts.config?.rateLimit).toEqual(expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }));
        expect(await publicMessages.opts.config?.rateLimit?.keyGenerator?.({ headers: {}, ip: "203.0.113.9" })).toBe("ip:203.0.113.9");

    });
});
