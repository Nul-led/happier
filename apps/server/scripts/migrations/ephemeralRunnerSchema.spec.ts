import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyPostgresMigrations, applySqliteMigrations } from "../prismaMigrations";

const activationMigrationName = "20260906153000_add_ephemeral_runner_activation";
const endpointFactsMigrationName = "20260906160000_add_ephemeral_runner_endpoint_facts";
const machineKindMigrationName = "20260906200000_add_machine_kind";
const materializationMigrationName = "20260908110000_complete_ephemeral_runner_materialization";
const serverRoot = join(import.meta.dirname, "../..");

async function stageMigration(params: Readonly<{
    migrationsDir: string;
    providerRoot: string;
    name: string;
}>): Promise<void> {
    await mkdir(join(params.migrationsDir, params.name), { recursive: true });
    await writeFile(
        join(params.migrationsDir, params.name, "migration.sql"),
        await readFile(join(serverRoot, params.providerRoot, "migrations", params.name, "migration.sql")),
    );
}

function decodeJson(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
}

describe("ephemeral Runner persistence", () => {
    it.each(["sqlite", "postgres"] as const)("deploys twice and preserves reservation/materialization invariants on %s", async (provider) => {
        const directory = await mkdtemp(join(tmpdir(), "happier-ephemeral-runner-schema-"));
        const migrationsDir = join(directory, "migrations");
        const databasePath = join(directory, "test.sqlite");
        const sqlite = provider === "sqlite" ? new DatabaseSync(databasePath) : null;
        const postgres = provider === "postgres" ? new PGlite() : null;
        const exec = async (sql: string) => { if (sqlite) sqlite.exec(sql); else await postgres!.exec(sql); };
        const query = async (sql: string) => sqlite ? sqlite.prepare(sql).all() : (await postgres!.query(sql)).rows;
        const deploy = () => sqlite
            ? applySqliteMigrations({ databasePath, migrationsDir })
            : applyPostgresMigrations({ db: postgres!, migrationsDir });
        const providerRoot = provider === "sqlite" ? "prisma/sqlite" : "prisma";
        const baseline = provider === "sqlite" ? "20260122190000_baseline" : "20250713002718_initial";

        try {
            await stageMigration({ migrationsDir, providerRoot, name: baseline });
            if (provider === "postgres") {
                await stageMigration({ migrationsDir, providerRoot, name: "20250812092041_add_machine_model" });
            }
            await deploy();
            if (sqlite) sqlite.exec("PRAGMA foreign_keys=ON");

            await exec(`
                INSERT INTO "Account" ("id", "publicKey", "updatedAt") VALUES
                    ('activation-account', 'activation-account', CURRENT_TIMESTAMP),
                    ('machine-account', 'machine-account', CURRENT_TIMESTAMP);
                INSERT INTO "Machine" ("id", "accountId", "metadata", "updatedAt")
                VALUES ('preexisting-machine', 'machine-account', '{}', CURRENT_TIMESTAMP);
            `);

            for (const name of [
                activationMigrationName,
                endpointFactsMigrationName,
                machineKindMigrationName,
                materializationMigrationName,
            ]) {
                await stageMigration({ migrationsDir, providerRoot, name });
            }
            await deploy();
            await expect(deploy()).resolves.toEqual({ applied: [] });

            expect(await query(`SELECT "kind" FROM "Machine" WHERE "id"='preexisting-machine'`))
                .toEqual([{ kind: "persistent" }]);
            await exec(`
                INSERT INTO "Machine" ("id", "accountId", "metadata", "kind", "runnerContentKeyBinding", "updatedAt")
                VALUES ('runner-machine', 'machine-account', '{}', 'ephemeral_session_runner', '{"v":1}', CURRENT_TIMESTAMP);
                INSERT INTO "EphemeralRunnerActivation" (
                    "id", "creatorAccountId", "creatorTokenEpoch", "draftId", "sessionId", "machineId", "state",
                    "progressPhase", "workspacePolicy",
                    "homeServerIdentityId", "activationSigningPublicKey", "authoringCommitment", "artifact",
                    "endpointFactsRecipient", "authenticationEvidence", "claim", "endpointFacts", "credentialSelection", "review", "consent", "readiness",
                    "sealedBootstrap", "updatedAt"
                ) VALUES (
                    'activation', 'activation-account', 7, 'draft', 'reserved-session', 'reserved-machine', 'materialized',
                    'creating_session', 'choose_on_endpoint',
                    'home', 'public-key', 'commitment', '{"v":1}', '{"v":1}', '{"v":1}', '{"v":1}', '{"v":1}',
                    '{"v":1}', '{"v":1}', '{"v":1}', '{"v":1}', '{"v":1}', CURRENT_TIMESTAMP
                );
            `);

            const activationRows = await query(`
                SELECT "progressPhase", "artifact", "endpointFactsRecipient", "authenticationEvidence", "claim", "endpointFacts", "credentialSelection", "review", "consent", "readiness", "sealedBootstrap"
                FROM "EphemeralRunnerActivation" WHERE "id"='activation'
            `) as Array<Record<string, unknown>>;
            expect(activationRows).toHaveLength(1);
            expect(activationRows[0]!.progressPhase).toBe("creating_session");
            const { progressPhase: _progressPhase, ...storedEnvelopes } = activationRows[0]!;
            for (const value of Object.values(storedEnvelopes)) {
                expect(decodeJson(value)).toEqual({ v: 1 });
            }

            await expect(exec(`
                INSERT INTO "EphemeralRunnerActivation" (
                    "id", "creatorAccountId", "creatorTokenEpoch", "draftId", "sessionId", "machineId", "state",
                    "homeServerIdentityId", "activationSigningPublicKey", "authoringCommitment", "artifact",
                    "endpointFactsRecipient", "updatedAt"
                ) VALUES (
                    'duplicate-session', 'activation-account', 7, 'draft-2', 'reserved-session', 'different-machine', 'pending',
                    'home', 'public-key', 'commitment', '{}', '{}', CURRENT_TIMESTAMP
                )
            `)).rejects.toThrow();
            await expect(exec(`
                INSERT INTO "EphemeralRunnerActivation" (
                    "id", "creatorAccountId", "creatorTokenEpoch", "draftId", "sessionId", "machineId", "state",
                    "homeServerIdentityId", "activationSigningPublicKey", "authoringCommitment", "artifact",
                    "endpointFactsRecipient", "updatedAt"
                ) VALUES (
                    'duplicate-machine', 'activation-account', 7, 'draft-3', 'different-session', 'reserved-machine', 'pending',
                    'home', 'public-key', 'commitment', '{}', '{}', CURRENT_TIMESTAMP
                )
            `)).rejects.toThrow();

            await expect(exec(`DELETE FROM "Account" WHERE "id"='activation-account'`)).rejects.toThrow();
            expect(await query(`SELECT "id" FROM "EphemeralRunnerActivation"`)).toEqual([{ id: "activation" }]);
            await exec(`DELETE FROM "EphemeralRunnerActivation" WHERE "id"='activation'`);
            await exec(`DELETE FROM "Account" WHERE "id"='activation-account'`);
            expect(await query(`SELECT "kind" FROM "Machine" ORDER BY "id"`)).toEqual([
                { kind: "persistent" },
                { kind: "ephemeral_session_runner" },
            ]);

            if (sqlite) {
                expect(await query("PRAGMA foreign_key_check")).toEqual([]);
                expect(await query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
            }
        } finally {
            sqlite?.close();
            await postgres?.close();
            await rm(directory, { recursive: true, force: true });
        }
    }, 60_000);

    it("keeps the MySQL Runner schema within accepted identity and identifier boundaries", async () => {
        const migrationSql = (await Promise.all([
            activationMigrationName,
            endpointFactsMigrationName,
            machineKindMigrationName,
            materializationMigrationName,
        ].map((name) => readFile(join(serverRoot, "prisma/mysql/migrations", name, "migration.sql"), "utf8")))).join("\n");

        for (const field of [
            "id",
            "creatorAccountId",
            "draftId",
            "sessionId",
            "machineId",
            "state",
            "closeReason",
            "progressPhase",
            "homeServerIdentityId",
            "activationSigningPublicKey",
            "authoringCommitment",
        ]) {
            expect(migrationSql).toMatch(new RegExp("`" + field + "` VARCHAR\\(191\\)"));
        }
        expect(migrationSql).toContain("FOREIGN KEY (`creatorAccountId`) REFERENCES `Account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE");
        expect(migrationSql).toContain("CREATE UNIQUE INDEX `EphemeralRunnerActivation_sessionId_key`");
        expect(migrationSql).toContain("CREATE UNIQUE INDEX `EphemeralRunnerActivation_machineId_key`");
        expect(migrationSql).toContain("ENUM('persistent', 'ephemeral_session_runner') NOT NULL DEFAULT 'persistent'");
        for (const field of [
            "runnerContentKeyBinding",
            "authenticationEvidence",
            "claim",
            "endpointFacts",
            "credentialSelection",
            "review",
            "consent",
            "readiness",
            "sealedBootstrap",
        ]) {
            // MySQL columns are nullable when NULL is omitted. The provider-backed
            // contract below verifies information_schema rather than requiring one
            // equivalent SQL spelling from every Prisma migration generation.
            expect(migrationSql).toMatch(new RegExp("`" + field + "` JSON(?: NULL)?"));
        }
        const identifiers = [...migrationSql.matchAll(/\b(?:INDEX|CONSTRAINT)\s+`([^`]+)`/gu)].map((match) => match[1]!);
        expect(identifiers.length).toBeGreaterThan(0);
        expect(identifiers.filter((identifier) => identifier.length > 64)).toEqual([]);
    });
});
