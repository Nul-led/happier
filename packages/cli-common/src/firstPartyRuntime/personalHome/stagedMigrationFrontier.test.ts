import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
    inspectPersonalHomeSqliteMigrationFrontier,
    migrateStagedPersonalHomeSqliteDatabase,
    PersonalHomeSqliteMigrationFrontierError,
    resolveInstalledPersonalHomeSqliteMigrationPaths,
    type PersonalHomeMigrationProcessRunner,
} from './stagedMigrationFrontier.js';
import { readSqliteMigrationCatalog } from '../sqliteMigrationCatalog.js';
import { renderPrismaCompatibleSqliteDatabaseUrl } from '../selfHostServerEnv.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

async function fixture(): Promise<Readonly<{
    root: string;
    installRoot: string;
    configDir: string;
    activeDatabasePath: string;
    databasePath: string;
    stagedDataDir: string;
    catalogDir: string;
    migrations: readonly Readonly<{ name: string; sql: string; checksum: string }>[];
}>> {
    const root = await mkdtemp(join(tmpdir(), 'happier-staged-migration-'));
    const installRoot = join(root, 'install');
    const configDir = join(root, 'config');
    const activeDatabasePath = join(root, 'active-home.sqlite');
    const stagedDataDir = join(root, 'staged-home');
    const databasePath = join(stagedDataDir, 'database', 'home.sqlite');
    const catalogDir = join(installRoot, 'bin', 'prisma', 'sqlite', 'migrations');
    const definitions = [
        { name: 'z-baseline', sql: 'CREATE TABLE first (id TEXT);\n' },
        { name: 'a-later', sql: 'CREATE TABLE second (id TEXT);\n' },
    ] as const;
    await mkdir(join(stagedDataDir, 'database'), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'server.env'), [
        `DATABASE_URL=file:${activeDatabasePath}`,
        'HAPPY_SERVER_LIGHT_DATA_DIR=/active/home',
        'HAPPIER_SQLITE_MIGRATIONS_DIR=/active/catalog',
        'RUN_MIGRATIONS=0',
        'HAPPIER_STACK_PRISMA_MIGRATE=false',
        'PERSISTED_CHILD_SETTING=present',
        '',
    ].join('\n'));
    const activeDatabase = new DatabaseSync(activeDatabasePath);
    activeDatabase.exec('CREATE TABLE sentinel (value TEXT NOT NULL)');
    activeDatabase.prepare('INSERT INTO sentinel (value) VALUES (?)').run('active-home-unchanged');
    activeDatabase.close();
    for (const migration of definitions) {
        await mkdir(join(catalogDir, migration.name), { recursive: true });
        await writeFile(join(catalogDir, migration.name, 'migration.sql'), migration.sql);
    }
    const database = new DatabaseSync(databasePath);
    database.exec([
        'CREATE TABLE _prisma_migrations (',
        'id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at TEXT, migration_name TEXT NOT NULL,',
        'logs TEXT, rolled_back_at TEXT, started_at TEXT NOT NULL, applied_steps_count INTEGER NOT NULL',
        ')',
    ].join(' '));
    database.close();
    return {
        root,
        installRoot,
        configDir,
        activeDatabasePath,
        databasePath,
        stagedDataDir,
        catalogDir,
        migrations: definitions
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((migration) => ({ ...migration, checksum: sha256(migration.sql) })),
    };
}

