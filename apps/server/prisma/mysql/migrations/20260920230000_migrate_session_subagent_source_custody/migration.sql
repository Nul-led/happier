ALTER TABLE `SessionSubagentCustody`
    ADD COLUMN `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL;

UPDATE `SessionSubagentCustody`
SET `sourceCustodyKind` = 'managed',
    `sourceCustodyId` = `immutableGenerationId`;

DROP INDEX `SubagentCustody_generation_retirement_idx` ON `SessionSubagentCustody`;
ALTER TABLE `SessionSubagentCustody`
    MODIFY `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    MODIFY `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    DROP COLUMN `immutableGenerationId`,
    ADD INDEX `SubagentCustody_source_retirement_idx` (`accountId`, `pluginId`, `sourceCustodyKind`, `sourceCustodyId`);

ALTER TABLE `SessionSubagentCustodyReceipt`
    ADD COLUMN `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL;

UPDATE `SessionSubagentCustodyReceipt`
SET `sourceCustodyKind` = 'managed',
    `sourceCustodyId` = `immutableGenerationId`;

DROP INDEX `SubagentCustodyReceipt_generation_retirement_idx` ON `SessionSubagentCustodyReceipt`;
ALTER TABLE `SessionSubagentCustodyReceipt`
    MODIFY `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    MODIFY `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    DROP COLUMN `immutableGenerationId`,
    ADD INDEX `SubagentCustodyReceipt_source_retirement_idx` (`accountId`, `pluginId`, `sourceCustodyKind`, `sourceCustodyId`);

RENAME TABLE `SessionSubagentCustodyRetiredGeneration` TO `SessionSubagentCustodyRetiredSource`;
ALTER TABLE `SessionSubagentCustodyRetiredSource`
    ADD COLUMN `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NULL;

UPDATE `SessionSubagentCustodyRetiredSource`
SET `sourceCustodyKind` = 'managed',
    `sourceCustodyId` = `immutableGenerationId`;

ALTER TABLE `SessionSubagentCustodyRetiredSource`
    DROP INDEX `SubagentCustodyRetiredGeneration_key`,
    DROP INDEX `SubagentCustodyRetiredGeneration_capacity_slot_key`,
    MODIFY `sourceCustodyKind` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    MODIFY `sourceCustodyId` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    DROP COLUMN `immutableGenerationId`,
    ADD UNIQUE INDEX `SubagentCustodyRetiredSource_key` (`accountId`, `pluginId`, `sourceCustodyKind`, `sourceCustodyId`),
    ADD UNIQUE INDEX `SubagentCustodyRetiredSource_capacity_slot_key` (`accountId`, `capacitySlot`);
