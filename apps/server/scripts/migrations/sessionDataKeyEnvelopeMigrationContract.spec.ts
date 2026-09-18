import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyPostgresMigrations, applySqliteMigrations } from '../prismaMigrations';

// Source-shaped persistence boundary from server-v0.2.11 / server-v0.2.11-preview.2
// (98ea8fb76733b1dd785d38c31360179cafa84824). The same relevant nullable byte
// columns remain in ../0.2 at b23f95ed354e8d49183017e487bdb75f217017de.
//
// The SQL under test is the canonical shipped migration, not a prepared copy: a
// fixture that drifted from the deployed bytes would prove nothing about the
// upgrade an operator actually runs.
const providerMigrationsDir = {
    postgres: join(import.meta.dirname, '..', '..', 'prisma', 'migrations'),
    sqlite: join(import.meta.dirname, '..', '..', 'prisma', 'sqlite', 'migrations'),
    mysql: join(import.meta.dirname, '..', '..', 'prisma', 'mysql', 'migrations'),
} as const;
const envelopeTable = 'SessionDataKeyEnvelope';
const migrationIds = {
    expand: '20260906160000_expand_session_data_key_envelopes',
    contract: '20260906160100_contract_session_data_key_envelopes',
} as const;

function predecessorSchema(blobType: 'BLOB' | 'BYTEA'): string {
    return `
        CREATE TABLE "Account" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Session" (
            "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"("id"),
            "dataEncryptionKey" ${blobType}, "archivedAt" TIMESTAMP NULL
        );
        CREATE TABLE "SessionShare" (
            "sessionId" TEXT NOT NULL REFERENCES "Session"("id") ON DELETE CASCADE,
            "sharedWithUserId" TEXT NOT NULL REFERENCES "Account"("id"),
            "encryptedDataKey" ${blobType}, PRIMARY KEY ("sessionId", "sharedWithUserId")
        );
        CREATE TABLE "PublicSessionShare" ("encryptedDataKey" ${blobType});
        INSERT INTO "Account" VALUES ('owner'), ('recipient'), ('other');
    `;
}

async function sql(provider: 'postgres' | 'sqlite' | 'mysql', phase: 'expand' | 'contract') {
    return await readFile(
        join(providerMigrationsDir[provider], migrationIds[phase], 'migration.sql'),
        'utf8',
    );
}

