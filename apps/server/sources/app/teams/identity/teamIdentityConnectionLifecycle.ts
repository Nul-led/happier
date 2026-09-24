import { randomUUID } from "node:crypto";

import { resolveTeamAuthenticationPolicy } from "@/app/auth/entry/resolveTeamAuthenticationPolicy";
import {
    deleteIdentityProviderInstanceInTx,
    readIdentityProviderInstanceInTx,
    readIdentityProviderInstancePresentationsByIdsInTx,
    type IdentityProviderInstanceView,
} from "@/app/auth/providers/managed/identityProviderInstanceLifecycle";
import { removeIdentitiesForProviderInTx } from "@/app/auth/providers/accountIdentityLifecycle";
import {
    parseTeamIdentityConnectionDocuments,
    type TeamIdentityConnectionDocuments,
    type TeamIdentityConnectionExternalReference,
    type TeamIdentityConnectionObservation,
    type TeamIdentityConnectionSettings,
} from "@/app/auth/providers/managed/identityProviderDocuments";
import type { Tx } from "@/storage/inTx";
import { applyTeamSessionAuthenticationContextEffectsInTx } from "../memberships/sessionAccessEffects";
import { isExactGitHubIdentityInstallationBinding } from "./githubIdentityInstallationBinding";

export type TeamIdentityConnectionState =
    | "unavailable"
    | "prohibited"
    | "not_configured"
    | "setting_up"
    | "connected"
    | "needs_attention"
    | "disabled";

export type TeamIdentityConnectionView = Readonly<{
    id: string;
    teamId: string;
    providerInstanceId: string;
    providerKind: IdentityProviderInstanceView["kind"];
    providerDisplayName: string;
    externalReference: TeamIdentityConnectionExternalReference;
    settings: TeamIdentityConnectionSettings;
    enabled: boolean;
    firstEnabledAt: Date | null;
    revision: number;
    state: TeamIdentityConnectionState;
    lastObservation: TeamIdentityConnectionObservation | null;
    lastSuccessfulTest: TeamIdentityConnectionDocuments["successfulTest"];
    createdByAccountId: string | null;
    createdAt: Date;
    updatedAt: Date;
}>;

type ConnectionRow = Readonly<{
    id: string;
    teamId: string;
    providerInstanceId: string;
    externalReference: unknown;
    settings: unknown;
    enabled: boolean;
    firstEnabledAt: Date | null;
    revision: number;
    lastObservation: unknown;
    lastSuccessfulTestAt: Date | null;
    createdByAccountId: string | null;
    createdAt: Date;
    updatedAt: Date;
}>;

const connectionSelect = {
    id: true,
    teamId: true,
    providerInstanceId: true,
    externalReference: true,
    settings: true,
    enabled: true,
    firstEnabledAt: true,
    revision: true,
    lastObservation: true,
    lastSuccessfulTestAt: true,
    createdByAccountId: true,
    createdAt: true,
    updatedAt: true,
} as const;

function isConfiguredExternalReference(reference: TeamIdentityConnectionExternalReference): boolean {
    return reference.kind !== "workos_sso"
        || (reference.organizationId !== null && reference.connectionId !== null);
}

function deriveState(input: Readonly<{
    provider: IdentityProviderInstanceView;
    row: ConnectionRow;
    documents: TeamIdentityConnectionDocuments;
}>): TeamIdentityConnectionState {
    if (!input.provider.enabled) return "unavailable";
    const observation = input.documents.lastObservation;
    const needsAttention =
        observation?.kind === "workos_sso"
        && observation.presentation !== null
        && observation.presentation.status.toLowerCase() !== "active";
    if (!input.row.enabled) {
        if (input.row.firstEnabledAt !== null) return "disabled";
        return needsAttention ? "needs_attention" : "setting_up";
    }
    if (!isConfiguredExternalReference(input.documents.externalReference)) return "setting_up";
    if (needsAttention) return "needs_attention";
    return "connected";
}

