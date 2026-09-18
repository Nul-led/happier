import type { Octokit } from "octokit";

import type {
    DirectoryGroup,
    DirectoryGroupMember,
    DirectoryPerson,
} from "@/app/teams/directory/directorySourceEvidence";
import { GITHUB_REQUEST_HEADERS } from "./githubAppInstallationClient";
import { createPurposeNarrowedGitHubInstallationOctokit } from "./githubAppInstallationClient";
import type { OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";
import {
    DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS,
    parseDirectoryRetryAfterMs,
    readUpstreamResponseHeader,
} from "@/app/teams/directory/directorySourceProjection";

export type GitHubDirectoryResource =
    | Readonly<{ kind: "organization_members" }>
    | Readonly<{ kind: "organization_teams" }>
    | Readonly<{ kind: "team_members"; githubTeamId: number }>;

export type GithubDirectoryReadFailureCode =
    | "installation_unavailable"
    | "organization_unresolved"
    | "permission_lost"
    | "rate_limited"
    | "upstream_unavailable"
    | "malformed_response"
    | "request_timeout"
    | "request_cancelled";

export type GithubDirectoryPageFailure = Readonly<{
    ok: false;
    code: GithubDirectoryReadFailureCode;
    upstreamStatus?: number;
    retryAfterMs?: number;
}>;

export type GithubDirectoryPageSuccess<T> = Readonly<{
    ok: true;
    items: readonly T[];
    hasMore: boolean;
}>;

export type GithubDirectoryPageResult<T> = GithubDirectoryPageSuccess<T> | GithubDirectoryPageFailure;
type AnyDirectoryItem = DirectoryPerson | DirectoryGroup | DirectoryGroupMember;

export const GITHUB_MAX_DIRECTORY_PAGE_SIZE = 100;

function assertDirectoryPageArgs(page: number, perPage: number): void {
    if (!Number.isInteger(page) || page < 1) {
        throw new RangeError(`GitHub directory page must be a positive integer (got ${page})`);
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > GITHUB_MAX_DIRECTORY_PAGE_SIZE) {
        throw new RangeError(
            `GitHub directory perPage must be an integer between 1 and ${GITHUB_MAX_DIRECTORY_PAGE_SIZE} (got ${perPage})`,
        );
    }
}

function readHttpStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
    return typeof error.status === "number" ? error.status : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function classifyGitHubDirectoryRequestFailure(
    error: unknown,
    operationSignal: AbortSignal,
    parentSignal?: AbortSignal,
): GithubDirectoryPageFailure {
    if (parentSignal?.aborted) return { ok: false, code: "request_cancelled" };
    if (operationSignal.aborted) return { ok: false, code: "request_timeout" };
    const status = readHttpStatus(error);
    const retryAfter = readUpstreamResponseHeader(error, "retry-after");
    if (status === 429 || (status === 403
        && (readUpstreamResponseHeader(error, "x-ratelimit-remaining") === "0" || retryAfter !== undefined))) {
        const retryAfterMs = parseDirectoryRetryAfterMs(retryAfter);
        return {
            ok: false,
            code: "rate_limited",
            upstreamStatus: status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        };
    }
    if (status === 404) return { ok: false, code: "organization_unresolved", upstreamStatus: status };
    if (status === 401 || status === 403) return { ok: false, code: "permission_lost", upstreamStatus: status };
    return { ok: false, code: "upstream_unavailable", ...(status === undefined ? {} : { upstreamStatus: status }) };
}

function parseGithubId(value: unknown): string | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function optionalText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function parseItems(resource: GitHubDirectoryResource, rows: unknown[]): GithubDirectoryPageResult<AnyDirectoryItem> {
    const items: AnyDirectoryItem[] = [];
    for (const row of rows) {
        if (!isRecord(row)) return { ok: false, code: "malformed_response" };
        const id = parseGithubId(row.id);
        if (!id) return { ok: false, code: "malformed_response" };
        if (resource.kind === "organization_members") {
            const login = optionalText(row.login);
            const email = optionalText(row.email);
            const displayName = optionalText(row.name);
            items.push({
                externalUserId: id,
                active: true,
                ...(login ? { login } : {}),
                ...(email ? { email } : {}),
                ...(displayName ? { displayName } : {}),
            });
        } else if (resource.kind === "organization_teams") {
            const displayName = optionalText(row.name) ?? optionalText(row.slug);
            if (!displayName) return { ok: false, code: "malformed_response" };
            items.push({ externalGroupId: id, displayName });
        } else {
            items.push({ externalGroupId: String(resource.githubTeamId), externalUserId: id });
        }
    }
    return { ok: true, items, hasMore: false };
}

type ReadPageParams<R extends GitHubDirectoryResource> = Readonly<{
    octokit: Octokit;
    organizationLogin: string;
    organizationId?: number;
    resource: R;
    page: number;
    perPage: number;
    operationSignal: AbortSignal;
    callerSignal?: AbortSignal;
}>;

export function readGitHubDirectoryPage(
    params: ReadPageParams<Readonly<{ kind: "organization_members" }>>,
): Promise<GithubDirectoryPageResult<DirectoryPerson>>;
export function readGitHubDirectoryPage(
    params: ReadPageParams<Readonly<{ kind: "organization_teams" }>>,
): Promise<GithubDirectoryPageResult<DirectoryGroup>>;
export function readGitHubDirectoryPage(
    params: ReadPageParams<Readonly<{ kind: "team_members"; githubTeamId: number }>>,
): Promise<GithubDirectoryPageResult<DirectoryGroupMember>>;
export function readGitHubDirectoryPage(
    params: ReadPageParams<GitHubDirectoryResource>,
): Promise<GithubDirectoryPageResult<AnyDirectoryItem>>;
export async function readGitHubDirectoryPage(
    params: ReadPageParams<GitHubDirectoryResource>,
): Promise<GithubDirectoryPageResult<AnyDirectoryItem>> {
    assertDirectoryPageArgs(params.page, params.perPage);
    const organizationLogin = params.organizationLogin.trim().toLowerCase();
    if (!organizationLogin) return { ok: false, code: "organization_unresolved" };
    if (params.resource.kind === "team_members"
        && (!Number.isSafeInteger(params.resource.githubTeamId) || params.resource.githubTeamId < 1)) {
        throw new RangeError(`GitHub team id must be a positive safe integer (got ${params.resource.githubTeamId})`);
    }
    if (params.resource.kind === "team_members"
        && (!Number.isSafeInteger(params.organizationId) || (params.organizationId ?? 0) < 1)) {
        throw new RangeError(`GitHub organization id must be a positive safe integer (got ${params.organizationId})`);
    }
    let response: Readonly<{ data: unknown; headers: unknown }>;
    try {
        const common = {
            page: params.page,
            per_page: params.perPage,
            headers: GITHUB_REQUEST_HEADERS,
            request: { signal: params.operationSignal },
        };
        response = params.resource.kind === "organization_members"
            ? await params.octokit.request("GET /orgs/{org}/members", { ...common, org: organizationLogin })
            : params.resource.kind === "organization_teams"
                ? await params.octokit.request("GET /orgs/{org}/teams", { ...common, org: organizationLogin })
                : await params.octokit.request("GET /organizations/{org_id}/team/{team_id}/members", {
                    ...common,
                    org_id: params.organizationId!,
                    team_id: params.resource.githubTeamId,
                });
    } catch (error) {
        return classifyGitHubDirectoryRequestFailure(error, params.operationSignal, params.callerSignal);
    }
    if (!Array.isArray(response.data)) return { ok: false, code: "malformed_response" };
    const parsed = parseItems(params.resource, response.data);
    if (!parsed.ok) return parsed;
    const link = isRecord(response.headers) ? response.headers.link : undefined;
    return {
        ok: true,
        items: parsed.items,
        hasMore: typeof link === "string"
            && link.split(",").some((entry) => /(?:^|;)\s*rel="?next"?(?:;|$)/i.test(entry)),
    };
}

type InstallationReadPageParams<R extends GitHubDirectoryResource> = Omit<ReadPageParams<R>, "octokit" | "operationSignal"> & Readonly<{
    githubHost: string;
    githubAppId: bigint | string;
    privateKey: string;
    githubInstallationId: bigint | number;
    networkPolicy: OutboundIdentityNetworkPolicy;
    signal?: AbortSignal;
}>;

export function readPurposeNarrowedGitHubDirectoryPage(
    params: InstallationReadPageParams<Readonly<{ kind: "organization_members" }>>,
): Promise<GithubDirectoryPageResult<DirectoryPerson>>;
export function readPurposeNarrowedGitHubDirectoryPage(
    params: InstallationReadPageParams<Readonly<{ kind: "organization_teams" }>>,
): Promise<GithubDirectoryPageResult<DirectoryGroup>>;
export function readPurposeNarrowedGitHubDirectoryPage(
    params: InstallationReadPageParams<Readonly<{ kind: "team_members"; githubTeamId: number }>>,
): Promise<GithubDirectoryPageResult<DirectoryGroupMember>>;
export function readPurposeNarrowedGitHubDirectoryPage(
    params: InstallationReadPageParams<GitHubDirectoryResource>,
): Promise<GithubDirectoryPageResult<AnyDirectoryItem>>;
export async function readPurposeNarrowedGitHubDirectoryPage(
    params: InstallationReadPageParams<GitHubDirectoryResource>,
): Promise<GithubDirectoryPageResult<AnyDirectoryItem>> {
    assertDirectoryPageArgs(params.page, params.perPage);
    if (params.resource.kind === "team_members"
        && (!Number.isSafeInteger(params.resource.githubTeamId) || params.resource.githubTeamId < 1)) {
        throw new RangeError(`GitHub team id must be a positive safe integer (got ${params.resource.githubTeamId})`);
    }
    if (params.resource.kind === "team_members"
        && (!Number.isSafeInteger(params.organizationId) || (params.organizationId ?? 0) < 1)) {
        throw new RangeError(`GitHub organization id must be a positive safe integer (got ${params.organizationId})`);
    }
    const timeoutSignal = AbortSignal.timeout(DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS);
    const operationSignal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
    try {
        const client = await createPurposeNarrowedGitHubInstallationOctokit({
            githubHost: params.githubHost,
            githubAppId: params.githubAppId,
            privateKey: params.privateKey,
            githubInstallationId: params.githubInstallationId,
            permissions: { members: "read" },
            networkPolicy: params.networkPolicy,
            signal: operationSignal,
        });
        if (!client) return { ok: false, code: "installation_unavailable" };
        try {
            return await readGitHubDirectoryPage({
                octokit: client.octokit,
                organizationLogin: params.organizationLogin,
                ...(params.organizationId === undefined ? {} : { organizationId: params.organizationId }),
                resource: params.resource,
                page: params.page,
                perPage: params.perPage,
                operationSignal,
                ...(params.signal ? { callerSignal: params.signal } : {}),
            });
        } finally {
            await client.close();
        }
    } catch (error) {
        return classifyGitHubDirectoryRequestFailure(error, operationSignal, params.signal);
    }
}
