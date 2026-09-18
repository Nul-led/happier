import { beforeEach, describe, expect, it, vi } from "vitest";

const githubMocks = vi.hoisted(() => ({
    app: vi.fn(),
    appRequest: vi.fn(),
    octokit: vi.fn(),
    defaults: vi.fn(),
    installationRequest: vi.fn(),
}));

vi.mock("octokit", () => ({
    App: githubMocks.app,
    Octokit: Object.assign(githubMocks.octokit, { defaults: githubMocks.defaults }),
}));

import {
    readGitHubAppInstallationEvidence,
    readGitHubTeamMembershipObservation,
    verifyGitHubOrganizationMember,
} from "./githubAppInstallationClient";

const networkPolicy = {
    address: { kind: "publicOnly" as const },
    allowedPorts: [443],
    allowLoopbackHttp: false,
    maxResponseBytes: 1024 * 1024,
    maxHeaderBytes: 32 * 1024,
    timeoutMs: 30_000,
};

describe("managed GitHub App outbound transport", () => {
    beforeEach(() => {
        githubMocks.defaults.mockReset();
        githubMocks.app.mockReset();
        githubMocks.appRequest.mockReset();
        githubMocks.installationRequest.mockReset();
        githubMocks.defaults.mockReturnValue(githubMocks.octokit);
        githubMocks.app.mockImplementation(() => ({ octokit: { request: githubMocks.appRequest } }));
        githubMocks.octokit.mockImplementation(() => ({ request: githubMocks.installationRequest }));
        githubMocks.appRequest.mockResolvedValue({
            data: {
                id: 301,
                app_id: 44,
                account: { id: 401, login: "Acme", type: "Organization" },
                repository_selection: "selected",
                permissions: { members: "read" },
                events: [],
                suspended_at: null,
            },
        });
    });

    it("injects the canonical bounded outbound fetch into App-authenticated requests", async () => {
        await readGitHubAppInstallationEvidence({
            githubHost: "https://github.com",
            githubAppId: 44n,
            privateKey: "private-key",
            githubInstallationId: 301n,
            networkPolicy,
        });

        expect(githubMocks.defaults).toHaveBeenCalledWith(expect.objectContaining({
            baseUrl: "https://api.github.com",
            request: { fetch: expect.any(Function) },
        }));
    });

    it("requires active organization membership for the exact immutable GitHub user", async () => {
        githubMocks.appRequest.mockResolvedValueOnce({ data: { token: "installation-token" } });
        githubMocks.installationRequest.mockResolvedValueOnce({
            data: { state: "active", role: "member", user: { id: 42 } },
        });
        await expect(verifyGitHubOrganizationMember({
            githubHost: "https://github.com",
            githubAppId: 44n,
            privateKey: "private-key",
            githubInstallationId: 301n,
            githubOrganizationLogin: "Acme",
            githubUserId: 42n,
            githubUserLogin: "Octocat",
            networkPolicy,
        })).resolves.toEqual({ status: "active" });
        expect(githubMocks.installationRequest).toHaveBeenCalledWith(
            "GET /orgs/{org}/memberships/{username}",
            expect.objectContaining({ org: "Acme", username: "Octocat" }),
        );

        githubMocks.appRequest.mockResolvedValueOnce({ data: { token: "installation-token" } });
        githubMocks.installationRequest.mockResolvedValueOnce({
            data: { state: "active", role: "member", user: { id: 99 } },
        });
        await expect(verifyGitHubOrganizationMember({
            githubHost: "https://github.com",
            githubAppId: 44n,
            privateKey: "private-key",
            githubInstallationId: 301n,
            githubOrganizationLogin: "Acme",
            githubUserId: 42n,
            githubUserLogin: "Octocat",
            networkPolicy,
        })).resolves.toEqual({ status: "identity_mismatch" });
    });

    it("returns a complete immutable Team-ID observation only when every membership check settles", async () => {
        githubMocks.appRequest.mockResolvedValue({ data: { token: "installation-token" } });
        githubMocks.installationRequest
            .mockResolvedValueOnce({ data: { state: "active", role: "member" } })
            .mockResolvedValueOnce({ data: { state: "pending", role: "member" } })
            .mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
        await expect(readGitHubTeamMembershipObservation({
            githubHost: "https://github.com",
            githubAppId: 44n,
            privateKey: "private-key",
            githubInstallationId: 301n,
            githubOrganizationId: 401n,
            githubUserLogin: "Octocat",
            githubTeamIds: ["501", "502", "503"],
            networkPolicy,
        })).resolves.toEqual({ status: "complete", activeTeamIds: ["501"] });
        expect(githubMocks.installationRequest).toHaveBeenNthCalledWith(
            1,
            "GET /organizations/{org_id}/team/{team_id}/memberships/{username}",
            expect.objectContaining({ org_id: 401, team_id: 501, username: "Octocat" }),
        );

        githubMocks.appRequest.mockResolvedValueOnce({ data: { token: "installation-token" } });
        githubMocks.installationRequest.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }));
        await expect(readGitHubTeamMembershipObservation({
            githubHost: "https://github.com",
            githubAppId: 44n,
            privateKey: "private-key",
            githubInstallationId: 301n,
            githubOrganizationId: 401n,
            githubUserLogin: "Octocat",
            githubTeamIds: ["501"],
            networkPolicy,
        })).resolves.toEqual({ status: "incomplete" });
    });
});
