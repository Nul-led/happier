import { describe, expect, it } from "vitest";

import type { Fastify } from "@/app/api/types";
import { createFakeRouteApp, getRouteEntry } from "@/app/api/testkit/routeHarness";

import { registerTeamRoutes } from "./registerTeamRoutes";

describe("Team route composition", () => {
    it("reuses the authenticated mutation and upload profiles and the strict Team denial envelope", () => {
        const env = {
            ...process.env,
            HAPPIER_API_RATE_LIMITS_ENABLED: "1",
            HAPPIER_ACCOUNT_SETTINGS_RATE_LIMIT_MAX: "17",
            HAPPIER_ACCOUNT_PROFILE_RATE_LIMIT_MAX: "3",
        };
        const app = createFakeRouteApp();

        registerTeamRoutes(app as unknown as Fastify, env);

        expect(getRouteEntry(app, "POST", "/v1/teams/create").opts.config?.rateLimit)
            .toEqual(expect.objectContaining({ max: 17 }));
        expect(getRouteEntry(app, "POST", "/v1/teams/logo/set").opts.config?.rateLimit)
            .toEqual(expect.objectContaining({ max: 3 }));
        expect(getRouteEntry(app, "POST", "/v1/teams/list").opts.config)
            .toMatchObject({
                allowLegacyHomeToken: false,
                restrictedAuthFailureError: "team_forbidden",
            });
    });
});
