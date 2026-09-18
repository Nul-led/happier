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

import { readPurposeNarrowedGitHubDirectoryPage } from "./githubDirectoryAdapter";

describe("GitHub directory operation boundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.app.mockImplementation(() => ({ octokit: { request: mocks.appRequest } }));
        mocks.appRequest.mockResolvedValue({ data: { token: "installation-token" } });
        mocks.octokit.mockImplementation(() => ({ request: mocks.request }));
        mocks.request.mockResolvedValue({ data: [], headers: {} });
    });

    it("uses one cancellation deadline for purpose-narrow token acquisition and the page request", async () => {
        const controller = new AbortController();

        await expect(readPurposeNarrowedGitHubDirectoryPage({
            githubHost: "https://github.com",
            githubAppId: 1n,
            privateKey: "private-key",
            githubInstallationId: 2n,
            networkPolicy: {
                address: { kind: "publicOnly" },
                allowedPorts: [443],
                allowLoopbackHttp: false,
                maxResponseBytes: 1024 * 1024,
                maxHeaderBytes: 32 * 1024,
                timeoutMs: 30_000,
            },
            organizationLogin: "acme",
            resource: { kind: "organization_members" },
            page: 1,
            perPage: 100,
            signal: controller.signal,
        })).resolves.toEqual({ ok: true, items: [], hasMore: false });

        const tokenOptions = mocks.appRequest.mock.calls[0]?.[1] as { request?: { signal?: AbortSignal } };
        const pageOptions = mocks.request.mock.calls[0]?.[1] as { request?: { signal?: AbortSignal } };
        expect(tokenOptions.request?.signal).toBeInstanceOf(AbortSignal);
        expect(tokenOptions.request?.signal).toBe(pageOptions.request?.signal);
        controller.abort();
        expect(tokenOptions.request?.signal?.aborted).toBe(true);
    });

    it("preserves caller cancellation instead of recording a provider timeout", async () => {
        const controller = new AbortController();
        mocks.request.mockImplementationOnce(async () => {
            controller.abort();
            throw new Error("aborted");
        });

        await expect(readPurposeNarrowedGitHubDirectoryPage({
            githubHost: "https://github.com",
            githubAppId: 1n,
            privateKey: "private-key",
            githubInstallationId: 2n,
            networkPolicy: {
                address: { kind: "publicOnly" },
                allowedPorts: [443],
                allowLoopbackHttp: false,
                maxResponseBytes: 1024 * 1024,
                maxHeaderBytes: 32 * 1024,
                timeoutMs: 30_000,
            },
            organizationLogin: "acme",
            resource: { kind: "organization_members" },
            page: 1,
            perPage: 100,
            signal: controller.signal,
        })).resolves.toEqual({ ok: false, code: "request_cancelled" });
    });

});
