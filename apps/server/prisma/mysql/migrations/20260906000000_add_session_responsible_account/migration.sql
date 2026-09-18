-- One nullable human Account is currently expected to handle a Session.
-- Existing Sessions are truthfully unassigned, so there is no backfill.

-- AlterTable
ALTER TABLE `Session` ADD COLUMN `responsibleAccountId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Session_responsibleAccountId_idx` ON `Session`(`responsibleAccountId`);

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_responsibleAccountId_fkey` FOREIGN KEY (`responsibleAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
