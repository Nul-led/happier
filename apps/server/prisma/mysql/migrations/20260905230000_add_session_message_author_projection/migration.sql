-- Derived query projection of the immutable `SessionMessage.inputAdmissionReceipt`
-- actor. Additive and nullable: existing readers and writers keep working, and
-- rows without a valid authenticated-Account receipt stay NULL rather than
-- acquiring a guessed author.
ALTER TABLE `SessionMessage` ADD COLUMN `authorAccountId` VARCHAR(191) NULL;

CREATE INDEX `SessionMessage_authorAccountId_sessionId_idx` ON `SessionMessage`(`authorAccountId`, `sessionId`);

ALTER TABLE `SessionMessage` ADD CONSTRAINT `SessionMessage_authorAccountId_fkey` FOREIGN KEY (`authorAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
