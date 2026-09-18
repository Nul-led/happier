import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, initDbMysql, initDbPostgres } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { removeTeamMemberForActorInTx } from "./memberAdministration";

function resolveContractProviderFromEnv(): "postgres" | "mysql" {
    const raw = (process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "postgres")
        .toString()
        .trim()
        .toLowerCase();

    if (raw === "postgresql" || raw === "postgres") return "postgres";
    if (raw === "mysql") return "mysql";
    throw new Error(`Unsupported contract provider: ${raw}`);
}

describe("Team membership administration database contract", () => {
    const provider = resolveContractProviderFromEnv();
    let dbConnected = false;

    beforeAll(async () => {
        if (!process.env.DATABASE_URL) {
            throw new Error("Missing DATABASE_URL (required for db contract tests).");
        }
        if (provider === "mysql") {
            await initDbMysql();
        } else {
            initDbPostgres();
        }
        await db.$connect();
        dbConnected = true;
    });

    afterAll(async () => {
        if (!dbConnected) return;
        await db.$disconnect();
    });

    it("serializes competing owner removals so one active owner survives", async () => {
        const suffix = randomUUID();
        const [firstOwner, secondOwner] = await Promise.all([
            db.account.create({ data: { publicKey: `owner-a-${suffix}`, encryptionMode: "plain" } }),
            db.account.create({ data: { publicKey: `owner-b-${suffix}`, encryptionMode: "plain" } }),
        ]);
        const team = await db.team.create({ data: { name: `Owner race ${suffix}` } });
        const [firstMembership, secondMembership] = await Promise.all([
            db.teamMembership.create({
                data: { teamId: team.id, accountId: firstOwner.id, role: "owner", status: "active" },
            }),
            db.teamMembership.create({
                data: { teamId: team.id, accountId: secondOwner.id, role: "owner", status: "active" },
            }),
        ]);

        const results = await Promise.all([
            inTx((tx) => removeTeamMemberForActorInTx(tx, {
                teamId: team.id,
                actorAccountId: firstOwner.id,
                membershipId: secondMembership.id,
            })),
            inTx((tx) => removeTeamMemberForActorInTx(tx, {
                teamId: team.id,
                actorAccountId: secondOwner.id,
                membershipId: firstMembership.id,
            })),
        ]);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toHaveLength(1);
        await expect(db.teamMembership.count({
            where: {
                teamId: team.id,
                role: "owner",
                status: "active",
                account: { status: "active" },
            },
        })).resolves.toBe(1);
    });
});
