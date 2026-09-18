import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, initDbMysql, initDbPostgres } from "@/storage/db";
import { TeamMembershipStatus, TeamRole } from "@/storage/enums.generated";
import { inTx } from "@/storage/inTx";
import { createTeamIdentityConnectionInTx } from "./teamIdentityConnectionLifecycle";
import { createTeamWorkosConnection } from "./teamWorkosAdministration";

function resolveContractProviderFromEnv(): "postgres" | "mysql" {
    const raw = (process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "postgres")
        .toString()
        .trim()
        .toLowerCase();

    if (raw === "postgresql" || raw === "postgres") return "postgres";
    if (raw === "mysql") return "mysql";
    throw new Error(`Unsupported contract provider: ${raw}`);
}

describe("TeamIdentityConnection lifecycle database contract", () => {
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

    it("observes an existing exact binding without poisoning the duplicate-create transaction", async () => {
        const suffix = randomUUID();
        const team = await db.team.create({ data: { name: `Identity contract ${suffix}` } });
        const identityProvider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "workos_sso",
                displayName: "Company identity",
                enabled: true,
                firstEnabledAt: new Date("2026-09-09T00:00:00.000Z"),
                config: { v: 1, kind: "workos_sso" },
            },
        });
        const input = {
            teamId: team.id,
            providerInstanceId: identityProvider.id,
            externalReference: {
                v: 1 as const,
                kind: "workos_sso" as const,
                organizationId: `org_${suffix}`,
                connectionId: `conn_${suffix}`,
            },
            settings: { v: 1 as const, kind: "workos_sso" as const },
            createdByAccountId: null,
        };

        const created = await inTx(async (tx) => await createTeamIdentityConnectionInTx(tx, input));
        expect(created.status).toBe("created");
        if (created.status !== "created") return;

        await expect(inTx(async (tx) => await createTeamIdentityConnectionInTx(tx, input))).resolves.toMatchObject({
            status: "already_exists",
            connection: { id: created.connection.id },
        });
        const [racingLeft, racingRight] = await Promise.all([
            inTx(async (tx) => await createTeamIdentityConnectionInTx(tx, input)),
            inTx(async (tx) => await createTeamIdentityConnectionInTx(tx, input)),
        ]);
        expect([racingLeft, racingRight]).toEqual([
            expect.objectContaining({ status: "already_exists", connection: expect.objectContaining({ id: created.connection.id }) }),
            expect.objectContaining({ status: "already_exists", connection: expect.objectContaining({ id: created.connection.id }) }),
        ]);
        await expect(db.teamIdentityConnection.count({
            where: { teamId: team.id, providerInstanceId: identityProvider.id },
        })).resolves.toBe(1);
    });

    it("serializes concurrent WorkOS creation onto one provider and one connection", async () => {
        const suffix = randomUUID();
        const actor = await db.account.create({ data: {} });
        const team = await db.team.create({ data: { name: `Concurrent WorkOS ${suffix}` } });
        await db.teamMembership.create({
            data: {
                teamId: team.id,
                accountId: actor.id,
                role: TeamRole.owner,
                status: TeamMembershipStatus.active,
            },
        });
        const input = {
            v: 1 as const,
            actorAccountId: actor.id,
            teamId: team.id,
            env: {},
            authenticationAuthority: "present_user" as const,
        };
        const dependencies = {
            resolvePlatform: () => ({
                available: true as const,
                clientId: "client_exact",
                client: {} as never,
                runtimeFingerprint: "workos-platform:v1:exact",
            }),
        };

        const [first, second] = await Promise.all([
            createTeamWorkosConnection(input, dependencies),
            createTeamWorkosConnection(input, dependencies),
        ]);
        expect(first).toEqual(second);
        expect(first.ok).toBe(true);
        await expect(db.identityProviderInstance.count({
            where: { ownerTeamId: team.id, kind: "workos_sso" },
        })).resolves.toBe(1);
        await expect(db.teamIdentityConnection.count({
            where: { teamId: team.id, providerInstance: { kind: "workos_sso" } },
        })).resolves.toBe(1);
    });
});
