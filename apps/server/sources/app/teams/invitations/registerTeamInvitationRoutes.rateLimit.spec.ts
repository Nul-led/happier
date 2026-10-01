import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "@/app/api/testkit/routeHarness";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { registerTeamInvitationRoutes } from "./registerTeamInvitationRoutes";

describe("Team invitation route rate limits", () => {
    it("protects approval preparation with the existing auth entry profile", async () => {
        const app = createFakeRouteApp();
        registerTeamInvitationRoutes(app as never, {
            resolveJoinLinkTarget: async () => ({ applicationOrigin: null, homeTarget: null }),
            resolveJoinScreenHomeIdentity: async () => ({
                serverId: "home-1",
                displayName: "Home",
                storageMode: "plain",
                hosting: null,
            }),
            email: {
                delivery: { isReady: async () => false, deliver: async () => ({ status: "sent" }) },
                isDeliveryReady: () => false,
            },
        });

        const configured = getRouteEntry(app, "POST", "/v1/team-invitations/accept/prepare-approval")
            .opts.config?.rateLimit;
        const expected = resolveApiHotEndpointRateLimit(process.env, "auth.entry");
        if (!configured || !expected || !configured.keyGenerator || !expected.keyGenerator) {
            throw new Error("Expected the auth entry rate-limit profile to be enabled");
        }
        expect(configured).toEqual(expect.objectContaining({
            max: expected.max,
            timeWindow: expected.timeWindow,
        }));
        expect(await configured.keyGenerator({
            userId: "account-1",
            ip: "203.0.113.9",
        })).toBe(await expected.keyGenerator({
            userId: "account-1",
            ip: "203.0.113.9",
        } as never));
    });
});
