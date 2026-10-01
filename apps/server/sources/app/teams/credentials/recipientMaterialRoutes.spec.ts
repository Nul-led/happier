import { describe, expect, it } from "vitest";

import { createFakeRouteApp } from "@/app/api/testkit/routeHarness";
import { registerTeamCredentialResourceRoutes } from "./registerTeamCredentialResourceRoutes";

describe("Team credential direct-material routes", () => {
    it("mounts the source census/upsert and recipient-only read contract", () => {
        const app = createFakeRouteApp();
        registerTeamCredentialResourceRoutes(app as never);

        const base = "/v2/teams/:teamId/credential-resources/:resourceId/direct-material";
        expect(app.routes.has(`GET ${base}`)).toBe(true);
        expect(app.routes.has(`PUT ${base}`)).toBe(true);
        expect(app.routes.has(`DELETE ${base}`)).toBe(true);
        expect(app.routes.has("POST /v1/teams/credential-resources/direct-material/preparation/list")).toBe(false);
    });
});
