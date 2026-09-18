import { z } from "zod";
import type { ManagedGitHubAppTeamConsumerV1 } from "@happier-dev/protocol";
import { randomUUID } from "node:crypto";

import {
    readHomeGovernanceAccountInTx,
    resolveHomeGovernanceAuthority,
} from "@/app/home/governance/homeCapabilities";
import type { ProviderCatalogContext } from "@/app/auth/providers/providerReference";
import {
    createIdentityProviderInstanceInTx,
} from "@/app/auth/providers/managed/identityProviderInstanceLifecycle";
import { resolveTeamActorContextInTx } from "@/app/teams/actorContext";
import { resolveManagedIdentityNetworkPolicyInTx } from "@/app/auth/providers/managed/managedIdentityNetworkPolicy";
import { readHomeGovernancePolicyInTx } from "@/app/home/governance/governancePolicy";
import { db } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { getActivePrismaRuntime } from "@/storage/prisma";
import {
    applyGitHubAppSecretReplacementV1,
    createGitHubAppRegistrationConfigV1,
    decryptGitHubAppRegistrationSecretsV1,
    encryptGitHubAppRegistrationSecretsV1,
    parseGitHubAppRegistrationConfigV1,
    projectGitHubAppSecretHealthV1,
    validateGitHubAppInstallationEvidenceV1,
    type GitHubAppRegistrationSecretReplacementV1,
    type GitHubAppRegistrationSecretsV1,
    type GitHubAppSecretHealthV1,
} from "./githubManagedApp";
import {
    readGitHubAppInstallationEvidence,
    verifyGitHubOrganizationAdministrator,
} from "./githubAppInstallationClient";
import { createManagedGitHubUserOAuthProvider } from "./githubManagedUserOAuth";
import type { OAuthFlowProvider } from "@/app/oauth/providers/types";
import { createExternalAuthorizeAttempt } from "@/app/api/routes/connect/oauthExternal/createExternalAuthorizeUrl";
import { resolveConfiguredPublicServerUrl } from "@/app/serverUrls/effectiveServerUrls";
import { isManagedGitHubHostApprovedByHome } from "./githubAppInstallationEligibility";
import { publishHomeGovernanceChangedInTx } from "@/app/home/governance/governanceChanges";
import {
    publishGitHubAppRegistrationTeamsChangedInTx,
    publishTeamChangedInTx,
} from "@/app/teams/teamChanges";

const GitHubAppRegistrationStateSchema = z.enum([
    "draft",
    "verified",
    "disabled",
    "needs_attention",
]);

type GitHubAppRegistrationState = z.infer<typeof GitHubAppRegistrationStateSchema>;

interface GitHubAppRegistrationRow {
    id: string;
    ownerTeamId: string | null;
    githubHost: string;
    githubAppId: bigint;
    githubClientId: string;
    githubAppSlug: string | null;
    githubOwnerId: bigint | null;
    githubOwnerLogin: string | null;
    config: unknown;
    encryptedSecrets: Uint8Array<ArrayBufferLike>;
    revision: number;
    securityRevision: number;
    state: string;
    verificationHealth: unknown;
    lastVerifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface GitHubAppRegistrationView {
    id: string;
    owner: Readonly<{ kind: "home" }> | Readonly<{ kind: "team"; teamId: string }>;
    githubHost: string;
    githubAppId: bigint;
    githubClientId: string;
    githubAppSlug: string | null;
    githubOwnerId: bigint | null;
    githubOwnerLogin: string | null;
    revision: number;
    securityRevision: number;
    state: GitHubAppRegistrationState;
    secretHealth: GitHubAppSecretHealthV1;
    lastVerifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

function normalizeGitHubHost(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error("GitHub App host must be an HTTPS origin");
    }
    if (url.pathname !== "/") throw new Error("GitHub App host must not contain a path");
    const origin = url.origin.toLowerCase();
    if (origin.length > 512) throw new Error("GitHub App host is too long");
    return origin;
}

function normalizeRequiredText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 256) throw new Error(`${field} is invalid`);
    return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length > 256) throw new Error("GitHub App text is too long");
    return normalized || null;
}

async function authorizeHomeAuthenticationManagementInTx(tx: Tx, actorAccountId: string): Promise<boolean> {
    const actor = await readHomeGovernanceAccountInTx(tx, actorAccountId);
    return resolveHomeGovernanceAuthority(actor).manageAuthentication;
}

function ownerTeamId(owner: ProviderCatalogContext): string | null {
    return owner.kind === "home" ? null : owner.teamId;
}

async function publishGitHubAppOwnerChangedInTx(
    tx: Tx,
    owner: ProviderCatalogContext,
    registrationId: string,
): Promise<void> {
    if (owner.kind === "home") {
        await publishHomeGovernanceChangedInTx(tx);
        await publishGitHubAppRegistrationTeamsChangedInTx(tx, { registrationId });
        return;
    }
    await publishTeamChangedInTx(tx, { teamId: owner.teamId });
}

