import type {
    TeamIdentityConnectionV1,
    TeamIdentityErrorCodeV1,
    TeamIdentityWorkosConnectionCreateInputV1,
    TeamIdentityWorkosReconcileResultV1,
} from "@happier-dev/protocol/teams";

import {
    createIdentityProviderInstanceInTx,
    readIdentityProviderInstanceInTx,
    setIdentityProviderInstanceEnabledInTx,
} from "@/app/auth/providers/managed/identityProviderInstanceLifecycle";
import {
    readHomeGovernancePolicyInTx,
    resolveTeamProviderKindPolicy,
} from "@/app/home/governance/governancePolicy";
import { createWorkosAdministrationAdapter } from "@/app/integrations/workos/workosAdministrationAdapter";
import {
    resolveWorkosPlatformConfig,
    resolveWorkosPlatformRequestPolicy,
    type WorkosPlatformConfigResolution,
    type WorkosPlatformRequestPolicy,
} from "@/app/integrations/workos/workosPlatform";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import { inTx, type Tx } from "@/storage/inTx";
import {
    createTeamIdentityConnectionInTx,
    isTeamIdentityConnectionNamespaceActivatedInTx,
    readTeamIdentityConnectionInTx,
    recordTeamIdentityConnectionWorkosObservationInTx,
    updateTeamIdentityConnectionInTx,
    type TeamIdentityConnectionView,
} from "./teamIdentityConnectionLifecycle";
import type { TeamOperationAuthenticationContext } from "../actorContext";
import { authorizeTeamIdentityAdministrationInTx } from "./teamIdentityAdministrationAuthority";
import { projectCurrentTeamIdentityConnectionV1InTx } from "./teamIdentityConnectionProjection";
import { resolveTeamIdentityConnectionReturnUrl } from "./teamIdentityConnectionUrls";
import { publishTeamChangedInTx } from "../teamChanges";

type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: TeamIdentityErrorCodeV1 }>;

export type WorkosAdministrationDependencies = Readonly<{
    resolvePlatform?: (
        env: NodeJS.ProcessEnv,
        requestPolicy: WorkosPlatformRequestPolicy,
    ) => WorkosPlatformConfigResolution;
    resolveServerIdentityId?: (env: NodeJS.ProcessEnv) => Promise<string>;
    now?: () => Date;
}>;

type WorkosConnectionPreflight = Readonly<{
    teamName: string;
    connection: TeamIdentityConnectionView & Readonly<{
        providerKind: "workos_sso";
        externalReference: Extract<TeamIdentityConnectionView["externalReference"], { kind: "workos_sso" }>;
    }>;
}>;

function workosAllowedByHomePolicy(
    policy: Awaited<ReturnType<typeof readHomeGovernancePolicyInTx>>,
): boolean {
    return resolveTeamProviderKindPolicy(policy, "workos_sso") === "allowed";
}

async function preflightWorkosConnectionInTx(
    tx: Tx,
    input: Partial<TeamOperationAuthenticationContext> & Readonly<{
        actorAccountId: string;
        teamId: string;
        connectionId: string;
        directorySourceId?: string;
        expectedRevision?: number;
    }>,
): Promise<Result<WorkosConnectionPreflight>> {
    const authority = await authorizeTeamIdentityAdministrationInTx(tx, input);
    if (!authority.ok) return authority;

    const [home, resolved, team, directorySource] = await Promise.all([
        readHomeGovernancePolicyInTx(tx),
        readTeamIdentityConnectionInTx(tx, { id: input.connectionId, teamId: input.teamId }),
        tx.team.findUnique({ where: { id: input.teamId }, select: { name: true } }),
        input.directorySourceId
            ? tx.teamDirectorySource.findFirst({
                where: { id: input.directorySourceId, teamId: input.teamId },
                select: { kind: true, teamIdentityConnectionId: true },
            })
            : Promise.resolve(null),
    ]);
    if (!team) return { ok: false, error: "team_not_found" };
    if (!workosAllowedByHomePolicy(home)) return { ok: false, error: "team_identity_not_allowed" };
    if (resolved.status === "not_found") return { ok: false, error: "identity_connection_not_found" };
    if (resolved.status !== "ready") return { ok: false, error: "identity_connection_invalid" };
    if (
        resolved.connection.providerKind !== "workos_sso"
        || resolved.connection.externalReference.kind !== "workos_sso"
    ) return { ok: false, error: "identity_connection_invalid" };
    if (
        input.expectedRevision !== undefined
        && resolved.connection.revision !== input.expectedRevision
    ) return { ok: false, error: "identity_connection_conflict" };
    if (input.directorySourceId && (
        directorySource?.kind !== "workos_directory"
        || directorySource.teamIdentityConnectionId !== input.connectionId
    )) return { ok: false, error: "identity_connection_invalid" };
    return {
        ok: true,
        value: {
            teamName: team.name,
            connection: resolved.connection as WorkosConnectionPreflight["connection"],
        },
    };
}

