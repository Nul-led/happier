import { getDbProviderFromEnv } from "./prisma";

type DatabaseTimeTransaction = { $queryRawUnsafe<T>(query: string): Promise<T> };

// Prisma gives every transaction attempt its own client object. Keying the read
// by that object lets nested canonical owners share one timestamp without a new
// transaction context or a process clock. A retry receives a new client and
// therefore necessarily performs a fresh database read.
const databaseTimeByTransaction = new WeakMap<object, Promise<Date>>();

/** Read the database clock exactly once for this transaction attempt. */
export function readTransactionDatabaseTime(tx: DatabaseTimeTransaction): Promise<Date> {
    const cached = databaseTimeByTransaction.get(tx);
    if (cached) return cached;

    const reading = readUncachedTransactionDatabaseTime(tx);
    databaseTimeByTransaction.set(tx, reading);
    return reading;
}

async function readUncachedTransactionDatabaseTime(tx: DatabaseTimeTransaction): Promise<Date> {
    const provider = getDbProviderFromEnv(process.env, "postgres");
    // Return an epoch value so driver/session timezone conversion cannot change the horizon.
    // All persisted membership/grant timestamps have millisecond precision.
    const sql = provider === "sqlite"
        ? "SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER) AS milliseconds"
        : provider === "mysql"
            ? "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) AS milliseconds"
            : "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS milliseconds";
    const rows = await tx.$queryRawUnsafe<Array<{ milliseconds: number | bigint }>>(sql);
    const milliseconds = Number(rows[0]?.milliseconds);
    if (!Number.isSafeInteger(milliseconds)) {
        throw new Error("Database returned an invalid transaction timestamp");
    }
    return new Date(milliseconds);
}
