import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    app: vi.fn(),
    appRequest: vi.fn(),
    octokit: vi.fn(),
    request: vi.fn(),
    updateInstallation: vi.fn(),
    updateSource: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: {
        teamDirectorySource: { findUnique: mocks.findUnique, update: mocks.updateSource },
        gitHubAppInstallation: { update: mocks.updateInstallation },
        homeGovernancePolicy: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (run) => await run({
            teamDirectorySource: { findUnique: mocks.findUnique, update: mocks.updateSource },
            gitHubAppInstallation: { update: mocks.updateInstallation },
        })),
    },
}));
vi.mock("octokit", () => ({
    App: mocks.app,
    Octokit: Object.assign(mocks.octokit, { defaults: vi.fn(() => mocks.octokit) }),
}));

import { initEncrypt } from "@/modules/encrypt";
import { encryptGitHubAppRegistrationSecretsV1 } from "./githubManagedApp";
import {
    beginManagedGitHubDirectoryRead,
    readManagedGitHubDirectoryPage,
} from "./githubManagedDirectory";

const previousMasterSecret = process.env.HANDY_MASTER_SECRET;

function sourceRow(overrides: Record<string, unknown> = {}) {
    const registrationId = "registration-1";
    return {
        id: "source-1",
        teamId: "team-1",
        kind: "github_organization",
        state: "initializing",
        bindingConfig: { v: 1, kind: "github_organization", githubOrganizationLogin: "Acme" },
        githubAppInstallation: {
            id: "installation-1",
            githubInstallationId: 42n,
            githubOrganizationId: 84n,
            githubOrganizationLogin: "Acme",
            revision: 3,
            state: "verified",
            verifiedPermissions: { members: "read" },
            verifiedEvents: [],
            suspendedAt: null,
            registration: {
                id: registrationId,
                ownerTeamId: "team-1",
                githubHost: "https://github.com",
                githubAppId: 21n,
                config: { v: 1 },
                encryptedSecrets: encryptGitHubAppRegistrationSecretsV1({
                    registrationId,
                    secrets: { v: 1, privateKey: "test-private-key" },
                }),
                securityRevision: 5,
                state: "verified",
            },
        },
        ...overrides,
    };
}

beforeAll(async () => {
    process.env.HANDY_MASTER_SECRET = "managed-github-directory-test-master-secret";
    await initEncrypt();
});

afterAll(() => {
    if (previousMasterSecret === undefined) delete process.env.HANDY_MASTER_SECRET;
    else process.env.HANDY_MASTER_SECRET = previousMasterSecret;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.app.mockImplementation(() => ({ octokit: { request: mocks.appRequest } }));
    mocks.appRequest.mockImplementation(async (route: string) => route.startsWith("GET ")
        ? {
            data: {
                id: 42,
                app_id: 21,
                account: { id: 84, login: "Acme", type: "Organization" },
                repository_selection: "all",
                permissions: { members: "read" },
                events: [],
                suspended_at: null,
            },
        }
        : { data: { token: "installation-token" } });
    mocks.updateInstallation.mockResolvedValue({});
    mocks.updateSource.mockResolvedValue({});
    mocks.octokit.mockImplementation(() => ({ request: mocks.request }));
    mocks.request.mockResolvedValue({
        data: [{ id: 101, login: "octocat" }],
        headers: { link: '<https://api.github.com/orgs/acme/members?page=2>; rel="next"' },
    });
});

