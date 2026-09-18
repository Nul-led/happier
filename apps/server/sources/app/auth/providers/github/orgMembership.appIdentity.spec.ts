import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    app: vi.fn(),
    octokit: vi.fn(),
    defaults: vi.fn(),
    /** Requests made as the App itself (installation-token minting). */
    appRequest: vi.fn(),
    /** Requests made with the narrowed installation token. */
    installationRequest: vi.fn(),
}));

vi.mock("octokit", () => ({
    App: mocks.app,
    Octokit: Object.assign(mocks.octokit, { defaults: mocks.defaults }),
}));

import { isGithubOrgMemberViaApp } from "./orgMembership";

describe("GitHub authentication App identity", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.defaults.mockReturnValue(mocks.octokit);
        mocks.octokit.mockImplementation(() => ({ request: mocks.installationRequest }));
        mocks.app.mockImplementation(() => ({ octokit: { request: mocks.appRequest } }));
        mocks.appRequest.mockResolvedValue({ data: { token: "installation-token" } });
        mocks.installationRequest.mockResolvedValue({ status: 204 });
    });

    it("does not borrow generic integration-App credentials for authentication membership", async () => {
        await expect(isGithubOrgMemberViaApp({
            org: "acme",
            username: "octocat",
            env: {
                GITHUB_APP_ID: "shared-integration-app",
                GITHUB_PRIVATE_KEY: "shared-integration-private-key",
                AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG: "acme=123",
            },
        })).resolves.toBe(false);

        expect(mocks.app).not.toHaveBeenCalled();
        expect(mocks.installationRequest).not.toHaveBeenCalled();
    });

    it("preserves the deployment App membership contract through the extracted owner", async () => {
        const env = {
            AUTH_GITHUB_APP_ID: "authentication-app",
            AUTH_GITHUB_APP_PRIVATE_KEY: "authentication-private-key",
            AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG: "acme=123",
        };

        await expect(isGithubOrgMemberViaApp({ org: "ACME", username: "octocat", env })).resolves.toBe(true);
        expect(mocks.installationRequest).toHaveBeenCalledWith(
            "GET /orgs/{org}/members/{username}",
            expect.objectContaining({
                org: "acme",
                username: "octocat",
                headers: {
                    accept: "application/vnd.github+json",
                    "x-github-api-version": "2026-03-10",
                },
            }),
        );

        mocks.installationRequest.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
        await expect(isGithubOrgMemberViaApp({ org: "acme", username: "former-member", env })).resolves.toBe(false);

        const upstreamError = Object.assign(new Error("upstream unavailable"), { status: 503 });
        mocks.installationRequest.mockRejectedValueOnce(upstreamError);
        await expect(isGithubOrgMemberViaApp({ org: "acme", username: "unknown", env })).rejects.toBe(upstreamError);
    });

    it("reaches GitHub only through the outbound identity boundary and asks for the narrowest token", async () => {
        const env = {
            AUTH_GITHUB_APP_ID: "authentication-app",
            AUTH_GITHUB_APP_PRIVATE_KEY: "authentication-private-key",
            AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG: "acme=123",
        };

        await expect(isGithubOrgMemberViaApp({ org: "acme", username: "octocat", env })).resolves.toBe(true);

        // A policy-checked fetch, not the process-global one: this legacy call
        // shares the connector the directory reads already use.
        expect(mocks.defaults).toHaveBeenCalledWith(expect.objectContaining({
            baseUrl: "https://api.github.com",
            request: { fetch: expect.any(Function) },
        }));
        expect(mocks.appRequest).toHaveBeenCalledWith(
            "POST /app/installations/{installation_id}/access_tokens",
            expect.objectContaining({
                installation_id: 123,
                permissions: { members: "read" },
            }),
        );
    });
});