function rowHasOwner(row: Pick<GitHubAppRegistrationRow, "ownerTeamId">, owner: ProviderCatalogContext): boolean {
    return row.ownerTeamId === ownerTeamId(owner);
}

async function ensureManagedGitHubIdentityProviderCandidateInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        owner: ProviderCatalogContext;
        installationId: string;
        organizationLogin: string;
    }>,
): Promise<void> {
    const existing = await tx.identityProviderInstance.findFirst({
        where: {
            ownerTeamId: ownerTeamId(input.owner),
            kind: "github_app_identity",
            githubAppInstallationId: input.installationId,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, enabled: true, revision: true, securityRevision: true },
    });
    if (!existing) {
        const created = await createIdentityProviderInstanceInTx(tx, {
            owner: input.owner,
            kind: "github_app_identity",
            displayName: `${input.organizationLogin} GitHub`,
            config: { v: 1, kind: "github_app_identity" },
            secrets: null,
            githubAppInstallationId: input.installationId,
            createdByAccountId: input.actorAccountId,
        });
        if (created.status !== "created") throw new Error("github_identity_provider_invalid");
    }
}

export async function authorizeGitHubAppManagementInTx(
    tx: Tx,
    actorAccountId: string,
    owner: ProviderCatalogContext,
): Promise<boolean> {
    if (owner.kind === "home") return await authorizeHomeAuthenticationManagementInTx(tx, actorAccountId);
    const resolved = await resolveTeamActorContextInTx(tx, {
        teamId: owner.teamId,
        actorAccountId,
    });
    return resolved?.capabilities.manageAuthentication === true;
}

function projectRegistration(
    row: GitHubAppRegistrationRow,
    secrets: GitHubAppRegistrationSecretsV1,
): GitHubAppRegistrationView {
    parseGitHubAppRegistrationConfigV1(row.config);
    return Object.freeze({
        id: row.id,
        owner: row.ownerTeamId === null
            ? Object.freeze({ kind: "home" as const })
            : Object.freeze({ kind: "team" as const, teamId: row.ownerTeamId }),
        githubHost: row.githubHost,
        githubAppId: row.githubAppId,
        githubClientId: row.githubClientId,
        githubAppSlug: row.githubAppSlug,
        githubOwnerId: row.githubOwnerId,
        githubOwnerLogin: row.githubOwnerLogin,
        revision: row.revision,
        securityRevision: row.securityRevision,
        state: GitHubAppRegistrationStateSchema.parse(row.state),
        secretHealth: projectGitHubAppSecretHealthV1(secrets),
        lastVerifiedAt: row.lastVerifiedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    });
}

function decryptRegistrationSecrets(row: GitHubAppRegistrationRow): GitHubAppRegistrationSecretsV1 {
    return decryptGitHubAppRegistrationSecretsV1({
        registrationId: row.id,
        encryptedSecrets: Uint8Array.from(row.encryptedSecrets),
    });
}

const registrationSelect = {
    id: true,
    ownerTeamId: true,
    githubHost: true,
    githubAppId: true,
    githubClientId: true,
    githubAppSlug: true,
    githubOwnerId: true,
    githubOwnerLogin: true,
    config: true,
    encryptedSecrets: true,
    revision: true,
    securityRevision: true,
    state: true,
    verificationHealth: true,
    lastVerifiedAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

export type CreateHomeGitHubAppRegistrationResult =
    | Readonly<{ status: "created"; registration: GitHubAppRegistrationView }>
    | Readonly<{ status: "forbidden" | "github_enterprise_origin_not_approved" }>;

export async function createGitHubAppRegistration(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    input: Readonly<{
        githubHost: string;
        githubAppId: bigint;
        githubClientId: string;
        githubAppSlug?: string | null;
        githubOwnerId?: bigint | null;
        githubOwnerLogin?: string | null;
        secrets: GitHubAppRegistrationSecretsV1;
    }>;
}>): Promise<CreateHomeGitHubAppRegistrationResult> {
    if (params.input.githubAppId <= 0n || (params.input.githubOwnerId !== null
        && params.input.githubOwnerId !== undefined && params.input.githubOwnerId <= 0n)) {
        throw new RangeError("GitHub identifiers must be positive");
    }
    const githubHost = normalizeGitHubHost(params.input.githubHost);
    return await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" };
        }
        if (!isManagedGitHubHostApprovedByHome(await readHomeGovernancePolicyInTx(tx), githubHost)) {
            return { status: "github_enterprise_origin_not_approved" };
        }
        const id = randomUUID();
        const secrets = params.input.secrets;
        const row = await tx.gitHubAppRegistration.create({
            data: {
                id,
                ownerTeamId: ownerTeamId(params.owner),
                githubHost,
                githubAppId: params.input.githubAppId,
                githubClientId: normalizeRequiredText(params.input.githubClientId, "githubClientId"),
                githubAppSlug: normalizeOptionalText(params.input.githubAppSlug),
                githubOwnerId: params.input.githubOwnerId ?? null,
                githubOwnerLogin: normalizeOptionalText(params.input.githubOwnerLogin),
                config: createGitHubAppRegistrationConfigV1(secrets),
                encryptedSecrets: encryptGitHubAppRegistrationSecretsV1({ registrationId: id, secrets }),
                createdByAccountId: params.actorAccountId,
            },
            select: registrationSelect,
        });
        await publishGitHubAppOwnerChangedInTx(tx, params.owner, row.id);
        return { status: "created", registration: projectRegistration(row, secrets) };
    });
}

