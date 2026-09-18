import {
    decodeKeysetCursorV1,
    encodeKeysetCursorV1,
    HOME_ACCOUNT_PAGE_LIMIT_DEFAULT_V1,
    isActiveHomeAccountStatus,
    normalizeVerifiedEmail,
    readKeysetCursorIdV1,
    readKeysetCursorTimeV1,
    type HomeAccountListResultV1,
    type HomeAccountPickerRowV1,
    type HomeAccountRowV1,
    type HomeAccountSearchScopeV1,
    type HomeAuthenticationPolicyProjectionV1,
    type HomeAuthenticationOptionsV1,
    type HomeAuthenticationPolicyReadV1,
    type HomeGovernancePolicyProjectionV1,
    type HomeGovernanceProjectionV1,
    type HomeGovernanceEligibilityV1,
    type HomeIdentityDeploymentServicesV1,
    type HomeRoleV1,
} from "@happier-dev/protocol";

import { deploymentAllowsPrivateIdentityNetwork } from "@/app/auth/providers/managed/managedIdentityNetworkPolicy";
import { resolveEffectiveHomeAuthMethodsInTx } from "@/app/auth/methods/effectiveHomeAuthMethods";
import {
    readAccountAdministrationAuthenticationByIdInTx,
    type AccountAdministrationAuthenticationProjection,
} from "@/app/auth/methods/effectiveAccountLoginMethods";
import { resolveAllowedAccountProvisionModes, resolveRecommendedAccountProvisionMode } from "@/app/auth/methods/accountProvisionModes";
import { isAuthEmailDeliveryReady } from "@/app/auth/email/resolveAuthEmailDelivery";
import { resolveWorkosPlatformRuntimeMetadata } from "@/app/integrations/workos/workosPlatform";
import { buildAccountTextPrefixFilter } from "@/app/account/accountTextPrefixFilter";
import {
    ACCOUNT_DISPLAY_PROFILE_SELECT,
    projectAccountDisplayProfileV1,
    type AccountDisplayProfileRow,
} from "@/app/account/profile/accountDisplayProfile";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { resolveTeamMembershipCapabilities } from "@/app/teams/memberships/capabilities";
import {
    assertTeamOwnershipAllowsAccountErasureInTx,
    readTeamOwnershipErasureDecisionsInTx,
} from "@/app/teams/memberships/erasurePrecondition";
import type { Tx } from "@/storage/inTx";
import { getDbProviderFromEnv } from "@/storage/prisma";

import { publishHomeGovernanceChangedInTx } from "./governanceChanges";
import { readHomeGovernancePolicyInTx, type HomeGovernancePolicyRecord } from "./governancePolicy";
import {
    assertHomeOwnershipSurvivesTransitionInTx,
    authorizeHomeGovernanceMutationInTx,
    countActiveHomeOwnersInTx,
    readHomeGovernanceAccountInTx,
    resolveHomeAccountMutationCapabilitiesV1,
    resolveHomeCapabilitiesV1,
    resolveHomeGovernanceAuthority,
} from "./homeCapabilities";

/** Every rejection these services can produce, as the wire already names them. */
export type HomeGovernanceRejectionCode =
    | "home_governance_forbidden"
    | "home_governance_setup_required"
    | "home_account_not_found"
    | "home_account_inactive"
    | "home_owner_transfer_required"
    | "invalid_home_cursor";

export type HomeGovernanceResult<T> =
    | Readonly<{ status: "ok"; result: T }>
    | Readonly<{ status: "rejected"; code: HomeGovernanceRejectionCode }>;

/**
 * Flattens the stored authentication narrowing for the administration surface.
 *
 * An absent optional field becomes an explicit `null` rather than being omitted:
 * the form must be able to distinguish "this Home does not narrow methods" from
 * "this Home narrows methods to none", and `unreadable` must stay visible as an
 * actionable configuration problem instead of collapsing into `inherited`.
 */
