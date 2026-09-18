import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    app: vi.fn(),
    appRequest: vi.fn(),
    octokit: vi.fn(),
    request: vi.fn(),
}));

vi.mock("octokit", () => ({
    App: mocks.app,
    Octokit: Object.assign(mocks.octokit, { defaults: vi.fn(() => mocks.octokit) }),
}));

import {
    readGithubOrgMembersPage,
    readGithubOrgTeamsPage,
    readGithubTeamMembersPage,
} from "./githubDeploymentApp";

function appEnv(appId = "123"): NodeJS.ProcessEnv {
    return {
        AUTH_GITHUB_APP_ID: appId,
        AUTH_GITHUB_APP_PRIVATE_KEY: "test-private-key",
        AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG: "acme=42,beta=43",
    };
}

function okResponse(data: unknown, headers: Record<string, string> = {}) {
    return { data, status: 200, headers };
}

function httpError(status: number, headers: Record<string, unknown> = {}) {
    return Object.assign(new Error(`HTTP ${status}`), { status, response: { headers } });
}

describe("deployment GitHub App directory page operations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.app.mockImplementation(() => ({
            octokit: { request: mocks.appRequest },
        }));
        mocks.appRequest.mockImplementation(async (route: string) => route.startsWith("GET ")
            ? okResponse({
                id: 42,
                app_id: 123,
                account: { id: 84, login: "Acme", type: "Organization" },
                repository_selection: "all",
                permissions: { members: "read" },
                events: [],
                suspended_at: null,
            })
            : okResponse({ token: "installation-token" }));
        mocks.octokit.mockImplementation(() => ({ request: mocks.request }));
        mocks.request.mockResolvedValue(okResponse([]));
    });

    it("reads one normalized organization members page through the org's installation", async () => {
        mocks.request.mockResolvedValueOnce(okResponse([
            { id: 1, login: "octocat", email: "octocat@example.com", name: "Octo Cat" },
            { id: 2, login: "robot", email: null, name: null },
        ], { link: '<https://api.github.com/organizations/1/members?page=2>; rel="next"' }));

        const result = await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 2, env: appEnv() });

        expect(result).toEqual({
            ok: true,
            hasMore: true,
            items: [
                { externalUserId: "1", active: true, login: "octocat", email: "octocat@example.com", displayName: "Octo Cat" },
                { externalUserId: "2", active: true, login: "robot" },
            ],
        });
        expect(mocks.appRequest).toHaveBeenCalledWith(
            "POST /app/installations/{installation_id}/access_tokens",
            expect.objectContaining({ installation_id: 42, permissions: { members: "read" } }),
        );
        expect(mocks.request).toHaveBeenCalledWith(
            "GET /orgs/{org}/members",
            expect.objectContaining({ org: "acme", page: 1, per_page: 2 }),
        );
    });

    it("forwards an explicit abort signal to the GitHub request", async () => {
        const controller = new AbortController();

        await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv(), signal: controller.signal });

        const options = mocks.request.mock.calls[0]?.[1] as { request?: { signal?: AbortSignal } } | undefined;
        const tokenOptions = mocks.appRequest.mock.calls[0]?.[1] as { request?: { signal?: AbortSignal } } | undefined;
        expect(options?.request?.signal).toBeInstanceOf(AbortSignal);
        expect(tokenOptions?.request?.signal).toBe(options?.request?.signal);
        controller.abort();
        expect(options?.request?.signal?.aborted).toBe(true);
    });

    it("fails closed as installation_unavailable when the App or the org installation is not configured", async () => {
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: {} }))
            .toEqual({ ok: false, code: "installation_unavailable" });
        expect(mocks.app).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();

        expect(await readGithubOrgMembersPage({ org: "gamma", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "installation_unavailable" });
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("never accepts the bare integration-App env namespace for directory reads", async () => {
        const result = await readGithubOrgTeamsPage({
            org: "acme",
            page: 1,
            perPage: 50,
            env: {
                GITHUB_APP_ID: "999",
                GITHUB_PRIVATE_KEY: "shared-integration-key",
                AUTH_GITHUB_APP_INSTALLATION_ID_BY_ORG: "acme=42",
            },
        });

        expect(result).toEqual({ ok: false, code: "installation_unavailable" });
        expect(mocks.app).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("classifies upstream failures without ever reporting absence", async () => {
        mocks.request.mockRejectedValueOnce(httpError(404));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "organization_unresolved", upstreamStatus: 404 });

        mocks.request.mockRejectedValueOnce(httpError(403));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "permission_lost", upstreamStatus: 403 });

        mocks.request.mockRejectedValueOnce(httpError(403, { "x-ratelimit-remaining": "0" }));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "rate_limited", upstreamStatus: 403 });

        mocks.request.mockRejectedValueOnce(httpError(429));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "rate_limited", upstreamStatus: 429 });

        mocks.request.mockRejectedValueOnce(httpError(403, { "retry-after": "60" }));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "rate_limited", upstreamStatus: 403, retryAfterMs: 60_000 });

        mocks.request.mockRejectedValueOnce(httpError(502));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "upstream_unavailable", upstreamStatus: 502 });

        mocks.request.mockRejectedValueOnce(new Error("network down"));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "upstream_unavailable" });

        mocks.request.mockRejectedValueOnce(httpError(404));
        expect(await readGithubTeamMembersPage({ org: "acme", teamId: 7, page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "organization_unresolved", upstreamStatus: 404 });
    });

    it("treats malformed payloads as incomplete evidence, not absence", async () => {
        mocks.request.mockResolvedValueOnce(okResponse({ members: [] }));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([{ login: "missing-id" }]));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([{ id: 600, name: "", slug: "" }]));
        expect(await readGithubOrgTeamsPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([{ id: Number.MAX_SAFE_INTEGER + 1, login: "unsafe-id" }]));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([null]));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([null]));
        expect(await readGithubOrgTeamsPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });

        mocks.request.mockResolvedValueOnce(okResponse([null]));
        expect(await readGithubTeamMembersPage({ org: "acme", teamId: 7, page: 1, perPage: 50, env: appEnv() }))
            .toEqual({ ok: false, code: "malformed_response" });
    });

    it("uses GitHub's Link header as the only pagination authority", async () => {
        mocks.request.mockResolvedValueOnce(okResponse(
            [{ id: 1, login: "short-page" }],
            { link: '<https://api.github.com/organizations/1/members?page=2>; rel="next"' },
        ));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 50, env: appEnv() }))
            .toMatchObject({ ok: true, hasMore: true });

        mocks.request.mockResolvedValueOnce(okResponse([
            { id: 2, login: "full-final-a" },
            { id: 3, login: "full-final-b" },
        ]));
        expect(await readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 2, env: appEnv() }))
            .toMatchObject({ ok: true, hasMore: false });
    });

    it("rejects page arguments GitHub cannot honor so traversal cannot silently truncate", async () => {
        await expect(readGithubOrgMembersPage({ org: "acme", page: 1, perPage: 101, env: appEnv() }))
            .rejects.toThrowError(RangeError);
        await expect(readGithubTeamMembersPage({ org: "acme", teamId: 7, page: 0, perPage: 50, env: appEnv() }))
            .rejects.toThrowError(RangeError);
        await expect(readGithubTeamMembersPage({ org: "acme", teamId: 0, page: 1, perPage: 50, env: appEnv() }))
            .rejects.toThrowError(RangeError);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("reads organization teams with stable immutable group ids and display-name fallback", async () => {
        mocks.request.mockResolvedValueOnce(okResponse(
            [
                { id: 500, name: "Platform", slug: "platform-team" },
                { id: 501, name: "", slug: "ops-team" },
            ],
            { link: '<https://api.github.com/organizations/1/teams?page=4>; rel="next"' },
        ));

        const result = await readGithubOrgTeamsPage({ org: "acme", page: 3, perPage: 2, env: appEnv() });

        expect(result).toEqual({
            ok: true,
            hasMore: true,
            items: [
                { externalGroupId: "500", displayName: "Platform" },
                { externalGroupId: "501", displayName: "ops-team" },
            ],
        });
        expect(mocks.request).toHaveBeenCalledWith(
            "GET /orgs/{org}/teams",
            expect.objectContaining({
                org: "acme",
                page: 3,
                per_page: 2,
                headers: {
                    accept: "application/vnd.github+json",
                    "x-github-api-version": "2026-03-10",
                },
            }),
        );
    });

    it("reads team members flattened against the immutable team and user ids", async () => {
        mocks.request.mockResolvedValueOnce(okResponse([
            { id: 9, login: "member-a" },
            { id: 11, login: "member-b" },
        ], { link: '<https://api.github.com/teams/77/members?page=2>; rel="next"' }));

        const result = await readGithubTeamMembersPage({ org: "acme", teamId: 77, page: 1, perPage: 2, env: appEnv() });

        expect(result).toEqual({
            ok: true,
            hasMore: true,
            items: [
                { externalGroupId: "77", externalUserId: "9" },
                { externalGroupId: "77", externalUserId: "11" },
            ],
        });
        expect(mocks.request).toHaveBeenCalledWith(
            "GET /organizations/{org_id}/team/{team_id}/members",
            expect.objectContaining({ org_id: 84, team_id: 77, page: 1, per_page: 2 }),
        );
    });
});
