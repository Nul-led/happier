import type { DbProvider } from "@/storage/prisma";

/**
 * Build the portable Prisma prefix filter used by Account directory searches.
 *
 * PostgreSQL and PGlite need an explicit case-insensitive mode. SQLite's LIKE
 * already provides the required ASCII-insensitive prefix behavior, while the
 * MySQL connector rejects Prisma's PostgreSQL-only `mode` argument and uses its
 * configured case-insensitive collation.
 */
export function buildAccountTextPrefixFilter(query: string, provider: DbProvider) {
    return provider === "postgres" || provider === "pglite"
        ? { startsWith: query, mode: "insensitive" as const }
        : { startsWith: query };
}
