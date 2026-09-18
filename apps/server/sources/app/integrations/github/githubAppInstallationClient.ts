import { App, Octokit } from "octokit";

import { createOutboundIdentityFetch } from "@/app/net/outboundIdentityFetch";
import type { OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";

import {
    validateGitHubAppInstallationEvidenceV1,
    type GitHubAppInstallationEvidenceV1,
} from "./githubManagedApp";

export const GITHUB_REQUEST_HEADERS = Object.freeze({
    accept: "application/vnd.github+json",
    "x-github-api-version": "2026-03-10",
});

function githubApiBaseUrl(githubHost: string): string {
    return githubHost === "https://github.com" ? "https://api.github.com" : `${githubHost}/api/v3`;
}

function toSafeInstallationId(value: bigint | number): number | null {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function readToken(value: unknown): string | null {
    if (typeof value !== "object" || value === null || !("token" in value)) return null;
    return typeof value.token === "string" && value.token.trim() ? value.token : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveBigInt(value: unknown): bigint | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
}

function readHttpStatus(error: unknown): number | null {
    return isRecord(error) && typeof error.status === "number" ? error.status : null;
}

export async function readGitHubAppInstallationEvidence(params: Readonly<{
    githubHost: string;
    githubAppId: bigint;
    privateKey: string;
    githubInstallationId: bigint;
    networkPolicy: OutboundIdentityNetworkPolicy;
    signal?: AbortSignal;
}>): Promise<GitHubAppInstallationEvidenceV1 | null> {
    const installationId = toSafeInstallationId(params.githubInstallationId);
    if (installationId === null) return null;
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
    const outbound = createOutboundIdentityFetch({ policy: params.networkPolicy });
    let data: unknown;
    try {
        const ApiOctokit = Octokit.defaults({
            baseUrl: githubApiBaseUrl(params.githubHost),
            request: { fetch: outbound.fetch },
        });
        const app = new App({
            appId: params.githubAppId.toString(),
            privateKey: params.privateKey,
            Octokit: ApiOctokit,
        });
        const response = await app.octokit.request("GET /app/installations/{installation_id}", {
            installation_id: installationId,
            headers: GITHUB_REQUEST_HEADERS,
            request: { signal },
        });
        data = response.data;
    } finally {
        await outbound.close();
    }
    if (!isRecord(data) || !isRecord(data.account) || data.account.type !== "Organization") return null;
    const githubInstallationId = readPositiveBigInt(data.id);
    const githubAppId = readPositiveBigInt(data.app_id);
    const githubOrganizationId = readPositiveBigInt(data.account.id);
    if (
        githubInstallationId === null
        || githubAppId === null
        || githubOrganizationId === null
        || typeof data.account.login !== "string"
        || !isRecord(data.permissions)
        || !Object.values(data.permissions).every((value) => value === "read" || value === "write")
        || !Array.isArray(data.events)
        || !data.events.every((value) => typeof value === "string" && value.length > 0)
        || (data.repository_selection !== "all" && data.repository_selection !== "selected")
    ) return null;
    const observed = {
        githubAppId,
        githubInstallationId,
        githubOrganizationId,
        githubOrganizationLogin: data.account.login,
        suspended: data.suspended_at !== null && data.suspended_at !== undefined,
        permissions: data.permissions,
        events: data.events,
        repositorySelection: data.repository_selection,
    };
    const validated = validateGitHubAppInstallationEvidenceV1({
        expected: { githubAppId, githubInstallationId, githubOrganizationId },
        observed,
    });
    return validated.ok ? {
        githubAppId,
        githubInstallationId,
        githubOrganizationId,
        ...validated.value,
    } : null;
}

export type PurposeNarrowedGitHubInstallationClient = Readonly<{
    octokit: Octokit;
    close: () => Promise<void>;
}>;

export async function createPurposeNarrowedGitHubInstallationOctokit(params: Readonly<{
    githubHost: string;
    githubAppId: bigint | string;
    privateKey: string;
    githubInstallationId: bigint | number;
    permissions: Readonly<Record<string, "read" | "write">>;
    networkPolicy: OutboundIdentityNetworkPolicy;
    signal: AbortSignal;
}>): Promise<PurposeNarrowedGitHubInstallationClient | null> {
    const installationId = toSafeInstallationId(params.githubInstallationId);
    if (installationId === null) return null;
    const outbound = createOutboundIdentityFetch({ policy: params.networkPolicy });
    try {
        const ApiOctokit = Octokit.defaults({
            baseUrl: githubApiBaseUrl(params.githubHost),
            request: { fetch: outbound.fetch },
        });
        const app = new App({
            appId: params.githubAppId.toString(),
            privateKey: params.privateKey,
            Octokit: ApiOctokit,
        });
        const response = await app.octokit.request(
            "POST /app/installations/{installation_id}/access_tokens",
            {
                installation_id: installationId,
                permissions: params.permissions,
                headers: GITHUB_REQUEST_HEADERS,
                request: { signal: params.signal },
            },
        );
        const token = readToken(response.data);
        if (!token) {
            await outbound.close();
            return null;
        }
        return { octokit: new ApiOctokit({ auth: token }), close: outbound.close };
    } catch (error) {
        await outbound.close();
        throw error;
    }
}

export type GitHubOrganizationAdministratorEvidenceResult =
    | Readonly<{ ok: true }>
    | Readonly<{
        ok: false;
        code: "github_administrator_mismatch" | "github_administrator_evidence_unavailable";
    }>; 

export type GitHubOrganizationMembershipResult =
    | Readonly<{ status: "active" }>
    | Readonly<{ status: "not_member" | "identity_mismatch" | "unavailable" }>;

export async function verifyGitHubOrganizationMember(
    params: Readonly<{
        githubHost: string;
        githubAppId: bigint;
        privateKey: string;
        githubInstallationId: bigint;
        githubOrganizationLogin: string;
        githubUserId: bigint;
        githubUserLogin: string;
        networkPolicy: OutboundIdentityNetworkPolicy;
        signal?: AbortSignal;
    }>,
): Promise<GitHubOrganizationMembershipResult> {
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
    let client: PurposeNarrowedGitHubInstallationClient | null;
    try {
        client = await createPurposeNarrowedGitHubInstallationOctokit({
            githubHost: params.githubHost,
            githubAppId: params.githubAppId,
            privateKey: params.privateKey,
            githubInstallationId: params.githubInstallationId,
            permissions: { members: "read" },
            networkPolicy: params.networkPolicy,
            signal,
        });
    } catch {
        return { status: "unavailable" };
    }
    if (!client) return { status: "unavailable" };
    try {
        const response = await client.octokit.request("GET /orgs/{org}/memberships/{username}", {
            org: params.githubOrganizationLogin,
            username: params.githubUserLogin,
            headers: GITHUB_REQUEST_HEADERS,
            request: { signal },
        });
        const data = response.data;
        if (!isRecord(data) || !isRecord(data.user)) return { status: "unavailable" };
        const observedUserId = readPositiveBigInt(data.user.id);
        if (observedUserId !== params.githubUserId) return { status: "identity_mismatch" };
        return data.state === "active" ? { status: "active" } : { status: "not_member" };
    } catch (error) {
        return readHttpStatus(error) === 404 ? { status: "not_member" } : { status: "unavailable" };
    } finally {
        await client.close();
    }
}

export type GitHubTeamMembershipObservation =
    | Readonly<{ status: "complete"; activeTeamIds: readonly string[] }>
    | Readonly<{ status: "incomplete" }>;

export async function readGitHubTeamMembershipObservation(
    params: Readonly<{
        githubHost: string;
        githubAppId: bigint;
        privateKey: string;
        githubInstallationId: bigint;
        githubOrganizationId: bigint;
        githubUserLogin: string;
        githubTeamIds: readonly string[];
        networkPolicy: OutboundIdentityNetworkPolicy;
        signal?: AbortSignal;
    }>,
): Promise<GitHubTeamMembershipObservation> {
    const teamIds = [...new Set(params.githubTeamIds)];
    const organizationId = toSafeInstallationId(params.githubOrganizationId);
    if (organizationId === null) return { status: "incomplete" };
    const parsedIds = teamIds.map((id) => {
        if (!/^[1-9][0-9]*$/u.test(id)) return null;
        const value = BigInt(id);
        return toSafeInstallationId(value);
    });
    if (parsedIds.some((id) => id === null)) return { status: "incomplete" };
    if (teamIds.length === 0) return { status: "complete", activeTeamIds: [] };

    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
    let client: PurposeNarrowedGitHubInstallationClient | null;
    try {
        client = await createPurposeNarrowedGitHubInstallationOctokit({
            githubHost: params.githubHost,
            githubAppId: params.githubAppId,
            privateKey: params.privateKey,
            githubInstallationId: params.githubInstallationId,
            permissions: { members: "read" },
            networkPolicy: params.networkPolicy,
            signal,
        });
    } catch {
        return { status: "incomplete" };
    }
    if (!client) return { status: "incomplete" };
    const activeTeamIds: string[] = [];
    try {
        for (let index = 0; index < teamIds.length; index += 1) {
            try {
                const response = await client.octokit.request("GET /organizations/{org_id}/team/{team_id}/memberships/{username}", {
                    org_id: organizationId,
                    team_id: parsedIds[index]!,
                    username: params.githubUserLogin,
                    headers: GITHUB_REQUEST_HEADERS,
                    request: { signal },
                });
                if (
                    !isRecord(response.data)
                    || (response.data.state !== "active" && response.data.state !== "pending")
                ) {
                    return { status: "incomplete" };
                }
                if (response.data.state === "active") activeTeamIds.push(teamIds[index]!);
            } catch (error) {
                if (readHttpStatus(error) !== 404) return { status: "incomplete" };
            }
        }
        return { status: "complete", activeTeamIds: Object.freeze(activeTeamIds) };
    } finally {
        await client.close();
    }
}

/**
 * Proves that one immutable GitHub user identity currently owns the exact
 * organization reached through this installation. The installation token is
 * purpose-narrowed to Members:read and never leaves this boundary.
 */
export async function verifyGitHubOrganizationAdministrator(params: Readonly<{
    githubHost: string;
    githubAppId: bigint;
    privateKey: string;
    githubInstallationId: bigint;
    githubOrganizationLogin: string;
    githubUserId: bigint;
    githubUserLogin: string;
    networkPolicy: OutboundIdentityNetworkPolicy;
    signal?: AbortSignal;
}>): Promise<GitHubOrganizationAdministratorEvidenceResult> {
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
    let client: PurposeNarrowedGitHubInstallationClient | null;
    try {
        client = await createPurposeNarrowedGitHubInstallationOctokit({
            githubHost: params.githubHost,
            githubAppId: params.githubAppId,
            privateKey: params.privateKey,
            githubInstallationId: params.githubInstallationId,
            permissions: { members: "read" },
            networkPolicy: params.networkPolicy,
            signal,
        });
    } catch {
        return { ok: false, code: "github_administrator_evidence_unavailable" };
    }
    if (!client) return { ok: false, code: "github_administrator_evidence_unavailable" };
    try {
        const response = await client.octokit.request("GET /orgs/{org}/memberships/{username}", {
            org: params.githubOrganizationLogin,
            username: params.githubUserLogin,
            headers: GITHUB_REQUEST_HEADERS,
            request: { signal },
        });
        const data = response.data;
        if (!isRecord(data) || !isRecord(data.user)) {
            return { ok: false, code: "github_administrator_evidence_unavailable" };
        }
        const observedUserId = readPositiveBigInt(data.user.id);
        return data.state === "active"
            && data.role === "admin"
            && observedUserId === params.githubUserId
            ? { ok: true }
            : { ok: false, code: "github_administrator_mismatch" };
    } catch (error) {
        return readHttpStatus(error) === 404
            ? { ok: false, code: "github_administrator_mismatch" }
            : { ok: false, code: "github_administrator_evidence_unavailable" };
    } finally {
        await client.close();
    }
}