function projectHomeAuthenticationPolicyV1(
    read: HomeAuthenticationPolicyReadV1,
): HomeAuthenticationPolicyProjectionV1 {
    if (read.status !== "narrowed") return { status: read.status };
    return {
        status: "narrowed",
        enabledMethodIds: read.policy.enabledMethodIds ?? null,
        permittedAccountModes: read.policy.permittedAccountModes ?? null,
        recommendedProvisioningMode: read.policy.recommendedProvisioningMode ?? null,
        admission: read.policy.admission ?? null,
        signInServiceDisabled: read.policy.signInService?.mode === "disabled",
    };
}

/**
 * Projects the stored policy record onto the wire. Lane 03's provider and
 * network ceilings pass through their own canonical codecs unchanged; this
 * surface renders them and never reinterprets their semantics.
 */
export function projectHomeGovernancePolicyV1(
    record: HomeGovernancePolicyRecord,
): HomeGovernancePolicyProjectionV1 {
    return {
        revision: record.revision,
        teamCreationPolicy: record.teamCreationPolicy,
        authentication: projectHomeAuthenticationPolicyV1(record.authentication),
        teamProviders: record.teamProviders,
        identityNetwork: record.identityNetwork,
    };
}

/**
 * The deployment's identity-service ceiling as an administration fact.
 *
 * Both answers come from the owners that already enforce them — the WorkOS
 * platform metadata resolver and the managed identity network policy — so the
 * surface cannot drift from the runtime. Only the resulting capability travels;
 * credentials, hosts and environment variable names stay on the server.
 */
function projectHomeIdentityDeploymentServicesV1(
    env: NodeJS.ProcessEnv,
): HomeIdentityDeploymentServicesV1 {
    const workos = resolveWorkosPlatformRuntimeMetadata(env);
    return {
        workos: workos.available
            ? "configured"
            : workos.reason === "partial_configuration"
                ? "partially_configured"
                : "not_configured",
        privateIdentityNetworkAllowed: deploymentAllowsPrivateIdentityNetwork(env),
    };
}

async function projectHomeAuthenticationOptionsV1(
    tx: Tx,
    env: NodeJS.ProcessEnv,
): Promise<HomeAuthenticationOptionsV1> {
    // The deployment decision defines which choices an administrator may save;
    // the persisted-Home decision supplies their current action state. Both are
    // projections of the same canonical resolver, never parallel availability
    // formulas. Keeping disabled Home choices in the list is what lets an
    // administrator repair or re-enable them.
    const deployment = await resolveEffectiveHomeAuthMethodsInTx(tx, {
        env,
        homeAuthenticationPolicyOverride: { status: "inherited" },
        emailDeliveryReady: isAuthEmailDeliveryReady(env),
    });
    const effective = await resolveEffectiveHomeAuthMethodsInTx(tx, {
        env,
        emailDeliveryReady: isAuthEmailDeliveryReady(env),
    });
    const permittedAccountModes = [...resolveAllowedAccountProvisionModes(env)];
    const recommendedProvisioningMode = resolveRecommendedAccountProvisionMode(env);
    if (deployment.status !== "ready" || effective.status !== "ready") {
        return {
            methods: [],
            permittedAccountModes,
            recommendedProvisioningMode,
            signInService: { deploymentMode: null, canDisable: false },
        };
    }
    const effectiveById = new Map(effective.decisions.map((decision) => [decision.id, decision]));
    return {
        methods: deployment.decisions.flatMap((decision) => {
            const viable = decision.actions.some((action) =>
                action.enabled && (action.id === "login" || action.id === "provision"));
            if (!viable) return [];
            const current = effectiveById.get(decision.id) ?? decision;
            return [{
                id: decision.id,
                actions: current.actions.map(({ id, enabled, mode, reason }) => ({
                    id,
                    enabled,
                    mode,
                    ...(reason ? { reason } : {}),
                })),
                ...(decision.ui?.displayName ? { displayName: decision.ui.displayName } : {}),
                ...(decision.ui?.iconHint !== undefined ? { iconHint: decision.ui.iconHint } : {}),
            }];
        }),
        permittedAccountModes,
        recommendedProvisioningMode,
        signInService: {
            deploymentMode: deployment.signInService?.mode ?? null,
            canDisable: deployment.signInService !== null && deployment.signInService.mode !== "disabled",
        },
    };
}

