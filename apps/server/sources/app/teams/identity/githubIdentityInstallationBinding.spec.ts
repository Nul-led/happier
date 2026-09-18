import { describe, expect, it } from "vitest";

import { isExactGitHubIdentityInstallationBinding } from "./githubIdentityInstallationBinding";

describe("GitHub identity installation binding", () => {
    it("accepts only the exact installation referenced by the provider instance", () => {
        expect(isExactGitHubIdentityInstallationBinding({
            providerInstallationId: "installation-a",
            connectionInstallationId: "installation-a",
        })).toBe(true);
        expect(isExactGitHubIdentityInstallationBinding({
            providerInstallationId: "installation-a",
            connectionInstallationId: "installation-b",
        })).toBe(false);
        expect(isExactGitHubIdentityInstallationBinding({
            providerInstallationId: null,
            connectionInstallationId: "installation-a",
        })).toBe(false);
    });
});
