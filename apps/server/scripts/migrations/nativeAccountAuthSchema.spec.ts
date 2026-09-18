import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "../..");
const migrationId = "20260905210000_add_native_account_auth";

describe("native Account authentication persistence", () => {
    it.each(["postgres", "sqlite"] as const)("preserves full-length locators, evidence cardinality, credential CAS and cascade on %s", async (provider) => {
        const sqlite = provider === "sqlite" ? new DatabaseSync(":memory:") : null;
        const postgres = provider === "postgres" ? new PGlite() : null;
        const exec = async (sql: string) => { if (sqlite) sqlite.exec(sql); else await postgres!.exec(sql); };
        const query = async (sql: string) => sqlite
            ? sqlite.prepare(sql).all()
            : (await postgres!.query(sql)).rows;
        const root = provider === "sqlite" ? "prisma/sqlite" : "prisma";
        try {
            if (sqlite) sqlite.exec("PRAGMA foreign_keys=ON");
            await exec(`CREATE TABLE "Account" ("id" TEXT PRIMARY KEY);`);
            // The native migration extends the canonical transition owner so a
            // password-backed mode change can commit its replacement credential
            // atomically. Keep that real predecessor boundary present without
            // reconstructing the transition owner's unrelated staging tables.
            await exec(`CREATE TABLE "AccountEncryptionTransition" ("id" TEXT PRIMARY KEY);`);
            // The auth-hardening owner also extends the released terminal
            // request lifecycle with credential-local authentication evidence.
            // This focused harness needs that real predecessor table just as a
            // full migration deployment does.
            await exec(`CREATE TABLE "TerminalAuthRequest" ("id" TEXT PRIMARY KEY);`);
            // Retained released identity migration: server-v0.2.11 / preview.2,
            // 98ea8fb76733b1dd785d38c31360179cafa84824. No reconstructed uniqueness fixture.
            await exec(await readFile(join(serverRoot, root, "migrations/20260205103927_add_account_identity/migration.sql"), "utf8"));
            await exec(await readFile(join(serverRoot, root, "migrations/20260822150000_auth_hardening_and_api_tokens/migration.sql"), "utf8"));
            await exec(await readFile(join(serverRoot, root, "migrations", migrationId, "migration.sql"), "utf8"));
            const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(63)}`;
            expect(email.length).toBe(320);
            const changedEmail = `z${email.slice(1)}`;
            const opaqueSubject = "S".repeat(512);
            const providerLogin = "l".repeat(320);
            await exec(`INSERT INTO "Account" ("id") VALUES ('one'), ('two');
                INSERT INTO "AccountIdentity" ("id", "accountId", "provider", "providerUserId", "updatedAt")
                VALUES ('identity', 'one', 'email', '${email}', CURRENT_TIMESTAMP);
                INSERT INTO "AccountIdentity" ("id", "accountId", "provider", "providerUserId", "providerLogin", "updatedAt")
                VALUES ('external-identity', 'two', 'workos', '${opaqueSubject}', '${providerLogin}', CURRENT_TIMESTAMP);
                INSERT INTO "AccountEmail" ("accountId", "address", "normalizedEmail")
                VALUES ('one', '${email}', '${email}'), ('two', '${email}', '${email}');
                INSERT INTO "AccountPasswordCredential" ("accountId", "credential") VALUES ('one', '{"v":1}');
                INSERT INTO "AccountApiToken" ("id", "accountId", "displayPrefix", "secretDigest", "label") VALUES ('token', 'one', 'prefix', 'digest', 'label');
                INSERT INTO "KeyChallengeV2" ("id", "nonce", "issuedAt", "expiresAt", "audienceOrigin") VALUES ('login', 'nonce', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'https://example.test');`);
            expect(await query(`SELECT "accountId" FROM "AccountIdentity" WHERE "provider"='email' AND "providerUserId"='${email}'`)).toEqual([{ accountId: "one" }]);
            expect(await query(`SELECT "accountId" FROM "AccountIdentity" WHERE "provider"='workos' AND "providerUserId"='${opaqueSubject}'`)).toEqual([{ accountId: "two" }]);
            expect(await query(`SELECT "providerLogin" FROM "AccountIdentity" WHERE "id"='external-identity'`)).toEqual([{ providerLogin }]);
            expect(await query(`SELECT "accountId" FROM "AccountEmail" WHERE "normalizedEmail"='${email}' ORDER BY "accountId"`)).toEqual([{ accountId: "one" }, { accountId: "two" }]);
            await expect(exec(`INSERT INTO "AccountEmail" ("accountId", "address", "normalizedEmail") VALUES ('one','${email}','${email}')`)).rejects.toThrow();
            await expect(exec(`INSERT INTO "AccountIdentity" ("id", "accountId", "provider", "providerUserId", "updatedAt") VALUES ('collision','two','email','${email}',CURRENT_TIMESTAMP)`)).rejects.toThrow();
            await exec(`UPDATE "AccountIdentity" SET "providerUserId"='${changedEmail}' WHERE "id"='identity'`);
            expect(await query(`SELECT "providerUserId" FROM "AccountIdentity" WHERE "accountId"='one'`)).toEqual([{ providerUserId: changedEmail }]);
            expect(await query(`SELECT "encryptionAccess", "authenticationEvidence" FROM "AccountApiToken"`)).toEqual([{
                encryptionAccess: null,
                authenticationEvidence: null,
            }]);
            expect(await query(`SELECT "authenticationEvidence", "approvalTokenEpoch" FROM "TerminalAuthRequest"`)).toEqual([]);
            expect(await query(`SELECT "operationKind", "operationDigest", "verifiedNativeMethodId" FROM "KeyChallengeV2"`)).toEqual([{
                operationKind: null,
                operationDigest: null,
                verifiedNativeMethodId: null,
            }]);
            await exec(`BEGIN;
                UPDATE "AccountPasswordCredential" SET "revision"=2 WHERE "accountId"='one' AND "revision"=1;
                UPDATE "KeyChallengeV2" SET "consumedAt"=CURRENT_TIMESTAMP WHERE "id"='login';
                ROLLBACK;`);
            expect(await query(`SELECT "revision" FROM "AccountPasswordCredential"`)).toEqual([{ revision: 1 }]);
            expect(await query(`SELECT "consumedAt" FROM "KeyChallengeV2"`)).toEqual([{ consumedAt: null }]);
            await exec(`UPDATE "AccountPasswordCredential" SET "revision"=2 WHERE "accountId"='one' AND "revision"=1;
                UPDATE "AccountPasswordCredential" SET "revision"=3 WHERE "accountId"='one' AND "revision"=1;`);
            expect(await query(`SELECT "revision" FROM "AccountPasswordCredential"`)).toEqual([{ revision: 2 }]);
            await expect(exec(`INSERT INTO "AccountPasswordCredential" ("accountId","credential") VALUES ('missing','{}')`)).rejects.toThrow();
            await exec(`DELETE FROM "Account" WHERE "id"='one'`);
            expect(await query(`SELECT "accountId" FROM "AccountPasswordCredential"`)).toEqual([]);
            expect(await query(`SELECT "accountId" FROM "AccountIdentity"`)).toEqual([{ accountId: "two" }]);
            expect(await query(`SELECT "accountId" FROM "AccountEmail"`)).toEqual([{ accountId: "two" }]);
        } finally {
            sqlite?.close();
            await postgres?.close();
        }
    });

    it("keeps MySQL native locators full-length, exact, and within identifier limits", async () => {
        const authHardeningSql = await readFile(join(
            serverRoot,
            "prisma/mysql/migrations/20260822150000_auth_hardening_and_api_tokens/migration.sql",
        ), "utf8");
        const nativeSql = await readFile(join(
            serverRoot,
            "prisma/mysql/migrations",
            migrationId,
            "migration.sql",
        ), "utf8");

        expect(nativeSql).toContain(
            "`providerUserId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL",
        );
        expect(nativeSql).toContain("`providerLogin` VARCHAR(320) NULL");
        expect(nativeSql).toContain("`address` VARCHAR(320) NOT NULL");
        expect(nativeSql).toContain(
            "`normalizedEmail` VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL",
        );
        expect(authHardeningSql).toContain("`encryptionAccess` JSON NULL");
        expect(authHardeningSql).toContain("`authenticationEvidence` JSON NULL");
        expect(authHardeningSql).toContain("`verifiedNativeMethodId` VARCHAR(191) NULL");
        expect(authHardeningSql).toContain("`approvalTokenEpoch` INTEGER NULL");

        const ownedSql = `${authHardeningSql}\n${nativeSql}`;
        const namedIdentifiers = [...ownedSql.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/gu)]
            .map((match) => match[1]!);
        expect(namedIdentifiers.filter((identifier) => identifier.length > 64)).toEqual([]);
    });
});