describe("managed GitHub directory operation", () => {
    it("carries one transient security tuple through normalized source-bound pages", async () => {
        mocks.findUnique.mockResolvedValue(sourceRow());

        const begun = await beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" });
        expect(begun).toMatchObject({ ok: true, organizationLogin: "Acme" });
        if (!begun.ok) throw new Error("expected managed directory read context");

        const page = await readManagedGitHubDirectoryPage({
            context: begun.context,
            resource: { kind: "organization_members" },
            pageSize: 50,
        });

        expect(page).toEqual({
            ok: true,
            items: [{ externalUserId: "101", active: true, login: "octocat" }],
            nextCursor: "v1:2",
        });
        expect(mocks.app).toHaveBeenCalledWith(expect.objectContaining({
            appId: "21",
            privateKey: "test-private-key",
        }));
        expect(mocks.appRequest).toHaveBeenCalledWith(
            "POST /app/installations/{installation_id}/access_tokens",
            expect.objectContaining({ installation_id: 42, permissions: { members: "read" } }),
        );
        expect(mocks.request).toHaveBeenCalledWith("GET /orgs/{org}/members", expect.objectContaining({
            org: "acme",
            page: 1,
            per_page: 50,
        }));
    });

    it("rejects a tuple that became stale before the request", async () => {
        mocks.findUnique
            .mockResolvedValueOnce(sourceRow())
            .mockResolvedValueOnce(sourceRow({
                githubAppInstallation: {
                    ...sourceRow().githubAppInstallation,
                    revision: 4,
                },
            }));
        const begun = await beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" });
        if (!begun.ok) throw new Error("expected managed directory read context");

        await expect(readManagedGitHubDirectoryPage({
            context: begun.context,
            resource: { kind: "organization_teams" },
        })).resolves.toEqual({ ok: false, code: "installation_stale" });
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("discards a fetched page when security rotates during the request", async () => {
        mocks.findUnique
            .mockResolvedValueOnce(sourceRow())
            .mockResolvedValueOnce(sourceRow())
            .mockResolvedValueOnce(sourceRow({
                githubAppInstallation: {
                    ...sourceRow().githubAppInstallation,
                    registration: {
                        ...sourceRow().githubAppInstallation.registration,
                        securityRevision: 6,
                    },
                },
            }));
        const begun = await beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" });
        if (!begun.ok) throw new Error("expected managed directory read context");

        await expect(readManagedGitHubDirectoryPage({
            context: begun.context,
            resource: { kind: "organization_members" },
        })).resolves.toEqual({ ok: false, code: "installation_stale" });
    });

    it("fails closed before GitHub when current Members permission is absent", async () => {
        const row = sourceRow();
        mocks.findUnique.mockResolvedValue({
            ...row,
            githubAppInstallation: {
                ...row.githubAppInstallation,
                verifiedPermissions: { contents: "read" },
            },
        });

        await expect(beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" }))
            .resolves.toEqual({ ok: false, code: "permission_lost" });
        expect(mocks.app).not.toHaveBeenCalled();
    });

    it("uses the current verified installation login when the display binding still has an older login", async () => {
        const row = sourceRow();
        mocks.findUnique.mockResolvedValue({
            ...row,
            githubAppInstallation: {
                ...row.githubAppInstallation,
                githubOrganizationLogin: "Acme-Renamed",
            },
        });
        mocks.appRequest.mockImplementation(async (route: string) => route.startsWith("GET ")
            ? {
                data: {
                    id: 42,
                    app_id: 21,
                    account: { id: 84, login: "Acme-Renamed", type: "Organization" },
                    repository_selection: "all",
                    permissions: { members: "read" },
                    events: [],
                    suspended_at: null,
                },
            }
            : { data: { token: "installation-token" } });

        await expect(beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" }))
            .resolves.toMatchObject({ ok: true, organizationLogin: "Acme-Renamed" });
    });

    it("refreshes an organization rename by immutable ids before reading pages", async () => {
        mocks.findUnique.mockResolvedValue(sourceRow());
        mocks.appRequest.mockImplementation(async (route: string) => route.startsWith("GET ")
            ? {
                data: {
                    id: 42,
                    app_id: 21,
                    account: { id: 84, login: "Acme-Renamed", type: "Organization" },
                    repository_selection: "all",
                    permissions: { members: "read" },
                    events: [],
                    suspended_at: null,
                },
            }
            : { data: { token: "installation-token" } });

        const begun = await beginManagedGitHubDirectoryRead({ directorySourceId: "source-1" });
        expect(begun).toMatchObject({ ok: true, organizationLogin: "Acme-Renamed" });
        if (!begun.ok) throw new Error("expected managed directory read context");

        await expect(readManagedGitHubDirectoryPage({
            context: begun.context,
            resource: { kind: "organization_members" },
        })).resolves.toMatchObject({ ok: true });
        expect(mocks.updateInstallation).toHaveBeenCalledWith({
            where: { id: "installation-1" },
            data: { githubOrganizationLogin: "Acme-Renamed" },
        });
        expect(mocks.updateSource).toHaveBeenCalledWith({
            where: { id: "source-1" },
            data: {
                displayName: "Acme-Renamed",
                bindingConfig: {
                    v: 1,
                    kind: "github_organization",
                    githubOrganizationLogin: "Acme-Renamed",
                },
            },
        });
        expect(mocks.request).toHaveBeenCalledWith("GET /orgs/{org}/members", expect.objectContaining({
            org: "acme-renamed",
        }));
    });
});
