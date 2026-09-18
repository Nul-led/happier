-- Preserve the released identity migration and widen its canonical identity fields.
-- Opaque external subjects use exact NO PAD comparison, matching the lifecycle
-- owner and PostgreSQL/SQLite rather than accent folding or PAD SPACE aliases.
ALTER TABLE `AccountIdentity`
    MODIFY `providerUserId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    MODIFY `providerLogin` VARCHAR(320) NULL;

CREATE TABLE `AccountEmail` (
    `accountId` VARCHAR(191) NOT NULL,
    `address` VARCHAR(320) NOT NULL,
    `normalizedEmail` VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    INDEX `AccountEmail_normalizedEmail_idx` (`normalizedEmail`),
    PRIMARY KEY (`accountId`, `normalizedEmail`),
    CONSTRAINT `AccountEmail_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountPasswordCredential` (
    `accountId` VARCHAR(191) NOT NULL,
    `credential` JSON NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (`accountId`),
    CONSTRAINT `AccountPasswordCredential_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Password-backed Account encryption-mode transitions stage the prepared
-- replacement credential on the existing transition row so the mode flip and
-- the credential conversion commit together.
ALTER TABLE `AccountEncryptionTransition` ADD COLUMN `targetPasswordCredential` JSON NULL,
    ADD COLUMN `targetPasswordRevision` INTEGER NULL;