describe('prepared Session data-key envelope migration', () => {
    it.each(['sqlite', 'postgres'] as const)('preserves exact bytes, null absence, self-share collapse and public-link isolation on %s', async (provider) => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'happier-session-envelope-migration-'));
        const databasePath = join(temporaryRoot, 'test.sqlite');
        const migrationsDir = join(temporaryRoot, 'migrations');
        const sqlite = provider === 'sqlite' ? new DatabaseSync(databasePath) : null;
        const postgres = provider === 'postgres' ? new PGlite() : null;
        const exec = async (statement: string) => {
            if (sqlite) sqlite.exec(statement);
            else await postgres!.exec(statement);
        };
        const query = async (statement: string): Promise<Record<string, unknown>[]> => {
            if (sqlite) return sqlite.prepare(statement).all();
            return (await postgres!.query<Record<string, unknown>>(statement)).rows;
        };
        const bytes = (hex: string) => provider === 'sqlite' ? `X'${hex}'` : `decode('${hex}', 'hex')`;
        const stage = async (phase: 'expand' | 'contract') => {
            const directory = join(migrationsDir, migrationIds[phase]);
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'migration.sql'), await sql(provider, phase));
        };
        const deploy = () => sqlite
            ? applySqliteMigrations({ databasePath, migrationsDir })
            : applyPostgresMigrations({ db: postgres!, migrationsDir });
        try {
            await exec(provider === 'sqlite' ? `PRAGMA foreign_keys = ON; ${predecessorSchema('BLOB')}` : predecessorSchema('BYTEA'));
            await exec(`
                INSERT INTO "Session" VALUES ('archived', 'owner', ${bytes('00ff0080')}, CURRENT_TIMESTAMP), ('legacy-null', 'owner', NULL, NULL), ('empty', 'owner', ${bytes('')}, NULL);
                INSERT INTO "SessionShare" VALUES ('archived', 'owner', ${bytes('00ff0080')}), ('archived', 'recipient', ${bytes('ff00010280')}), ('legacy-null', 'recipient', NULL);
                INSERT INTO "PublicSessionShare" VALUES (${bytes('deadbeef')});
            `);
            await stage('expand');
            expect(await deploy()).toEqual({ applied: [migrationIds.expand] });
            expect(await query(`SELECT "sessionId", "recipientAccountId", "encryptedDataKey" FROM "${envelopeTable}" ORDER BY "sessionId", "recipientAccountId"`)).toEqual([
                { sessionId: 'archived', recipientAccountId: 'owner', encryptedDataKey: new Uint8Array([0, 255, 0, 128]) },
                { sessionId: 'archived', recipientAccountId: 'recipient', encryptedDataKey: new Uint8Array([255, 0, 1, 2, 128]) },
                { sessionId: 'empty', recipientAccountId: 'owner', encryptedDataKey: new Uint8Array() },
            ]);
            await stage('contract');
            expect(await deploy()).toEqual({ applied: [migrationIds.contract] });
            expect(await deploy()).toEqual({ applied: [] });
            expect(await query('SELECT "encryptedDataKey" FROM "PublicSessionShare"')).toEqual([{ encryptedDataKey: new Uint8Array([222, 173, 190, 239]) }]);
            const columns = provider === 'sqlite'
                ? await query(`PRAGMA table_info('Session')`)
                : await query(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'Session'`);
            expect(columns.map((column) => column.name)).not.toContain('dataEncryptionKey');
            const shareColumns = provider === 'sqlite'
                ? await query(`PRAGMA table_info('SessionShare')`)
                : await query(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'SessionShare'`);
            expect(shareColumns.map((column) => column.name)).not.toContain('encryptedDataKey');
            const indexes = provider === 'sqlite'
                ? await query(`PRAGMA index_list('SessionDataKeyEnvelope')`)
                : await query(`SELECT indexname AS name FROM pg_indexes WHERE tablename = 'SessionDataKeyEnvelope'`);
            expect(indexes.map((index) => index.name)).toContain('SessionDataKeyEnvelope_recipientAccountId_sessionId_idx');
            await expect(exec(`INSERT INTO "${envelopeTable}" VALUES ('archived', 'recipient', ${bytes('01')})`)).rejects.toThrow();
            await exec(`DELETE FROM "SessionShare" WHERE "sharedWithUserId" = 'recipient'; DELETE FROM "Account" WHERE "id" = 'recipient'`);
            expect(await query(`SELECT "recipientAccountId" FROM "${envelopeTable}" WHERE "sessionId" = 'archived'`)).toEqual([{ recipientAccountId: 'owner' }]);
            await exec(`DELETE FROM "Session" WHERE "id" = 'archived'`);
            expect(await query(`SELECT "sessionId" FROM "${envelopeTable}"`)).toEqual([{ sessionId: 'empty' }]);
        } finally {
            sqlite?.close();
            await postgres?.close();
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    });

    it.each(['sqlite', 'postgres'] as const)('rejects differing owner/self-share bytes before contraction on %s', async (provider) => {
        const sqlite = provider === 'sqlite' ? new DatabaseSync(':memory:') : null;
        const postgres = provider === 'postgres' ? new PGlite() : null;
        const exec = async (statement: string) => {
            if (sqlite) sqlite.exec(statement);
            else await postgres!.exec(statement);
        };
        const bytes = (hex: string) => provider === 'sqlite' ? `X'${hex}'` : `decode('${hex}', 'hex')`;
        try {
            await exec(predecessorSchema(provider === 'sqlite' ? 'BLOB' : 'BYTEA'));
            await exec(`INSERT INTO "Session" VALUES ('conflict', 'owner', ${bytes('00ff')}, NULL); INSERT INTO "SessionShare" VALUES ('conflict', 'owner', ${bytes('ff00')});`);
            await expect(exec(await sql(provider, 'expand'))).rejects.toThrow(/session_envelope_conflicting_legacy_bytes/i);
            // A failed backfill must leave both original values available for operator repair.
            await exec('SELECT "dataEncryptionKey" FROM "Session"; SELECT "encryptedDataKey" FROM "SessionShare";');
        } finally {
            sqlite?.close();
            await postgres?.close();
        }
    });

    it.each([
        `DELETE FROM "SessionDataKeyEnvelope"`,
        `UPDATE "SessionDataKeyEnvelope" SET "encryptedDataKey" = X'ff00'`,
        `INSERT INTO "SessionDataKeyEnvelope" VALUES ('session', 'recipient', X'00ff')`,
    ])('refuses contraction when the completed backfill is no longer byte/count exact: %s', async (mutation) => {
        const database = new DatabaseSync(':memory:');
        try {
            database.exec(predecessorSchema('BLOB'));
            database.exec(`INSERT INTO "Session" VALUES ('session', 'owner', X'00ff', NULL)`);
            database.exec(await sql('sqlite', 'expand'));
            database.exec(mutation);
            const contract = await sql('sqlite', 'contract');
            expect(() => database.exec(contract)).toThrow(/session_envelope_backfill_mismatch/);
            expect(database.prepare('SELECT "dataEncryptionKey" FROM "Session"').get()).toEqual({ dataEncryptionKey: new Uint8Array([0, 255]) });
        } finally {
            database.close();
        }
    });
});
