import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyPostgresMigrations, applySqliteMigrations } from "../prismaMigrations";

const serverRoot = join(import.meta.dirname, "../..");

describe("Session collaboration projection migration", () => {
    it.each(["sqlite", "postgres"] as const)("preserves existing Sessions and enforces nullable identity relations on %s", async (provider) => {
        const directory = await mkdtemp(join(tmpdir(), "happier-collaboration-schema-"));
        const migrationsDir = join(directory, "migrations");
        const databasePath = join(directory, "test.sqlite");
        const sqlite = provider === "sqlite" ? new DatabaseSync(databasePath) : null;
        const postgres = provider === "postgres" ? new PGlite() : null;
        const sourceRoot = join(serverRoot, provider === "sqlite" ? "prisma/sqlite/migrations" : "prisma/migrations");
        const exec = async (sql: string) => { if (sqlite) sqlite.exec(sql); else await postgres!.exec(sql); };
        const query = async (sql: string) => sqlite ? sqlite.prepare(sql).all() : (await postgres!.query(sql)).rows;
        const deploy = () => sqlite
            ? applySqliteMigrations({ databasePath, migrationsDir })
            : applyPostgresMigrations({ db: postgres!, migrationsDir });
        const stage = async (name: string) => {
            await mkdir(join(migrationsDir, name), { recursive: true });
            await writeFile(join(migrationsDir, name, "migration.sql"), await readFile(join(sourceRoot, name, "migration.sql")));
        };
        try {
            // Retained released migration bytes establish Account/Session/Message,
            // rather than a test reconstruction of their foreign keys.
            const baselineEnd = provider === "sqlite" ? "20260122190000_baseline" : "20260109044634_add_session_sharing";
            for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
                if (entry.isDirectory() && entry.name <= baselineEnd) await stage(entry.name);
            }
            await deploy();
            if (sqlite) sqlite.exec("PRAGMA foreign_keys=ON");
            await exec(`INSERT INTO "Account" ("id","publicKey","updatedAt") VALUES
                ('owner','owner-key',CURRENT_TIMESTAMP),('author','author-key',CURRENT_TIMESTAMP),
                ('responsible','responsible-key',CURRENT_TIMESTAMP);
                INSERT INTO "Session" ("id","tag","accountId","metadata","updatedAt")
                VALUES ('existing','existing','owner','{}',CURRENT_TIMESTAMP);
                INSERT INTO "SessionMessage" ("id","sessionId","seq","content","updatedAt")
                VALUES ('message','existing',1,'{}',CURRENT_TIMESTAMP);`);
            await stage("20260905220000_add_team_home_governance");
            await stage("20260905230000_add_session_message_author_projection");
            await stage("20260905230000_add_session_team_group_grants");
            await stage("20260906000000_add_session_responsible_account");
            await deploy();
            expect(await query(`SELECT "primaryTeamId" FROM "Session" WHERE "id"='existing'`)).toEqual([{ primaryTeamId: null }]);
            expect(await query(`SELECT "authorAccountId" FROM "SessionMessage" WHERE "id"='message'`)).toEqual([{ authorAccountId: null }]);
            await expect(deploy()).resolves.toEqual({ applied: [] });

            await expect(exec(`UPDATE "Session" SET "primaryTeamId"='missing' WHERE "id"='existing'`)).rejects.toThrow();
            await expect(exec(`UPDATE "SessionMessage" SET "authorAccountId"='missing' WHERE "id"='message'`)).rejects.toThrow();
            await exec(`INSERT INTO "Team" ("id","name","updatedAt") VALUES ('context','Context',CURRENT_TIMESTAMP);
                INSERT INTO "TeamGroup" ("id","teamId","name","nameKey","updatedAt")
                VALUES ('context-group','context','Context','context',CURRENT_TIMESTAMP);
                UPDATE "Session" SET "primaryTeamId"='context' WHERE "id"='existing';
                UPDATE "Session" SET "responsibleAccountId"='responsible' WHERE "id"='existing';
                INSERT INTO "SessionTeamGrant" ("sessionId","teamId","effectiveAt")
                VALUES ('existing','context',CURRENT_TIMESTAMP);
                INSERT INTO "SessionGroupGrant" ("sessionId","teamGroupId","effectiveAt")
                VALUES ('existing','context-group',CURRENT_TIMESTAMP);
                UPDATE "SessionMessage" SET "authorAccountId"='author' WHERE "id"='message';`);
            expect(await query(`SELECT "primaryTeamId","responsibleAccountId","accountId" FROM "Session" WHERE "id"='existing'`)).toEqual([
                { primaryTeamId: "context", responsibleAccountId: "responsible", accountId: "owner" },
            ]);
            expect(await query(`SELECT "accessLevel","canApprovePermissions","requiredByTeamPolicy" FROM "SessionTeamGrant" WHERE "sessionId"='existing'`)).toEqual([
                {
                    accessLevel: "view",
                    canApprovePermissions: sqlite ? 0 : false,
                    requiredByTeamPolicy: sqlite ? 0 : false,
                },
            ]);
            expect(await query(`SELECT "accessLevel","canApprovePermissions" FROM "SessionGroupGrant" WHERE "sessionId"='existing'`)).toEqual([
                { accessLevel: "view", canApprovePermissions: sqlite ? 0 : false },
            ]);
            expect(await query(`SELECT "sessionId" FROM "SessionMessage" WHERE "authorAccountId"='author'`)).toEqual([{ sessionId: "existing" }]);
            await exec(`DELETE FROM "TeamGroup" WHERE "id"='context-group';`);
            expect(await query(`SELECT "sessionId" FROM "SessionGroupGrant" WHERE "sessionId"='existing'`)).toEqual([]);
            await exec(`DELETE FROM "Team" WHERE "id"='context';
                DELETE FROM "Account" WHERE "id"='responsible';
                DELETE FROM "Account" WHERE "id"='author';`);
            expect(await query(`SELECT "primaryTeamId","responsibleAccountId" FROM "Session" WHERE "id"='existing'`)).toEqual([
                { primaryTeamId: null, responsibleAccountId: null },
            ]);
            expect(await query(`SELECT "sessionId" FROM "SessionTeamGrant" WHERE "sessionId"='existing'`)).toEqual([]);
            expect(await query(`SELECT "authorAccountId","content" FROM "SessionMessage" WHERE "id"='message'`)).toEqual([
                { authorAccountId: null, content: sqlite ? "{}" : {} },
            ]);
            if (sqlite) {
                expect(await query("PRAGMA foreign_key_check")).toEqual([]);
                expect(await query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
                expect((await query(`PRAGMA index_info('SessionMessage_authorAccountId_sessionId_idx')`)).map((row) => row.name)).toEqual(["authorAccountId", "sessionId"]);
                expect((await query(`PRAGMA index_info('Session_primaryTeamId_idx')`)).map((row) => row.name)).toEqual(["primaryTeamId"]);
            } else {
                const indexes = await query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
                    AND indexname IN ('SessionMessage_authorAccountId_sessionId_idx','Session_primaryTeamId_idx') ORDER BY indexname`);
                expect(indexes).toEqual([{ indexname: "SessionMessage_authorAccountId_sessionId_idx" }, { indexname: "Session_primaryTeamId_idx" }]);
            }
        } finally {
            sqlite?.close();
            await postgres?.close();
            await rm(directory, { recursive: true, force: true });
        }
    }, 60_000);
});
