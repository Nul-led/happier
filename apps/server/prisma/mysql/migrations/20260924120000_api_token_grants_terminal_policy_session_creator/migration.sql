ALTER TABLE `Account` ADD COLUMN `terminalPresentUserPolicy` VARCHAR(191) NOT NULL DEFAULT 'allowed';
ALTER TABLE `AccountApiToken` ADD COLUMN `accessGrant` JSON NULL,
    ADD COLUMN `embedConfig` JSON NULL,
    ADD COLUMN `parentTokenId` VARCHAR(191) NULL;
ALTER TABLE `Session` ADD COLUMN `createdByApiTokenId` VARCHAR(191) NULL;
CREATE INDEX `AccountApiToken_parentTokenId_idx` ON `AccountApiToken`(`parentTokenId`);
CREATE INDEX `Session_createdByApiTokenId_idx` ON `Session`(`createdByApiTokenId`);
ALTER TABLE `AccountApiToken` ADD CONSTRAINT `AccountApiToken_parentTokenId_fkey`
    FOREIGN KEY (`parentTokenId`) REFERENCES `AccountApiToken`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Session` ADD CONSTRAINT `Session_createdByApiTokenId_fkey`
    FOREIGN KEY (`createdByApiTokenId`) REFERENCES `AccountApiToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
