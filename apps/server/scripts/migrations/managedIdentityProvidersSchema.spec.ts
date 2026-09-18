import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyPostgresMigrations, applySqliteMigrations } from "../prismaMigrations";

const migrationName = "20260906210000_add_managed_identity_providers";
const governanceMigrationName = "20260905220000_add_team_home_governance";
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

describe("managed identity provider persistence", () => {
    it.each(["sqlite", "postgres"] as const)("deploys twice and enforces exact same-Team source ownership on %s", async (provider) => {
        const directory = await mkdtemp(join(tmpdir(), "happier-managed-identity-schema-"));
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
        const longPresentation = `Unicode 人 🚀 ${"x".repeat(499)}`;

        try {
            await stageMigration({ migrationsDir, providerRoot, name: baseline });
            await stageMigration({ migrationsDir, providerRoot, name: governanceMigrationName });
            await stageMigration({ migrationsDir, providerRoot, name: migrationName });
            await deploy();
            await expect(deploy()).resolves.toEqual({ applied: [] });
            if (sqlite) sqlite.exec("PRAGMA foreign_keys=ON");

            await exec(`
                INSERT INTO "Account" ("id", "publicKey", "updatedAt") VALUES
                    ('account-a', 'account-a', CURRENT_TIMESTAMP),
                    ('account-b', 'account-b', CURRENT_TIMESTAMP);
                INSERT INTO "Team" ("id", "name", "updatedAt") VALUES
                    ('team-a', 'Team A', CURRENT_TIMESTAMP),
                    ('team-b', 'Team B', CURRENT_TIMESTAMP);
                INSERT INTO "TeamMembership" ("id", "teamId", "accountId", "role") VALUES
                    ('membership-a', 'team-a', 'account-a', 'member'),
                    ('membership-b', 'team-b', 'account-b', 'member');
                INSERT INTO "IdentityProviderInstance" ("id", "ownerTeamId", "kind", "displayName", "config", "updatedAt") VALUES
                    ('provider-a', 'team-a', 'workos_sso', 'WorkOS A', '{}', CURRENT_TIMESTAMP),
                    ('provider-b', 'team-b', 'workos_sso', 'WorkOS B', '{}', CURRENT_TIMESTAMP);
                INSERT INTO "TeamIdentityConnection" ("id", "teamId", "providerInstanceId", "externalReference", "settings", "updatedAt") VALUES
                    ('connection-a', 'team-a', 'provider-a', '{"v":1,"kind":"workos_sso","organizationId":"org-a","connectionId":"connection-a"}', '{"v":1,"kind":"workos_sso"}', CURRENT_TIMESTAMP),
                    ('connection-b', 'team-b', 'provider-b', '{"v":1,"kind":"workos_sso","organizationId":"org-b","connectionId":"connection-b"}', '{"v":1,"kind":"workos_sso"}', CURRENT_TIMESTAMP);
                INSERT INTO "TeamDirectorySource" ("id", "teamId", "kind", "displayName", "externalSourceKey", "bindingConfig", "teamIdentityConnectionId", "updatedAt") VALUES
                    ('source-a', 'team-a', 'workos_directory', 'Directory', 'workos:source-a', '{"v":1,"kind":"workos_directory","workosDirectoryId":"directory"}', 'connection-a', CURRENT_TIMESTAMP);
            `);

            await expect(exec(`
                INSERT INTO "TeamDirectorySource" ("id", "teamId", "kind", "displayName", "externalSourceKey", "bindingConfig", "teamIdentityConnectionId", "updatedAt")
                VALUES ('wrong-team-source', 'team-a', 'workos_directory', 'Wrong', 'workos:wrong', '{"v":1,"kind":"workos_directory","workosDirectoryId":"wrong"}', 'connection-b', CURRENT_TIMESTAMP)
            `)).rejects.toThrow();

            await expect(exec(`
                INSERT INTO "TeamMembershipIdentityConnectionManagement" ("teamMembershipId", "teamId", "teamIdentityConnectionId")
                VALUES ('membership-a', 'team-a', 'connection-b')
            `)).rejects.toThrow();
            await exec(`
                INSERT INTO "TeamMembershipIdentityConnectionManagement" ("teamMembershipId", "teamId", "teamIdentityConnectionId")
                VALUES ('membership-a', 'team-a', 'connection-a')
            `);

            await expect(exec(`
                INSERT INTO "TeamProvisionedIdentity" ("id", "directorySourceId", "teamId", "externalUserId", "state", "teamMembershipId", "teamMembershipTeamId", "updatedAt")
                VALUES ('wrong-team', 'source-a', 'team-a', 'wrong-team-user', 'active', 'membership-b', 'team-a', CURRENT_TIMESTAMP)
            `)).rejects.toThrow();
            await expect(exec(`
                INSERT INTO "TeamProvisionedIdentity" ("id", "directorySourceId", "teamId", "externalUserId", "state", "teamMembershipId", "teamMembershipTeamId", "updatedAt")
                VALUES ('cross-team-membership', 'source-a', 'team-a', 'cross-team-user', 'active', 'membership-b', 'team-b', CURRENT_TIMESTAMP)
            `)).rejects.toThrow();

            await exec(`
                INSERT INTO "TeamProvisionedIdentity" ("id", "directorySourceId", "teamId", "externalUserId", "displayName", "externalLogin", "normalizedEmail", "state", "boundAccountId", "teamMembershipId", "teamMembershipTeamId", "updatedAt")
                VALUES ('identity-a', 'source-a', 'team-a', 'CaseSensitive', '${longPresentation}', '${longPresentation}', '${longPresentation}', 'active', 'account-a', 'membership-a', 'team-a', CURRENT_TIMESTAMP);
                INSERT INTO "TeamProvisionedIdentity" ("id", "directorySourceId", "teamId", "externalUserId", "state", "updatedAt")
                VALUES ('identity-case', 'source-a', 'team-a', 'casesensitive', 'active', CURRENT_TIMESTAMP);
                INSERT INTO "TeamDirectoryGroup" ("id", "directorySourceId", "externalGroupId", "externalDisplayName", "state", "updatedAt")
                VALUES ('group-a', 'source-a', 'CaseSensitive', '${longPresentation}', 'active', CURRENT_TIMESTAMP);
                INSERT INTO "TeamDirectoryGroup" ("id", "directorySourceId", "externalGroupId", "externalDisplayName", "state", "updatedAt")
                VALUES ('group-case', 'source-a', 'casesensitive', 'case', 'active', CURRENT_TIMESTAMP);
            `);
            expect(await query(`SELECT "displayName", "externalLogin", "normalizedEmail" FROM "TeamProvisionedIdentity" WHERE "id"='identity-a'`))
                .toEqual([{ displayName: longPresentation, externalLogin: longPresentation, normalizedEmail: longPresentation }]);

            await exec(`DELETE FROM "TeamMembership" WHERE "id"='membership-a'`);
            expect(await query(`SELECT "teamId", "teamMembershipId" FROM "TeamProvisionedIdentity" WHERE "id"='identity-a'`))
                .toEqual([{ teamId: "team-a", teamMembershipId: null }]);
            await exec(`DELETE FROM "TeamDirectorySource" WHERE "id"='source-a'`);
            expect(await query(`SELECT "id" FROM "TeamProvisionedIdentity"`)).toEqual([]);
            expect(await query(`SELECT "id" FROM "Team" ORDER BY "id"`)).toEqual([{ id: "team-a" }, { id: "team-b" }]);
            expect(await query(`SELECT "id" FROM "Account" ORDER BY "id"`)).toEqual([{ id: "account-a" }, { id: "account-b" }]);

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

    it("keeps MySQL accepted values exact, indexable, and identifier-portable", async () => {
        const sql = await readFile(join(serverRoot, "prisma/mysql/migrations", migrationName, "migration.sql"), "utf8");
        const schema = await readFile(join(serverRoot, "prisma/mysql/schema.prisma"), "utf8");
        const exactUtf8 = "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin";
        for (const [field, width] of [
            ["externalSourceKey", 64],
            ["externalUserId", 256],
            ["externalSubjectId", 512],
            ["externalGroupId", 256],
            ["eventCursor", 512],
        ] as const) {
            expect(sql).toMatch(new RegExp("`" + field + "` VARCHAR\\(" + width + "\\) " + exactUtf8));
            expect(schema).toMatch(new RegExp(field + "\\s+String\\??[^\\n]*@db\\.VarChar\\(" + width + "\\)"));
        }
        expect(sql.match(new RegExp(
            "`lastSeenReconcileRunId` VARCHAR\\(512\\) " + exactUtf8 + " NULL",
            "gu",
        ))).toHaveLength(3);
        expect(schema.match(/lastSeenReconcileRunId\s+String\?[^\n]*@db\.VarChar\(512\)/gu)).toHaveLength(3);
        expect(sql).toContain("`normalizedEmail` VARCHAR(512) NULL");
        expect(sql).toContain("`displayName` VARCHAR(512) NULL");
        expect(sql).toContain("`externalLogin` VARCHAR(512) NULL");
        expect(sql).toContain("`externalDisplayName` VARCHAR(512) NOT NULL");
        expect(sql).toContain("`displayName` VARCHAR(256) NOT NULL");
        expect(sql).toContain("`lastSuccessfulTestRuntimeFingerprint` VARCHAR(1024) NULL");
        expect(sql).toContain("`githubHost` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL");
        expect(sql).not.toMatch(/COLLATE utf8mb4_bin\b/u);
        expect(sql).toContain("`githubClientId` VARCHAR(256) NOT NULL");
        expect(sql).toContain("`githubAppSlug` VARCHAR(256) NULL");
        expect(sql).toContain("`githubOwnerLogin` VARCHAR(256) NULL");
        expect(sql).toContain("`githubOrganizationLogin` VARCHAR(256) NOT NULL");
        expect(sql).toContain("FOREIGN KEY (`directorySourceId`, `teamId`) REFERENCES `TeamDirectorySource`(`id`, `teamId`)");
        expect(sql).toContain("FOREIGN KEY (`teamMembershipId`, `teamMembershipTeamId`) REFERENCES `TeamMembership`(`id`, `teamId`)");
        // MySQL rejects a CHECK that reads the nullable membership columns
        // because their composite FK uses ON DELETE SET NULL (error 3823).
        // Provider-native write-boundary triggers retain the exact same pair
        // and Team invariant without weakening the FK lifecycle.
        expect(sql).not.toContain("TeamProvisionedIdentity_membership_team_check");
        expect(sql).toContain("CREATE TRIGGER `TeamProvisionedIdentity_membership_team_insert`");
        expect(sql).toContain("CREATE TRIGGER `TeamProvisionedIdentity_membership_team_update`");
        expect(sql.match(/SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TeamProvisionedIdentity membership must belong to the same Team'/gu)).toHaveLength(2);
        expect(sql).not.toMatch(/SET NEW\.`directorySourceId` = CASE WHEN/gu);
        expect(sql).toContain("PRIMARY KEY (`directorySourceId`, `externalGroupId`, `externalUserId`)");
        // MySQL's admitted utf8mb4 index ceiling is 3072 bytes. Keep the
        // accepted Protocol maxima (256 code units) instead of shrinking the
        // product contract to work around the physical key.
        expect((191 + 256 + 256) * 4).toBeLessThanOrEqual(3072);
        const identifiers = [...sql.matchAll(/\b(?:INDEX|CONSTRAINT)\s+`([^`]+)`/gu)].map((match) => match[1]!);
        expect(identifiers.length).toBeGreaterThan(0);
        expect(identifiers.filter((identifier) => identifier.length > 64)).toEqual([]);
    });
});