export async function createHomeGitHubAppRegistration(params: Readonly<{
    actorAccountId: string;
    input: Readonly<{
        githubHost: string;
        githubAppId: bigint;
        githubClientId: string;
        githubAppSlug?: string | null;
        githubOwnerId?: bigint | null;
        githubOwnerLogin?: string | null;
        secrets: GitHubAppRegistrationSecretsV1;
    }>;
}>): Promise<CreateHomeGitHubAppRegistrationResult> {
    return await createGitHubAppRegistration({ ...params, owner: { kind: "home" } });
}

export type ListGitHubAppRegistrationsResult =
    | Readonly<{
        status: "ready";
        registrations: readonly GitHubAppRegistrationView[];
        installations: readonly GitHubAppInstallationAdministrationView[];
    }>
    | Readonly<{ status: "forbidden" }>;

export async function listGitHubAppRegistrations(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
}>): Promise<ListGitHubAppRegistrationsResult> {
    return await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" };
        }
        const rows = await tx.gitHubAppRegistration.findMany({
            where: { ownerTeamId: ownerTeamId(params.owner) },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: registrationSelect,
        });
        const installations = rows.length === 0
            ? []
            : await tx.gitHubAppInstallation.findMany({
                where: { registrationId: { in: rows.map((row) => row.id) } },
                orderBy: [{ registrationId: "asc" }, { id: "asc" }],
                select: {
                    ...installationSelect,
                    identityProviderInstances: {
                        where: { ownerTeamId: null },
                        select: {
                            id: true,
                            connections: {
                                select: {
                                    id: true,
                                    enabled: true,
                                    team: { select: { id: true, name: true } },
                                },
                            },
                        },
                    },
                    directorySources: {
                        select: {
                            id: true,
                            state: true,
                            team: { select: { id: true, name: true } },
                        },
                    },
                },
            });
        return {
            status: "ready",
            registrations: rows.map((row) => projectRegistration(row, decryptRegistrationSecrets(row))),
            installations: installations.map((installation) => {
                return {
                    id: installation.id,
                    registrationId: installation.registrationId,
                    githubInstallationId: installation.githubInstallationId,
                    githubOrganizationId: installation.githubOrganizationId,
                    githubOrganizationLogin: installation.githubOrganizationLogin,
                    repositorySelection: installation.repositorySelection,
                    revision: installation.revision,
                    state: installation.state,
                    verifiedPermissions: installation.verifiedPermissions,
                    verifiedEvents: installation.verifiedEvents,
                    suspendedAt: installation.suspendedAt,
                    lastVerifiedAt: installation.lastVerifiedAt,
                    teamConsumers: params.owner.kind === "home"
                        ? projectGitHubAppTeamConsumers(installation)
                        : [],
                };
            }),
        };
    });
}

export type UpdateHomeGitHubAppRegistrationResult =
    | Readonly<{ status: "updated"; registration: GitHubAppRegistrationView }>
    | Readonly<{ status: "not_found" | "forbidden" | "github_enterprise_origin_not_approved" }>
    | Readonly<{ status: "revision_conflict"; registration: GitHubAppRegistrationView }>;

