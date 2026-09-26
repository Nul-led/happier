import {
    HOME_TEAM_CREATION_POLICY_DEFAULT_V1,
    readHomeAuthenticationPolicyV1,
    readHomeIdentityNetworkPolicyV1,
    readHomeTeamProviderPolicyV1,
    readTeamCreationPolicyV1,
    type HomeAuthenticationPolicyReadV1,
    type HomeAuthenticationPolicyV1,
    type HomeGovernancePolicySetInputV1,
    type HomeIdentityNetworkPolicyReadV1,
    type HomeTeamProviderPolicyReadV1,
    type ManagedIdentityProviderKindV1,
    type TeamCreationPolicyV1,
} from "@happier-dev/protocol";

import { db, isPrismaErrorCode } from "@/storage/db";
import { resolveEffectiveHomeAuthMethodsInTx } from "@/app/auth/methods/effectiveHomeAuthMethods";
import { checkHomeAuthenticationPolicyRetainsLoginRoutesInTx } from "@/app/auth/methods/effectiveAccountLoginMethods";
import { isAuthEmailDeliveryReady } from "@/app/auth/email/resolveAuthEmailDelivery";
import { validateManagedIdentityNetworkPolicyForSave } from "@/app/auth/providers/managed/managedIdentityNetworkPolicyValidation";
import { isHomeTeamProviderPolicyWithinDeploymentCeiling } from "@/app/auth/providers/teamProviderDeploymentCeiling";
import { getActivePrismaRuntime } from "@/storage/prisma";
import { inTx, type Tx } from "@/storage/inTx";

import { authorizeHomeGovernanceMutationInTx } from "./homeCapabilities";
import { publishHomeGovernanceChangedInTx } from "./governanceChanges";

/**
 * The Home database holds exactly one governance policy. There is no separate
 * Home row to key it by, so the identity is this constant.
 */
export const HOME_GOVERNANCE_POLICY_ID = "home";

export type HomeGovernancePolicyRecord = Readonly<{
    /** `0` while no row exists; the first persisted revision is `1`. */
    revision: number;
    teamCreationPolicy: TeamCreationPolicyV1;
    authentication: HomeAuthenticationPolicyReadV1;
    teamProviders: HomeTeamProviderPolicyReadV1;
    identityNetwork: HomeIdentityNetworkPolicyReadV1;
}>;

type HomeGovernancePolicyRow = Readonly<{
    revision: number;
    teamCreationPolicy: string;
    authenticationPolicy: unknown;
    teamProviderPolicy: unknown;
    identityNetworkPolicy: unknown;
}>;

const DEPLOYMENT_DEFAULT_POLICY: HomeGovernancePolicyRecord = Object.freeze({
    revision: 0,
    teamCreationPolicy: HOME_TEAM_CREATION_POLICY_DEFAULT_V1,
    authentication: Object.freeze({ status: "inherited" as const }),
    teamProviders: Object.freeze({ status: "inherited" as const }),
    identityNetwork: Object.freeze({ status: "inherited" as const }),
});

function projectPolicyRow(row: HomeGovernancePolicyRow | null): HomeGovernancePolicyRecord {
    if (!row) return DEPLOYMENT_DEFAULT_POLICY;
    return Object.freeze({
        revision: row.revision,
        teamCreationPolicy: readTeamCreationPolicyV1(row.teamCreationPolicy),
        authentication: readHomeAuthenticationPolicyV1(row.authenticationPolicy),
        teamProviders: readHomeTeamProviderPolicyV1(row.teamProviderPolicy),
        identityNetwork: readHomeIdentityNetworkPolicyV1(row.identityNetworkPolicy),
    });
}

async function findPolicyRowInTx(tx: Tx): Promise<HomeGovernancePolicyRow | null> {
    return await tx.homeGovernancePolicy.findUnique({
        where: { id: HOME_GOVERNANCE_POLICY_ID },
        select: {
            revision: true,
            teamCreationPolicy: true,
            authenticationPolicy: true,
            teamProviderPolicy: true,
            identityNetworkPolicy: true,
        },
    });
}

/**
 * Reads the Home policy. An absent row is the deployment default, so ordinary
 * reads never write; only a mutation or bootstrap creates the row.
 */
export async function readHomeGovernancePolicyInTx(tx: Tx): Promise<HomeGovernancePolicyRecord> {
    return projectPolicyRow(await findPolicyRowInTx(tx));
}

export async function readHomeGovernancePolicy(): Promise<HomeGovernancePolicyRecord> {
    const row = await db.homeGovernancePolicy.findUnique({
        where: { id: HOME_GOVERNANCE_POLICY_ID },
        select: {
            revision: true,
            teamCreationPolicy: true,
            authenticationPolicy: true,
            teamProviderPolicy: true,
            identityNetworkPolicy: true,
        },
    });
    return projectPolicyRow(row);
}