function resolvePlatform(
    env: NodeJS.ProcessEnv,
    dependencies: WorkosAdministrationDependencies,
): Extract<WorkosPlatformConfigResolution, { available: true }> | null {
    const requestPolicy = resolveWorkosPlatformRequestPolicy();
    const platform = dependencies.resolvePlatform
        ? dependencies.resolvePlatform(env, requestPolicy)
        : resolveWorkosPlatformConfig(env, {}, requestPolicy);
    return platform.available ? platform : null;
}

export async function createTeamWorkosConnection(
    input: TeamIdentityWorkosConnectionCreateInputV1 & Partial<TeamOperationAuthenticationContext> & Readonly<{
        actorAccountId: string;
        env: NodeJS.ProcessEnv;
    }>,
    dependencies: WorkosAdministrationDependencies = {},
): Promise<Result<TeamIdentityConnectionV1>> {
    return await inTx(async (tx) => {
        const authority = await authorizeTeamIdentityAdministrationInTx(tx, input);
        if (!authority.ok) return authority;
        const [home, team] = await Promise.all([
            readHomeGovernancePolicyInTx(tx),
            tx.team.findUnique({ where: { id: input.teamId }, select: { name: true, updatedAt: true } }),
        ]);
        if (!team) return { ok: false, error: "team_not_found" };
        if (!workosAllowedByHomePolicy(home)) {
            return { ok: false, error: "team_identity_not_allowed" };
        }
        if (!resolvePlatform(input.env, dependencies)) {
            return { ok: false, error: "workos_platform_unavailable" };
        }

        // Serialize concurrent creators on the already-authoritative Team row
        // without changing its bytes: serializable PostgreSQL/MySQL transactions
        // retry the loser from a fresh snapshot and SQLite already serializes the
        // write, so two presses cannot both create a draft carrier.
        await tx.team.update({
            where: { id: input.teamId },
            data: { updatedAt: team.updatedAt },
            select: { id: true },
        });
        // A still-draft WorkOS connection is the one setup in progress, so a replay
        // returns it. Once a connection's namespace is activated (enabled or an
        // identity was issued) it is immutable; recovering from a replaced or
        // deleted upstream connection creates a new provider instance and Team
        // connection beside it, and the old one keeps its identities until an
        // administrator removes it (teams-lane-03/03 §6.3(7)). No relink job.
        const existingConnections = await tx.teamIdentityConnection.findMany({
            where: {
                teamId: input.teamId,
                providerInstance: { kind: "workos_sso" },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, firstEnabledAt: true, providerInstanceId: true },
        });
        for (const candidate of existingConnections) {
            if (await isTeamIdentityConnectionNamespaceActivatedInTx(tx, candidate)) continue;
            const draft = await readTeamIdentityConnectionInTx(tx, { id: candidate.id, teamId: input.teamId });
            return draft.status === "ready"
                ? { ok: true, value: await projectCurrentTeamIdentityConnectionV1InTx(tx, { env: input.env, teamId: input.teamId, connection: draft.connection }) }
                : { ok: false, error: "identity_connection_invalid" };
        }

        // Each Team connection owns exactly one provider instance (unique per
        // Team). Reuse only a Team-owned WorkOS instance no connection carries.
        const unboundProvider = await tx.identityProviderInstance.findFirst({
            where: { ownerTeamId: input.teamId, kind: "workos_sso", connections: { none: {} } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true },
        });
        const provider = unboundProvider
            ? await readIdentityProviderInstanceInTx(tx, {
                id: unboundProvider.id,
                owner: { kind: "team", teamId: input.teamId },
            })
            : await createIdentityProviderInstanceInTx(tx, {
                env: input.env,
                owner: { kind: "team", teamId: input.teamId },
                kind: "workos_sso",
                displayName: `${team.name} SSO`,
                config: { v: 1, kind: "workos_sso" },
                secrets: null,
                createdByAccountId: input.actorAccountId,
            });
        if (provider.status !== "ready" && provider.status !== "created") {
            return { ok: false, error: "identity_connection_invalid" };
        }
        let providerInstance = provider.instance;
        if (!providerInstance.enabled) {
            const enabled = await setIdentityProviderInstanceEnabledInTx(tx, {
                id: providerInstance.id,
                owner: { kind: "team", teamId: input.teamId },
                expectedRevision: providerInstance.revision,
                expectedSecurityRevision: providerInstance.securityRevision,
                enabled: true,
            });
            if (enabled.status !== "applied") {
                return { ok: false, error: "identity_connection_invalid" };
            }
            providerInstance = enabled.instance;
        }
        const created = await createTeamIdentityConnectionInTx(tx, {
            teamId: input.teamId,
            providerInstanceId: providerInstance.id,
            externalReference: {
                v: 1,
                kind: "workos_sso",
                organizationId: null,
                connectionId: null,
            },
            settings: { v: 1, kind: "workos_sso" },
            createdByAccountId: input.actorAccountId,
        });
        if (created.status === "created") {
            await publishTeamChangedInTx(tx, { teamId: input.teamId });
            return { ok: true, value: await projectCurrentTeamIdentityConnectionV1InTx(tx, { env: input.env, teamId: input.teamId, connection: created.connection }) };
        }
        if (created.status === "already_exists" && created.connection) {
            return { ok: true, value: await projectCurrentTeamIdentityConnectionV1InTx(tx, { env: input.env, teamId: input.teamId, connection: created.connection }) };
        }
        return { ok: false, error: "identity_connection_invalid" };
    });
}