export async function updateGitHubAppRegistration(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    registrationId: string;
    expectedRevision: number;
    patch: Readonly<{
        githubClientId?: string;
        githubAppSlug?: string | null;
        githubOwnerLogin?: string | null;
        secrets?: GitHubAppRegistrationSecretReplacementV1;
    }>;
}>): Promise<UpdateHomeGitHubAppRegistrationResult> {
    return await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" };
        }
        const current = await tx.gitHubAppRegistration.findUnique({
            where: { id: params.registrationId },
            select: registrationSelect,
        });
        if (!current || !rowHasOwner(current, params.owner)) return { status: "not_found" };
        if (!isManagedGitHubHostApprovedByHome(await readHomeGovernancePolicyInTx(tx), current.githubHost)) {
            return { status: "github_enterprise_origin_not_approved" };
        }
        const currentSecrets = decryptRegistrationSecrets(current);
        if (current.revision !== params.expectedRevision) {
            return { status: "revision_conflict", registration: projectRegistration(current, currentSecrets) };
        }
        const securityEffective = params.patch.githubClientId !== undefined || params.patch.secrets !== undefined;
        const nextSecrets = params.patch.secrets === undefined
            ? currentSecrets
            : applyGitHubAppSecretReplacementV1(currentSecrets, params.patch.secrets);
        const updated = await tx.gitHubAppRegistration.updateMany({
            where: {
                id: params.registrationId,
                ownerTeamId: ownerTeamId(params.owner),
                revision: params.expectedRevision,
            },
            data: {
                revision: { increment: 1 },
                ...(securityEffective ? {
                    securityRevision: { increment: 1 },
                    state: "draft",
                    verificationHealth: getActivePrismaRuntime().DbNull,
                } : {}),
                ...(params.patch.githubClientId === undefined
                    ? {} : { githubClientId: normalizeRequiredText(params.patch.githubClientId, "githubClientId") }),
                ...(params.patch.githubAppSlug === undefined
                    ? {} : { githubAppSlug: normalizeOptionalText(params.patch.githubAppSlug) }),
                ...(params.patch.githubOwnerLogin === undefined
                    ? {} : { githubOwnerLogin: normalizeOptionalText(params.patch.githubOwnerLogin) }),
                ...(params.patch.secrets === undefined ? {} : {
                    config: createGitHubAppRegistrationConfigV1(nextSecrets),
                    encryptedSecrets: encryptGitHubAppRegistrationSecretsV1({
                        registrationId: params.registrationId,
                        secrets: nextSecrets,
                    }),
                }),
            },
        });
        const latest = await tx.gitHubAppRegistration.findUniqueOrThrow({
            where: { id: params.registrationId },
            select: registrationSelect,
        });
        const latestSecrets = updated.count === 0 ? decryptRegistrationSecrets(latest) : nextSecrets;
        if (updated.count === 1) {
            await publishGitHubAppOwnerChangedInTx(tx, params.owner, params.registrationId);
        }
        return updated.count === 0
            ? { status: "revision_conflict", registration: projectRegistration(latest, latestSecrets) }
            : { status: "updated", registration: projectRegistration(latest, latestSecrets) };
    });
}

export async function updateHomeGitHubAppRegistration(
    params: Omit<Parameters<typeof updateGitHubAppRegistration>[0], "owner">,
): Promise<UpdateHomeGitHubAppRegistrationResult> {
    return await updateGitHubAppRegistration({ ...params, owner: { kind: "home" } });
}

export type GitHubAppRegistrationRuntimeResult =
    | Readonly<{
        status: "resolved";
        runtime: Readonly<{
            registration: GitHubAppRegistrationView;
            secrets: GitHubAppRegistrationSecretsV1;
        }>;
    }>
    | Readonly<{ status: "not_found" | "invalid" }>;

export async function readGitHubAppRegistrationRuntime(
    registrationId: string,
): Promise<GitHubAppRegistrationRuntimeResult> {
    const row = await db.gitHubAppRegistration.findUnique({
        where: { id: registrationId },
        select: registrationSelect,
    });
    if (!row) return { status: "not_found" };
    try {
        const secrets = decryptRegistrationSecrets(row);
        return {
            status: "resolved",
            runtime: {
                registration: projectRegistration(row, secrets),
                secrets,
            },
        };
    } catch {
        return { status: "invalid" };
    }
}

export interface GitHubAppInstallationView {
    id: string;
    registrationId: string;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    githubOrganizationLogin: string;
    repositorySelection: string;
    revision: number;
    state: string;
    verifiedPermissions: unknown;
    verifiedEvents: unknown;
    suspendedAt: Date | null;
    lastVerifiedAt: Date | null;
}

export interface GitHubAppInstallationAdministrationView extends GitHubAppInstallationView {
    teamConsumers: readonly ManagedGitHubAppTeamConsumerV1[];
}

function projectGitHubAppTeamConsumers(input: Readonly<{
    identityProviderInstances: readonly Readonly<{
        id: string;
        connections: readonly Readonly<{
            id: string;
            enabled: boolean;
            team: Readonly<{ id: string; name: string }>;
        }>[];
    }>[];
    directorySources: readonly Readonly<{
        id: string;
        state: "initializing" | "active" | "paused" | "needs_attention";
        team: Readonly<{ id: string; name: string }>;
    }>[];
}>): readonly ManagedGitHubAppTeamConsumerV1[] {
    const consumers: ManagedGitHubAppTeamConsumerV1[] = [
        ...input.identityProviderInstances.flatMap((provider) => provider.connections.map((connection) => ({
            team: connection.team,
            binding: {
                kind: "identity_connection" as const,
                id: connection.id,
                providerInstanceId: provider.id,
                enabled: connection.enabled,
            },
        }))),
        ...input.directorySources.map((source) => ({
            team: source.team,
            binding: {
                kind: "directory_source" as const,
                id: source.id,
                state: source.state,
            },
        })),
    ];
    return consumers.sort((left, right) => left.team.name.localeCompare(right.team.name)
        || left.team.id.localeCompare(right.team.id)
        || left.binding.kind.localeCompare(right.binding.kind)
        || left.binding.id.localeCompare(right.binding.id));
}

const installationSelect = {
    id: true,
    registrationId: true,
    githubInstallationId: true,
    githubOrganizationId: true,
    githubOrganizationLogin: true,
    repositorySelection: true,
    revision: true,
    state: true,
    verifiedPermissions: true,
    verifiedEvents: true,
    suspendedAt: true,
    lastVerifiedAt: true,
} as const;