export function resolveTeamProviderKindPolicy(
    policy: HomeGovernancePolicyRecord,
    kind: ManagedIdentityProviderKindV1,
): "allowed" | "prohibited" | "unavailable" {
    if (policy.teamProviders.status === "unreadable") return "unavailable";
    // An absent policy inherits the deployment ceiling (teams-lane-01/02 :230,
    // :234): the Home adds no narrowing of its own. Whether the deployment can
    // run a kind is Lane 03's `resolveTeamProviderKindDeploymentAvailability`,
    // which every setup choice and managed runtime already enforces on top of
    // this answer. Team JIT and approved GHES origins stay off under
    // inheritance because each requires an explicit Home allowance.
    if (policy.teamProviders.status === "inherited") return "allowed";
    return policy.teamProviders.policy.allowedTeamProviderKinds.includes(kind)
        ? "allowed"
        : "prohibited";
}

export type HomeGovernancePolicySetResult =
    | Readonly<{ status: "applied"; policy: HomeGovernancePolicyRecord }>
    | Readonly<{ status: "revision_conflict"; policy: HomeGovernancePolicyRecord }>
    | Readonly<{ status: "forbidden" }>
    | Readonly<{ status: "invalid_policy" }>;

class HomeGovernancePolicyCreateConflictError extends Error {
    constructor() {
        super("Home governance policy was created concurrently");
        this.name = "HomeGovernancePolicyCreateConflictError";
    }
}

/**
 * Lets compositions that include the singleton's first write leave the failed
 * transaction before retrying their complete atomic operation.
 */
export function isHomeGovernancePolicyCreateConflictError(
    error: unknown,
): boolean {
    return error instanceof HomeGovernancePolicyCreateConflictError;
}

/**
 * Applies the singleton policy mutation and its invalidation atomically.
 *
 * A first-writer uniqueness race must leave the failed database transaction
 * before it is translated into the normal CAS conflict. PostgreSQL marks a
 * transaction failed after the unique violation, so querying from the catch
 * block inside that transaction would mask the intended conflict with a
 * transaction-aborted error. The settlement attempt starts a fresh transaction,
 * reauthorizes the actor, and observes the winning revision through the same
 * canonical owner.
 */
export async function setHomeGovernancePolicy(input: Readonly<{
    actorAccountId: string;
    patch: HomeGovernancePolicySetInputV1;
    env: NodeJS.ProcessEnv;
}>): Promise<HomeGovernancePolicySetResult> {
    const attempt = async () => await inTx(async (tx) => {
        const result = await setHomeGovernancePolicyInTx(tx, input);
        if (result.status === "applied") {
            const minimumEligibilityMayChange = input.patch.teamCreationPolicy !== undefined
                || input.patch.authenticationPolicy !== undefined;
            await publishHomeGovernanceChangedInTx(tx, {
                audience: minimumEligibilityMayChange ? "all_active_accounts" : "administrators",
            });
        }
        return result;
    }, { isolationLevel: "Serializable" });

    try {
        return await attempt();
    } catch (error) {
        if (!isHomeGovernancePolicyCreateConflictError(error)) throw error;
        return await attempt();
    }
}

/**
 * Whether this Home could still be used under the prospective narrowing.
 *
 * Usability is a route question, not an Account-mode question: the deployment's
 * permitted Account modes decide which Accounts may be *constructed*, while an
 * Account that already exists keeps its stored mode and its login. A narrowing
 * is refused only when it leaves no enabled login or provision action at all,
 * names a method this deployment does not have, removes every provisioning
 * mode, or — through the auth-domain stranding owner — takes away the last
 * current login route of an Account that has one.
 */
async function isProspectiveAuthenticationPolicyValidInTx(
    tx: Tx,
    policy: HomeAuthenticationPolicyV1 | null,
    env: NodeJS.ProcessEnv,
): Promise<boolean> {
    const current = await resolveEffectiveHomeAuthMethodsInTx(tx, {
        env,
        emailDeliveryReady: await isAuthEmailDeliveryReady(env),
    });
    const prospective = policy === null
        ? { status: "inherited" as const }
        : { status: "narrowed" as const, policy };
    const effective = await resolveEffectiveHomeAuthMethodsInTx(tx, {
        env,
        homeAuthenticationPolicyOverride: prospective,
        emailDeliveryReady: await isAuthEmailDeliveryReady(env),
    });
    if (effective.status !== "ready") return false;

    if (policy?.enabledMethodIds) {
        const knownIds = new Set(effective.decisions.map((decision) => decision.id));
        if (policy.enabledMethodIds.some((id) => !knownIds.has(id))) return false;
    }
    if (!effective.decisions.some((decision) => decision.allowedProvisionModes.length > 0)) return false;
    if (policy?.recommendedProvisioningMode
        && !effective.decisions.some((decision) =>
            decision.allowedProvisionModes.includes(policy.recommendedProvisioningMode!))) return false;
    if (!effective.decisions.some((decision) => decision.actions.some((action) =>
        action.enabled && (action.id === "login" || action.id === "provision")))) return false;

    const loginStranding = await checkHomeAuthenticationPolicyRetainsLoginRoutesInTx(tx, {
        env,
        currentDecisions: current.status === "ready" ? current.decisions : [],
        prospectiveDecisions: effective.decisions,
    });
    if (!loginStranding.ok) return false;

    return true;
}

