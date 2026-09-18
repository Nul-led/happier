import type { ManagedIdentityProviderKindV1 } from "@happier-dev/protocol";

import {
    readHomeGovernancePolicyInTx,
    resolveTeamProviderKindPolicy,
} from "@/app/home/governance/governancePolicy";
import type { Tx } from "@/storage/inTx";
import { isServerFeatureEnabledForRequest } from "@/app/features/catalog/serverFeatureGate";

import type { TeamDirectoryBindingConfigV1 } from "./directorySourceBinding";

export type DirectorySourceCompletedEvidence = Readonly<{
    kind: TeamDirectoryBindingConfigV1["kind"];
    state: "initializing" | "active" | "paused" | "needs_attention";
    activeReconcileRunId: string | null;
}>;

/**
 * The sole structural readiness predicate for directory projection evidence.
 *
 * A run token means the visible rows belong to an incomplete observation even
 * when the source previously had a successful projection. A failed attempt is
 * kept non-active by the reconciliation owner, so clearing a token alone can
 * never make its partial rows authoritative.
 */
export function isDirectorySourceProjectionComplete(
    source: Pick<DirectorySourceCompletedEvidence, "state" | "activeReconcileRunId">,
): boolean {
    return source.state === "active" && source.activeReconcileRunId === null;
}

/** One canonical directory-source to identity-provider policy mapping. */
export function resolveDirectorySourceProviderKind(
    kind: TeamDirectoryBindingConfigV1["kind"],
): ManagedIdentityProviderKindV1 {
    return kind === "workos_directory" ? "workos_sso" : "github_app_identity";
}

export async function isDirectorySourceKindAllowedInTx(
    tx: Tx,
    kind: TeamDirectoryBindingConfigV1["kind"],
): Promise<boolean> {
    if (!isServerFeatureEnabledForRequest("teams", process.env ?? {})) return false;
    const policy = await readHomeGovernancePolicyInTx(tx);
    const providerKind = resolveDirectorySourceProviderKind(kind);
    return resolveTeamProviderKindPolicy(policy, providerKind) === "allowed";
}

/**
 * Authoritative admission/readiness decision for one source's completed facts.
 * Callers provide the row they read in their current transaction so readiness,
 * current Home policy, and the ensuing native mutation share one snapshot.
 */
export async function isDirectorySourceCompletedEvidenceAllowedInTx(
    tx: Tx,
    source: DirectorySourceCompletedEvidence,
): Promise<boolean> {
    return isDirectorySourceProjectionComplete(source)
        && await isDirectorySourceKindAllowedInTx(tx, source.kind);
}
