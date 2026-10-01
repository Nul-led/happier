import { describe, expect, it, vi } from "vitest";

import {
    managedGitHubAppRefusalCode,
    projectManagedGitHubAppRegistrationV1,
    registerManagedGitHubAppRoutes,
} from "./githubManagedAppRoutes";

describe("managed GitHub App routes", () => {
    it("normalizes domain refusals through the single route error vocabulary", () => {
        expect(managedGitHubAppRefusalCode("forbidden", "forbidden")).toBe("github_app_forbidden");
        expect(managedGitHubAppRefusalCode("team_authentication_required", "forbidden"))
            .toBe("team_authentication_required");
        expect(managedGitHubAppRefusalCode("team_authentication_unavailable", "forbidden"))
            .toBe("team_authentication_unavailable");
        expect(managedGitHubAppRefusalCode("registration_revision_conflict", "github_app_revision_conflict"))
            .toBe("github_app_revision_conflict");
    });

    it("registers every public Action transport on the canonical paths", () => {
        const post = vi.fn();
        const get = vi.fn();
        registerManagedGitHubAppRoutes({ post, get } as never);

        expect(get.mock.calls.map(([path]) => path)).toEqual([
            "/v1/identity/github-apps/manifest-setup/submit",
            "/v1/identity/github-apps/manifest-setup/complete",
        ]);

        expect(post.mock.calls.map(([path]) => path)).toEqual([
            "/v1/identity/github-apps/list",
            "/v1/identity/github-apps/create",
            "/v1/identity/github-apps/manifest-setup/start",
            "/v1/identity/github-apps/update",
            "/v1/identity/github-apps/verify-installation",
            "/v1/identity/github-apps/remove",
        ]);
    });

    it("projects the user-authorization callback URL an administrator must register on the App", () => {
        // The value is derived from the Home's public server URL, never
        // persisted; without a public URL the field is absent rather than a
        // guess the administrator would copy into GitHub.
        const registration = {
            id: "registration_1",
            owner: { kind: "home" as const },
            githubHost: "https://github.com",
            githubAppId: 42n,
            githubClientId: "Iv1.client",
            githubAppSlug: null,
            githubOwnerId: null,
            githubOwnerLogin: null,
            revision: 1,
            securityRevision: 1,
            state: "draft" as const,
            secretHealth: { clientSecretConfigured: true, privateKeyConfigured: true, webhookSecretConfigured: true },
            lastVerifiedAt: null,
            createdAt: new Date("2026-09-06T00:00:00.000Z"),
            updatedAt: new Date("2026-09-06T00:00:00.000Z"),
        };
        expect(projectManagedGitHubAppRegistrationV1(registration, { HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test" }))
            .toMatchObject({ id: "registration_1", githubAppId: "42", callbackUrl: "https://home.example.test/v1/oauth/github-app/callback" });
        expect(projectManagedGitHubAppRegistrationV1(registration, {})).not.toHaveProperty("callbackUrl");
    });
});
