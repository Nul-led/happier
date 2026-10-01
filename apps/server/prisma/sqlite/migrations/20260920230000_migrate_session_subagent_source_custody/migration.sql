PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SessionSubagentCustody" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "sourceCustodyKind" TEXT NOT NULL,
    "sourceCustodyId" TEXT NOT NULL,
    "custodyKey" TEXT NOT NULL,
    "subagentId" TEXT NOT NULL,
    "subagentKey" TEXT NOT NULL,
    "groupId" TEXT,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,
    "terminalAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionSubagentCustody_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionSubagentCustody_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SessionSubagentCustody"
SELECT "id", "accountId", "sessionId", "pluginId", "contributionId", 'managed', "immutableGenerationId",
    "custodyKey", "subagentId", "subagentKey", "groupId", "status", "revision", "content", "terminalAt", "createdAt", "updatedAt"
FROM "SessionSubagentCustody";
DROP TABLE "SessionSubagentCustody";
ALTER TABLE "new_SessionSubagentCustody" RENAME TO "SessionSubagentCustody";
CREATE UNIQUE INDEX "SubagentCustody_scope_subagent_key" ON "SessionSubagentCustody"("accountId", "sessionId", "custodyKey", "subagentKey");
CREATE INDEX "SessionSubagentCustody_scope_list_idx" ON "SessionSubagentCustody"("accountId", "sessionId", "custodyKey", "subagentKey");
CREATE INDEX "SubagentCustody_source_retirement_idx" ON "SessionSubagentCustody"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");
CREATE INDEX "SessionSubagentCustody_sessionId_idx" ON "SessionSubagentCustody"("sessionId");

CREATE TABLE "new_SessionSubagentCustodyReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "sourceCustodyKind" TEXT NOT NULL,
    "sourceCustodyId" TEXT NOT NULL,
    "custodyKey" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "resultSubagentId" TEXT NOT NULL,
    "resultGroupId" TEXT,
    "resultStatus" TEXT NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "resultUpdatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionSubagentCustodyReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionSubagentCustodyReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SessionSubagentCustodyReceipt"
SELECT "id", "accountId", "sessionId", "pluginId", "contributionId", 'managed', "immutableGenerationId",
    "custodyKey", "operationId", "requestDigest", "resultSubagentId", "resultGroupId", "resultStatus", "resultRevision",
    "resultUpdatedAt", "expiresAt", "createdAt"
FROM "SessionSubagentCustodyReceipt";
DROP TABLE "SessionSubagentCustodyReceipt";
ALTER TABLE "new_SessionSubagentCustodyReceipt" RENAME TO "SessionSubagentCustodyReceipt";
CREATE UNIQUE INDEX "SubagentCustodyReceipt_scope_operation_key" ON "SessionSubagentCustodyReceipt"("accountId", "sessionId", "custodyKey", "operationId");
CREATE INDEX "SessionSubagentCustodyReceipt_scope_expiry_idx" ON "SessionSubagentCustodyReceipt"("accountId", "sessionId", "custodyKey", "expiresAt");
CREATE INDEX "SubagentCustodyReceipt_source_retirement_idx" ON "SessionSubagentCustodyReceipt"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");
CREATE INDEX "SessionSubagentCustodyReceipt_expiresAt_idx" ON "SessionSubagentCustodyReceipt"("expiresAt");
CREATE INDEX "SessionSubagentCustodyReceipt_sessionId_idx" ON "SessionSubagentCustodyReceipt"("sessionId");

CREATE TABLE "SessionSubagentCustodyRetiredSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "sourceCustodyKind" TEXT NOT NULL,
    "sourceCustodyId" TEXT NOT NULL,
    "capacitySlot" INTEGER NOT NULL,
    "retiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionSubagentCustodyRetiredSource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "SessionSubagentCustodyRetiredSource"
SELECT "id", "accountId", "pluginId", 'managed', "immutableGenerationId", "capacitySlot", "retiredAt"
FROM "SessionSubagentCustodyRetiredGeneration";
DROP TABLE "SessionSubagentCustodyRetiredGeneration";
CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_key" ON "SessionSubagentCustodyRetiredSource"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");
CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_capacity_slot_key" ON "SessionSubagentCustodyRetiredSource"("accountId", "capacitySlot");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
