import { readDatabaseTransactionConfigFromEnv } from "@/config/databaseTransactions";
import { getDbProviderFromEnv } from "@/storage/prisma";
import { DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS } from "../directorySourceProjection";

export const DIRECTORY_SYNC_LOCK_MARGIN_MS = 5_000;

/**
 * A lease must cover one bounded provider request and the longest configured
 * transaction retry budget that can follow it. Page/run predicates remain the
 * correctness fence if the lease is stolen while an external call is active.
 */
export function readEnterpriseIdentitySyncLockTtlMs(
    env: NodeJS.ProcessEnv = process.env,
): number {
    const provider = getDbProviderFromEnv(env, "postgres");
    const transaction = readDatabaseTransactionConfigFromEnv(env, provider);
    return DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS
        + transaction.totalRetryBudgetMs
        + DIRECTORY_SYNC_LOCK_MARGIN_MS;
}