export type VerifyHomeGitHubAppInstallationResult =
    | Readonly<{
        status: "verified";
        registration: GitHubAppRegistrationView;
        installation: GitHubAppInstallationView;
    }>
    | Readonly<{
        status: "forbidden" | "not_found" | "registration_revision_conflict" | "github_enterprise_origin_not_approved";
    }>
    | Readonly<{ status: "installation_revision_conflict"; currentRevision: number | null }>
    | Readonly<{ status:
        | "github_installation_evidence_invalid"
        | "github_app_mismatch"
        | "github_installation_mismatch"
        | "github_organization_mismatch"
        | "github_permission_missing"
        | "github_administrator_identity_required"
        | "github_administrator_mismatch"
        | "github_administrator_evidence_unavailable"
        | "github_network_policy_changed" }>;

export type BeginGitHubAppInstallationVerificationResult =
    | Readonly<{ status: "ready"; authorizeUrl: string; attemptId: string }>
    | Readonly<{
        status: "forbidden" | "not_found" | "registration_revision_conflict" | "github_enterprise_origin_not_approved";
    }>
    | Readonly<{ status: "github_app_not_configured" | "github_network_policy_changed" }>;

export type GitHubAppInstallationVerificationBinding = Readonly<{
    owner: ProviderCatalogContext;
    registrationId: string;
    registrationRevision: number;
    registrationSecurityRevision: number;
    installationRevision: number;
    networkPolicyFingerprint: string;
    githubInstallationId: string;
    githubOrganizationId: string;
}>;

export type ResolveGitHubAppInstallationVerificationOAuthResult =
    | Readonly<{ status: "ready"; provider: OAuthFlowProvider }>
    | Readonly<{
        status: "forbidden" | "not_found" | "registration_revision_conflict" | "github_enterprise_origin_not_approved";
    }>
    | Readonly<{ status: "github_app_not_configured" | "github_network_policy_changed" }>;

function parsePositiveDecimalBigInt(value: string): bigint | null {
    return /^[1-9][0-9]*$/.test(value) ? BigInt(value) : null;
}

// Reuse the built-in reserved GitHub callback namespace. The signed attempt's
// closed purpose dispatches this flow before ordinary provider resolution, so
// no newly reserved provider ID or deployment-provider collision is introduced.
const GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID = "github";

export async function resolveGitHubAppInstallationVerificationOAuth(params: Readonly<{
    actorAccountId: string;
    binding: GitHubAppInstallationVerificationBinding;
    env: NodeJS.ProcessEnv;
}>): Promise<ResolveGitHubAppInstallationVerificationOAuthResult> {
    const publicServerUrl = resolveConfiguredPublicServerUrl(params.env);
    if (!publicServerUrl) return { status: "github_app_not_configured" };
    const prepared = await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.binding.owner)) {
            return { status: "forbidden" as const };
        }
        const registration = await tx.gitHubAppRegistration.findUnique({
            where: { id: params.binding.registrationId },
            select: registrationSelect,
        });
        if (!registration || !rowHasOwner(registration, params.binding.owner)) return { status: "not_found" as const };
        if (!isManagedGitHubHostApprovedByHome(await readHomeGovernancePolicyInTx(tx), registration.githubHost)) {
            return { status: "github_enterprise_origin_not_approved" as const };
        }
        if (registration.revision !== params.binding.registrationRevision
            || registration.securityRevision !== params.binding.registrationSecurityRevision) {
            return { status: "registration_revision_conflict" as const };
        }
        const network = await resolveManagedIdentityNetworkPolicyInTx(tx, {
            env: params.env,
            timeoutSeconds: 30,
        });
        if (network.fingerprint !== params.binding.networkPolicyFingerprint) {
            return { status: "github_network_policy_changed" as const };
        }
        const secrets = decryptRegistrationSecrets(registration);
        if (!secrets.clientSecret || !secrets.privateKey) {
            return { status: "github_app_not_configured" as const };
        }
        return { status: "ready" as const, registration, secrets, network };
    });
    if (prepared.status !== "ready") return prepared;
    return {
        status: "ready",
        provider: createManagedGitHubUserOAuthProvider({
            providerId: GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID,
            githubHost: prepared.registration.githubHost,
            clientId: prepared.registration.githubClientId,
            clientSecret: prepared.secrets.clientSecret!,
            redirectUrl: `${publicServerUrl}/v1/oauth/${GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID}/callback`,
            networkPolicy: prepared.network.policy,
        }),
    };
}