function mapConnectionMutationError(status: string): TeamIdentityErrorCodeV1 {
    switch (status) {
        case "not_found": return "identity_connection_not_found";
        case "revision_conflict": return "identity_connection_conflict";
        case "immutable_external_identity": return "workos_connection_mismatch";
        case "provider_not_available": return "identity_provider_unavailable";
        default: return "identity_connection_invalid";
    }
}

function mapWorkosError(error: unknown): TeamIdentityErrorCodeV1 {
    const code = error instanceof Error ? error.message : "";
    if (code === "workos_organization_mismatch") return "workos_organization_mismatch";
    if (code === "workos_connection_mismatch") return "workos_connection_mismatch";
    return "identity_provider_unavailable";
}

export async function createTeamWorkosAdminPortalLink(
    input: Partial<TeamOperationAuthenticationContext> & Readonly<{
        actorAccountId: string;
        teamId: string;
        connectionId: string;
        directorySourceId?: string;
        intent: "sso" | "dsync";
        env: NodeJS.ProcessEnv;
    }>,
    dependencies: WorkosAdministrationDependencies = {},
): Promise<Result<Readonly<{ url: string }>>> {
    let preflight = await inTx((tx) => preflightWorkosConnectionInTx(tx, input));
    if (!preflight.ok) return preflight;
    const initialConnectionRevision = preflight.value.connection.revision;
    const platform = resolvePlatform(input.env, dependencies);
    if (!platform) return { ok: false, error: "workos_platform_unavailable" };

    const homeServerIdentityId = await (
        dependencies.resolveServerIdentityId ?? getOrCreateServerIdentityId
    )(input.env);
    const adapter = createWorkosAdministrationAdapter(platform.client);
    let organizationId = preflight.value.connection.externalReference.organizationId;
    if (organizationId === null) {
        let organization: Readonly<{ id: string; name: string }>;
        try {
            organization = await adapter.ensureOrganization({
                homeServerIdentityId,
                teamId: input.teamId,
                teamName: preflight.value.teamName,
            });
        } catch (error) {
            return { ok: false, error: mapWorkosError(error) };
        }
        const persisted = await inTx(async (tx) => {
            const current = await preflightWorkosConnectionInTx(tx, {
                ...input,
                expectedRevision: initialConnectionRevision,
            });
            if (!current.ok) return current;
            if (current.value.connection.externalReference.organizationId !== null) {
                return current;
            }
            const updated = await updateTeamIdentityConnectionInTx(tx, {
                id: input.connectionId,
                teamId: input.teamId,
                expectedRevision: current.value.connection.revision,
                externalReference: {
                    ...current.value.connection.externalReference,
                    organizationId: organization.id,
                },
            });
            if (updated.status === "applied") {
                await publishTeamChangedInTx(tx, { teamId: input.teamId });
            }
            return updated.status === "applied"
                ? { ok: true as const, value: { ...current.value, connection: updated.connection as WorkosConnectionPreflight["connection"] } }
                : { ok: false as const, error: mapConnectionMutationError(updated.status) };
        });
        if (!persisted.ok) return persisted;
        preflight = persisted;
        organizationId = organization.id;
    }

    const returnUrl = resolveTeamIdentityConnectionReturnUrl({
        env: input.env,
        homeServerIdentityId,
        teamId: input.teamId,
        connectionId: input.connectionId,
    });
    if (!returnUrl) return { ok: false, error: "identity_connection_invalid" };
    try {
        return {
            ok: true,
            value: {
                url: await adapter.createAdminPortalLink({
                    organizationId,
                    intent: input.intent,
                    returnUrl,
                }),
            },
        };
    } catch (error) {
        return { ok: false, error: mapWorkosError(error) };
    }
}

