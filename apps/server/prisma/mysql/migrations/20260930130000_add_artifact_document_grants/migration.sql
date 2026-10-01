-- Documents share through Artifact grants; workflow runs have no per-run grants.

CREATE TABLE `ArtifactAccountGrant` (
    `artifactId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `accessLevel` ENUM('view', 'edit', 'admin') NOT NULL,
    `createdByAccountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`artifactId`, `accountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ArtifactTeamGrant` (
    `artifactId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `accessLevel` ENUM('view', 'edit', 'admin') NOT NULL,
    `createdByAccountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`artifactId`, `teamId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ArtifactGroupGrant` (
    `artifactId` VARCHAR(191) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    `accessLevel` ENUM('view', 'edit', 'admin') NOT NULL,
    `createdByAccountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`artifactId`, `teamGroupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ArtifactKeyEnvelope` (
    `artifactId` VARCHAR(191) NOT NULL,
    `recipientAccountId` VARCHAR(191) NOT NULL,
    `encryptedDataKey` LONGBLOB NOT NULL,
    `recipientContentPublicKeyFingerprint` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`artifactId`, `recipientAccountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ArtifactAccountGrant_accountId_artifactId_idx` ON `ArtifactAccountGrant`(`accountId`, `artifactId`);

CREATE INDEX `ArtifactTeamGrant_teamId_artifactId_idx` ON `ArtifactTeamGrant`(`teamId`, `artifactId`);

CREATE INDEX `ArtifactGroupGrant_teamGroupId_artifactId_idx` ON `ArtifactGroupGrant`(`teamGroupId`, `artifactId`);

CREATE INDEX `ArtifactKeyEnvelope_recipientAccountId_artifactId_idx` ON `ArtifactKeyEnvelope`(`recipientAccountId`, `artifactId`);

ALTER TABLE `ArtifactAccountGrant` ADD CONSTRAINT `ArtifactAccountGrant_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactAccountGrant` ADD CONSTRAINT `ArtifactAccountGrant_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactAccountGrant` ADD CONSTRAINT `ArtifactAccountGrant_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ArtifactTeamGrant` ADD CONSTRAINT `ArtifactTeamGrant_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactTeamGrant` ADD CONSTRAINT `ArtifactTeamGrant_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactTeamGrant` ADD CONSTRAINT `ArtifactTeamGrant_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ArtifactGroupGrant` ADD CONSTRAINT `ArtifactGroupGrant_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactGroupGrant` ADD CONSTRAINT `ArtifactGroupGrant_teamGroupId_fkey` FOREIGN KEY (`teamGroupId`) REFERENCES `TeamGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactGroupGrant` ADD CONSTRAINT `ArtifactGroupGrant_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ArtifactKeyEnvelope` ADD CONSTRAINT `ArtifactKeyEnvelope_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ArtifactKeyEnvelope` ADD CONSTRAINT `ArtifactKeyEnvelope_recipientAccountId_fkey` FOREIGN KEY (`recipientAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