export async function beginGitHubAppInstallationVerification(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedInstallationRevision: number;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    env: NodeJS.ProcessEnv;
}>): Promise<BeginGitHubAppInstallationVerificationResult> {
    if (params.githubInstallationId <= 0n || params.githubOrganizationId <= 0n) {
        throw new RangeError("GitHub identifiers must be positive");
    }
    const publicServerUrl = resolveConfiguredPublicServerUrl(params.env);
    if (!publicServerUrl) return { status: "github_app_not_configured" };
    const prepared = await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" as const };
        }
        const registration = await tx.gitHubAppRegistration.findUnique({
            where: { id: params.registrationId },
            select: registrationSelect,
        });
        if (!registration || !rowHasOwner(registration, params.owner)) return { status: "not_found" as const };
        if (!isManagedGitHubHostApprovedByHome(await readHomeGovernancePolicyInTx(tx), registration.githubHost)) {
            return { status: "github_enterprise_origin_not_approved" as const };
        }
        if (registration.revision !== params.expectedRegistrationRevision) {
            return { status: "registration_revision_conflict" as const };
        }
        const secrets = decryptRegistrationSecrets(registration);
        if (!secrets.clientSecret || !secrets.privateKey) {
            return { status: "github_app_not_configured" as const };
        }
        const network = await resolveManagedIdentityNetworkPolicyInTx(tx, {
            env: params.env,
            timeoutSeconds: 30,
        });
        return { status: "ready" as const, registration, secrets, network };
    });
    if (prepared.status !== "ready") return prepared;

    const redirectUrl = `${publicServerUrl}/v1/oauth/${GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID}/callback`;
    const provider = createManagedGitHubUserOAuthProvider({
        providerId: GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID,
        githubHost: prepared.registration.githubHost,
        clientId: prepared.registration.githubClientId,
        clientSecret: prepared.secrets.clientSecret!,
        redirectUrl,
        networkPolicy: prepared.network.policy,
    });
    const attempt = await createExternalAuthorizeAttempt({
        flow: "connect",
        purpose: "github_app_installation_verification",
        providerId: GITHUB_APP_INSTALLATION_OAUTH_PROVIDER_ID,
        provider,
        env: params.env,
        userId: params.actorAccountId,
        githubAppInstallationVerification: {
            owner: params.owner,
            registrationId: params.registrationId,
            registrationRevision: prepared.registration.revision,
            registrationSecurityRevision: prepared.registration.securityRevision,
            installationRevision: params.expectedInstallationRevision,
            networkPolicyFingerprint: prepared.network.fingerprint,
            githubInstallationId: params.githubInstallationId.toString(),
            githubOrganizationId: params.githubOrganizationId.toString(),
        },
    });
    return attempt
        ? { status: "ready", authorizeUrl: attempt.url, attemptId: attempt.attemptId }
        : { status: "github_app_not_configured" };
}

type GitHubAdministratorProfile = Readonly<{
    githubUserId: bigint;
    githubUserLogin: string;
}>;

