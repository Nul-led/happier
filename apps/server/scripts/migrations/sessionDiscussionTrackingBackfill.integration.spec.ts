import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
    import.meta.dirname,
    "..",
    "..",
    "prisma",
    "sqlite",
    "migrations",
    "20260905235000_add_account_session_read_state",
    "migration.sql",
);

describe("Account Session read-state migration Discussion tracking", () => {
    it("establishes every existing owner's Discussion baseline without enrolling a readable non-owner", async () => {
        const database = new DatabaseSync(":memory:");
        try {
            database.exec(`
                PRAGMA foreign_keys = ON;
                CREATE TABLE "Account" (
                    "id" TEXT NOT NULL PRIMARY KEY
                );
                CREATE TABLE "Session" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "accountId" TEXT NOT NULL,
                    "seq" INTEGER NOT NULL,
                    "lastViewedSessionSeq" INTEGER,
                    "unreadSince" DATETIME,
                    "currentStorageState" TEXT NOT NULL,
                    "acceptedThroughServerSeq" INTEGER,
                    "materializationPublicationId" TEXT,
                    "materializedThroughSourceAt" INTEGER,
                    "publishedThroughServerSeq" INTEGER,
                    FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE
                );
                CREATE TABLE "SessionDiscussion" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "sessionId" TEXT NOT NULL,
                    "messageSeq" INTEGER NOT NULL,
                    FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE
                );
                CREATE TABLE "SessionDiscussionReadState" (
                    "discussionId" TEXT NOT NULL,
                    "accountId" TEXT NOT NULL,
                    "lastReadSeq" INTEGER NOT NULL,
                    "updatedAt" DATETIME NOT NULL,
                    PRIMARY KEY ("discussionId", "accountId"),
                    FOREIGN KEY ("discussionId") REFERENCES "SessionDiscussion" ("id") ON DELETE CASCADE,
                    FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE
                );
                INSERT INTO "Account" ("id") VALUES ('owner'), ('reader');
                INSERT INTO "Session" (
                    "id", "accountId", "seq", "lastViewedSessionSeq", "unreadSince",
                    "currentStorageState", "acceptedThroughServerSeq", "materializationPublicationId",
                    "materializedThroughSourceAt", "publishedThroughServerSeq"
                ) VALUES ('session-1', 'owner', 9, 4, 1234, 'hosted', NULL, NULL, NULL, NULL);
                INSERT INTO "SessionDiscussion" ("id", "sessionId", "messageSeq") VALUES
                    ('discussion-a', 'session-1', 3),
                    ('discussion-b', 'session-1', 7);
            `);

            database.exec(await readFile(migrationPath, "utf8"));

            expect(database.prepare(`
                SELECT "discussionId", "accountId", "lastReadSeq"
                FROM "SessionDiscussionReadState"
                ORDER BY "discussionId"
            `).all()).toEqual([
                { discussionId: "discussion-a", accountId: "owner", lastReadSeq: 3 },
                { discussionId: "discussion-b", accountId: "owner", lastReadSeq: 7 },
            ]);
            expect(database.prepare(`
                SELECT COUNT(*) AS "count"
                FROM "SessionDiscussionReadState"
                WHERE "accountId" = 'reader'
            `).get()).toEqual({ count: 0 });
            expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        } finally {
            database.close();
        }
    });
});
