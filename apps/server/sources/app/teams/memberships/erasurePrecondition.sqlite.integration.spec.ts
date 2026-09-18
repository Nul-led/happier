import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    assertTeamOwnershipAllowsAccountErasureInTx,
    readTeamOwnershipErasureDecisionsInTx,
} from "./erasurePrecondition";

describe("Team ownership erasure precondition (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-erasure-precondition-",
            initAuth: false,
        });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    async function account(status: "active" | "suspended" | "disabled" = "active") {
        return db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain", status },
        });
    }

    async function membership(input: Readonly<{
        teamId: string;
        accountId: string;
        role: "owner" | "admin" | "member" | "guest";
        status?: "active" | "suspended";
    }>) {
        return db.teamMembership.create({
            data: {
                teamId: input.teamId,
                accountId: input.accountId,
                role: input.role,
                status: input.status ?? "active",
            },
        });
    }

    function check(accountId: string) {
        return inTx((tx) => assertTeamOwnershipAllowsAccountErasureInTx(tx, { accountId }));
    }

    it("permits an Account that owns nothing", async () => {
        const target = await account();
        const team = await db.team.create({ data: { name: "Not owned" } });
        await membership({ teamId: team.id, accountId: target.id, role: "member" });

        expect(await check(target.id)).toEqual({ status: "ok" });
    });

    it("permits removal while another structurally active owner remains", async () => {
        const target = await account();
        const survivor = await account();
        const team = await db.team.create({ data: { name: "Two owners" } });
        await membership({ teamId: team.id, accountId: target.id, role: "owner" });
        await membership({ teamId: team.id, accountId: survivor.id, role: "owner" });

        expect(await check(target.id)).toEqual({ status: "ok" });
    });

    it("refuses a live staffed Team whose only other owner is not structurally active", async () => {
        const target = await account();
        const suspendedOwner = await account("suspended");
        const worker = await account();
        const team = await db.team.create({ data: { name: "Staffed" } });
        await membership({ teamId: team.id, accountId: target.id, role: "owner" });
        await membership({ teamId: team.id, accountId: suspendedOwner.id, role: "owner" });
        await membership({ teamId: team.id, accountId: worker.id, role: "member" });

        expect(await check(target.id)).toEqual({
            status: "rejected",
            code: "team_owner_transfer_required",
            teamIds: [team.id],
        });
    });

    it("counts a guest as somebody left to strand", async () => {
        const target = await account();
        const guest = await account();
        const team = await db.team.create({ data: { name: "Guest only" } });
        await membership({ teamId: team.id, accountId: target.id, role: "owner" });
        await membership({ teamId: team.id, accountId: guest.id, role: "guest" });

        expect(await check(target.id)).toMatchObject({ status: "rejected" });
    });

    it("permits an archived or unoccupied Team to go ownerless", async () => {
        const target = await account();
        const archivedTeam = await db.team.create({
            data: { name: "Archived", archivedAt: new Date() },
        });
        const worker = await account();
        await membership({ teamId: archivedTeam.id, accountId: target.id, role: "owner" });
        await membership({ teamId: archivedTeam.id, accountId: worker.id, role: "member" });

        const emptyTeam = await db.team.create({ data: { name: "Unoccupied" } });
        await membership({ teamId: emptyTeam.id, accountId: target.id, role: "owner" });
        const inactiveColleague = await account("disabled");
        await membership({ teamId: emptyTeam.id, accountId: inactiveColleague.id, role: "member" });

        expect(await check(target.id)).toEqual({ status: "ok" });
    });

    it("still refuses on a retry that finds the Account already retired and suspended", async () => {
        // The whole point of the predicate: an erasure retry arrives with the
        // target terminally Retired. Reading "is this an active owner" would
        // pass here and silently finish an erasure the first attempt refused.
        const target = await account();
        const worker = await account();
        const team = await db.team.create({ data: { name: "Retry" } });
        await membership({
            teamId: team.id, accountId: target.id, role: "owner", status: "suspended",
        });
        await membership({ teamId: team.id, accountId: worker.id, role: "member" });
        await db.account.update({ where: { id: target.id }, data: { status: "disabled" } });

        expect(await check(target.id)).toEqual({
            status: "rejected",
            code: "team_owner_transfer_required",
            teamIds: [team.id],
        });
    });

    it("projects a page of Account erasure decisions through the same predicate", async () => {
        const blockedOwner = await account();
        const ordinaryMember = await account();
        const worker = await account();
        const team = await db.team.create({ data: { name: "Projected" } });
        await membership({ teamId: team.id, accountId: blockedOwner.id, role: "owner" });
        await membership({ teamId: team.id, accountId: worker.id, role: "member" });

        const decisions = await inTx((tx) => readTeamOwnershipErasureDecisionsInTx(tx, {
            accountIds: [blockedOwner.id, ordinaryMember.id],
        }));
        expect(decisions.get(blockedOwner.id)).toEqual({
            status: "rejected",
            code: "team_owner_transfer_required",
            teamIds: [team.id],
        });
        expect(decisions.get(ordinaryMember.id)).toEqual({ status: "ok" });
    });
});
