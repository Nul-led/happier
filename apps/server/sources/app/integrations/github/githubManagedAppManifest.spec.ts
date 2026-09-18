import { describe, expect, it } from "vitest";

import { createGitHubAppManifest } from "./githubManagedAppManifest";

describe("GitHub App manifest", () => {
    it("registers the exact manifest return and stable GitHub App user OAuth callback", () => {
        const callbackUrl = new URL("/v1/oauth/github/callback", "https://home.example.test").toString();
        const userAuthorizationCallbackUrl = new URL(
            "/v1/oauth/github-app/callback",
            "https://home.example.test",
        ).toString();
        const setupUrl = new URL(
            "/v1/identity/github-apps/manifest-setup/complete?state=signed-state",
            "https://home.example.test",
        ).toString();
        const manifest = JSON.parse(createGitHubAppManifest({
            appName: "Acme Happier",
            publicServerUrl: "https://home.example.test",
            callbackUrl,
            userAuthorizationCallbackUrl,
            setupUrl,
        })) as Record<string, unknown>;

        expect(manifest).toMatchObject({
            redirect_url: callbackUrl,
            callback_urls: [userAuthorizationCallbackUrl],
            setup_url: setupUrl,
            setup_on_update: false,
        });
    });
});