/**
 * The Home Administration snapshot for one viewer of one explicit Home.
 *
 * Only a current administrator may read it. Ordinary members use the separate
 * minimum eligibility projection, so policy and deployment facts never cross
 * this boundary and depend on client-side filtering for privacy.
 */
export async function readHomeGovernanceProjectionInTx(tx: Tx, input: Readonly<{
    viewerAccountId: string;
    teamsEnabled: boolean;
    env: NodeJS.ProcessEnv;
}>): Promise<HomeGovernanceResult<HomeGovernanceProjectionV1>> {
    // Ownerless Homes are a deployment-recovery state, not an authorization
    // opportunity. Return only the typed setup signal before reading policy,
    // provider/network configuration, or any other administration fact.
    const activeOwnerCount = await countActiveHomeOwnersInTx(tx);
    if (activeOwnerCount === 0) {
        return { status: "rejected", code: "home_governance_setup_required" };
    }
    const authorization = await authorizeHomeGovernanceMutationInTx(tx, {
        actorAccountId: input.viewerAccountId,
        request: { operation: "view" },
    });
    if (authorization.status === "rejected") return authorization;
    const viewer = await readHomeGovernanceAccountInTx(tx, input.viewerAccountId);
    if (!viewer) return { status: "rejected", code: "home_account_not_found" };
    const policy = await readHomeGovernancePolicyInTx(tx);
    const authenticationOptions = await projectHomeAuthenticationOptionsV1(tx, input.env);
    return { status: "ok", result: {
        identityServices: projectHomeIdentityDeploymentServicesV1(input.env),
        viewer: { accountId: viewer.accountId, homeRole: viewer.homeRole, status: viewer.status },
        capabilities: resolveHomeCapabilitiesV1({
            account: viewer,
            teamCreationPolicy: policy.teamCreationPolicy,
            teamsEnabled: input.teamsEnabled,
        }),
        policy: projectHomeGovernancePolicyV1(policy),
        setupState: "owned",
        activeOwnerCount,
        teamsEnabled: input.teamsEnabled,
        authenticationOptions,
    } };
}

/**
 * Projects only the two effective Team eligibility facts ordinary members
 * consume. Policy, role, deployment-service, and owner-count facts never enter
 * this result, so transport serialization is not relied on for nondisclosure.
 */
export async function readHomeGovernanceEligibilityInTx(tx: Tx, input: Readonly<{
    viewerAccountId: string;
    teamsEnabled: boolean;
}>): Promise<HomeGovernanceEligibilityV1 | null> {
    const viewer = await readHomeGovernanceAccountInTx(tx, input.viewerAccountId);
    if (!viewer) return null;
    const policy = await readHomeGovernancePolicyInTx(tx);
    return {
        teamsEnabled: input.teamsEnabled,
        createTeam: resolveHomeCapabilitiesV1({
            account: viewer,
            teamCreationPolicy: policy.teamCreationPolicy,
            teamsEnabled: input.teamsEnabled,
        }).createTeam,
    };
}

type HomeAccountRow = AccountDisplayProfileRow & Readonly<{
    homeRole: HomeRoleV1;
    status: HomeAccountRowV1["status"];
    createdAt: Date;
}>;

const HOME_ACCOUNT_ROW_SELECT = {
    ...ACCOUNT_DISPLAY_PROFILE_SELECT,
    homeRole: true,
    status: true,
    createdAt: true,
} as const;

function projectHomeAccountRowV1(row: HomeAccountRow, input: Readonly<{
    actor: NonNullable<Awaited<ReturnType<typeof readHomeGovernanceAccountInTx>>>;
    activeOwnerCount: number;
    teamOwnershipAllowsErasure: boolean;
    authentication: AccountAdministrationAuthenticationProjection;
}>): HomeAccountRowV1 {
    return {
        accountId: row.id,
        homeRole: row.homeRole,
        status: row.status,
        profile: projectAccountDisplayProfileV1(row),
        createdAt: row.createdAt.getTime(),
        authentication: {
            signInEmail: input.authentication.signInEmail,
            usableMethodIds: [...input.authentication.usableMethodIds],
        },
        mutationCapabilities: resolveHomeAccountMutationCapabilitiesV1({
            actor: input.actor,
            target: { accountId: row.id, homeRole: row.homeRole, status: row.status },
            activeOwnerCount: input.activeOwnerCount,
            teamOwnershipAllowsErasure: input.teamOwnershipAllowsErasure,
        }),
    };
}

async function projectHomeAccountRowForViewerInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    actor?: NonNullable<Awaited<ReturnType<typeof readHomeGovernanceAccountInTx>>>;
    activeOwnerCount?: number;
    teamOwnershipAllowsErasure?: boolean;
    authentication?: AccountAdministrationAuthenticationProjection;
    env: NodeJS.ProcessEnv;
    row: HomeAccountRow;
}>): Promise<HomeAccountRowV1 | null> {
    const actor = input.actor ?? await readHomeGovernanceAccountInTx(tx, input.actorAccountId);
    if (!actor) return null;
    const activeOwnerCount = input.activeOwnerCount ?? await countActiveHomeOwnersInTx(tx);
    const teamOwnershipAllowsErasure = input.teamOwnershipAllowsErasure
        ?? (resolveHomeGovernanceAuthority(actor).eraseAccounts
            && (await assertTeamOwnershipAllowsAccountErasureInTx(tx, { accountId: input.row.id })).status === "ok");
    const authentication = input.authentication ?? (await readHomeAccountAuthenticationByIdInTx(tx, {
        accountIds: [input.row.id],
        env: input.env,
    })).get(input.row.id) ?? { signInEmail: null, usableMethodIds: [] };
    return projectHomeAccountRowV1(input.row, {
        actor,
        activeOwnerCount,
        teamOwnershipAllowsErasure,
        authentication,
    });
}

async function readHomeAccountAuthenticationByIdInTx(
    tx: Tx,
    input: Readonly<{ accountIds: readonly string[]; env: NodeJS.ProcessEnv }>,
): Promise<ReadonlyMap<string, AccountAdministrationAuthenticationProjection>> {
    const effective = await resolveEffectiveHomeAuthMethodsInTx(tx, {
        env: input.env,
        emailDeliveryReady: isAuthEmailDeliveryReady(input.env),
    });
    return await readAccountAdministrationAuthenticationByIdInTx(tx, {
        accountIds: input.accountIds,
        env: input.env,
        decisions: effective.status === "ready" ? effective.decisions : [],
    });
}

const HOME_ACCOUNT_CURSOR_QUERY_V1 = "home-accounts:v1";
type HomeAccountCursor = Readonly<{ createdAt: number; id: string }>;

function encodeHomeAccountCursor(cursor: HomeAccountCursor): string {
    return encodeKeysetCursorV1({
        queryKey: HOME_ACCOUNT_CURSOR_QUERY_V1,
        parts: [cursor.createdAt, cursor.id],
    });
}

function decodeHomeAccountCursor(cursor: string): HomeAccountCursor | null {
    const decoded = decodeKeysetCursorV1(cursor, HOME_ACCOUNT_CURSOR_QUERY_V1);
    if (decoded.status !== "ok") return null;
    const createdAt = readKeysetCursorTimeV1(decoded.parts[0]);
    const id = readKeysetCursorIdV1(decoded.parts[1]);
    return createdAt === null || id === null ? null : { createdAt, id };
}

/**
 * The administrator People page.
 *
 * The keyset is `(createdAt, id)` so a page stays stable while Accounts are
 * created or administered. A malformed or foreign cursor is rejected rather
 * than silently restarting and duplicating rows already rendered by the client.
 */