function insertLedgerRow(databasePath: string, row: Readonly<{
    name: string;
    checksum: string;
    finished?: boolean;
    finishedAt?: string;
    rolledBack?: boolean;
}>): void {
    const database = new DatabaseSync(databasePath);
    database.prepare([
        'INSERT INTO _prisma_migrations',
        '(id, checksum, finished_at, migration_name, rolled_back_at, started_at, applied_steps_count)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ].join(' ')).run(
        randomUUID(),
        row.checksum,
        row.finished === false ? null : (row.finishedAt ?? new Date().toISOString()),
        row.name,
        row.rolledBack ? new Date().toISOString() : null,
        new Date().toISOString(),
        row.finished === false ? 0 : 1,
    );
    database.close();
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    await expect(promise).rejects.toMatchObject({
        name: PersonalHomeSqliteMigrationFrontierError.name,
        code,
    });
}

describe('Personal Home staged SQLite migration frontier', () => {
    it('rejects an applied migration absent from the installed catalog', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, { name: 'unknown', checksum: sha256('SELECT 1') });
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: value.databasePath,
            catalog: await readSqliteMigrationCatalog(value.catalogDir),
        }), 'unknown_applied_migration');
    });

    it('rejects an applied migration checksum mismatch', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, { name: value.migrations[0]!.name, checksum: sha256('wrong') });
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: value.databasePath,
            catalog: await readSqliteMigrationCatalog(value.catalogDir),
        }), 'migration_checksum_mismatch');
    });

    it('rejects duplicate active rows and unresolved active rows', async () => {
        const duplicate = await fixture();
        insertLedgerRow(duplicate.databasePath, duplicate.migrations[0]!);
        insertLedgerRow(duplicate.databasePath, duplicate.migrations[0]!);
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: duplicate.databasePath,
            catalog: await readSqliteMigrationCatalog(duplicate.catalogDir),
        }), 'duplicate_active_migration');

        const unresolved = await fixture();
        insertLedgerRow(unresolved.databasePath, { ...unresolved.migrations[0]!, finished: false });
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: unresolved.databasePath,
            catalog: await readSqliteMigrationCatalog(unresolved.catalogDir),
        }), 'unresolved_active_migration');
    });

    it('ignores rolled-back rows when deriving the active completed frontier', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, { name: 'rolled-back-draft', checksum: sha256('draft'), rolledBack: true });
        insertLedgerRow(value.databasePath, value.migrations[0]!);
        const facts = await inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: value.databasePath,
            catalog: await readSqliteMigrationCatalog(value.catalogDir),
        });
        expect(facts.schemaVersion).toBe(value.migrations[0]!.name);
        expect(facts.completedMigrations).toEqual([{
            name: value.migrations[0]!.name,
            checksum: value.migrations[0]!.checksum,
        }]);
    });

    it('derives the frontier in catalog order and rejects a different manifest schema', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, { ...value.migrations[0]!, finishedAt: '2000-01-01T00:00:00.000Z' });
        insertLedgerRow(value.databasePath, { ...value.migrations[1]!, finishedAt: '2099-01-01T00:00:00.000Z' });
        const catalog = (await readSqliteMigrationCatalog(value.catalogDir)).reverse();
        const facts = await inspectPersonalHomeSqliteMigrationFrontier({ databasePath: value.databasePath, catalog });
        expect(facts.schemaVersion).toBe(value.migrations[0]!.name);
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: value.databasePath,
            catalog,
            expectedSchemaVersion: value.migrations[1]!.name,
        }), 'manifest_schema_mismatch');
    });

    it('rejects an empty ledger because supported Home backups are post-bootstrap and have a catalog frontier', async () => {
        const value = await fixture();
        await expectCode(inspectPersonalHomeSqliteMigrationFrontier({
            databasePath: value.databasePath,
            catalog: await readSqliteMigrationCatalog(value.catalogDir),
            expectedSchemaVersion: value.migrations[0]!.name,
        }), 'migration_frontier_missing');
    });

    it('migrates an older supported archive once with only the staged database and installed catalog authority', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, value.migrations[0]!);
        const calls: Parameters<PersonalHomeMigrationProcessRunner>[0][] = [];
        const runProcess: PersonalHomeMigrationProcessRunner = async (input) => {
            calls.push(input);
            const database = new DatabaseSync(value.databasePath);
            database.prepare([
                'INSERT INTO _prisma_migrations',
                '(id, checksum, finished_at, migration_name, rolled_back_at, started_at, applied_steps_count)',
                'VALUES (?, ?, ?, ?, NULL, ?, 1)',
            ].join(' ')).run(
                randomUUID(),
                value.migrations[1]!.checksum,
                new Date().toISOString(),
                value.migrations[1]!.name,
                new Date().toISOString(),
            );
            database.close();
        };

        const result = await migrateStagedPersonalHomeSqliteDatabase({
            layout: { installRoot: value.installRoot, configDir: value.configDir, platform: 'linux' },
            databasePath: value.databasePath,
            manifestSchemaVersion: value.migrations[0]!.name,
            runProcess,
        });

        expect(result.schemaVersion).toBe(value.migrations[1]!.name);
        expect(result.pendingMigrations).toEqual([]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            command: join(value.installRoot, 'bin', 'happier-server'),
            args: ['--migrate-only'],
        });
        expect(calls[0]!.env).toMatchObject({
            PERSISTED_CHILD_SETTING: 'present',
            HAPPIER_DB_PROVIDER: 'sqlite',
            HAPPIER_SERVER_LIGHT_DATA_DIR: value.stagedDataDir,
            HAPPIER_SQLITE_MIGRATIONS_DIR: value.catalogDir,
        });
        expect(calls[0]!.env.DATABASE_URL).toContain(value.databasePath);
        expect(calls[0]!.env.DATABASE_URL).not.toContain(value.activeDatabasePath);
        expect(calls[0]!.env.HAPPY_SERVER_LIGHT_DATA_DIR).toBeUndefined();
        expect(calls[0]!.env.RUN_MIGRATIONS).toBeUndefined();
        expect(calls[0]!.env.HAPPIER_STACK_PRISMA_MIGRATE).toBeUndefined();
        const activeDatabase = new DatabaseSync(value.activeDatabasePath, { readOnly: true });
        expect(activeDatabase.prepare('SELECT value FROM sentinel').get()).toEqual({ value: 'active-home-unchanged' });
        activeDatabase.close();
    });

    it('treats nonzero exit and signals as typed failures without process output', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, value.migrations[0]!);
        await expectCode(migrateStagedPersonalHomeSqliteDatabase({
            layout: { installRoot: value.installRoot, configDir: value.configDir, platform: 'linux' },
            databasePath: value.databasePath,
            manifestSchemaVersion: value.migrations[0]!.name,
            runProcess: async () => { throw new Error('secret stdout from nonzero exit'); },
        }), 'migration_process_failed');

        await expect(migrateStagedPersonalHomeSqliteDatabase({
            layout: { installRoot: value.installRoot, configDir: value.configDir, platform: 'linux' },
            databasePath: value.databasePath,
            manifestSchemaVersion: value.migrations[0]!.name,
            runProcess: async () => { throw new Error('secret stderr from SIGTERM'); },
        })).rejects.toMatchObject({
            code: 'migration_process_failed',
            message: 'The installed server failed to migrate the staged SQLite database',
        });
    });

    it('re-reads the ledger and rejects a successful process that leaves installed migrations pending', async () => {
        const value = await fixture();
        insertLedgerRow(value.databasePath, value.migrations[0]!);
        await expectCode(migrateStagedPersonalHomeSqliteDatabase({
            layout: { installRoot: value.installRoot, configDir: value.configDir, platform: 'linux' },
            databasePath: value.databasePath,
            manifestSchemaVersion: value.migrations[0]!.name,
            runProcess: async () => undefined,
        }), 'migration_incomplete');
    });

    it('refuses a database path outside the verified archive database/home.sqlite shape', async () => {
        const value = await fixture();
        await expectCode(migrateStagedPersonalHomeSqliteDatabase({
            layout: { installRoot: value.installRoot, configDir: value.configDir, platform: 'linux' },
            databasePath: value.activeDatabasePath,
            manifestSchemaVersion: value.migrations[0]!.name,
            runProcess: async () => undefined,
        }), 'invalid_staged_database_path');
    });

    it('renders Windows binary, catalog, and Prisma paths independently of the host platform', async () => {
        const paths = resolveInstalledPersonalHomeSqliteMigrationPaths({
            installRoot: 'C:\\Users\\Alice\\.happier\\self-host',
            platform: 'win32',
        });
        expect(paths).toEqual({
            serverBinaryPath: 'C:\\Users\\Alice\\.happier\\self-host\\bin\\happier-server.exe',
            migrationsDir: 'C:\\Users\\Alice\\.happier\\self-host\\bin\\prisma\\sqlite\\migrations',
        });
        expect(win32.isAbsolute(paths.serverBinaryPath)).toBe(true);
        expect(renderPrismaCompatibleSqliteDatabaseUrl({
            dbPath: 'C:\\Restore Stage\\home.sqlite',
            platform: 'win32',
        })).toBe('file:C:/Restore%20Stage/home.sqlite?socket_timeout=30');
    });
});
