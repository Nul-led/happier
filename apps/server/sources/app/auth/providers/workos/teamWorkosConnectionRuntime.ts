import { computeCanonicalDomainSeparatedDigest } from "@happier-dev/protocol/crypto/canonicalDigest";

import {
    resolveIdentityProviderInstanceRuntimeInTx,
    type IdentityProviderInstanceView,
} from "@/app/auth/providers/managed/identityProviderInstanceLifecycle";
import {
    parseTeamIdentityConnectionDocuments,
    type TeamIdentityConnectionDocuments,
} from "@/app/auth/providers/managed/identityProviderDocuments";
import type {
    WorkosPlatformConfigResolution,
    WorkosPlatformRequestPolicy,
} from "@/app/integrations/workos/workosPlatform";
import { resolveWorkosPlatformConfig } from "@/app/integrations/workos/workosPlatform";
import type { Tx } from "@/storage/inTx";

type ConfiguredWorkosExternalReference = Omit<
    Extract<TeamIdentityConnectionDocuments["externalReference"], { kind: "workos_sso" }>,
    "organizationId" | "connectionId"
> & Readonly<{ organizationId: string; connectionId: string }>;

type WorkosOrganizationExternalReference = Omit<
    Extract<TeamIdentityConnectionDocuments["externalReference"], { kind: "workos_sso" }>,
    "organizationId"
> & Readonly<{ organizationId: string }>;

type TeamWorkosRuntimeUnavailableResult =
    Readonly<{
        status: "connection_not_found" | "connection_disabled" | "provider_unavailable" | "unreadable" | "not_configured" | "platform_unavailable";
    }>;

type TeamWorkosRuntimeReadyResult<
    TPurpose extends "sso" | "directory",
    TExternalReference extends WorkosOrganizationExternalReference,
> =
    | Readonly<{
        status: "ready";
        purpose: TPurpose;
        provider: IdentityProviderInstanceView;
        connection: Readonly<{
            id: string;
            teamId: string;
            providerInstanceId: string;
            enabled: boolean;
            revision: number;
            externalReference: TExternalReference;
            settings: Extract<TeamIdentityConnectionDocuments["settings"], { kind: "workos_sso" }>;
        }>;
        platform: Extract<WorkosPlatformConfigResolution, { available: true }>;
        runtimeFingerprint: string;
    }>;

export type TeamWorkosConnectionRuntimeResult =
    | TeamWorkosRuntimeReadyResult<"sso", ConfiguredWorkosExternalReference>
    | TeamWorkosRuntimeUnavailableResult;

export type TeamWorkosDirectoryRuntimeResult =
    | TeamWorkosRuntimeReadyResult<"directory", WorkosOrganizationExternalReference>
    | TeamWorkosRuntimeUnavailableResult;

type TeamWorkosRuntimeInput = Readonly<{
    env: NodeJS.ProcessEnv;
    teamId: string;
    connectionId: string;
    includeDisabled?: boolean;
    purpose?: "sso" | "directory";
    requestPolicy?: WorkosPlatformRequestPolicy;
}>;

type TeamWorkosRuntimeDependencies = Readonly<{
    resolvePlatform?: (
        env: NodeJS.ProcessEnv,
        requestPolicy?: WorkosPlatformRequestPolicy,
    ) => WorkosPlatformConfigResolution;
}>;

export function computeTeamWorkosConnectionRuntimeFingerprint(input: Readonly<{
    teamId: string;
    connectionId: string;
    providerInstanceId: string;
    providerSecurityRevision: number;
    connectionRevision: number;
    platformRuntimeFingerprint: string;
}>): string {
    const digest = computeCanonicalDomainSeparatedDigest(
        "happier.team-workos-connection.runtime.v1",
        [
            input.teamId,
            input.connectionId,
            input.providerInstanceId,
            input.platformRuntimeFingerprint,
        ],
    );
    return `team-workos:v1:${input.providerSecurityRevision}:${input.connectionRevision}:${digest}`;
}

/** Current provider authority shared by network reads and directory effect commits. */
export async function resolveTeamWorkosProviderInstanceInTx(
    tx: Tx,
    input: Readonly<{ teamId: string; providerInstanceId: string; includeDisabled?: boolean }>,
): Promise<
    | Readonly<{ status: "ready"; instance: IdentityProviderInstanceView }>
    | Readonly<{ status: "unreadable" | "provider_unavailable" }>