async function recordWorkosCandidateInTx(
    tx: Tx,
    input: Readonly<{
        preflight: WorkosConnectionPreflight;
        candidate: Readonly<{
            connectionId: string;
            displayName: string;
            strategy: string;
            status: string;
        }>;
        now: Date;
        env: NodeJS.ProcessEnv;
    }>,
): Promise<Result<TeamIdentityConnectionV1>> {
    let connection = input.preflight.connection;
    if (connection.externalReference.connectionId !== input.candidate.connectionId) {
        // Whether the exact connection may still change is the connection
        // lifecycle's decision, not a second rule here: it refuses the write once
        // the binding has been enabled or an AccountIdentity was issued under this
        // provider namespace, and permits an admin to correct a draft choice before
        // then. Reconcile never reaches this branch with a different connection
        // because it narrows its candidates to the existing selection first.
        const updated = await updateTeamIdentityConnectionInTx(tx, {
            id: connection.id,
            teamId: connection.teamId,
            expectedRevision: connection.revision,
            externalReference: {
                ...connection.externalReference,
                connectionId: input.candidate.connectionId,
            },
        });
        if (updated.status !== "applied") {
            return { ok: false, error: mapConnectionMutationError(updated.status) };
        }
        connection = updated.connection as WorkosConnectionPreflight["connection"];
    }
    const observed = await recordTeamIdentityConnectionWorkosObservationInTx(tx, {
        id: connection.id,
        teamId: connection.teamId,
        expectedRevision: connection.revision,
        presentation: {
            displayName: input.candidate.displayName,
            strategy: input.candidate.strategy,
            status: input.candidate.status,
            lastCheckedAt: input.now,
        },
    });
    return observed.status === "applied"
        ? {
            ok: true,
            value: await projectCurrentTeamIdentityConnectionV1InTx(tx, {
                env: input.env,
                teamId: connection.teamId,
                connection: observed.connection,
            }),
        }
        : { ok: false, error: mapConnectionMutationError(observed.status) };
}

