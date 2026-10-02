CREATE TABLE `ArtifactRevision` (
    `artifactId` VARCHAR(191) NOT NULL,
    `bodyVersion` INTEGER NOT NULL,
    `body` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`artifactId`, `bodyVersion`),
    CONSTRAINT `ArtifactRevision_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