function projectConnection(input: Readonly<{
    provider: IdentityProviderInstanceView;
    row: ConnectionRow;
}>): TeamIdentityConnectionView | null {
    const documents = parseTeamIdentityConnectionDocuments({
        providerKind: input.provider.kind,
        externalReference: input.row.externalReference,
        settings: input.row.settings,
        lastObservation: input.row.lastObservation,
        lastSuccessfulTestAt: input.row.lastSuccessfulTestAt,
    });
    if (!documents.ok) return null;
    if (!areConnectionDocumentsCompatible(input.provider, documents.value)) return null;
    return Object.freeze({
        id: input.row.id,
        teamId: input.row.teamId,
        providerInstanceId: input.row.providerInstanceId,
        providerKind: input.provider.kind,
        providerDisplayName: input.provider.displayName,
        externalReference: documents.value.externalReference,
        settings: documents.value.settings,
        enabled: input.row.enabled,
        firstEnabledAt: input.row.firstEnabledAt,
        revision: input.row.revision,
        state: deriveState({ provider: input.provider, row: input.row, documents: documents.value }),
        lastObservation: documents.value.lastObservation,
        lastSuccessfulTest: documents.value.successfulTest,
        createdByAccountId: input.row.createdByAccountId,
        createdAt: input.row.createdAt,
        updatedAt: input.row.updatedAt,
    });
}

function areConnectionDocumentsCompatible(
    provider: IdentityProviderInstanceView,
    documents: TeamIdentityConnectionDocuments,
): boolean {
    return documents.externalReference.kind !== "github_app_identity"
        || isExactGitHubIdentityInstallationBinding({
            providerInstallationId: provider.githubAppInstallationId,
            connectionInstallationId: documents.externalReference.installationId,
        });
}

async function readAvailableProviderInTx(
    tx: Tx,
    input: Readonly<{ providerInstanceId: string; teamId: string }>,
): Promise<IdentityProviderInstanceView | null> {
    const result = await inspectAvailableProviderInTx(tx, input);
    return result.status === "ready" ? result.provider : null;
}

async function inspectAvailableProviderInTx(
    tx: Tx,
    input: Readonly<{ providerInstanceId: string; teamId: string }>,
): Promise<Readonly<{ status: "ready"; provider: IdentityProviderInstanceView }> | Readonly<{ status: "not_found" | "unreadable" }>> {
    const teamOwned = await readIdentityProviderInstanceInTx(tx, {
        id: input.providerInstanceId,
        owner: { kind: "team", teamId: input.teamId },
    });
    if (teamOwned.status === "ready") return { status: "ready", provider: teamOwned.instance };
    if (teamOwned.status === "unreadable") return teamOwned;
    const homeOwned = await readIdentityProviderInstanceInTx(tx, {
        id: input.providerInstanceId,
        owner: { kind: "home" },
    });
    if (homeOwned.status === "ready") return { status: "ready", provider: homeOwned.instance };
    return homeOwned;
}

async function readCurrentInTx(
    tx: Tx,
    input: Readonly<{ id: string; teamId: string }>,
): Promise<Readonly<{ row: ConnectionRow; provider: IdentityProviderInstanceView; view: TeamIdentityConnectionView | null }> | null> {
    const row = await tx.teamIdentityConnection.findFirst({
        where: { id: input.id, teamId: input.teamId },
        select: connectionSelect,
    });
    if (!row) return null;
    const provider = await readAvailableProviderInTx(tx, {
        providerInstanceId: row.providerInstanceId,
        teamId: row.teamId,
    });
    if (!provider) return null;
    return { row, provider, view: projectConnection({ provider, row }) };
}

export async function readTeamIdentityConnectionInTx(
    tx: Tx,
    input: Readonly<{ id: string; teamId: string }>,
): Promise<Readonly<{ status: "ready"; connection: TeamIdentityConnectionView }> | Readonly<{ status: "not_found" | "unreadable" }>> {
    const reads = await readTeamIdentityConnectionsByIdInTx(tx, { references: [input] });
    return reads.get(teamIdentityConnectionReferenceKey(input)) ?? { status: "not_found" };
}

export type TeamIdentityConnectionReadResult =
    | Readonly<{ status: "ready"; connection: TeamIdentityConnectionView }>
    | Readonly<{ status: "not_found" | "unreadable" }>;

export function teamIdentityConnectionReferenceKey(input: Readonly<{ id: string; teamId: string }>): string {
    return `${input.teamId}\u0000${input.id}`;
}

/**
 * Reads a bounded set of exact Team/connection identities without repeating
 * connection and provider-instance reads per Team. The returned map remains
 * keyed by both identities so a connection from one Team can never satisfy a
 * reference from another Team.
 */
