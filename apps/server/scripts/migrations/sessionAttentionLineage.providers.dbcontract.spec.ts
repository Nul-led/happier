import { createHash, randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient as PostgresPrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaClient as MysqlPrismaClient } from "../../generated/mysql-client/index.js";
import { runPrismaCli } from "../prismaCli";

type Provider = "postgres" | "mysql";
type PredecessorFrontier = "released-v0.2.1" | "current-0.2";

const serverRoot = join(import.meta.dirname, "..", "..");
const quotaDropId = "20260630223000_drop_service_account_quota_snapshots";
// Immutable `server-v0.2.1` (4913c1e533c872a0712ba1c25b3104fd470aacc2) ends at this migration for both
// providers. Its migration IDs and SQL are byte-identical to these retained
// 0.3 assets. The later list is the observed current `../0.2` frontier at
// a7305433ac9e3dffdba4d24e82e2bea068c623b3 plus its dirty replacement bytes
// for 20260902120000; its
// shared SQL is likewise byte-identical, while the quota DROP is intentionally
// absent from 0.3 and is reconstructed explicitly below.
const earlyPredecessorLastId = "20260326130000_add_pending_queue_seq";
const postgresOnlyPredecessorIds = [
    "20260412172000_add_account_push_token_client_server_url",
] as const;
const laterPredecessorIds = [
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
    postgres: {
        "released-v0.2.1": "0a31526e800c3834ed539725130d7f15e71585045599ce59d019f7bef1594851",
        "current-0.2": "900f876103c9a3bac7163a9a7cfbd7e4533083bd23838a6e860fb2904b6a61d7",
    },
    mysql: {
        "released-v0.2.1": "f9c377792f5a8c3770ed9ab6ef24451a577c1b85454945de7ae1dd88a6ad36f5",
        "current-0.2": "3d462a0f149abdc8d521f9f21d318b5e8d553ed7b1c425aff34c3af05110e2f0",
    },
} as const;

function migrationsRoot(provider: Provider): string {
    return provider === "postgres"
        ? join(serverRoot, "prisma", "migrations")
        : join(serverRoot, "prisma", "mysql", "migrations");
}

function prismaRoot(provider: Provider): string {
    return provider === "postgres"
        ? join(serverRoot, "prisma")
        : join(serverRoot, "prisma", "mysql");
}

