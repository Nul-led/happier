ALTER TABLE "SessionSubagentCustody"
    ADD COLUMN "sourceCustodyKind" TEXT COLLATE "C",
    ADD COLUMN "sourceCustodyId" TEXT COLLATE "C";

UPDATE "SessionSubagentCustody"
SET "sourceCustodyKind" = 'managed',
    "sourceCustodyId" = "immutableGenerationId";

DROP INDEX "SubagentCustody_generation_retirement_idx";
ALTER TABLE "SessionSubagentCustody"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

CREATE INDEX "SubagentCustody_source_retirement_idx"
    ON "SessionSubagentCustody"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");

ALTER TABLE "SessionSubagentCustodyReceipt"
    ADD COLUMN "sourceCustodyKind" TEXT COLLATE "C",
    ADD COLUMN "sourceCustodyId" TEXT COLLATE "C";

UPDATE "SessionSubagentCustodyReceipt"
SET "sourceCustodyKind" = 'managed',
    "sourceCustodyId" = "immutableGenerationId";

DROP INDEX "SubagentCustodyReceipt_generation_retirement_idx";
ALTER TABLE "SessionSubagentCustodyReceipt"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

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

DROP INDEX "SubagentCustodyRetiredGeneration_key";
DROP INDEX "SubagentCustodyRetiredGeneration_capacity_slot_key";
ALTER TABLE "SessionSubagentCustodyRetiredSource"
    ALTER COLUMN "sourceCustodyKind" SET NOT NULL,
    ALTER COLUMN "sourceCustodyId" SET NOT NULL,
    DROP COLUMN "immutableGenerationId";

CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_key"
    ON "SessionSubagentCustodyRetiredSource"("accountId", "pluginId", "sourceCustodyKind", "sourceCustodyId");
CREATE UNIQUE INDEX "SubagentCustodyRetiredSource_capacity_slot_key"
    ON "SessionSubagentCustodyRetiredSource"("accountId", "capacitySlot");
