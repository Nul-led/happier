import { describe, expect, it } from "vitest";

import { homeDomainActionPathForMethod } from "./homeDomainActionRoute";

describe("homeDomainActionPathForMethod", () => {
    it("reads the route path from the Action row and rejects a mismatched explicit handler method", () => {
        expect(homeDomainActionPathForMethod("teams.list", "POST")).toBe("/v1/teams/list");
        expect(() => homeDomainActionPathForMethod("teams.list", "GET"))
            .toThrow("Home-domain Action teams.list declares POST /v1/teams/list, not GET.");
    });
});
