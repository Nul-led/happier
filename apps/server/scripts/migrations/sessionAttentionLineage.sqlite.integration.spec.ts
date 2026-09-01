import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../../generated/sqlite-client/index.js";
import { applySqliteMigrations } from "../prismaMigrations";

const serverRoot = join(import.meta.dirname, "..", "..");
const sqliteMigrationsRoot = join(serverRoot, "prisma", "sqlite", "migrations");
const quotaDropId = "20260630223000_drop_service_account_quota_snapshots";
const releasedPredecessorLastId = "20260326130000_add_pending_queue_seq";
const currentPredecessorLastId = "20260723220000_add_connected_service_auth_group_runtime_state_revision";
type PredecessorFrontier = "released-v0.2.1" | "current-0.2";

async function copyMigration(sourceId: string, targetRoot: string): Promise<void> {
    const targetDir = join(targetRoot, sourceId);
    await mkdir(targetDir, { recursive: true });
    await writeFile(
        join(targetDir, "migration.sql"),
        await readFile(join(sqliteMigrationsRoot, sourceId, "migration.sql"), "utf8"),
        "utf8",
    );
}

async function listCurrentMigrationIds(): Promise<string[]> {
    return (await readdir(sqliteMigrationsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function preparePredecessorLedger(
    migrationsDir: string,
    frontier: PredecessorFrontier,
): Promise<string[]> {
    const lastMigrationId = frontier === "released-v0.2.1"
        ? releasedPredecessorLastId
        : currentPredecessorLastId;
    const predecessorMigrationIds = (await listCurrentMigrationIds())
        .filter((id) => id <= lastMigrationId);
    for (const id of predecessorMigrationIds) {
        await copyMigration(id, migrationsDir);
    }
    if (frontier === "released-v0.2.1") return predecessorMigrationIds;

    const quotaDropDir = join(migrationsDir, quotaDropId);
    await mkdir(quotaDropDir, { recursive: true });
    await writeFile(
        join(quotaDropDir, "migration.sql"),
        'DROP TABLE IF EXISTS "ServiceAccountQuotaSnapshot";\n',
        "utf8",
    );
    return [...predecessorMigrationIds, quotaDropId].sort((left, right) => left.localeCompare(right));
}

async function appendCurrentMigrations(
    migrationsDir: string,
    frontier: PredecessorFrontier,
): Promise<string[]> {
    await rm(join(migrationsDir, quotaDropId), { recursive: true, force: true });
    const currentMigrationIds = await listCurrentMigrationIds();
    for (const id of currentMigrationIds) {
        await copyMigration(id, migrationsDir);
    }
    const lastMigrationId = frontier === "released-v0.2.1"
        ? releasedPredecessorLastId
        : currentPredecessorLastId;
    return currentMigrationIds.filter((id) => id > lastMigrationId);
}

async function seedReleasedQuotaRow(databasePath: string): Promise<void> {
    const database = new DatabaseSync(databasePath);
    try {
        database.prepare('INSERT INTO "Account" ("id", "publicKey", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)')
            .run("preserved-quota-account", "preserved-quota-public-key");
        database.prepare(`
            INSERT INTO "ServiceAccountQuotaSnapshot" (
                "id", "accountId", "vendor", "profileId", "snapshot", "status",
                "fetchedAt", "staleAfterMs", "metadata", "updatedAt"
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            "preserved-quota-row",
            "preserved-quota-account",
            "anthropic",
            "default",
            new TextEncoder().encode("sealed-preserved-quota"),
            "ok",
            60_000,
            JSON.stringify({ v: 1, format: "account_scoped_v1" }),
        );
    } finally {
        database.close();
    }
}

describe("SQLite 0.2 migration lineage before Account Directory", () => {
    const temporaryPaths: string[] = [];

    afterEach(async () => {
        await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    });

    async function createPredecessorDatabase(frontier: PredecessorFrontier): Promise<Readonly<{
        databasePath: string;
        migrationsDir: string;
    }>> {
        const migrationsDir = await mkdtemp(join(tmpdir(), "happier-account-directory-lineage-migrations-"));
        const dataDir = await mkdtemp(join(tmpdir(), "happier-account-directory-lineage-db-"));
        temporaryPaths.push(migrationsDir, dataDir);
        const databasePath = join(dataDir, "lineage.sqlite");

        const predecessorMigrationIds = await preparePredecessorLedger(migrationsDir, frontier);
        const predecessorResult = await applySqliteMigrations({ databasePath, migrationsDir });
        expect(predecessorResult.applied).toEqual(predecessorMigrationIds);

        const predecessor = new DatabaseSync(databasePath);
        try {
            const quotaTable =
                predecessor.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
                    .get("ServiceAccountQuotaSnapshot");
            if (frontier === "current-0.2") expect(quotaTable).toBeUndefined();
            else expect(quotaTable).toEqual({ name: "ServiceAccountQuotaSnapshot" });
        } finally {
            predecessor.close();
        }

        return { databasePath, migrationsDir };
    }

    it("recreates quota storage after the current 0.2 DROP and deploys current migrations twice", async () => {
        const { databasePath, migrationsDir } = await createPredecessorDatabase("current-0.2");
        const currentMigrationIds = await appendCurrentMigrations(migrationsDir, "current-0.2");

        await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({
            applied: currentMigrationIds,
        });
        await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({ applied: [] });

        const deployed = new DatabaseSync(databasePath);
        try {
            const sessionSql = deployed
                .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'Session'")
                .get() as { sql?: string } | undefined;
            expect(sessionSql?.sql).toContain('"unreadSince"');
            expect(sessionSql?.sql).toContain('"needsAttention"');
            expect(deployed.prepare(
                "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?",
            ).get("Session_accountId_needsAttention_meaningfulActivityAt_id_idx")).toEqual({
                name: "Session_accountId_needsAttention_meaningfulActivityAt_id_idx",
            });
        } finally {
            deployed.close();
        }

        const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
        try {
            const account = await prisma.account.create({
                data: { publicKey: "quota-compatibility-query-account" },
                select: { id: true },
            });
            await prisma.serviceAccountQuotaSnapshot.create({
                data: {
                    accountId: account.id,
                    vendor: "anthropic",
                    profileId: "default",
                    snapshot: new TextEncoder().encode("sealed-quota"),
                    status: "ok",
                },
            });
            await expect(prisma.serviceAccountQuotaSnapshot.findUnique({
                where: {
                    accountId_vendor_profileId: {
                        accountId: account.id,
                        vendor: "anthropic",
                        profileId: "default",
                    },
                },
                select: { snapshot: true, status: true },
            })).resolves.toEqual({
                snapshot: new TextEncoder().encode("sealed-quota"),
                status: "ok",
            });
        } finally {
            await prisma.$disconnect();
        }
    });

    it("preserves the released 0.2.1 quota table and its rows across two current deploys", async () => {
        const { databasePath, migrationsDir } = await createPredecessorDatabase("released-v0.2.1");
        await seedReleasedQuotaRow(databasePath);
        await appendCurrentMigrations(migrationsDir, "released-v0.2.1");

        await applySqliteMigrations({ databasePath, migrationsDir });
        await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({ applied: [] });

        const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
        try {
            await expect(prisma.serviceAccountQuotaSnapshot.findUnique({
                where: {
                    accountId_vendor_profileId: {
                        accountId: "preserved-quota-account",
                        vendor: "anthropic",
                        profileId: "default",
                    },
                },
                select: { id: true, snapshot: true, status: true },
            })).resolves.toEqual({
                id: "preserved-quota-row",
                snapshot: new TextEncoder().encode("sealed-preserved-quota"),
                status: "ok",
            });
        } finally {
            await prisma.$disconnect();
        }
    });
});
