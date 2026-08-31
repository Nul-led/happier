-- Preserve the remote-dev migration ledger and move its physical schema to the
-- current canonical names through an append-only transition.

-- The supported 0.2 predecessor dropped this released compatibility table,
-- while 0.3 still reads it until each service/profile is replaced or deleted.
-- Recreate only the missing storage; an existing table and its rows stay intact.
CREATE TABLE IF NOT EXISTS "ServiceAccountQuotaSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT 'default',
    "snapshot" BLOB NOT NULL,
    "status" TEXT,
    "fetchedAt" DATETIME,
    "staleAfterMs" INTEGER,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    CONSTRAINT "ServiceAccountQuotaSnapshot_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAccountQuotaSnapshot_accountId_vendor_profileId_key"
ON "ServiceAccountQuotaSnapshot"("accountId", "vendor", "profileId");

CREATE INDEX IF NOT EXISTS "ServiceAccountQuotaSnapshot_accountId_idx"
ON "ServiceAccountQuotaSnapshot"("accountId");

ALTER TABLE "SessionTurn" RENAME COLUMN "provider" TO "agentId";
ALTER TABLE "SessionTurn" RENAME COLUMN "providerTurnId" TO "agentTurnId";
ALTER TABLE "SessionTurn" RENAME COLUMN "providerRollbackOrdinal" TO "agentRollbackOrdinal";

DROP INDEX "SessionTurn_sessionId_provider_providerTurnId_idx";
CREATE INDEX "SessionTurn_sessionId_agentId_agentTurnId_idx"
ON "SessionTurn"("sessionId", "agentId", "agentTurnId");

DROP INDEX "ssr_account_session_kind_updated_id_idx";
CREATE INDEX "SessionSystemRecord_account_kind_updated_idx"
ON "SessionSystemRecord"("accountId", "sessionId", "namespace", "kind", "updatedAt", "id");

-- The V4 activation rebuilds ConnectedServiceUsageSource with its canonical
-- foreign-key and index names. ProviderAccountUsageRecord remains in place.
DROP INDEX "paur_identity_key";
CREATE UNIQUE INDEX "paur_scope_key"
ON "ProviderAccountUsageRecord"(
    "accountId", "providerId", "accountSubjectId", "quotaScope", "quotaScopeIdKey"
);
