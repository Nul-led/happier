import { describe, expect, it } from "vitest";

import { toSocialIdentities } from "./type";

describe("social identity visibility", () => {
    it("omits the native email locator without hiding other native identities", () => {
        expect(toSocialIdentities([
            {
                provider: "email",
                providerLogin: "owner@example.test",
                profile: {},
                showOnProfile: false,
            },
            {
                provider: "mtls",
                providerLogin: null,
                profile: {},
                showOnProfile: false,
            },
            {
                provider: "github",
                providerLogin: "octocat",
                profile: {},
                showOnProfile: true,
            },
        ])).toEqual([
            {
                provider: "mtls",
                providerLogin: null,
                profile: {},
                showOnProfile: false,
            },
            {
                provider: "github",
                providerLogin: "octocat",
                profile: {},
                showOnProfile: true,
            },
        ]);
    });
});
