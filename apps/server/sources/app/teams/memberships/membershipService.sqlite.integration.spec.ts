import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { admitTeamMemberInTx } from "./membershipService";

describe("Team member admission (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-team-admission-", initAuth: false });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    async function account(status: "active" | "suspended" | "disabled" = "active") {
        return db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain", status } });
    }

    it("mints a from-membership horizon from the database clock, not the process clock", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Horizon" } });
        const before = await inTx(tx => tx.$queryRawUnsafe<Array<unknown>>("SELECT 1").then(() => new Date()));

        const result = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
        }));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.outcome).toBe("added");
        expect(result.membership.historyAccess).toBe("from_membership");
        expect(result.membership.sessionAccessStartsAt).not.toBeNull();
        const persisted = await db.teamMembership.findUniqueOrThrow({ where: { id: result.membership.teamMembershipId } });
        expect(persisted.sessionAccessStartsAt?.getTime()).toBe(result.membership.sessionAccessStartsAt?.getTime());
        expect(before).toBeInstanceOf(Date);
    });

    it("mints no horizon for all-existing admission", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "All existing admission" } });

        const result = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "owner", historyAccess: "all_existing",
        }));

        expect(result).toMatchObject({ ok: true, outcome: "added", membership: { sessionAccessStartsAt: null, historyAccess: "all_existing" } });
    });

    it("forces Guest admission to from-membership history even when a caller requests all-existing", async () => {
        const guest = await account();
        const team = await db.team.create({ data: { name: "Guest boundary" } });

        const result = await inTx((tx) => admitTeamMemberInTx(tx, {
            teamId: team.id,
            accountId: guest.id,
            role: "guest",
            historyAccess: "all_existing",
        }));

        expect(result).toMatchObject({
            ok: true,
            outcome: "added",
            membership: { role: "guest", historyAccess: "from_membership" },
        });
        if (!result.ok) return;
        expect(result.membership.sessionAccessStartsAt).not.toBeNull();
    });

    it("never resets an existing member's role, status, or horizon on replay", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Replay" } });
        const first = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
        }));
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        await db.teamMembership.update({
            where: { id: first.membership.teamMembershipId },
            data: { role: "admin", status: "suspended" },
        });

        // A retried acceptance or directory replay must not widen history or restore
        // a role an administrator has since changed.
        const replay = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "owner", historyAccess: "all_existing",
        }));

        expect(replay.ok).toBe(true);
        if (!replay.ok) return;
        expect(replay.outcome).toBe("already_member");
        expect(replay.membership.teamMembershipId).toBe(first.membership.teamMembershipId);
        expect(replay.membership.role).toBe("admin");
        expect(replay.membership.status).toBe("suspended");
        expect(replay.membership.sessionAccessStartsAt?.getTime())
            .toBe(first.membership.sessionAccessStartsAt?.getTime());
        expect(replay.membership.effective).toBe(false);
    });

    it("mints a new lifetime and horizon after removal and rejoin", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Rejoin" } });
        const first = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
        }));
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        await db.teamMembership.delete({ where: { id: first.membership.teamMembershipId } });

        const rejoined = await inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
        }));

        expect(rejoined.ok).toBe(true);
        if (!rejoined.ok) return;
        expect(rejoined.outcome).toBe("added");
        expect(rejoined.membership.teamMembershipId).not.toBe(first.membership.teamMembershipId);
    });

    it("refuses admission to an archived Team and to an inactive Account", async () => {
        const archived = await db.team.create({ data: { name: "Archived", archivedAt: new Date() } });
        const live = await db.team.create({ data: { name: "Live" } });
        const member = await account();
        const suspended = await account("suspended");
        const disabled = await account("disabled");

        await expect(inTx(tx => admitTeamMemberInTx(tx, {
            teamId: archived.id, accountId: member.id, role: "member", historyAccess: "from_membership",
        }))).resolves.toEqual({ ok: false, error: "team_archived" });

        await expect(inTx(tx => admitTeamMemberInTx(tx, {
            teamId: live.id, accountId: suspended.id, role: "member", historyAccess: "from_membership",
        }))).resolves.toEqual({ ok: false, error: "account_ineligible" });

        await expect(inTx(tx => admitTeamMemberInTx(tx, {
            teamId: live.id, accountId: disabled.id, role: "member", historyAccess: "from_membership",
        }))).resolves.toEqual({ ok: false, error: "account_ineligible" });

        expect(await db.teamMembership.count({ where: { teamId: { in: [archived.id, live.id] } } })).toBe(0);
    });

    it("fails closed before creating membership when the Teams feature is unavailable", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Disabled feature admission" } });

        await expect(inTx((tx) => admitTeamMemberInTx(tx, {
            teamId: team.id,
            accountId: member.id,
            role: "member",
            historyAccess: "from_membership",
            env: { ...process.env, HAPPIER_BUILD_FEATURES_DENY: "teams" },
        }))).resolves.toEqual({ ok: false, error: "teams_unavailable" });
        await expect(db.teamMembership.count({ where: { teamId: team.id } })).resolves.toBe(0);
    });

    it("reports a missing Team and a missing Account distinctly without mutating", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Distinct" } });

        await expect(inTx(tx => admitTeamMemberInTx(tx, {
            teamId: "team_does_not_exist", accountId: member.id, role: "member", historyAccess: "from_membership",
        }))).resolves.toEqual({ ok: false, error: "team_not_found" });

        await expect(inTx(tx => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: "account_does_not_exist", role: "member", historyAccess: "from_membership",
        }))).resolves.toEqual({ ok: false, error: "account_not_found" });
    });

    it("yields exactly one lifetime when two admissions race the same Account", async () => {
        const member = await account();
        const team = await db.team.create({ data: { name: "Race" } });

        const [a, b] = await Promise.all([
            inTx(tx => admitTeamMemberInTx(tx, {
                teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
            })),
            inTx(tx => admitTeamMemberInTx(tx, {
                teamId: team.id, accountId: member.id, role: "member", historyAccess: "from_membership",
            })),
        ]);

        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.membership.teamMembershipId).toBe(b.membership.teamMembershipId);
        expect([a.outcome, b.outcome].filter(outcome => outcome === "added")).toHaveLength(1);
        expect(await db.teamMembership.count({ where: { teamId: team.id, accountId: member.id } })).toBe(1);
    });
});
