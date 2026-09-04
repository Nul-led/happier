import { createHash } from "node:crypto";
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
// Immutable release basis: server-v0.2.1 at 4913c1e533c872a0712ba1c25b3104fd470aacc2.
// Current predecessor basis: ../0.2 at a7305433ac9e3dffdba4d24e82e2bea068c623b3,
// including its dirty replacement bytes for 20260902120000. The aggregate hashes below pin
// every migration ID and SQL byte so this fixture cannot silently borrow changed 0.3 history.
const currentPredecessorLaterIds = [
    "20260504110500_add_account_pet_library",
    "20260506193000_add_session_runtime_issue_projection",
    "20260512130000_add_machine_installation_identity",
    "20260513143000_add_session_folder_assignment",
    "20260514100000_add_session_message_role_metadata",
    "20260517150000_add_session_meaningful_activity_at",
    "20260517173000_add_connected_service_auth_groups",
    "20260517190000_add_session_turns",
    "20260517200000_add_connected_service_auth_group_member_credential_fk",
    "20260519183000_add_session_system_records",
    "20260520110000_add_session_attention_projection_facts",
    "20260523154000_add_account_settings_snapshots",
    "20260624123000_add_pending_delivery_state",
    "20260630162000_add_provider_account_usage_records",
    "20260630170000_add_session_organization_models",
    quotaDropId,
    "20260701123000_add_session_runtime_activity_projection",
    "20260723210000_drop_public_share_blocked_users",
    "20260723220000_add_connected_service_auth_group_runtime_state_revision",
    "20260803201500_add_session_publisher_generation",
    "20260807120000_add_session_unread_since",
    "20260808120000_add_session_needs_attention",
    "20260810190000_add_session_message_row_revision",
    "20260810200000_expand_session_turn_anchor_projection",
    "20260816230000_add_manual_automation_triggers",
    "20260819120000_add_session_attention_standing",
    "20260902120000_add_pending_activation_authorization",
] as const;
const predecessorSqlDigests = {
    "released-v0.2.1": "e8727e472791d7de236f2cfa1ef7e8da7c179cbc97c3e137df2eb00b3b9873e5",
    "current-0.2": "22a64155dbbc987ebb8bb1fbfbcf1f82fad8065bb37c935fd5c03e953f458227",
} as const;
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
    const predecessorMigrationIds = (await listCurrentMigrationIds())
        .filter((id) => id <= releasedPredecessorLastId);
    for (const id of predecessorMigrationIds) {
        await copyMigration(id, migrationsDir);
    }
    if (frontier === "released-v0.2.1") return predecessorMigrationIds;

    for (const id of currentPredecessorLaterIds) {
        if (id !== quotaDropId) await copyMigration(id, migrationsDir);
    }

    const quotaDropDir = join(migrationsDir, quotaDropId);
    await mkdir(quotaDropDir, { recursive: true });
    await writeFile(
        join(quotaDropDir, "migration.sql"),
        'DROP TABLE IF EXISTS "ServiceAccountQuotaSnapshot";\n',
        "utf8",
    );
    return [...predecessorMigrationIds, ...currentPredecessorLaterIds].sort((left, right) => left.localeCompare(right));
}

async function digestMigrationSql(migrationsDir: string, ids: readonly string[]): Promise<string> {
    const hash = createHash("sha256");
    for (const id of ids) {
        hash.update(id);
        hash.update("\0");
        hash.update(await readFile(join(migrationsDir, id, "migration.sql")));
        hash.update("\0");
    }
    return hash.digest("hex");
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
    const predecessorIds = frontier === "released-v0.2.1"
        ? currentMigrationIds.filter((id) => id <= releasedPredecessorLastId)
        : [
            ...currentMigrationIds.filter((id) => id <= releasedPredecessorLastId),
            ...currentPredecessorLaterIds,
        ];
    const predecessorIdSet = new Set(predecessorIds);
    return currentMigrationIds.filter((id) => !predecessorIdSet.has(id));
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
        expect(await digestMigrationSql(migrationsDir, predecessorMigrationIds)).toBe(predecessorSqlDigests[frontier]);
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