export async function listHomeAccountsInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    env: NodeJS.ProcessEnv;
    cursor?: string | null;
    limit?: number;
}>): Promise<HomeGovernanceResult<HomeAccountListResultV1>> {
    const actor = await readHomeGovernanceAccountInTx(tx, input.actorAccountId);
    const actorAuthority = resolveHomeGovernanceAuthority(actor);
    if (!actor || !actorAuthority.manageAccounts) {
        return { status: "rejected", code: "home_governance_forbidden" };
    }

    const limit = input.limit ?? HOME_ACCOUNT_PAGE_LIMIT_DEFAULT_V1;
    const after = input.cursor ? decodeHomeAccountCursor(input.cursor) : null;
    if (input.cursor && !after) return { status: "rejected", code: "invalid_home_cursor" };
    const rows: readonly HomeAccountRow[] = await tx.account.findMany({
        ...(after
            ? {
                where: {
                    OR: [
                        { createdAt: { gt: new Date(after.createdAt) } },
                        { createdAt: new Date(after.createdAt), id: { gt: after.id } },
                    ],
                },
            }
            : {}),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        select: HOME_ACCOUNT_ROW_SELECT,
    });

    const page = rows.slice(0, limit);
    const last = page.length === limit ? page[page.length - 1] : undefined;
    const activeOwnerCount = await countActiveHomeOwnersInTx(tx);
    const teamOwnership = actorAuthority.eraseAccounts
        ? await readTeamOwnershipErasureDecisionsInTx(tx, { accountIds: page.map((row) => row.id) })
        : null;
    const authenticationByAccountId = await readHomeAccountAuthenticationByIdInTx(tx, {
        accountIds: page.map((row) => row.id),
        env: input.env,
    });
    return {
        status: "ok",
        result: {
            items: await Promise.all(page.map(async (row) => {
                const projected = await projectHomeAccountRowForViewerInTx(tx, {
                    actorAccountId: input.actorAccountId,
                    actor,
                    activeOwnerCount,
                    teamOwnershipAllowsErasure: teamOwnership?.get(row.id)?.status === "ok",
                    authentication: authenticationByAccountId.get(row.id)
                        ?? { signInEmail: null, usableMethodIds: [] },
                    env: input.env,
                    row,
                });
                if (!projected) throw new Error("home_governance_actor_disappeared_in_transaction");
                return projected;
            })),
            nextCursor: rows.length > limit && last
                ? encodeHomeAccountCursor({ createdAt: last.createdAt.getTime(), id: last.id })
                : null,
        },
    };
}

/**
 * Resolves the actor's current management authority over one exact Team.
 *
 * Team scope is authorized by that Team's own membership, through Lane 04's
 * capability owner, so managing one Team can never enumerate another Team or
 * the Home People projection.
 */
async function actorManagesTeamInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    teamId: string;
}>): Promise<boolean> {
    const membership = await tx.teamMembership.findFirst({
        where: { teamId: input.teamId, accountId: input.actorAccountId },
        select: {
            role: true,
            status: true,
            account: { select: { status: true } },
            team: { select: { archivedAt: true } },
        },
    });
    if (!membership) return false;
    return resolveTeamMembershipCapabilities({
        role: membership.role,
        membershipStatus: membership.status,
        accountStatus: membership.account.status,
        teamArchivedAt: membership.team.archivedAt,
    }).manageMembers;
}

/**
 * The Account picker behind Home People, Team member add, and initial-owner
 * selection.
 *
 * One query answers three identities the Home already owns, as a union: the
 * exact Account id, the exact verified mailbox (the same `AccountEmail`
 * evidence admission and invitations write, compared only after the shared
 * normalizer canonicalized the typed address), and a case-insensitive
 * username prefix through the directory's existing prefix filter. The page is
 * bounded to the People page size so a one-letter prefix can never enumerate
 * a whole Home in one answer. Nothing here changes who may ask: Home scope
 * still needs `manageAccounts`, and Team scope still needs management of that
 * exact Team.
 */
