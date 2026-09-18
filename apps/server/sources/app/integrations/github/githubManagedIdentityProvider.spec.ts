import { describe, expect, it } from "vitest";

import type { AuthPolicy } from "@/app/auth/authPolicy";
import { resolveManagedGitHubAuthProviderFeatures } from "./githubManagedIdentityProvider";

describe("managed GitHub auth provider features", () => {
    it("projects the safe catalog descriptor without constructing a secret-bearing runtime", () => {
        const policy: AuthPolicy = {
            anonymousSignupEnabled: false,
            signupProviders: [],
            requiredLoginProviders: [],
            offboarding: { enabled: true, strict: false, intervalSeconds: 900, mode: "per-request-cache" },
        };

        expect(resolveManagedGitHubAuthProviderFeatures({
            displayName: "Acme GitHub",
            enabled: false,
            configured: true,
        }, policy)).toEqual({
            enabled: false,
            configured: true,
            ui: {
                displayName: "Acme GitHub",
                iconHint: "github",
                connectButtonColor: "#24292F",
                supportsProfileBadge: true,
                badgeIconName: "github",
            },
            restrictions: { usersAllowlist: false, orgsAllowlist: true, orgMatch: "all" },
            offboarding: {
                enabled: true,
                intervalSeconds: 900,
                mode: "per-request-cache",
                source: "managed_github_app",
            },
        });
    });
});
