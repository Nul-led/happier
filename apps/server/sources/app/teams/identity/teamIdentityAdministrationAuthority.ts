import type { TeamIdentityErrorCodeV1 } from "@happier-dev/protocol/teams";

import type { Tx } from "@/storage/inTx";
import {
    qualifyTeamOperationAuthenticationInTx,
    resolveTeamActorContextInTx,
    type TeamOperationAuthenticationContext,
} from "../actorContext";

export type TeamIdentityAdministrationAuthorityError = Extract<TeamIdentityErrorCodeV1,
    | "team_not_found"
    | "team_forbidden"
    | "team_authentication_required"
    | "team_authentication_unavailable"
>;

export async function authorizeTeamIdentityAdministrationInTx(
    tx: Tx,
    input: Partial<TeamOperationAuthenticationContext> & Readonly<{
        teamId: string;
        actorAccountId: string;
    }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; error: TeamIdentityAdministrationAuthorityError }>> {
    const actor = await resolveTeamActorContextInTx(tx, input);
    // Identity and directory administration are Team-only surfaces. Home's
    // manageAllTeams projection deliberately grants detail/metadata/lifecycle
    // authority, but must not reveal these surfaces to a non-member.
    if (!actor || !actor.teamCapabilities.viewTeam) return { ok: false, error: "team_not_found" };
    if (!actor.teamCapabilities.manageAuthentication) return { ok: false, error: "team_forbidden" };

    return qualifyTeamOperationAuthenticationInTx(tx, {
        context: actor,
        ...input,
    });
}
