import {
    beginManagedGitHubDirectoryRead,
    readManagedGitHubDirectoryPage,
    type ManagedGitHubDirectoryFailure,
    type ManagedGitHubDirectoryReadContext,
    type ManagedGitHubDirectoryResource,
} from "@/app/integrations/github/githubManagedDirectory";
import type {
    DirectoryProjectionCatchUp,
    DirectoryProjectionScan,
    DirectoryProjectionScanResult,
} from "./directoryReconciler";
import type { DirectoryGroup, DirectoryGroupMember, DirectoryPerson } from "./directorySourceEvidence";
import { beginWorkosDirectoryRead } from "./workosDirectorySourceAdapter";
import {
    consumeWorkosDirectoryEvents,
    scanWorkosDirectorySnapshot,
} from "./workosDirectoryReader";

function mapGithubFailure(failure: ManagedGitHubDirectoryFailure): DirectoryProjectionScanResult {
    const retryHint = failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs };
    switch (failure.code) {
        case "permission_lost":
            return { ok: false, code: "directory_source_permission_lost" };
        case "rate_limited":
            return { ok: false, code: "directory_sync_rate_limited", ...retryHint };
        case "request_cancelled":
            return { ok: false, code: "stale_run" };
        case "directory_source_unavailable":
        case "installation_unavailable":
        case "installation_stale":
        case "organization_unresolved":
            return { ok: false, code: "directory_source_identity_mismatch" };
        case "upstream_unavailable":
            // Network loss and 5xx are provider unavailability; an unexpected
            // 4xx response is a malformed snapshot instead. Both keep committed
            // native access and stay worker-retryable.
            return failure.upstreamStatus !== undefined && failure.upstreamStatus < 500
                ? { ok: false, code: "directory_snapshot_incomplete" }
                : { ok: false, code: "directory_sync_unavailable" };
        case "malformed_response":
            return { ok: false, code: "directory_snapshot_incomplete" };
        case "request_timeout":
            return { ok: false, code: "directory_sync_unavailable" };
    }
}

function parsePeople(items: readonly unknown[]): readonly DirectoryPerson[] | null {
    if (!items.every((item): item is DirectoryPerson => (
        typeof item === "object" && item !== null && "externalUserId" in item && "active" in item
    ))) return null;
    return items;
}

function parseGroups(items: readonly unknown[]): readonly DirectoryGroup[] | null {
    if (!items.every((item): item is DirectoryGroup => (
        typeof item === "object" && item !== null && "externalGroupId" in item && "displayName" in item
    ))) return null;
    return items;
}

function parseGroupMembers(items: readonly unknown[]): readonly DirectoryGroupMember[] | null {
    if (!items.every((item): item is DirectoryGroupMember => (
        typeof item === "object"
        && item !== null
        && "externalGroupId" in item
        && "externalUserId" in item
        && !("active" in item)
    ))) return null;
    return items;
}

async function readGithubResourcePages(params: Readonly<{
    context: ManagedGitHubDirectoryReadContext;
    resource: ManagedGitHubDirectoryResource;
    signal?: AbortSignal;
    consume: (items: readonly unknown[]) => Promise<boolean>;
}>): Promise<DirectoryProjectionScanResult> {
    let cursor: string | null = null;
    const visitedCursors = new Set<string>();
    do {
        const page = await readManagedGitHubDirectoryPage({
            context: params.context,
            resource: params.resource,
            cursor,
            signal: params.signal,
        });
        if (!page.ok) return mapGithubFailure(page);
        if (page.nextCursor !== null && visitedCursors.has(page.nextCursor)) {
            return { ok: false, code: "directory_snapshot_incomplete" };
        }
        if (page.nextCursor !== null) visitedCursors.add(page.nextCursor);
        if (!await params.consume(page.items)) return { ok: false, code: "stale_run" };
        cursor = page.nextCursor;
    } while (cursor !== null);
    return { ok: true };
}

async function scanGithubDirectory(params: Parameters<DirectoryProjectionScan>[0]): Promise<DirectoryProjectionScanResult> {
    const began = await beginManagedGitHubDirectoryRead({ directorySourceId: params.source.id });
    if (!began.ok) return mapGithubFailure(began);

    const people = await readGithubResourcePages({
        context: began.context,
        resource: { kind: "organization_members" },
        signal: params.signal,
        consume: async (items) => {
            const parsed = parsePeople(items);
            return parsed !== null && await params.writePeoplePage(parsed);
        },
    });
    if (!people.ok) return people;

    let nestedFailure: DirectoryProjectionScanResult | null = null;
    const groupsResult = await readGithubResourcePages({
        context: began.context,
        resource: { kind: "organization_teams" },
        signal: params.signal,
        consume: async (items) => {
            const groups = parseGroups(items);
            if (!groups || !await params.writeGroupsPage(groups)) return false;
            for (const group of groups) {
                let githubTeamId: bigint;
                try {
                    githubTeamId = BigInt(group.externalGroupId);
                    if (githubTeamId <= 0n) {
                        nestedFailure = { ok: false, code: "directory_snapshot_incomplete" };
                        return false;
                    }
                } catch {
                    nestedFailure = { ok: false, code: "directory_snapshot_incomplete" };
                    return false;
                }
                const members = await readGithubResourcePages({
                    context: began.context,
                    resource: { kind: "team_members", githubTeamId },
                    signal: params.signal,
                    consume: async (memberItems) => {
                        const parsed = parseGroupMembers(memberItems);
                        return parsed !== null && await params.writeGroupMembersPage(parsed);
                    },
                });
                if (!members.ok) {
                    nestedFailure = members;
                    return false;
                }
            }
            return true;
        },
    });
    return nestedFailure ?? groupsResult;
}

export const scanDirectorySource: DirectoryProjectionScan = async (params) => {
    switch (params.source.kind) {
        case "github_organization":
            return await scanGithubDirectory(params);
        case "workos_directory": {
            const began = await beginWorkosDirectoryRead({
                source: params.source,
                env: params.env ?? process.env,
                signal: params.signal,
            });
            if (!began.ok) return began;
            return await scanWorkosDirectorySnapshot({
                context: began.context,
                signal: params.signal,
                writePeoplePage: params.writePeoplePage,
                writeGroupsPage: params.writeGroupsPage,
                writeGroupMembersPage: params.writeGroupMembersPage,
            });
        }
    }
};

export const catchUpDirectorySource: DirectoryProjectionCatchUp = async (params) => {
    switch (params.source.kind) {
        case "github_organization":
            return { ok: true };
        case "workos_directory": {
            const began = await beginWorkosDirectoryRead({
                source: params.source,
                env: params.env ?? process.env,
                signal: params.signal,
            });
            if (!began.ok) return began;
            return await consumeWorkosDirectoryEvents({
                source: params.source,
                context: began.context,
                signal: params.signal,
                writeWorkosEvent: params.writeWorkosEvent,
                stageWorkosGroupMembersEventPage: params.stageWorkosGroupMembersEventPage,
            });
        }
    }
};