async function verifyGitHubAppInstallationWithAdministrator(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedRegistrationSecurityRevision?: number;
    expectedInstallationRevision: number;
    expectedNetworkPolicyFingerprint?: string;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    administrator?: GitHubAdministratorProfile;
    signal?: AbortSignal;
}>): Promise<VerifyHomeGitHubAppInstallationResult> {
    if (params.githubInstallationId <= 0n || params.githubOrganizationId <= 0n) {
        throw new RangeError("GitHub identifiers must be positive");
    }
    const prepared = await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" as const };
        }
        const registration = await tx.gitHubAppRegistration.findUnique({
            where: { id: params.registrationId },
            select: registrationSelect,
        });
        if (!registration || !rowHasOwner(registration, params.owner)) return { status: "not_found" as const };
        if (!isManagedGitHubHostApprovedByHome(await readHomeGovernancePolicyInTx(tx), registration.githubHost)) {
            return { status: "github_enterprise_origin_not_approved" as const };
        }
        if (registration.revision !== params.expectedRegistrationRevision) {
            return { status: "registration_revision_conflict" as const };
        }
        if (params.expectedRegistrationSecurityRevision !== undefined
            && registration.securityRevision !== params.expectedRegistrationSecurityRevision) {
            return { status: "registration_revision_conflict" as const };
        }
        const secrets = decryptRegistrationSecrets(registration);
        if (!secrets.privateKey) return { status: "github_installation_evidence_invalid" as const };
        const network = await resolveManagedIdentityNetworkPolicyInTx(tx, {
            env: process.env,
            timeoutSeconds: 30,
        });
        if (params.expectedNetworkPolicyFingerprint !== undefined
            && network.fingerprint !== params.expectedNetworkPolicyFingerprint) {
            return { status: "github_network_policy_changed" as const };
        }
        if (params.administrator) {
            const githubUserLogin = params.administrator.githubUserLogin.trim();
            if (params.administrator.githubUserId <= 0n || !githubUserLogin) {
                return { status: "github_administrator_identity_required" as const };
            }
            return {
                status: "ready" as const,
                registration,
                secrets,
                privateKey: secrets.privateKey,
                githubIdentity: {
                    source: "oauth_profile" as const,
                    githubUserId: params.administrator.githubUserId,
                    githubUserLogin,
                },
                network,
            };
        }
        // The built-in `github` identity is minted only by github.com OAuth.
        // A GHES first installation instead supplies the ephemeral profile from
        // the registration-bound OAuth callback through the explicit entry point below.
        if (registration.githubHost !== "https://github.com") {
            return { status: "github_administrator_identity_required" as const };
        }
        const identity = await tx.accountIdentity.findFirst({
            where: { accountId: params.actorAccountId, provider: "github" },
            select: { id: true, providerUserId: true, providerLogin: true },
        });
        const githubUserId = identity ? parsePositiveDecimalBigInt(identity.providerUserId) : null;
        const githubUserLogin = identity?.providerLogin?.trim() ?? "";
        return identity && githubUserId && githubUserLogin
            ? {
                status: "ready" as const,
                registration,
                secrets,
                privateKey: secrets.privateKey,
                githubIdentity: { source: "account_identity" as const, ...identity, githubUserId, githubUserLogin },
                network,
            }
            : { status: "github_administrator_identity_required" as const };
    });
    if (prepared.status !== "ready") return prepared;

    let observed: Awaited<ReturnType<typeof readGitHubAppInstallationEvidence>>;
    try {
        observed = await readGitHubAppInstallationEvidence({
            githubHost: prepared.registration.githubHost,
            githubAppId: prepared.registration.githubAppId,
            privateKey: prepared.privateKey,
            githubInstallationId: params.githubInstallationId,
            networkPolicy: prepared.network.policy,
            signal: params.signal,
        });
    } catch {
        return { status: "github_installation_evidence_invalid" };
    }
    const evidence = validateGitHubAppInstallationEvidenceV1({
        expected: {
            githubAppId: prepared.registration.githubAppId,
            githubInstallationId: params.githubInstallationId,
            githubOrganizationId: params.githubOrganizationId,
            requiredPermissions: { members: "read" },
        },
        observed,
    });
    if (!evidence.ok) return { status: evidence.code };

    const administrator = await verifyGitHubOrganizationAdministrator({
        githubHost: prepared.registration.githubHost,
        githubAppId: prepared.registration.githubAppId,
        privateKey: prepared.privateKey,
        githubInstallationId: params.githubInstallationId,
        githubOrganizationLogin: evidence.value.githubOrganizationLogin,
        githubUserId: prepared.githubIdentity.githubUserId,
        githubUserLogin: prepared.githubIdentity.githubUserLogin,
        networkPolicy: prepared.network.policy,
        signal: params.signal,
    });
    if (!administrator.ok) return { status: administrator.code };

    return await inTx(async (tx): Promise<VerifyHomeGitHubAppInstallationResult> => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" };
        }
        const currentRegistration = await tx.gitHubAppRegistration.findUnique({
            where: { id: params.registrationId },
            select: registrationSelect,
        });
        if (!currentRegistration || !rowHasOwner(currentRegistration, params.owner)) return { status: "not_found" };
        if (!isManagedGitHubHostApprovedByHome(
            await readHomeGovernancePolicyInTx(tx),
            currentRegistration.githubHost,
        )) return { status: "github_enterprise_origin_not_approved" };
        if (currentRegistration.revision !== params.expectedRegistrationRevision
            || currentRegistration.securityRevision !== prepared.registration.securityRevision) {
            return { status: "registration_revision_conflict" };
        }
        const currentNetwork = await resolveManagedIdentityNetworkPolicyInTx(tx, {
            env: process.env,
            timeoutSeconds: 30,
        });
        if (currentNetwork.fingerprint !== prepared.network.fingerprint) {
            return { status: "github_network_policy_changed" };
        }
        if (prepared.githubIdentity.source === "account_identity") {
            const currentIdentity = await tx.accountIdentity.findFirst({
                where: { id: prepared.githubIdentity.id, accountId: params.actorAccountId, provider: "github" },
                select: { providerUserId: true, providerLogin: true },
            });
            if (!currentIdentity
                || currentIdentity.providerUserId !== prepared.githubIdentity.providerUserId
                || currentIdentity.providerLogin?.trim() !== prepared.githubIdentity.githubUserLogin) {
                return { status: "github_administrator_identity_required" };
            }
        }
        const currentInstallation = await tx.gitHubAppInstallation.findFirst({
            where: {
                registrationId: params.registrationId,
                OR: [
                    { githubInstallationId: params.githubInstallationId },
                    { githubOrganizationId: params.githubOrganizationId },
                ],
            },
            select: installationSelect,
        });
        if (currentInstallation && currentInstallation.githubInstallationId !== params.githubInstallationId) {
            return { status: "github_installation_mismatch" };
        }
        if (currentInstallation && currentInstallation.githubOrganizationId !== params.githubOrganizationId) {
            return { status: "github_organization_mismatch" };
        }
        if ((currentInstallation?.revision ?? 0) !== params.expectedInstallationRevision) {
            return { status: "installation_revision_conflict", currentRevision: currentInstallation?.revision ?? null };
        }
        const now = new Date();
        const data = {
            githubOrganizationLogin: evidence.value.githubOrganizationLogin,
            repositorySelection: evidence.value.repositorySelection,
            state: evidence.value.suspended ? "suspended" : "verified",
            verifiedPermissions: evidence.value.permissions,
            verifiedEvents: evidence.value.events,
            suspendedAt: evidence.value.suspended ? now : null,
            lastVerifiedAt: now,
        };
        const installation = currentInstallation
            ? await tx.gitHubAppInstallation.update({
                where: { id: currentInstallation.id },
                data: { ...data, revision: { increment: 1 } },
                select: installationSelect,
            })
            : await tx.gitHubAppInstallation.create({
                data: {
                    registrationId: params.registrationId,
                    githubInstallationId: params.githubInstallationId,
                    githubOrganizationId: params.githubOrganizationId,
                    ...data,
                },
                select: installationSelect,
            });
        await ensureManagedGitHubIdentityProviderCandidateInTx(tx, {
            actorAccountId: params.actorAccountId,
            owner: params.owner,
            installationId: installation.id,
            organizationLogin: installation.githubOrganizationLogin,
        });
        const registration = await tx.gitHubAppRegistration.update({
            where: { id: params.registrationId },
            data: {
                revision: { increment: 1 },
                state: "verified",
                verificationHealth: { v: 1, status: "verified" },
                lastVerifiedAt: now,
            },
            select: registrationSelect,
        });
        await publishGitHubAppOwnerChangedInTx(tx, params.owner, params.registrationId);
        return {
            status: "verified",
            registration: projectRegistration(registration, prepared.secrets),
            installation,
        };
    });
}

