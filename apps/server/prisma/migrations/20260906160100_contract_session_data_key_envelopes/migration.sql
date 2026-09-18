-- Irreversible for predecessor binaries. Keep the server stopped on failure.
CREATE TEMPORARY TABLE "session_envelope_backfill_mismatch" (
    "ok" INTEGER NOT NULL CONSTRAINT "session_envelope_backfill_mismatch" CHECK ("ok" = 1)
);
INSERT INTO "session_envelope_backfill_mismatch" ("ok") SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (SELECT "id" AS "sessionId", "accountId" AS "recipientAccountId", "dataEncryptionKey" AS "encryptedDataKey"
    FROM "Session" WHERE "dataEncryptionKey" IS NOT NULL
UNION
SELECT "sessionId", "sharedWithUserId", "encryptedDataKey"
    FROM "SessionShare" WHERE "encryptedDataKey" IS NOT NULL) legacy
    LEFT JOIN "SessionDataKeyEnvelope" e
      ON e."sessionId" = legacy."sessionId" AND e."recipientAccountId" = legacy."recipientAccountId"
    WHERE e."sessionId" IS NULL OR e."encryptedDataKey" <> legacy."encryptedDataKey"
) OR (SELECT COUNT(*) FROM "SessionDataKeyEnvelope") <> (SELECT COUNT(*) FROM (SELECT "id" AS "sessionId", "accountId" AS "recipientAccountId", "dataEncryptionKey" AS "encryptedDataKey"
    FROM "Session" WHERE "dataEncryptionKey" IS NOT NULL
UNION
SELECT "sessionId", "sharedWithUserId", "encryptedDataKey"
    FROM "SessionShare" WHERE "encryptedDataKey" IS NOT NULL) legacy) THEN 0 ELSE 1 END;
DROP TABLE "session_envelope_backfill_mismatch";
ALTER TABLE "Session" DROP COLUMN "dataEncryptionKey";
ALTER TABLE "SessionShare" DROP COLUMN "encryptedDataKey";