> {
    const teamProvider = await resolveIdentityProviderInstanceRuntimeInTx(tx, {
        id: input.providerInstanceId,
        owner: { kind: "team", teamId: input.teamId },
        includeDisabled: input.includeDisabled,
    });
    const resolvedProvider = teamProvider.status === "not_found"
        ? await resolveIdentityProviderInstanceRuntimeInTx(tx, {
            id: input.providerInstanceId,
            owner: { kind: "home" },
            includeDisabled: input.includeDisabled,
        })
        : teamProvider;
    if (resolvedProvider.status === "unreadable") return { status: "unreadable" };
    if (
        resolvedProvider.status !== "ready"
        || resolvedProvider.instance.kind !== "workos_sso"
        || resolvedProvider.instance.config.kind !== "workos_sso"
        || resolvedProvider.secrets !== null
    ) return { status: "provider_unavailable" };
    return { status: "ready", instance: resolvedProvider.instance };
}

export function resolveTeamWorkosConnectionRuntimeInTx(
    tx: Tx,
    input: TeamWorkosRuntimeInput & Readonly<{ purpose: "directory" }>,
    dependencies?: TeamWorkosRuntimeDependencies,
): Promise<TeamWorkosDirectoryRuntimeResult>;
export function resolveTeamWorkosConnectionRuntimeInTx(
    tx: Tx,
    input: TeamWorkosRuntimeInput & Readonly<{ purpose?: "sso" }>,
    dependencies?: TeamWorkosRuntimeDependencies,
): Promise<TeamWorkosConnectionRuntimeResult>;
export async function resolveTeamWorkosConnectionRuntimeInTx(
    tx: Tx,
    input: TeamWorkosRuntimeInput,
    dependencies: TeamWorkosRuntimeDependencies = {},
): Promise<TeamWorkosConnectionRuntimeResult | TeamWorkosDirectoryRuntimeResult> {
    const purpose = input.purpose ?? "sso";
    const row = await tx.teamIdentityConnection.findFirst({
        where: { id: input.connectionId, teamId: input.teamId },
        select: {
            id: true,
            teamId: true,
            providerInstanceId: true,
            externalReference: true,
            settings: true,
            enabled: true,
            revision: true,
            lastObservation: true,
            lastSuccessfulTestAt: true,
        },
    });
    if (!row) return { status: "connection_not_found" };
    if (!row.enabled && purpose === "sso" && input.includeDisabled !== true) {
        return { status: "connection_disabled" };
    }

    const resolvedProvider = await resolveTeamWorkosProviderInstanceInTx(tx, {
        providerInstanceId: row.providerInstanceId,
        teamId: input.teamId,
        includeDisabled: input.includeDisabled,
    });
    if (resolvedProvider.status !== "ready") return resolvedProvider;

    const documents = parseTeamIdentityConnectionDocuments({
        providerKind: resolvedProvider.instance.kind,
        externalReference: row.externalReference,
        settings: row.settings,
        lastObservation: row.lastObservation,
        lastSuccessfulTestAt: row.lastSuccessfulTestAt,
    });
    if (!documents.ok || documents.value.externalReference.kind !== "workos_sso" || documents.value.settings.kind !== "workos_sso") {
        return { status: "unreadable" };
    }
    const organizationId = documents.value.externalReference.organizationId;
    const connectionId = documents.value.externalReference.connectionId;
    if (organizationId === null || (purpose === "sso" && connectionId === null)) {
        return { status: "not_configured" };
    }

    const platform = dependencies.resolvePlatform
        ? dependencies.resolvePlatform(input.env, input.requestPolicy)
        : resolveWorkosPlatformConfig(input.env, {}, input.requestPolicy);
    if (!platform.available) return { status: "platform_unavailable" };
    const runtimeFingerprint = computeTeamWorkosConnectionRuntimeFingerprint({
        teamId: input.teamId,
        connectionId: row.id,
        providerInstanceId: row.providerInstanceId,
        providerSecurityRevision: resolvedProvider.instance.securityRevision,
        connectionRevision: row.revision,
        platformRuntimeFingerprint: platform.runtimeFingerprint,
    });
    const connection = {
        id: row.id,
        teamId: row.teamId,
        providerInstanceId: row.providerInstanceId,
        enabled: row.enabled,
        revision: row.revision,
        settings: documents.value.settings,
    };
    if (purpose === "directory") {
        return {
            status: "ready",
            purpose,
            provider: resolvedProvider.instance,
            connection: {
                ...connection,
                externalReference: {
                    ...documents.value.externalReference,
                    organizationId,
                },
            },
            platform,
            runtimeFingerprint,
        };
    }
    return {
        status: "ready",
        purpose,
        provider: resolvedProvider.instance,
        connection: {
            ...connection,
            externalReference: {
                ...documents.value.externalReference,
                organizationId,
                connectionId: connectionId!,
            },
        },
        platform,
        runtimeFingerprint,
    };
}
