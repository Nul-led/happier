import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedDirectorySource } from "./directorySourceService";

const mocks = vi.hoisted(() => ({ beginWorkos: vi.fn() }));

vi.mock("@/app/integrations/github/githubManagedDirectory", () => ({
    beginManagedGitHubDirectoryRead: vi.fn(),
    readManagedGitHubDirectoryPage: vi.fn(),
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

describe("WorkOS directory source dispatch", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.beginWorkos.mockResolvedValue({
            ok: true,
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
        })).resolves.toEqual({ ok: true });
        await expect(catchUpDirectorySource({
            source: claimed,
            writeWorkosEvent: vi.fn(async () => true),
            stageWorkosGroupMembersEventPage: vi.fn(async () => true),
        })).resolves.toEqual({ ok: true });

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
});
