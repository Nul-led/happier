import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AccountStatus, TeamMembershipStatus } from "@/storage/enums.generated";
import { isEffectiveTeamMembership } from "./effectiveMembership";

const teamQueriesPath = fileURLToPath(new URL("../queries.ts", import.meta.url));

describe("Structural Team-membership predicate", () => {
    const active = {
        accountStatus: AccountStatus.active,
        membershipStatus: TeamMembershipStatus.active,
        teamArchivedAt: null,
    } as const;

    it("is effective only when Account, membership, and Team are all current", () => {
        expect(isEffectiveTeamMembership(active)).toBe(true);
    });

    it("fails for each structural input independently", () => {
        expect(isEffectiveTeamMembership({ ...active, accountStatus: AccountStatus.suspended })).toBe(false);
        expect(isEffectiveTeamMembership({ ...active, accountStatus: AccountStatus.disabled })).toBe(false);
        expect(isEffectiveTeamMembership({ ...active, membershipStatus: TeamMembershipStatus.suspended })).toBe(false);
        expect(isEffectiveTeamMembership({ ...active, teamArchivedAt: new Date("2026-04-01T00:00:00.000Z") })).toBe(false);
    });

    // Equivalent inline formulas cannot be distinguished by a runtime grantability
    // test, so ownership is asserted where it is actually decided: the Team
    // grantability query must consume this predicate instead of restating it.
    it("is the sole structural decision-maker behind Team grantability", async () => {
        const source = await readFile(teamQueriesPath, "utf8");
        expect(source).toContain("./memberships/effectiveMembership");

        const start = source.indexOf("export async function resolveGrantableTeamForActorInTx");
        expect(start).toBeGreaterThanOrEqual(0);
        const nextExport = source.indexOf("\nexport ", start + 1);
        const grantability = source.slice(start, nextExport === -1 ? undefined : nextExport);

        expect(grantability).toContain("isEffectiveTeamMembership(");
        for (const restatement of ["AccountStatus.active", "TeamMembershipStatus.active", "archivedAt === null"]) {
            expect(grantability).not.toContain(restatement);
        }
    });
});
