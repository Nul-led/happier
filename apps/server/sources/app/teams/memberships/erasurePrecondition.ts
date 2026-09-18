import type { Tx } from "@/storage/inTx";
import { AccountStatus, TeamMembershipStatus, TeamRole } from "@/storage/enums.generated";

/**
 * The one Team-ownership question Account erasure must ask.
 *
 * Erasure is not a Team mutation and must not become a second Team-membership
 * workflow: this child supplies only the predicate, and the existing erasure
 * owner composes it before destructive blob work and again at final deletion.
 */
export type TeamOwnershipErasureDecision =
    | Readonly<{ status: "ok" }>
    | Readonly<{ status: "rejected"; code: "team_owner_transfer_required"; teamIds: readonly string[] }>;

/**
 * Evaluates the Team-ownership erasure precondition for a bounded Account set.
 * The People projection uses this batch form so a page does not issue one
 * ownership query family per row; the single-Account erasure guard below
 * delegates to the same result and therefore cannot drift from presentation.
 */
export async function readTeamOwnershipErasureDecisionsInTx(
    tx: Tx,
    input: Readonly<{ accountIds: readonly string[] }>,
): Promise<ReadonlyMap<string, TeamOwnershipErasureDecision>> {
    const accountIds = [...new Set(input.accountIds)];
    const allowed = (): TeamOwnershipErasureDecision => ({ status: "ok" });
    const decisions = new Map<string, TeamOwnershipErasureDecision>(
        accountIds.map((accountId): [string, TeamOwnershipErasureDecision] => [accountId, allowed()]),
    );
    if (accountIds.length === 0) return decisions;

    const ownedTeams = await tx.teamMembership.findMany({
        where: { accountId: { in: accountIds }, role: TeamRole.owner },
        select: { accountId: true, teamId: true },
    });
    if (ownedTeams.length === 0) return decisions;

    const teamIds = [...new Set(ownedTeams.map(({ teamId }) => teamId))];
    const [teams, activeMemberships] = await Promise.all([
        tx.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, archivedAt: true },
        }),
        tx.teamMembership.findMany({
            where: {
                teamId: { in: teamIds },
                status: TeamMembershipStatus.active,
                account: { status: AccountStatus.active },
            },
            select: { teamId: true, accountId: true, role: true },
        }),
    ]);
    const archivedByTeamId = new Map(teams.map((team) => [team.id, team.archivedAt !== null]));
    const activeMembershipsByTeamId = new Map<string, typeof activeMemberships>();
    for (const membership of activeMemberships) {
        const members = activeMembershipsByTeamId.get(membership.teamId) ?? [];
        members.push(membership);
        activeMembershipsByTeamId.set(membership.teamId, members);
    }
    const blockedByAccountId = new Map<string, string[]>();

    for (const ownership of ownedTeams) {
        if (archivedByTeamId.get(ownership.teamId) !== false) continue;
        const otherActiveMemberships = (activeMembershipsByTeamId.get(ownership.teamId) ?? [])
            .filter((membership) => membership.accountId !== ownership.accountId);
        if (otherActiveMemberships.some((membership) => membership.role === TeamRole.owner)) continue;
        if (otherActiveMemberships.length === 0) continue;
        const blocked = blockedByAccountId.get(ownership.accountId) ?? [];
        blocked.push(ownership.teamId);
        blockedByAccountId.set(ownership.accountId, blocked);
    }

    for (const [accountId, teamIds] of blockedByAccountId) {
        decisions.set(accountId, {
            status: "rejected",
            code: "team_owner_transfer_required",
            teamIds,
        });
    }
    return decisions;
}

/**
 * May this Account be erased without stranding a Team it owns?
 *
 * The evaluation is per retained owner membership, and it is deliberately
 * insensitive to the target's own lifecycle state. An erasure retry arrives
 * with the Account already terminally Retired and its membership possibly
 * suspended; if the check read "is this an active owner" it would pass on the
 * retry and quietly finish an erasure the first attempt refused.
 *
 * With another structurally active owner present, removal is fine. Without one:
 *
 * - an archived Team may go ownerless — its rows are retained and its derived
 *   recovery state is exactly how it comes back;
 * - a Team with no other structurally active member may also go ownerless,
 *   because there is nobody left to strand;
 * - otherwise a live, staffed Team would lose its last owner, so erasure is
 *   refused and an explicit ownership transfer is required first.
 *
 * "Structurally active" means an active Account and an active membership.
 * Guests count as members here: a Team with a guest still has someone whose
 * access an ownerless Team would leave unadministered. Neither authentication
 * freshness nor envelope readiness is owner continuity, so neither appears.
 */
export async function assertTeamOwnershipAllowsAccountErasureInTx(
    tx: Tx,
    input: Readonly<{ accountId: string }>,
): Promise<TeamOwnershipErasureDecision> {
    const decisions = await readTeamOwnershipErasureDecisionsInTx(tx, { accountIds: [input.accountId] });
    return decisions.get(input.accountId) ?? { status: "ok" };
}
