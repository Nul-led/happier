import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type SqliteMigrationCatalogEntry = Readonly<{
    name: string;
    sql: string;
    checksum: string;
}>;

function invalidMigrationSql(migrationName: string, reason: string): Error {
    return new Error(`[sqlite-migrations] ${reason} for migration ${migrationName}`);
}

/** Reads the ordered, checksum-bound migration catalog shipped with a server binary. */
export async function readSqliteMigrationCatalog(migrationsDir: string): Promise<SqliteMigrationCatalogEntry[]> {
    const rawDir = String(migrationsDir ?? '').trim();
    if (!rawDir) {
        throw new Error('SQLite migrations directory is missing: <empty>');
    }
    const dir = resolve(rawDir);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new Error(`SQLite migrations directory is missing: ${dir}`);
    });
    const migrationNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    const result: SqliteMigrationCatalogEntry[] = [];
    for (const name of migrationNames) {
        let sql: string;
        try {
            sql = await readFile(join(dir, name, 'migration.sql'), 'utf8');
        } catch {
            throw invalidMigrationSql(name, 'missing migration.sql');
        }
        if (!sql.trim()) {
            throw invalidMigrationSql(name, 'empty migration.sql');
        }
        result.push(Object.freeze({
            name,
            sql,
            checksum: createHash('sha256').update(sql).digest('hex'),
        }));
    }
    return result;
}