export async function reconcileTeamWorkosConnection(
    input: Partial<TeamOperationAuthenticationContext> & Readonly<{
        actorAccountId: string;
        teamId: string;
        connectionId: string;
        expectedRevision: number;
        env: NodeJS.ProcessEnv;
    }>,
    dependencies: WorkosAdministrationDependencies = {},
): Promise<Result<TeamIdentityWorkosReconcileResultV1>> {
    const preflight = await inTx((tx) => preflightWorkosConnectionInTx(tx, input));
    if (!preflight.ok) return preflight;
    const organizationId = preflight.value.connection.externalReference.organizationId;
    if (organizationId === null) return { ok: false, error: "identity_connection_invalid" };
    const platform = resolvePlatform(input.env, dependencies);
    if (!platform) return { ok: false, error: "workos_platform_unavailable" };
    const adapter = createWorkosAdministrationAdapter(platform.client);
    let listedCandidates;
    try {
        listedCandidates = await adapter.listSsoConnections(organizationId);
    } catch (error) {
        return { ok: false, error: mapWorkosError(error) };
    }

    // An exact selection belongs to the immutable provider namespace: once chosen it is only
    // re-observed or reported missing. Other connections appearing or the selected one
    // disappearing upstream must never reopen selection or move existing AccountIdentity rows
    // to a different IdP. Narrowing the candidate set to the selection is what enforces that,
    // so every branch below reads one list rather than re-deriving the selection.
    const selectedConnectionId = preflight.value.connection.externalReference.connectionId;
    const selectedCandidate = selectedConnectionId === null
        ? null
        : listedCandidates.find((candidate) => candidate.connectionId === selectedConnectionId) ?? null;
    const candidates = selectedConnectionId === null
        ? listedCandidates.filter((candidate) => candidate.status.toLowerCase() === "active")
        : selectedCandidate === null
            ? []
            : [selectedCandidate];

    if (selectedConnectionId === null && candidates.length > 1) {
        return {
            ok: true,
            value: {
                outcome: "selection_required",
                connection: await inTx((tx) => projectCurrentTeamIdentityConnectionV1InTx(tx, {
                    env: input.env,
                    teamId: input.teamId,
                    connection: preflight.value.connection,
                })),
                candidates,
            },
        };
    }
    if (candidates.length === 0) {
        const observed = await inTx(async (tx) => {
            const current = await preflightWorkosConnectionInTx(tx, input);
            if (!current.ok) return current;

            // Once selected, the WorkOS connection is part of the immutable provider
            // namespace. Upstream disappearance is repair state, never permission to
            // reinterpret existing AccountIdentity rows under a different connection.
            const expectedRevision = input.expectedRevision;
            const externalReference = current.value.connection.externalReference;
            const result = await recordTeamIdentityConnectionWorkosObservationInTx(tx, {
                id: input.connectionId,
                teamId: input.teamId,
                expectedRevision,
                presentation: externalReference.connectionId === null
                    ? null
                    : {
                        displayName: current.value.connection.lastObservation?.kind === "workos_sso"
                            ? current.value.connection.lastObservation.presentation?.displayName
                                ?? externalReference.connectionId
                            : externalReference.connectionId,
                        strategy: current.value.connection.lastObservation?.kind === "workos_sso"
                            ? current.value.connection.lastObservation.presentation?.strategy ?? "unknown"
                            : "unknown",
                        status: "missing",
                        lastCheckedAt: (dependencies.now ?? (() => new Date()))(),
                    },
            });
            if (result.status === "applied") {
                await publishTeamChangedInTx(tx, { teamId: input.teamId });
            }
            return result.status === "applied"
                ? { ok: true as const, value: await projectCurrentTeamIdentityConnectionV1InTx(tx, { env: input.env, teamId: input.teamId, connection: result.connection }) }
                : { ok: false as const, error: mapConnectionMutationError(result.status) };
        });
        return observed.ok
            ? {
                ok: true,
                value: {
                    outcome: preflight.value.connection.externalReference.connectionId === null
                        ? "setting_up" as const
                        : "needs_attention" as const,
                    connection: observed.value,
                },
            }
            : observed;
    }

    const now = (dependencies.now ?? (() => new Date()))();
    const recorded = await inTx(async (tx) => {
        const current = await preflightWorkosConnectionInTx(tx, input);
        if (!current.ok) return current;
        const result = await recordWorkosCandidateInTx(tx, {
            preflight: current.value,
            candidate: candidates[0]!,
            now,
            env: input.env,
        });
        if (result.ok) await publishTeamChangedInTx(tx, { teamId: input.teamId });
        return result;
    });
    return recorded.ok
        ? {
            ok: true,
            value: {
                outcome: candidates[0]!.status.toLowerCase() === "active"
                    ? "connected"
                    : "needs_attention",
                connection: recorded.value,
            },
        }
        : recorded;
}

export async function setTeamWorkosConnection(
    input: Partial<TeamOperationAuthenticationContext> & Readonly<{
        actorAccountId: string;
        teamId: string;
        connectionId: string;
        expectedRevision: number;
        workosConnectionId: string;
        env: NodeJS.ProcessEnv;
    }>,
    dependencies: WorkosAdministrationDependencies = {},
): Promise<Result<TeamIdentityConnectionV1>> {
    const preflight = await inTx((tx) => preflightWorkosConnectionInTx(tx, input));
    if (!preflight.ok) return preflight;
    const organizationId = preflight.value.connection.externalReference.organizationId;
    if (organizationId === null) return { ok: false, error: "identity_connection_invalid" };
    const platform = resolvePlatform(input.env, dependencies);
    if (!platform) return { ok: false, error: "workos_platform_unavailable" };
    let candidate;
    try {
        candidate = await createWorkosAdministrationAdapter(platform.client).getSsoConnection({
            organizationId,
            connectionId: input.workosConnectionId,
        });
    } catch (error) {
        return { ok: false, error: mapWorkosError(error) };
    }
    if (candidate.status.toLowerCase() !== "active") {
        return { ok: false, error: "workos_connection_mismatch" };
    }
    const now = (dependencies.now ?? (() => new Date()))();
    return await inTx(async (tx) => {
        const current = await preflightWorkosConnectionInTx(tx, input);
        if (!current.ok) return current;
        const result = await recordWorkosCandidateInTx(tx, {
            preflight: current.value,
            candidate,
            now,
            env: input.env,
        });
        if (result.ok) await publishTeamChangedInTx(tx, { teamId: input.teamId });
        return result;
    });
}
