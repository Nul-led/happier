export type HomeSearchSqliteValue = string | number | bigint | null | Uint8Array;

export type HomeSearchSqliteStatement = Readonly<{
    run(...values: HomeSearchSqliteValue[]): unknown;
    get(...values: HomeSearchSqliteValue[]): unknown;
    all(...values: HomeSearchSqliteValue[]): unknown[];
}>;

export type HomeSearchSqliteDatabase = Readonly<{
    exec(sql: string): unknown;
    prepare(sql: string): HomeSearchSqliteStatement;
    close(): void;
}>;

type HomeSearchSqliteDatabaseConstructor = new (path: string) => HomeSearchSqliteDatabase;

/** Selects only the runtime-owned SQLite binding; HomeSearchDb remains the SQL and schema owner. */
export async function openHomeSearchSqliteBinding(path: string): Promise<HomeSearchSqliteDatabase> {
    if (typeof process.versions.bun === 'string') {
        const sqlite = await import('bun:sqlite');
        // bun:sqlite is intentionally an untyped external boundary in Node's compilation environment.
        const Database = sqlite.Database as unknown as HomeSearchSqliteDatabaseConstructor;
        return new Database(path);
    }

    const sqlite = await import('node:sqlite');
    return new sqlite.DatabaseSync(path) as unknown as HomeSearchSqliteDatabase;
}