/**
 * Applies one partial policy patch under compare-and-set on `revision`.
 *
 * Every changed field is authorized before any field is written, so a patch
 * that mixes an authorized and an unauthorized field changes nothing. A stale
 * expected revision is reported with the current policy so the editor can
 * reload and reapply instead of silently overwriting another administrator.
 */
export async function setHomeGovernancePolicyInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        patch: HomeGovernancePolicySetInputV1;
        env: NodeJS.ProcessEnv;
    }>,
): Promise<HomeGovernancePolicySetResult> {
    const operations = new Set<"set_team_creation_policy" | "set_authentication_policy">();
    if (input.patch.teamCreationPolicy !== undefined) operations.add("set_team_creation_policy");
    if (input.patch.authenticationPolicy !== undefined
        || input.patch.teamProviderPolicy !== undefined
        || input.patch.identityNetworkPolicy !== undefined) operations.add("set_authentication_policy");
    for (const operation of operations) {
        const authorization = await authorizeHomeGovernanceMutationInTx(tx, {
            actorAccountId: input.actorAccountId,
            request: { operation },
        });
        if (authorization.status === "rejected") return { status: "forbidden" };
    }

    const current = await findPolicyRowInTx(tx);
    const currentRevision = current?.revision ?? 0;
    if (input.patch.expectedRevision !== currentRevision) {
        return { status: "revision_conflict", policy: projectPolicyRow(current) };
    }

    // The strict codec proves shape; Lane 03's deployment ceiling decides which
    // provider kinds a save may add. A fresh (inherited) or unreadable Home can
    // therefore save its first narrowing, and clearing back to inheritance is
    // always a recoverable write.
    if (input.patch.teamProviderPolicy !== undefined
        && !isHomeTeamProviderPolicyWithinDeploymentCeiling({
            env: input.env,
            current: projectPolicyRow(current).teamProviders,
            next: input.patch.teamProviderPolicy,
        })) {
        return { status: "invalid_policy" };
    }

    if (input.patch.authenticationPolicy !== undefined
        && !await isProspectiveAuthenticationPolicyValidInTx(
            tx,
            input.patch.authenticationPolicy,
            input.env,
        )) return { status: "invalid_policy" };

    if (input.patch.identityNetworkPolicy !== undefined
        && input.patch.identityNetworkPolicy !== null
        && validateManagedIdentityNetworkPolicyForSave({
            env: input.env,
            policy: input.patch.identityNetworkPolicy,
        }).status === "invalid") return { status: "invalid_policy" };

    const authenticationPolicyWrite = input.patch.authenticationPolicy === undefined
        ? {}
        : {
            authenticationPolicy: input.patch.authenticationPolicy === null
                ? getActivePrismaRuntime().DbNull
                : input.patch.authenticationPolicy,
        };
    const teamProviderPolicyWrite = input.patch.teamProviderPolicy === undefined
        ? {}
        : {
            teamProviderPolicy: input.patch.teamProviderPolicy === null
                ? getActivePrismaRuntime().DbNull
                : input.patch.teamProviderPolicy,
        };
    const identityNetworkPolicyWrite = input.patch.identityNetworkPolicy === undefined
        ? {}
        : {
            identityNetworkPolicy: input.patch.identityNetworkPolicy === null
                ? getActivePrismaRuntime().DbNull
                : input.patch.identityNetworkPolicy,
        };

    if (!current) {
        try {
            await tx.homeGovernancePolicy.create({
                data: {
                    id: HOME_GOVERNANCE_POLICY_ID,
                    revision: 1,
                    ...(input.patch.teamCreationPolicy ? { teamCreationPolicy: input.patch.teamCreationPolicy } : {}),
                    ...authenticationPolicyWrite,
                    ...teamProviderPolicyWrite,
                    ...identityNetworkPolicyWrite,
                },
                select: { id: true },
            });
        } catch (error) {
            if (isPrismaErrorCode(error, "P2002")) {
                throw new HomeGovernancePolicyCreateConflictError();
            }
            throw error;
        }
        return { status: "applied", policy: projectPolicyRow(await findPolicyRowInTx(tx)) };
    }

    const applied = await tx.homeGovernancePolicy.updateMany({
        where: { id: HOME_GOVERNANCE_POLICY_ID, revision: currentRevision },
        data: {
            revision: currentRevision + 1,
            ...(input.patch.teamCreationPolicy ? { teamCreationPolicy: input.patch.teamCreationPolicy } : {}),
            ...authenticationPolicyWrite,
            ...teamProviderPolicyWrite,
            ...identityNetworkPolicyWrite,
        },
    });
    if (applied.count === 0) {
        return { status: "revision_conflict", policy: projectPolicyRow(await findPolicyRowInTx(tx)) };
    }
    return { status: "applied", policy: projectPolicyRow(await findPolicyRowInTx(tx)) };
}
