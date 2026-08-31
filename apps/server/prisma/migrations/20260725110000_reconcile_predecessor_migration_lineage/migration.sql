-- Preserve the remote-dev migration ledger and move its physical schema to the
-- current canonical names through an append-only transition.

-- The supported 0.2 predecessor dropped this released compatibility table,
-- while 0.3 still reads it until each service/profile is replaced or deleted.
-- Recreate only the missing storage; an existing table and its rows stay intact.
CREATE TABLE IF NOT EXISTS "ServiceAccountQuotaSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT 'default',
    "snapshot" BYTEA NOT NULL,
    "status" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "staleAfterMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAccountQuotaSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ServiceAccountQuotaSnapshot_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAccountQuotaSnapshot_accountId_vendor_profileId_key"
ON "ServiceAccountQuotaSnapshot"("accountId", "vendor", "profileId");

CREATE INDEX IF NOT EXISTS "ServiceAccountQuotaSnapshot_accountId_idx"
ON "ServiceAccountQuotaSnapshot"("accountId");

ALTER TABLE "SessionTurn" RENAME COLUMN "provider" TO "agentId";
ALTER TABLE "SessionTurn" RENAME COLUMN "providerTurnId" TO "agentTurnId";
ALTER TABLE "SessionTurn" RENAME COLUMN "providerRollbackOrdinal" TO "agentRollbackOrdinal";

ALTER INDEX "SessionTurn_sessionId_provider_providerTurnId_idx"
RENAME TO "SessionTurn_sessionId_agentId_agentTurnId_idx";

ALTER INDEX "ssr_account_session_kind_updated_id_idx"
RENAME TO "SessionSystemRecord_account_kind_updated_idx";

ALTER TABLE "ConnectedServiceUsageSource"
RENAME CONSTRAINT "csus_paur_fkey" TO "csus_record_fkey";

ALTER INDEX "paur_identity_key" RENAME TO "paur_scope_key";
ALTER INDEX "csus_paur_idx" RENAME TO "csus_record_idx";