export async function readTeamIdentityConnectionsByIdInTx(
    tx: Tx,
    input: Readonly<{ references: readonly Readonly<{ id: string; teamId: string }>[] }>,
): Promise<ReadonlyMap<string, TeamIdentityConnectionReadResult>> {
    const references = [...new Map(input.references.map((reference) => [
        teamIdentityConnectionReferenceKey(reference),
        reference,
    ])).values()];
    if (references.length === 0) return new Map();
    const wantedKeys = new Set(references.map(teamIdentityConnectionReferenceKey));
    const rows = await tx.teamIdentityConnection.findMany({
        where: {
            id: { in: [...new Set(references.map((reference) => reference.id))] },
            teamId: { in: [...new Set(references.map((reference) => reference.teamId))] },
        },
        select: connectionSelect,
    });
    const providerReads = await readIdentityProviderInstancePresentationsByIdsInTx(tx, {
        ids: rows.map((row) => row.providerInstanceId),
    });
    const rowsByKey = new Map(rows
        .filter((row) => wantedKeys.has(teamIdentityConnectionReferenceKey(row)))
        .map((row) => [teamIdentityConnectionReferenceKey(row), row] as const));
    const entries: Array<readonly [string, TeamIdentityConnectionReadResult]> = references.map((reference) => {
        const key = teamIdentityConnectionReferenceKey(reference);
        const row = rowsByKey.get(key);
        if (!row) return [key, { status: "not_found" as const }] as const;
        const providerRead = providerReads.get(row.providerInstanceId.trim().toLowerCase());
        if (providerRead?.status !== "ready") return [key, { status: "unreadable" as const }] as const;
        const provider = providerRead.instance;
        const ownerMatches = provider.owner.kind === "home"
            || (provider.owner.kind === "team" && provider.owner.teamId === row.teamId);
        const connection = ownerMatches ? projectConnection({ provider, row }) : null;
        return [key, connection
            ? { status: "ready" as const, connection }
            : { status: "unreadable" as const }] as const;
    });
    return new Map(entries);
}

