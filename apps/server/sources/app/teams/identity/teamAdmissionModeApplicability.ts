import type { TeamAdmissionModeApplicabilityV1 } from "@happier-dev/protocol/teams";

import { resolveOAuthRuntimeByIdInTx } from "@/app/auth/providers/identityProviderCatalog";
import {
    readHomeGovernancePolicyInTx,
    resolveTeamProviderKindPolicy,
} from "@/app/home/governance/governancePolicy";
import {
    isDirectorySourceCompletedEvidenceAllowedInTx,
    isDirectorySourceProjectionComplete,
    resolveDirectorySourceProviderKind,
} from "@/app/teams/directory/directorySourcePolicy";
import type { Tx } from "@/storage/inTx";

import { listTeamIdentityConnectionsInTx } from "./teamIdentityConnectionLifecycle";

type TeamAdmissionModeApplicabilityInput = Readonly<{
    tx: Tx;
    env: NodeJS.ProcessEnv;
    teamId: string;
}>;

/**
 * Resolves the current server-owned admission choices for one exact Team.
 *
 * The result is intentionally derived inside the caller's transaction. It is
 * an administration projection and mutation guard, not persisted readiness:
 * Home policy, directory run fencing, connection documents, provider state,
 * and executable runtime are all re-read for every operation.
 */
export async function resolveTeamAdmissionModeApplicabilityInTx(
    input: TeamAdmissionModeApplicabilityInput,
): Promise<TeamAdmissionModeApplicabilityV1> {
    const [home, directorySources, rawConnectionCount, connections] = await Promise.all([
        readHomeGovernancePolicyInTx(input.tx),
        input.tx.teamDirectorySource.findMany({
            where: { teamId: input.teamId },
            select: { kind: true, state: true, activeReconcileRunId: true },
        }),
        input.tx.teamIdentityConnection.count({ where: { teamId: input.teamId } }),
        listTeamIdentityConnectionsInTx(input.tx, { teamId: input.teamId }),
    ]);

    const provisioned = await (async (): Promise<TeamAdmissionModeApplicabilityV1["modes"]["provisioned"]> => {
        if (directorySources.length === 0) {
            return { status: "unavailable", reason: "directory_source_required" };
        }
        const completedAllowed = await Promise.all(directorySources.map(async (source) =>
            await isDirectorySourceCompletedEvidenceAllowedInTx(input.tx, source)));
        if (completedAllowed.some(Boolean)) return { status: "available" };

        const providerPolicies = directorySources.map((source) => resolveTeamProviderKindPolicy(
            home,
            resolveDirectorySourceProviderKind(source.kind),
        ));
        if (providerPolicies.some((policy) => policy === "unavailable")) {
            return { status: "unavailable", reason: "home_policy_unavailable" };
        }
        if (providerPolicies.every((policy) => policy === "prohibited")) {
            return { status: "unavailable", reason: "home_policy_prohibited" };
        }
        if (directorySources.some((source) => !isDirectorySourceProjectionComplete(source))) {
            return { status: "unavailable", reason: "directory_projection_required" };
        }
        return { status: "unavailable", reason: "home_policy_prohibited" };
    })();

    const jit = await (async (): Promise<TeamAdmissionModeApplicabilityV1["modes"]["jit"]> => {
        if (home.teamProviders.status !== "narrowed") {
            return { status: "unavailable", reason: "home_policy_unavailable" };
        }
        if (!home.teamProviders.policy.teamJitAllowed) {
            return { status: "unavailable", reason: "home_policy_prohibited" };
        }
        if (rawConnectionCount === 0) {
            return { status: "unavailable", reason: "team_connection_required" };
        }
        if (connections.length === 0) {
            return { status: "unavailable", reason: "team_connection_unavailable" };
        }

        const allowedConnections = connections.filter((connection) =>
            resolveTeamProviderKindPolicy(home, connection.providerKind) === "allowed");
        if (allowedConnections.length === 0) {
            return rawConnectionCount > connections.length
                ? { status: "unavailable", reason: "team_connection_unavailable" }
                : { status: "unavailable", reason: "home_policy_prohibited" };
        }
        const currentRuntimes = await Promise.all(allowedConnections.map(async (connection) => {
            if (!connection.enabled || connection.state !== "connected") return null;
            return await resolveOAuthRuntimeByIdInTx(
                input.tx,
                input.env,
                connection.providerInstanceId,
                { kind: "team", teamId: input.teamId },
                "oauth_start",
            );
        }));
        return currentRuntimes.some((runtime) => runtime !== null)
            ? { status: "available" }
            : { status: "unavailable", reason: "team_connection_unavailable" };
    })();

    return {
        v: 1,
        modes: {
            invite_only: { status: "available" },
            provisioned,
            jit,
        },
    };
}