export async function verifyGitHubAppInstallation(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedInstallationRevision: number;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    signal?: AbortSignal;
}>): Promise<VerifyHomeGitHubAppInstallationResult> {
    return await verifyGitHubAppInstallationWithAdministrator(params);
}

/**
 * Completes a registration-bound first-install OAuth proof without persisting
 * the ephemeral administrator credential or creating a second identity owner.
 */
export async function verifyGitHubAppInstallationWithAdministratorProfile(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedRegistrationSecurityRevision: number;
    expectedInstallationRevision: number;
    expectedNetworkPolicyFingerprint: string;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    administrator: GitHubAdministratorProfile;
    signal?: AbortSignal;
}>): Promise<VerifyHomeGitHubAppInstallationResult> {
    return await verifyGitHubAppInstallationWithAdministrator(params);
}

export async function verifyHomeGitHubAppInstallation(params: Readonly<{
    actorAccountId: string;
    registrationId: string;
    expectedRegistrationRevision: number;
    expectedInstallationRevision: number;
    githubInstallationId: bigint;
    githubOrganizationId: bigint;
    signal?: AbortSignal;
}>): Promise<VerifyHomeGitHubAppInstallationResult> {
    return await verifyGitHubAppInstallation({ ...params, owner: { kind: "home" } });
}

export type RemoveHomeGitHubAppInstallationResult =
    | Readonly<{ status: "removed" }>
    | Readonly<{ status: "forbidden" | "not_found" | "revision_conflict" }>
    | Readonly<{
        status: "blocked";
        blockers: Readonly<{ identityProviderInstances: number; directorySources: number }>;
    }>;

export async function removeGitHubAppInstallation(params: Readonly<{
    actorAccountId: string;
    owner: ProviderCatalogContext;
    installationId: string;
    expectedRevision: number;
}>): Promise<RemoveHomeGitHubAppInstallationResult> {
    return await inTx(async (tx) => {
        if (!await authorizeGitHubAppManagementInTx(tx, params.actorAccountId, params.owner)) {
            return { status: "forbidden" };
        }
        const installation = await tx.gitHubAppInstallation.findUnique({
            where: { id: params.installationId },
            include: {
                registration: { select: { ownerTeamId: true } },
                _count: { select: { identityProviderInstances: true, directorySources: true } },
            },
        });
        if (!installation || installation.registration.ownerTeamId !== ownerTeamId(params.owner)) {
            return { status: "not_found" };
        }
        if (installation.revision !== params.expectedRevision) return { status: "revision_conflict" };
        if (installation._count.identityProviderInstances > 0 || installation._count.directorySources > 0) {
            return {
                status: "blocked",
                blockers: {
                    identityProviderInstances: installation._count.identityProviderInstances,
                    directorySources: installation._count.directorySources,
                },
            };
        }
        const removed = await tx.gitHubAppInstallation.deleteMany({
            where: { id: params.installationId, revision: params.expectedRevision },
        });
        if (removed.count === 1) {
            await publishGitHubAppOwnerChangedInTx(tx, params.owner, installation.registrationId);
        }
        return { status: removed.count === 1 ? "removed" : "revision_conflict" };
    });
}

export async function removeHomeGitHubAppInstallation(params: Readonly<{
    actorAccountId: string;
    installationId: string;
    expectedRevision: number;
}>): Promise<RemoveHomeGitHubAppInstallationResult> {
    return await removeGitHubAppInstallation({ ...params, owner: { kind: "home" } });
}
