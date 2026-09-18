import type { Tx } from "@/storage/inTx";
import {
    type AccountStatus,
    type SessionHistoryAccess,
    type TeamMembershipStatus,
} from "@/storage/enums.generated";
import { isEffectiveTeamMembership } from "../memberships/effectiveMembership";
import { sessionHistoryAccessOf } from "../memberships/sessionHistory";

/**
 * One resolved Group membership, keyed by the Team-membership lifetime it hangs on.
 *
 * Group access is ineffective whenever the parent Team membership is ineffective;
 * that is derived here from the same structural predicate rather than copied into a
 * Boolean on the Group row that a cleanup race could leave stale.
 */
export type TeamGroupMembershipLifetimeContext = Readonly<{
    teamId: string;
    teamGroupId: string;
    teamMembershipId: string;
    accountId: string;
    nativeContribution: boolean;
    /** The Group's own horizon. Team and Group horizons are independent facts. */
    sessionAccessStartsAt: Date | null;
    historyAccess: SessionHistoryAccess;
    effective: boolean;
}>;

export type TeamGroupMembershipContextError =
    | "team_group_not_found"
    | "team_membership_not_found"
    | "team_group_membership_not_found";

export type TeamGroupMembershipContextResolution =
    | Readonly<{ ok: true; groupMembership: TeamGroupMembershipLifetimeContext }>
    | Readonly<{ ok: false; error: TeamGroupMembershipContextError }>;

/**
 * Lane 01's complete structural Group-membership predicate. Retained roster
 * rows are not effective while any Account, Team-membership, Team, or Group
 * lifecycle input is inactive.
 */
export function isEffectiveTeamGroupMembership(
    input: Readonly<{
        accountStatus: AccountStatus;
        membershipStatus: TeamMembershipStatus;
        teamArchivedAt: Date | null;
        groupArchivedAt: Date | null;
    }>,
): boolean {
    return isEffectiveTeamMembership(input) && input.groupArchivedAt === null;
}

/** Resolve all currently effective Group identities for one Account in a Team. */
export async function resolveEffectiveTeamGroupIdsForAccountInTx(
    tx: Tx,
    params: Readonly<{ teamId: string; accountId: string }>,
): Promise<readonly string[]> {
    const membership = await tx.teamMembership.findUnique({
        where: { teamId_accountId: { teamId: params.teamId, accountId: params.accountId } },
        select: {
            status: true,
            account: { select: { status: true } },
            team: { select: { archivedAt: true } },
            groupMemberships: {
                select: { group: { select: { id: true, archivedAt: true } } },
            },
        },
    });
    if (!membership) return [];

    return membership.groupMemberships
        .filter(({ group }) => isEffectiveTeamGroupMembership({
            accountStatus: membership.account.status,
            membershipStatus: membership.status,
            teamArchivedAt: membership.team.archivedAt,
            groupArchivedAt: group.archivedAt,
        }))
        .map(({ group }) => group.id)
        .sort();
}

/**
 * Resolve a Group membership from its public `{ teamId, groupId, accountId }`
 * address inside the caller's transaction.
 *
 * The public address is by Account, but the stored row is keyed by the current
 * Team-membership lifetime. Resolving that lifetime here — once, transactionally —
 * is what lets removal and rejoin produce a genuinely new Group membership and
 * horizon instead of resurrecting the previous one, and it is why no surrogate
 * Group-membership id is minted anywhere.
 *
 * The Group row is the authority for its own parent Team; the caller's `teamId` is a
 * claim that is verified rather than trusted, so a Group cannot be reached through a
 * Team that does not own it.
 */
export async function resolveTeamGroupMembershipContextInTx(
    tx: Tx,
    params: Readonly<{
        teamId: string;
        groupId: string;
        accountId: string;
    }>,
): Promise<TeamGroupMembershipContextResolution> {
    const group = await tx.teamGroup.findUnique({
        where: { id: params.groupId },
        select: {
            id: true,
            teamId: true,
            archivedAt: true,
            team: { select: { archivedAt: true } },
        },
    });
    if (!group || group.teamId !== params.teamId) {
        return { ok: false, error: "team_group_not_found" };
    }

    const membership = await tx.teamMembership.findUnique({
        where: { teamId_accountId: { teamId: params.teamId, accountId: params.accountId } },
        select: {
            id: true,
            status: true,
            account: { select: { status: true } },
        },
    });
    if (!membership) {
        return { ok: false, error: "team_membership_not_found" };
    }

    const groupMembership = await tx.teamGroupMembership.findUnique({
        where: {
            teamGroupId_teamMembershipId: {
                teamGroupId: group.id,
                teamMembershipId: membership.id,
            },
        },
        select: { nativeContribution: true, sessionAccessStartsAt: true },
    });
    if (!groupMembership) {
        return { ok: false, error: "team_group_membership_not_found" };
    }

    const effective = isEffectiveTeamGroupMembership({
        accountStatus: membership.account.status,
        membershipStatus: membership.status,
        teamArchivedAt: group.team.archivedAt,
        groupArchivedAt: group.archivedAt,
    });

    return {
        ok: true,
        groupMembership: {
            teamId: group.teamId,
            teamGroupId: group.id,
            teamMembershipId: membership.id,
            accountId: params.accountId,
            nativeContribution: groupMembership.nativeContribution,
            sessionAccessStartsAt: groupMembership.sessionAccessStartsAt,
            historyAccess: sessionHistoryAccessOf(groupMembership.sessionAccessStartsAt),
            effective,
        },
    };
}
