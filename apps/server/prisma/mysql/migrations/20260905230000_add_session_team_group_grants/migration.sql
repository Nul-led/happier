-- Explicit Team context is independent of access grants. Existing Sessions have none.
ALTER TABLE `Session` ADD COLUMN `primaryTeamId` VARCHAR(191) NULL;
CREATE INDEX `Session_primaryTeamId_idx` ON `Session`(`primaryTeamId`);
ALTER TABLE `Session` ADD CONSTRAINT `Session_primaryTeamId_fkey` FOREIGN KEY (`primaryTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `SessionTeamGrant` (
    `sessionId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `accessLevel` ENUM('view', 'edit', 'admin') NOT NULL DEFAULT 'view',
    `canApprovePermissions` BOOLEAN NOT NULL DEFAULT false,
    `requiredByTeamPolicy` BOOLEAN NOT NULL DEFAULT false,
    `effectiveAt` DATETIME(3) NOT NULL,

    INDEX `SessionTeamGrant_teamId_sessionId_idx`(`teamId`, `sessionId`),
    PRIMARY KEY (`sessionId`, `teamId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionGroupGrant` (
    `sessionId` VARCHAR(191) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    `accessLevel` ENUM('view', 'edit', 'admin') NOT NULL DEFAULT 'view',
    `canApprovePermissions` BOOLEAN NOT NULL DEFAULT false,
    `effectiveAt` DATETIME(3) NOT NULL,

    INDEX `SessionGroupGrant_teamGroupId_sessionId_idx`(`teamGroupId`, `sessionId`),
    PRIMARY KEY (`sessionId`, `teamGroupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SessionTeamGrant` ADD CONSTRAINT `SessionTeamGrant_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionTeamGrant` ADD CONSTRAINT `SessionTeamGrant_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionGroupGrant` ADD CONSTRAINT `SessionGroupGrant_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionGroupGrant` ADD CONSTRAINT `SessionGroupGrant_teamGroupId_fkey` FOREIGN KEY (`teamGroupId`) REFERENCES `TeamGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
