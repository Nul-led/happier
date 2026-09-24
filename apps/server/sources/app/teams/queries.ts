import {
    TEAM_DIRECTORY_PAGE_LIMIT_DEFAULT_V1,
    decodeTeamDirectoryCursorV1,
    encodeTeamDirectoryCursorV1,
    teamDirectoryQueryKeyV1,
    type TeamsListInputV1,
    type TeamsPageV1,
} from "@happier-dev/protocol/teams";

import { readHomeGovernanceAccountInTx, resolveHomeGovernanceAuthority } from "@/app/home/governance/homeCapabilities";
import type { Tx } from "@/storage/inTx";
import { AccountStatus, TeamMembershipStatus, TeamRole } from "@/storage/enums.generated";

import {
    composeTeamActorContext,
    qualifyTeamProjectionReadAuthenticationsInTx,
    type TeamOperationAuthenticationContext,
} from "./actorContext";
import { resolveTeamCapabilitiesV1 } from "./capabilities";
import { isEffectiveTeamMembership } from "./memberships/effectiveMembership";
import { TEAM_PROJECTION_SELECT, projectTeamSummaryV1 } from "./projections";

/**
 * The Home-local Team directory.
 *
 * Visibility and archive predicates are applied by the query itself, before the
 * cursor narrows it. That ordering is what makes the opaque cursor a position
 * rather than an authority: a forged or replayed cursor can only move within a
 * result set the viewer was already entitled to.
 */

/**
 * The directory refuses the whole read only for facts about the reader: a
 * forged cursor, an inactive Account, or an administrative scope they do not
 * hold. A Team's own authentication policy is a per-row fact and is projected
 * on the row instead, so it can no longer fail the page.
 */
export type TeamDirectoryError =
    | "invalid_team_cursor"
    | "team_forbidden";

export type TeamDirectoryResult =
    | Readonly<{ ok: true; page: TeamsPageV1 }>
    | Readonly<{ ok: false; error: TeamDirectoryError }>;

/**
 * Commit-time Team grantability for content-sharing consumers. This is the
 * narrow single-subject form of the member directory: only an effective
 * membership — decided by the canonical `isEffectiveTeamMembership` predicate,
 * never restated here — is grantable. Home administration is intentionally not
 * a substitute for membership.
 */
export async function resolveGrantableTeamForActorInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; teamId: string }>,
): Promise<Readonly<{ teamId: string }> | null> {
    const membership = await tx.teamMembership.findUnique({
        where: {
            teamId_accountId: {
                teamId: input.teamId,
                accountId: input.actorAccountId,
            },
        },
        select: {
            status: true,
            account: { select: { status: true } },
            team: { select: { id: true, archivedAt: true } },
        },
    });
    return membership && isEffectiveTeamMembership({
        accountStatus: membership.account.status,
        membershipStatus: membership.status,
        teamArchivedAt: membership.team.archivedAt,
    })
        ? { teamId: membership.team.id }
        : null;
}

export async function listTeamsForActorInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        authentication?: TeamOperationAuthenticationContext;
    } & TeamsListInputV1>,
): Promise<TeamDirectoryResult> {
    const account = await readHomeGovernanceAccountInTx(tx, input.actorAccountId);
    if (!account || account.status !== AccountStatus.active) return { ok: false, error: "team_forbidden" };
    const authority = resolveHomeGovernanceAuthority(account);

    // The administrative scope is an explicit request, not an implicit widening
    // of the member directory: an administrator's ordinary Teams list still shows
    // the Teams they actually belong to.
    if (input.scope === "administered" && !authority.manageAllTeams) {
        return { ok: false, error: "team_forbidden" };
    }

    const queryKey = teamDirectoryQueryKeyV1(input);
    let after: Readonly<{ name: string; id: string }> | null = null;
    if (input.cursor !== undefined && input.cursor !== null) {
        const decoded = decodeTeamDirectoryCursorV1(input.cursor, queryKey);
        if (decoded.status !== "ok") return { ok: false, error: "invalid_team_cursor" };
        after = decoded.cursor;
    }

    const limit = input.limit ?? TEAM_DIRECTORY_PAGE_LIMIT_DEFAULT_V1;
    const rows = await tx.team.findMany({
        where: {
            archivedAt: input.archived === "archived" ? { not: null } : null,
            ...(input.scope === "member"
                ? {
                    memberships: {
                        some: { accountId: input.actorAccountId, status: TeamMembershipStatus.active },
                    },
                }
                : {}),
            // The keyset predicate: strictly after `(name, id)` in the same order
            // the query sorts by, so a rename moves a Team within the sequence
            // instead of duplicating or skipping a page.
            ...(after === null
                ? {}
                : {
                    OR: [
                        { name: { gt: after.name } },
                        { name: after.name, id: { gt: after.id } },
                    ],
                }),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit + 1,
        select: {
            ...TEAM_PROJECTION_SELECT,
            memberships: {
                where: { accountId: input.actorAccountId },
                select: { id: true, role: true, status: true },
            },
        },
    });

    const page = rows.slice(0, limit);
    // The owner-required condition for the whole page in one query rather than a
    // count per row. The notice asks only whether an active owner exists, so the
    // distinct Team ids of the page's active owners answer it exactly.
    const teamsWithActiveOwner = new Set((await tx.teamMembership.findMany({
        where: {
            teamId: { in: page.map((row) => row.id) },
            role: TeamRole.owner,
            status: TeamMembershipStatus.active,
            account: { status: AccountStatus.active },
        },
        distinct: ["teamId"],
        select: { teamId: true },
    })).map((row) => row.teamId));

    const contexts = page.map((row) => {
        const membership = row.memberships[0] ?? null;
        return composeTeamActorContext({
            team: row,
            actorAccountId: input.actorAccountId,
            accountStatus: account.status,
            membership: membership
                ? { id: membership.id, role: membership.role, status: membership.status }
                : null,
            homeAuthority: authority,
            ownerRequired: !teamsWithActiveOwner.has(row.id),
        });
    });
    // One qualification for the whole page. The member scope is the only one
    // that carries Team-derived authority.
    const qualifications = input.scope === "member"
        ? await qualifyTeamProjectionReadAuthenticationsInTx(tx, { contexts, ...input.authentication })
        : null;

    const items: TeamsPageV1["items"] = [];
    for (const context of contexts) {
        // Qualification is per Team because the authentication policy is per
        // Team. A Team whose accepted method this credential does not satisfy
        // keeps its row and loses its Team-derived capabilities; it must not
        // take down the Teams the viewer does satisfy, nor the keyset position
        // of the page they share. A row missing from the batch answer is
        // unqualified for the same reason it always was.
        //
        // Home authority is not Team-derived and is therefore not qualified,
        // so the withheld row is recomposed by the same capability owner with
        // the membership removed rather than re-decided here.
        const qualified = qualifications === null || (qualifications.get(context.team.id)?.ok ?? false);
        items.push(projectTeamSummaryV1({
            team: context.team,
            viewerRole: context.membership?.role ?? null,
            capabilities: qualified
                ? context.capabilities
                : resolveTeamCapabilitiesV1({
                    accountStatus: context.accountStatus,
                    homeAuthority: context.homeAuthority,
                    membership: null,
                    teamArchivedAt: context.team.archivedAt,
                }),
            ownerRequired: context.ownerRequired,
            homeAuthority: context.homeAuthority,
        }));
    }

    const last = page.at(-1);
    const nextCursor = rows.length > limit && last
        ? encodeTeamDirectoryCursorV1({ queryKey, name: last.name, id: last.id })
        : null;

    return { ok: true, page: { items, nextCursor } };
}
