ALTER TABLE "SessionSubagentCustody"
    ADD COLUMN "sourceCustodyKind" TEXT COLLATE "C",
    ADD COLUMN "sourceCustodyId" TEXT COLLATE "C";

UPDATE "SessionSubagentCustody"
SET "sourceCustodyKind" = 'managed',
    "sourceCustodyId" = "immutableGenerationId";

ALTER TABLE "SessionSubagentCustody"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

DROP INDEX "SubagentCustody_generation_retirement_idx";
CREATE INDEX "SubagentCustody_source_retirement_idx"
    ON "SessionSubagentCustody"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");

ALTER TABLE "SessionSubagentCustodyReceipt"
    ADD COLUMN "sourceCustodyKind" TEXT COLLATE "C",
    ADD COLUMN "sourceCustodyId" TEXT COLLATE "C";

UPDATE "SessionSubagentCustodyReceipt"
SET "sourceCustodyKind" = 'managed',
    "sourceCustodyId" = "immutableGenerationId";

ALTER TABLE "SessionSubagentCustodyReceipt"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

DROP INDEX "SubagentCustodyReceipt_generation_retirement_idx";
CREATE INDEX "SubagentCustodyReceipt_source_retirement_idx"
    ON "SessionSubagentCustodyReceipt"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");

ALTER TABLE "SessionSubagentCustodyRetiredGeneration"
    RENAME TO "SessionSubagentCustodyRetiredSource";

ALTER TABLE "SessionSubagentCustodyRetiredSource"
    ADD COLUMN "sourceCustodyKind" TEXT COLLATE "C",
    ADD COLUMN "sourceCustodyId" TEXT COLLATE "C";

UPDATE "SessionSubagentCustodyRetiredSource"
SET "sourceCustodyKind" = 'managed',
    "sourceCustodyId" = "immutableGenerationId";

ALTER TABLE "SessionSubagentCustodyRetiredSource"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

DROP INDEX "SubagentCustodyRetiredGeneration_key";
DROP INDEX "SubagentCustodyRetiredGeneration_capacity_slot_key";
CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_key"
    ON "SessionSubagentCustodyRetiredSource"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");
CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_capacity_slot_key"
    ON "SessionSubagentCustodyRetiredSource"("accountId", "capacitySlot");