export async function listTeamIdentityConnectionsInTx(
    tx: Tx,
    input: Readonly<{ teamId: string }>,
): Promise<readonly TeamIdentityConnectionView[]> {
    const rows = await tx.teamIdentityConnection.findMany({
        where: { teamId: input.teamId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: connectionSelect,
    });
    const projected = await Promise.all(rows.map(async (row) => {
        const provider = await readAvailableProviderInTx(tx, {
            providerInstanceId: row.providerInstanceId,
            teamId: row.teamId,
        });
        return provider ? projectConnection({ provider, row }) : null;
    }));
    return projected.filter((connection): connection is TeamIdentityConnectionView => connection !== null);
}

export type CreateTeamIdentityConnectionResult =
    | Readonly<{ status: "created"; connection: TeamIdentityConnectionView }>
    | Readonly<{ status: "provider_not_available" | "invalid_document" }>
    | Readonly<{ status: "already_exists"; connection: TeamIdentityConnectionView | null }>;

export async function createTeamIdentityConnectionInTx(tx: Tx, input: Readonly<{
    teamId: string;
    providerInstanceId: string;
    externalReference: unknown;
    settings: unknown;
    createdByAccountId: string | null;
}>): Promise<CreateTeamIdentityConnectionResult> {
    const provider = await readAvailableProviderInTx(tx, input);
    if (!provider) return { status: "provider_not_available" };
    const documents = parseTeamIdentityConnectionDocuments({
        providerKind: provider.kind,
        externalReference: input.externalReference,
        settings: input.settings,
        lastObservation: null,
        lastSuccessfulTestAt: null,
    });
    if (!documents.ok || !areConnectionDocumentsCompatible(provider, documents.value)) {
        return { status: "invalid_document" };
    }

    const proposedId = randomUUID();
    const row = await tx.teamIdentityConnection.upsert({
        where: {
            teamId_providerInstanceId: {
                teamId: input.teamId,
                providerInstanceId: input.providerInstanceId,
            },
        },
        create: {
            id: proposedId,
            teamId: input.teamId,
            providerInstanceId: input.providerInstanceId,
            externalReference: documents.value.externalReference,
            settings: documents.value.settings,
            createdByAccountId: input.createdByAccountId,
        },
        update: {},
        select: connectionSelect,
    });
    const connection = projectConnection({ provider, row });
    return row.id === proposedId
        ? { status: "created", connection: connection! }
        : { status: "already_exists", connection };
}

type TeamIdentityConnectionMutationResult =
    | Readonly<{ status: "applied"; connection: TeamIdentityConnectionView }>
    | Readonly<{ status: "immutable_external_identity"; connection: TeamIdentityConnectionView }>
    | Readonly<{ status: "not_found" | "invalid_document" | "provider_not_available" | "not_configured" | "policy_in_use" | "authentication_policy_unavailable" }>
    | Readonly<{ status: "revision_conflict"; connection: TeamIdentityConnectionView | null }>;

/**
 * Whether a connection's external reference now defines an immutable provider
 * namespace: it has been enabled at least once, or an AccountIdentity was issued
 * under its provider. Before that an administrator may still correct a draft;
 * afterwards recovery is a new provider instance/Team connection beside it
 * (teams-lane-03/03 §6.3(7)), never a rewrite of this one.
 */
export async function isTeamIdentityConnectionNamespaceActivatedInTx(
    tx: Tx,
    input: Readonly<{ firstEnabledAt: Date | null; providerInstanceId: string }>,
): Promise<boolean> {
    return input.firstEnabledAt !== null
        || await tx.accountIdentity.count({ where: { provider: input.providerInstanceId } }) > 0;
}

export async function updateTeamIdentityConnectionInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
    externalReference?: unknown;
    settings?: unknown;
}>): Promise<TeamIdentityConnectionMutationResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    if (!current.view) return { status: "invalid_document" };

    const nextDocuments = parseTeamIdentityConnectionDocuments({
        providerKind: current.provider.kind,
        externalReference: input.externalReference ?? current.view.externalReference,
        settings: input.settings ?? current.view.settings,
        lastObservation: current.view.lastObservation,
        lastSuccessfulTestAt: current.view.lastSuccessfulTest?.at ?? null,
    });
    if (!nextDocuments.ok || !areConnectionDocumentsCompatible(current.provider, nextDocuments.value)) {
        return { status: "invalid_document" };
    }

    if (
        input.externalReference !== undefined
        && JSON.stringify(nextDocuments.value.externalReference) !== JSON.stringify(current.view.externalReference)
        && await isTeamIdentityConnectionNamespaceActivatedInTx(tx, {
            firstEnabledAt: current.row.firstEnabledAt,
            providerInstanceId: current.provider.id,
        })
    ) return { status: "immutable_external_identity", connection: current.view };

    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    const updated = await tx.teamIdentityConnection.updateMany({
        where: { id: input.id, teamId: input.teamId, revision: input.expectedRevision },
        data: {
            revision: { increment: 1 },
            externalReference: nextDocuments.value.externalReference,
            settings: nextDocuments.value.settings,
        },
    });
    if (updated.count > 0 && policyUse !== "not_in_use") {
        await applyTeamSessionAuthenticationContextEffectsInTx(tx, { teamIds: [input.teamId] });
    }
    return await projectMutationResultInTx(tx, input, updated.count);
}

export async function setTeamIdentityConnectionEnabledInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
    enabled: boolean;
    now?: Date;
}>): Promise<TeamIdentityConnectionMutationResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    if (!current.view) return { status: "invalid_document" };
    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    if (!input.enabled) {
        if (policyUse !== "not_in_use") return { status: policyUse };
    }
    if (input.enabled && !current.provider.enabled) return { status: "provider_not_available" };
    if (input.enabled && !isConfiguredExternalReference(current.view.externalReference)) {
        return { status: "not_configured" };
    }

    const updated = await tx.teamIdentityConnection.updateMany({
        where: { id: input.id, teamId: input.teamId, revision: input.expectedRevision },
        data: {
            revision: { increment: 1 },
            enabled: input.enabled,
            ...(input.enabled && current.row.firstEnabledAt === null
                ? { firstEnabledAt: input.now ?? new Date() }
                : {}),
        },
    });
    if (updated.count > 0 && policyUse !== "not_in_use") {
        await applyTeamSessionAuthenticationContextEffectsInTx(tx, { teamIds: [input.teamId] });
    }
    return await projectMutationResultInTx(tx, input, updated.count);
}

function emptyObservation(kind: IdentityProviderInstanceView["kind"]): TeamIdentityConnectionObservation {
    return kind === "workos_sso"
        ? { v: 1, kind, presentation: null, successfulTest: null }
        : { v: 1, kind, successfulTest: null };
}

export async function recordTeamIdentityConnectionTestInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
    runtimeFingerprint: string;
    testedAt: Date;
}>): Promise<TeamIdentityConnectionMutationResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    if (!current.view || input.runtimeFingerprint.trim().length === 0) return { status: "invalid_document" };
    const observation = current.view.lastObservation ?? emptyObservation(current.provider.kind);
    const nextObservation = {
        ...observation,
        successfulTest: {
            runtimeFingerprint: input.runtimeFingerprint,
        },
    } satisfies TeamIdentityConnectionObservation;
    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    const updated = await tx.teamIdentityConnection.updateMany({
        where: { id: input.id, teamId: input.teamId, revision: input.expectedRevision },
        data: { lastObservation: nextObservation, lastSuccessfulTestAt: input.testedAt },
    });
    if (updated.count > 0 && policyUse !== "not_in_use") {
        await applyTeamSessionAuthenticationContextEffectsInTx(tx, { teamIds: [input.teamId] });
    }
    return await projectMutationResultInTx(tx, input, updated.count);
}

export async function recordTeamIdentityConnectionWorkosObservationInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
    presentation: Readonly<{
        displayName: string;
        strategy: string;
        status: string;
        lastCheckedAt: Date;
    }> | null;
}>): Promise<TeamIdentityConnectionMutationResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    if (!current.view || current.provider.kind !== "workos_sso") return { status: "invalid_document" };
    const existingTest = current.view.lastObservation?.successfulTest ?? null;
    const nextObservation = {
        v: 1,
        kind: "workos_sso",
        presentation: input.presentation === null
            ? null
            : {
                displayName: input.presentation.displayName,
                strategy: input.presentation.strategy,
                status: input.presentation.status,
                lastCheckedAt: input.presentation.lastCheckedAt.toISOString(),
            },
        successfulTest: existingTest,
    } satisfies TeamIdentityConnectionObservation;
    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    const updated = await tx.teamIdentityConnection.updateMany({
        where: { id: input.id, teamId: input.teamId, revision: input.expectedRevision },
        data: { lastObservation: nextObservation },
    });
    if (updated.count > 0 && policyUse !== "not_in_use") {
        await applyTeamSessionAuthenticationContextEffectsInTx(tx, { teamIds: [input.teamId] });
    }
    return await projectMutationResultInTx(tx, input, updated.count);
}

async function projectMutationResultInTx(
    tx: Tx,
    input: Readonly<{ id: string; teamId: string }>,
    updatedCount: number,
): Promise<TeamIdentityConnectionMutationResult> {
    const latest = await readCurrentInTx(tx, input);
    if (updatedCount === 0) {
        return latest
            ? { status: "revision_conflict", connection: latest.view }
            : { status: "not_found" };
    }
    return latest?.view
        ? { status: "applied", connection: latest.view }
        : { status: "invalid_document" };
}

export type DeleteTeamIdentityConnectionResult =
    | Readonly<{ status: "deleted" | "not_found" }>
    | Readonly<{ status: "revision_conflict"; connection: TeamIdentityConnectionView | null }>
    | Readonly<{ status: "policy_in_use" | "authentication_policy_unavailable" }>
    | Readonly<{ status: "blocked"; blockers: Readonly<{ directorySources: number; externalGroupBindings: number; managedMemberships: number }> }>;

export async function deleteTeamIdentityConnectionInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
}>): Promise<DeleteTeamIdentityConnectionResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    if (policyUse !== "not_in_use") return { status: policyUse };
    const [directorySources, externalGroupBindings, managedMemberships] = await Promise.all([
        tx.teamDirectorySource.count({ where: { teamIdentityConnectionId: input.id } }),
        tx.teamExternalGroupBinding.count({ where: { teamIdentityConnectionId: input.id } }),
        tx.teamMembershipIdentityConnectionManagement.count({ where: { teamIdentityConnectionId: input.id } }),
    ]);
    if (directorySources > 0 || externalGroupBindings > 0 || managedMemberships > 0) {
        return { status: "blocked", blockers: { directorySources, externalGroupBindings, managedMemberships } };
    }

    const deleted = await tx.teamIdentityConnection.deleteMany({
        where: { id: input.id, teamId: input.teamId, revision: input.expectedRevision },
    });
    if (deleted.count === 1) return { status: "deleted" };
    const latest = await readCurrentInTx(tx, input);
    return latest
        ? { status: "revision_conflict", connection: latest.view }
        : { status: "not_found" };
}