async function currentMigrationIds(provider: Provider): Promise<string[]> {
    return (await readdir(migrationsRoot(provider), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function predecessorMigrationIds(provider: Provider, frontier: PredecessorFrontier): Promise<string[]> {
    const early = (await currentMigrationIds(provider)).filter((id) => id <= earlyPredecessorLastId);
    if (frontier === "released-v0.2.1") return early;
    return [
        ...early,
        ...(provider === "postgres" ? postgresOnlyPredecessorIds : []),
        ...laterPredecessorIds,
    ].sort((left, right) => left.localeCompare(right));
}

async function copyMigration(provider: Provider, id: string, targetRoot: string): Promise<void> {
    if (id === quotaDropId) {
        const targetDir = join(targetRoot, id);
        await mkdir(targetDir, { recursive: true });
        await writeFile(
            join(targetDir, "migration.sql"),
            provider === "postgres"
                ? 'DROP TABLE IF EXISTS "ServiceAccountQuotaSnapshot";\n'
                : "DROP TABLE IF EXISTS `ServiceAccountQuotaSnapshot`;\n",
            "utf8",
        );
        return;
    }
    await cp(join(migrationsRoot(provider), id), join(targetRoot, id), { recursive: true });
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

async function createStagedPredecessor(
    provider: Provider,
    frontier: PredecessorFrontier,
): Promise<Readonly<{
    stageDir: string;
    stagedMigrationsDir: string;
}>> {
    const stageDir = await mkdtemp(join(tmpdir(), `happier-${provider}-predecessor-lineage-`));
    const stagedMigrationsDir = join(stageDir, "migrations");
    await mkdir(stagedMigrationsDir, { recursive: true });
    await copyFile(join(prismaRoot(provider), "schema.prisma"), join(stageDir, "schema.prisma"));
    await copyFile(
        join(migrationsRoot(provider), "migration_lock.toml"),
        join(stagedMigrationsDir, "migration_lock.toml"),
    );
    const migrationIds = await predecessorMigrationIds(provider, frontier);
    for (const id of migrationIds) {
        await copyMigration(provider, id, stagedMigrationsDir);
    }
    expect(await digestMigrationSql(stagedMigrationsDir, migrationIds)).toBe(predecessorSqlDigests[provider][frontier]);
    return { stageDir, stagedMigrationsDir };
}

async function replacePredecessorWithCurrentMigrations(
    provider: Provider,
    stagedMigrationsDir: string,
): Promise<void> {
    await rm(join(stagedMigrationsDir, quotaDropId), { recursive: true, force: true });
    for (const id of await currentMigrationIds(provider)) {
        const target = join(stagedMigrationsDir, id);
        await rm(target, { recursive: true, force: true });
        await cp(join(migrationsRoot(provider), id), target, { recursive: true });
    }
}

async function deploy(provider: Provider, stageDir: string, databaseUrl: string): Promise<void> {
    await runPrismaCli({
        serverRoot,
        args: ["migrate", "deploy", "--schema", join(stageDir, "schema.prisma")],
        env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            HAPPIER_DB_PROVIDER: provider,
        },
        quiet: true,
    });
}

function providerDatabaseUrl(provider: Provider): string | null {
    const dedicated = provider === "postgres"
        ? process.env.HAPPIER_TEST_POSTGRES_DATABASE_URL
        : process.env.HAPPIER_TEST_MYSQL_DATABASE_URL;
    if (dedicated?.trim()) return dedicated.trim();

    const configuredProvider = String(
        process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "",
    ).trim().toLowerCase();
    const providerMatches = provider === "postgres"
        ? configuredProvider === "postgres" || configuredProvider === "postgresql"
        : configuredProvider === "mysql";
    return providerMatches && process.env.DATABASE_URL?.trim()
        ? process.env.DATABASE_URL.trim()
        : null;
}

function postgresSchemaUrl(databaseUrl: string, schema: string): string {
    const url = new URL(databaseUrl);
    url.searchParams.set("schema", schema);
    return url.toString();
}

function mysqlDatabaseUrl(databaseUrl: string, database: string): string {
    const url = new URL(databaseUrl);
    url.pathname = `/${database}`;
    return url.toString();
}

const predecessorCases = [
    { frontier: "released-v0.2.1", preservesQuotaRow: true },
    { frontier: "current-0.2", preservesQuotaRow: false },
] as const satisfies ReadonlyArray<Readonly<{
    frontier: PredecessorFrontier;
    preservesQuotaRow: boolean;
}>>;

describe.each(predecessorCases)("$frontier migration lineage before Account Directory", ({
    frontier,
    preservesQuotaRow,
}) => {
    const temporaryPaths: string[] = [];

    afterEach(async () => {
        await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    });

    const postgresUrl = providerDatabaseUrl("postgres");
    const postgresTest = postgresUrl ? it : it.skip;
    postgresTest(
        `upgrades PostgreSQL twice without losing predecessor state${
            postgresUrl ? "" : " [skipped: HAPPIER_TEST_POSTGRES_DATABASE_URL is absent]"
        }`,
        async () => {
            if (!postgresUrl) return;
            const schema = `lane02_lineage_${randomUUID().replace(/-/gu, "")}`;
            const admin = new PostgresPrismaClient({ datasourceUrl: postgresUrl });
            const databaseUrl = postgresSchemaUrl(postgresUrl, schema);
            const database = new PostgresPrismaClient({ datasourceUrl: databaseUrl });
            const staged = await createStagedPredecessor("postgres", frontier);
            temporaryPaths.push(staged.stageDir);
            try {
                await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
                await deploy("postgres", staged.stageDir, databaseUrl);
                const predecessorQuotaTables = await database.$queryRawUnsafe<Array<{ table_name: string }>>(
                    `SELECT table_name FROM information_schema.tables
                     WHERE table_schema = current_schema()
                       AND table_name = 'ServiceAccountQuotaSnapshot'`,
                );
                expect(predecessorQuotaTables).toHaveLength(preservesQuotaRow ? 1 : 0);
                if (preservesQuotaRow) {
                    await database.$executeRawUnsafe(
                        `INSERT INTO "Account" ("id", "publicKey", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)`,
                        "preserved-quota-account",
                        "preserved-quota-public-key",
                    );
                    await database.$executeRawUnsafe(
                        `INSERT INTO "ServiceAccountQuotaSnapshot"
                            ("id", "accountId", "vendor", "profileId", "snapshot", "status", "updatedAt")
                         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
                        "preserved-quota-row",
                        "preserved-quota-account",
                        "anthropic",
                        "default",
                        Buffer.from("sealed-preserved-quota"),
                        "ok",
                    );
                } else {
                    await expect(database.$queryRawUnsafe(
                        `SELECT indexname FROM pg_indexes
                         WHERE schemaname = current_schema()
                           AND indexname = 'Session_accountId_needsAttention_meaningfulActivityAt_id_idx'`,
                    )).resolves.toHaveLength(1);
                }

                await replacePredecessorWithCurrentMigrations("postgres", staged.stagedMigrationsDir);
                await deploy("postgres", staged.stageDir, databaseUrl);
                const ledgerBeforeSecondDeploy = await database.$queryRawUnsafe<Array<{ migration_name: string }>>(
                    `SELECT migration_name FROM "_prisma_migrations"
                     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
                );
                await deploy("postgres", staged.stageDir, databaseUrl);
                const ledgerAfterSecondDeploy = await database.$queryRawUnsafe<Array<{ migration_name: string }>>(
                    `SELECT migration_name FROM "_prisma_migrations"
                     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
                );

                expect(ledgerAfterSecondDeploy).toEqual(ledgerBeforeSecondDeploy);
                const quotaRows = await database.$queryRawUnsafe(
                    `SELECT "id", "status", encode("snapshot", 'hex') AS "snapshotHex"
                     FROM "ServiceAccountQuotaSnapshot" WHERE "id" = 'preserved-quota-row'`,
                );
                expect(quotaRows).toEqual(preservesQuotaRow ? [{
                    id: "preserved-quota-row",
                    status: "ok",
                    snapshotHex: Buffer.from("sealed-preserved-quota").toString("hex"),
                }] : []);
                await expect(database.$queryRawUnsafe(
                    `SELECT indexname FROM pg_indexes
                     WHERE schemaname = current_schema()
                       AND indexname = 'Session_accountId_needsAttention_meaningfulActivityAt_id_idx'`,
                )).resolves.toHaveLength(1);
            } finally {
                await database.$disconnect();
                await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
                await admin.$disconnect();
            }
        },
        240_000,
    );

    const mysqlUrl = providerDatabaseUrl("mysql");
    const mysqlTest = mysqlUrl ? it : it.skip;
    mysqlTest(
        `upgrades MySQL twice without losing predecessor state${
            mysqlUrl ? "" : " [skipped: HAPPIER_TEST_MYSQL_DATABASE_URL is absent]"
        }`,
        async () => {
            if (!mysqlUrl) return;
            const databaseName = `lane02_lineage_${randomUUID().replace(/-/gu, "")}`;
            const admin = new MysqlPrismaClient({ datasourceUrl: mysqlUrl });
            const databaseUrl = mysqlDatabaseUrl(mysqlUrl, databaseName);
            const database = new MysqlPrismaClient({ datasourceUrl: databaseUrl });
            const staged = await createStagedPredecessor("mysql", frontier);
            temporaryPaths.push(staged.stageDir);
            try {
                await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\``);
                await deploy("mysql", staged.stageDir, databaseUrl);
                const predecessorQuotaTables = await database.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
                    `SELECT TABLE_NAME FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'ServiceAccountQuotaSnapshot'`,
                );
                expect(predecessorQuotaTables).toHaveLength(preservesQuotaRow ? 1 : 0);
                if (preservesQuotaRow) {
                    await database.$executeRawUnsafe(
                        "INSERT INTO `Account` (`id`, `publicKey`, `updatedAt`) VALUES (?, ?, CURRENT_TIMESTAMP(3))",
                        "preserved-quota-account",
                        "preserved-quota-public-key",
                    );
                    await database.$executeRawUnsafe(
                        `INSERT INTO \`ServiceAccountQuotaSnapshot\`
                            (\`id\`, \`accountId\`, \`vendor\`, \`profileId\`, \`snapshot\`, \`status\`, \`updatedAt\`)
                         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
                        "preserved-quota-row",
                        "preserved-quota-account",
                        "anthropic",
                        "default",
                        Buffer.from("sealed-preserved-quota"),
                        "ok",
                    );
                } else {
                    await expect(database.$queryRawUnsafe(
                        `SELECT INDEX_NAME FROM information_schema.STATISTICS
                         WHERE TABLE_SCHEMA = DATABASE()
                           AND TABLE_NAME = 'Session'
                           AND INDEX_NAME = 'Session_accountId_needsAttention_meaningfulActivityAt_id_idx'`,
                    )).resolves.toHaveLength(1);
                }

                await replacePredecessorWithCurrentMigrations("mysql", staged.stagedMigrationsDir);
                await deploy("mysql", staged.stageDir, databaseUrl);
                const ledgerBeforeSecondDeploy = await database.$queryRawUnsafe<Array<{ migration_name: string }>>(
                    "SELECT `migration_name` FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL AND `rolled_back_at` IS NULL ORDER BY `migration_name`",
                );
                await deploy("mysql", staged.stageDir, databaseUrl);
                const ledgerAfterSecondDeploy = await database.$queryRawUnsafe<Array<{ migration_name: string }>>(
                    "SELECT `migration_name` FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL AND `rolled_back_at` IS NULL ORDER BY `migration_name`",
                );

                expect(ledgerAfterSecondDeploy).toEqual(ledgerBeforeSecondDeploy);
                const quotaRows = await database.$queryRawUnsafe(
                    "SELECT `id`, `status`, LOWER(HEX(`snapshot`)) AS `snapshotHex` FROM `ServiceAccountQuotaSnapshot` WHERE `id` = 'preserved-quota-row'",
                );
                expect(quotaRows).toEqual(preservesQuotaRow ? [{
                    id: "preserved-quota-row",
                    status: "ok",
                    snapshotHex: Buffer.from("sealed-preserved-quota").toString("hex"),
                }] : []);
                await expect(database.$queryRawUnsafe(
                    `SELECT INDEX_NAME FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'Session'
                       AND INDEX_NAME = 'Session_accountId_needsAttention_meaningfulActivityAt_id_idx'`,
                )).resolves.toHaveLength(1);
            } finally {
                await database.$disconnect();
                await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``);
                await admin.$disconnect();
            }
        },
        240_000,
    );
});