export async function searchHomeAccountsInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    query: string;
    scope: HomeAccountSearchScopeV1;
    teamsEnabled: boolean;
    env: NodeJS.ProcessEnv;
}>): Promise<HomeGovernanceResult<readonly HomeAccountPickerRowV1[]>> {
    if (input.scope.kind === "home") {
        const actor = await readHomeGovernanceAccountInTx(tx, input.actorAccountId);
        if (!resolveHomeGovernanceAuthority(actor).manageAccounts) {
            return { status: "rejected", code: "home_governance_forbidden" };
        }
    } else {
        if (!input.teamsEnabled) return { status: "rejected", code: "home_governance_forbidden" };
        const manages = await actorManagesTeamInTx(tx, {
            actorAccountId: input.actorAccountId,
            teamId: input.scope.teamId,
        });
        if (!manages) return { status: "rejected", code: "home_governance_forbidden" };
    }

    const query = input.query.trim();
    if (query.length === 0) return { status: "ok", result: [] };
    const mailbox = normalizeVerifiedEmail(query);
    const matches = await tx.account.findMany({
        where: {
            OR: [
                { id: query },
                ...(mailbox ? [{ AccountEmail: { some: { normalizedEmail: mailbox.normalizedEmail } } }] : []),
                { username: buildAccountTextPrefixFilter(query, getDbProviderFromEnv(input.env, "postgres")) },
            ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: HOME_ACCOUNT_PAGE_LIMIT_DEFAULT_V1,
        select: { ...ACCOUNT_DISPLAY_PROFILE_SELECT, status: true },
    });
    if (matches.length === 0) return { status: "ok", result: [] };

    // Eligibility is what the picker's own next mutation will recheck: an
    // active Account, and for Team scope one that is not already a member.
    const existingMembers = input.scope.kind === "team"
        ? new Set((await tx.teamMembership.findMany({
            where: { teamId: input.scope.teamId, accountId: { in: matches.map((match) => match.id) } },
            select: { accountId: true },
        })).map((membership) => membership.accountId))
        : new Set<string>();
    return {
        status: "ok",
        result: matches.map((match) => ({
            accountId: match.id,
            profile: projectAccountDisplayProfileV1(match),
            eligible: isActiveHomeAccountStatus(match.status) && !existingMembers.has(match.id),
        })),
    };
}

export type HomeRoleSetOutcome = Readonly<{ account: HomeAccountRowV1 }>;

/**
 * Changes one Account's Home role.
 *
 * Authority, target state, and the last-active-owner invariant are all read
 * inside the caller's serializable transaction, so a concurrent demotion cannot
 * be raced into a Home with zero active owners. Only an active Account may be
 * given authority: a suspended or retired Account can never be promoted.
 */
export async function setHomeRoleInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    targetAccountId: string;
    homeRole: HomeRoleV1;
    env: NodeJS.ProcessEnv;
}>): Promise<HomeGovernanceResult<HomeRoleSetOutcome>> {
    const admission = await authorizeHomeGovernanceMutationInTx(tx, {
        actorAccountId: input.actorAccountId,
        request: {
            operation: "set_home_role",
            targetAccountId: input.targetAccountId,
            nextHomeRole: input.homeRole,
        },
    });
    if (admission.status === "rejected") return { status: "rejected", code: admission.code };
    const target = admission.target;
    if (!target) return { status: "rejected", code: "home_account_not_found" };

    if (target.homeRole !== input.homeRole) {
        if (input.homeRole !== "member" && !isActiveHomeAccountStatus(target.status)) {
            return { status: "rejected", code: "home_account_inactive" };
        }
        const ownership = await assertHomeOwnershipSurvivesTransitionInTx(tx, {
            targetAccountId: target.accountId,
            nextHomeRole: input.homeRole,
        });
        if (ownership.status === "rejected") return { status: "rejected", code: ownership.code };
        if (ownership.status === "target_not_found") {
            return { status: "rejected", code: "home_account_not_found" };
        }
        await tx.account.update({
            where: { id: target.accountId },
            data: { homeRole: input.homeRole },
        });
        await markAccountChanged(tx, { accountId: target.accountId, kind: "account", entityId: "self" });
        await publishHomeGovernanceChangedInTx(tx, { excludeAccountIds: [target.accountId] });
    }

    const row = await tx.account.findUniqueOrThrow({
        where: { id: target.accountId },
        select: HOME_ACCOUNT_ROW_SELECT,
    });
    const account = await projectHomeAccountRowForViewerInTx(tx, {
        actorAccountId: input.actorAccountId,
        env: input.env,
        row,
    });
    if (!account) return { status: "rejected", code: "home_governance_forbidden" };
    return { status: "ok", result: { account } };
}

/** Reads one Account row with capabilities for the currently authenticated actor. */
export async function readHomeAccountRowInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; accountId: string }>,
): Promise<HomeAccountRowV1 | null> {
    const row = await tx.account.findUnique({ where: { id: input.accountId }, select: HOME_ACCOUNT_ROW_SELECT });
    return row ? await projectHomeAccountRowForViewerInTx(tx, {
        actorAccountId: input.actorAccountId,
        env: process.env,
        row,
    }) : null;
}