export type RemoveTeamWorkosSsoConfigurationResult =
    | Readonly<{ status: "removed"; retainedCarrier: boolean }>
    | Readonly<{ status: "not_found" | "invalid_document" | "policy_in_use" | "authentication_policy_unavailable" }>
    | Readonly<{ status: "revision_conflict"; connection: TeamIdentityConnectionView | null }>;

/**
 * Completes WorkOS SSO removal after the upstream connection has been deleted
 * (or confirmed absent). Directory and group consumers retain the organization
 * carrier; otherwise its now-unused Team connection and provider are removed.
 */
export async function removeTeamWorkosSsoConfigurationInTx(tx: Tx, input: Readonly<{
    id: string;
    teamId: string;
    expectedRevision: number;
    organizationId: string | null;
    connectionId: string | null;
}>): Promise<RemoveTeamWorkosSsoConfigurationResult> {
    const current = await readCurrentInTx(tx, input);
    if (!current) return { status: "not_found" };
    if (current.row.revision !== input.expectedRevision) {
        return { status: "revision_conflict", connection: current.view };
    }
    if (
        !current.view
        || current.view.providerKind !== "workos_sso"
        || current.view.externalReference.kind !== "workos_sso"
        || current.view.externalReference.organizationId !== input.organizationId
        || current.view.externalReference.connectionId !== input.connectionId
        || current.view.enabled
    ) return { status: "invalid_document" };
    const policyUse = await resolveTeamAuthenticationPolicyUseInTx(tx, input);
    if (policyUse !== "not_in_use") return { status: policyUse };

    const [directorySources, externalGroupBindings, managedMemberships] = await Promise.all([
        tx.teamDirectorySource.count({ where: { teamIdentityConnectionId: input.id } }),
        tx.teamExternalGroupBinding.count({ where: { teamIdentityConnectionId: input.id } }),
        tx.teamMembershipIdentityConnectionManagement.count({ where: { teamIdentityConnectionId: input.id } }),
    ]);
    const retainedCarrier = directorySources > 0 || externalGroupBindings > 0 || managedMemberships > 0;
    if (retainedCarrier) {
        const updated = await tx.teamIdentityConnection.updateMany({
            where: {
                id: input.id,
                teamId: input.teamId,
                revision: input.expectedRevision,
                enabled: false,
            },
            data: {
                revision: { increment: 1 },
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: input.organizationId,
                    connectionId: null,
                },
                firstEnabledAt: null,
                lastObservation: null,
                lastSuccessfulTestAt: null,
            },
        });
        if (updated.count !== 1) {
            const latest = await readCurrentInTx(tx, input);
            return { status: "revision_conflict", connection: latest?.view ?? null };
        }
        await removeIdentitiesForProviderInTx(tx, current.provider.id);
        return { status: "removed", retainedCarrier: true };
    }

    const deleted = await tx.teamIdentityConnection.deleteMany({
        where: {
            id: input.id,
            teamId: input.teamId,
            revision: input.expectedRevision,
            enabled: false,
        },
    });
    if (deleted.count !== 1) {
        const latest = await readCurrentInTx(tx, input);
        return latest
            ? { status: "revision_conflict", connection: latest.view }
            : { status: "not_found" };
    }
    await removeIdentitiesForProviderInTx(tx, current.provider.id);
    const providerDeletion = await deleteIdentityProviderInstanceInTx(tx, {
        id: current.provider.id,
        owner: { kind: "team", teamId: input.teamId },
        expectedRevision: current.provider.revision,
    });
    if (providerDeletion.status === "revision_conflict") {
        throw new Error("identity_provider_revision_conflict");
    }
    return { status: "removed", retainedCarrier: false };
}

async function resolveTeamAuthenticationPolicyUseInTx(
    tx: Tx,
    input: Readonly<{ id: string; teamId: string }>,
): Promise<"not_in_use" | "policy_in_use" | "authentication_policy_unavailable"> {
    const team = await tx.team.findUnique({
        where: { id: input.teamId },
        select: { authenticationPolicy: true },
    });
    if (!team) return "authentication_policy_unavailable";
    const policy = resolveTeamAuthenticationPolicy({
        policy: team.authenticationPolicy,
        homeMethods: [],
        teamConnections: [],
    });
    if (policy.status === "unavailable") return "authentication_policy_unavailable";
    return policy.status === "restricted"
        && policy.choices.some((choice) =>
            choice.reference.kind === "team_connection"
            && choice.reference.connectionId === input.id)
        ? "policy_in_use"
        : "not_in_use";
}
