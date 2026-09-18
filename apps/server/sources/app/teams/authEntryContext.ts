import type { AuthEntryProjectionV1 } from "@happier-dev/protocol";

import { getPublicUrl } from "@/storage/blob/files";
import type { Tx } from "@/storage/inTx";

import { readStoredTeamLogo } from "./projections";

export type TeamAuthEntryContext = Readonly<{
    team: Extract<AuthEntryProjectionV1, { scope: { kind: "team" }; state: "admission_required" }>["team"];
    authenticationPolicy: unknown;
}>;

/**
 * The Team owner's bounded public entry projection. Unknown and archived Teams
 * intentionally share the same null result so unauthenticated entry cannot
 * enumerate lifecycle state.
 */
export async function resolveTeamAuthEntryContextInTx(
    tx: Tx,
    input: Readonly<{ teamId: string }>,
): Promise<TeamAuthEntryContext | null> {
    const row = await tx.team.findUnique({
        where: { id: input.teamId },
        select: { id: true, name: true, logo: true, authenticationPolicy: true, archivedAt: true },
    });
    if (!row || row.archivedAt !== null) return null;
    const logo = readStoredTeamLogo(row.logo, row.id);
    return {
        team: {
            teamId: row.id,
            name: row.name,
            logo: logo === null ? null : { ...logo, url: getPublicUrl(logo.path) },
        },
        authenticationPolicy: row.authenticationPolicy,
    };
}
