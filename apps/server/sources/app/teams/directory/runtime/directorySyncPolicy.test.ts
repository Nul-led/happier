import { describe, expect, it } from "vitest";

import { DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS } from "../directorySourceProjection";
import { readEnterpriseIdentitySyncLockTtlMs } from "./directorySyncPolicy";

describe("enterprise identity sync policy", () => {
    it("derives the lock lease from the configured transaction retry budget", () => {
        expect(readEnterpriseIdentitySyncLockTtlMs({
            HAPPIER_DB_PROVIDER: "postgres",
            HAPPIER_DB_TX_TOTAL_RETRY_BUDGET_MS: "120000",
        })).toBe(DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS + 120_000 + 5_000);
    });

    it("keeps the configured database provider's retry budget in the lease", () => {
        expect(readEnterpriseIdentitySyncLockTtlMs({
            HAPPIER_DB_PROVIDER: "sqlite",
            HAPPIER_DB_TX_TOTAL_RETRY_BUDGET_MS: "40000",
        })).toBe(DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS + 40_000 + 5_000);
    });
});
