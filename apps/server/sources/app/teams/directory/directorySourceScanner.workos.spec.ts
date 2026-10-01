import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedDirectorySource } from "./directorySourceService";

const mocks = vi.hoisted(() => ({
    beginWorkos: vi.fn(),
    beginGithub: vi.fn(),
    readGithub: vi.fn(),
}));

vi.mock("@/app/integrations/github/githubManagedDirectory", () => ({
    beginManagedGitHubDirectoryRead: mocks.beginGithub,
    readManagedGitHubDirectoryPage: mocks.readGithub,
}));
vi.mock("./workosDirectorySourceAdapter", () => ({
    beginWorkosDirectoryRead: mocks.beginWorkos,
}));

import { catchUpDirectorySource, scanDirectorySource } from "./directorySourceScanner";

function source(): ClaimedDirectorySource {
    return {
        id: "source-workos",
        teamId: "team-workos",
        kind: "workos_directory",
        binding: { v: 1, kind: "workos_directory", workosDirectoryId: "directory_1" },
        reconcileRunId: "run-workos",
        eventCursor: null,
        eventRangeStart: new Date("2026-09-05T09:00:00.000Z"),
        observedManualSyncRequestedAt: null,
    };
}

function githubSource(): ClaimedDirectorySource {
    return {
        id: "source-github",
        teamId: "team-github",
        kind: "github_organization",
        binding: { v: 1, kind: "github_organization", githubOrganizationLogin: "acme" },
        reconcileRunId: "run-github",
        eventCursor: null,
        eventRangeStart: null,
        observedManualSyncRequestedAt: null,
    };
}

const workosCurrentness = {
    kind: "workos_directory_read" as const,
    directorySourceId: "source-workos",
    teamIdentityConnectionId: "connection-workos",
    workosDirectoryId: "directory_1",
    organizationId: "org_1",
    runtimeFingerprint: "workos-runtime-v1",
};

describe("WorkOS directory source dispatch", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.beginWorkos.mockResolvedValue({
            ok: true,
            expectedCurrentness: workosCurrentness,
            context: {
                organizationId: "org_1",
                directoryId: "directory_1",
                listUsers: vi.fn(async () => ({ data: [], listMetadata: { after: null } })),
                listGroups: vi.fn(async () => ({ data: [], listMetadata: { after: null } })),
                listEvents: vi.fn(async () => ({ data: [], listMetadata: { after: null } })),
            },
        });
    });

    it("uses one canonical source context for the snapshot and replay phases", async () => {
        const claimed = source();
        await expect(scanDirectorySource({
            source: claimed,
            writePeoplePage: vi.fn(async () => true),
            writeGroupsPage: vi.fn(async () => true),
            writeGroupMembersPage: vi.fn(async () => true),
        })).resolves.toEqual({ ok: true, expectedCurrentness: workosCurrentness });
        await expect(catchUpDirectorySource({
            source: claimed,
            writeWorkosEvent: vi.fn(async () => true),
            stageWorkosGroupMembersEventPage: vi.fn(async () => true),
        })).resolves.toEqual({ ok: true, expectedCurrentness: workosCurrentness });

        expect(mocks.beginWorkos).toHaveBeenNthCalledWith(1, { source: claimed, env: process.env });
        expect(mocks.beginWorkos).toHaveBeenNthCalledWith(2, { source: claimed, env: process.env });
    });

    it("forwards the worker environment to both WorkOS phases", async () => {
        const env = { WORKOS_API_KEY: "test-key", WORKOS_CLIENT_ID: "test-client" };
        await scanDirectorySource({
            source: source(),
            env,
            writePeoplePage: vi.fn(async () => true),
            writeGroupsPage: vi.fn(async () => true),
            writeGroupMembersPage: vi.fn(async () => true),
        });
        await catchUpDirectorySource({
            source: source(),
            env,
            writeWorkosEvent: vi.fn(async () => true),
            stageWorkosGroupMembersEventPage: vi.fn(async () => true),
        });
        expect(mocks.beginWorkos).toHaveBeenNthCalledWith(1, { source: expect.anything(), env });
        expect(mocks.beginWorkos).toHaveBeenNthCalledWith(2, { source: expect.anything(), env });
    });

    it("carries WorkOS read currentness with an event before the native write", async () => {
        const listEvents = vi.fn()
            .mockResolvedValueOnce({
                data: [{ id: "event_1", event: "dsync.activated", data: { id: "directory_1", organizationId: "org_1" } }],
                listMetadata: { after: "event_1" },
            })
            .mockResolvedValueOnce({ data: [], listMetadata: { after: null } });
        mocks.beginWorkos.mockResolvedValueOnce({
            ok: true,
            expectedCurrentness: workosCurrentness,
            context: {
                organizationId: "org_1",
                directoryId: "directory_1",
                listUsers: vi.fn(),
                listGroups: vi.fn(),
                listEvents,
            },
        });
        const writeWorkosEvent = vi.fn(async () => true);
        await expect(catchUpDirectorySource({
            source: source(),
            writeWorkosEvent,
            stageWorkosGroupMembersEventPage: vi.fn(async () => true),
        })).resolves.toEqual({ ok: true, expectedCurrentness: workosCurrentness });
        expect(writeWorkosEvent).toHaveBeenCalledWith({
            expectedPosition: { eventCursor: null, eventRangeStart: source().eventRangeStart },
            eventId: "event_1",
        }, workosCurrentness);
    });

    it("carries GitHub read currentness into projection completion", async () => {
        mocks.beginGithub.mockResolvedValue({
            ok: true,
            context: {
                directorySourceId: "source-github",
                githubInstallationId: 900n,
                registrationSecurityRevision: 4,
                installationRevision: 7,
                networkPolicyFingerprint: "network-v1",
                githubOrganizationId: 42n,
                organizationLogin: "acme",
            },
            organizationLogin: "acme",
        });
        mocks.readGithub.mockResolvedValue({ ok: true, items: [], nextCursor: null });

        await expect(scanDirectorySource({
            source: githubSource(),
            writePeoplePage: vi.fn(async () => true),
            writeGroupsPage: vi.fn(async () => true),
            writeGroupMembersPage: vi.fn(async () => true),
        })).resolves.toEqual({
            ok: true,
            expectedCurrentness: {
                kind: "github_directory_read",
                directorySourceId: "source-github",
                githubInstallationId: 900n,
                registrationSecurityRevision: 4,
                installationRevision: 7,
                networkPolicyFingerprint: "network-v1",
                githubOrganizationId: 42n,
                organizationLogin: "acme",
            },
        });
    });
});
