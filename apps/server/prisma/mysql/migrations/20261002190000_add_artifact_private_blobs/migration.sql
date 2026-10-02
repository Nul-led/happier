ALTER TABLE `Artifact` ADD COLUMN `currentBlobId` VARCHAR(191) NULL;
ALTER TABLE `Artifact` ADD COLUMN `deletedAt` DATETIME(3) NULL;
ALTER TABLE `ArtifactRevision` ADD COLUMN `blobId` VARCHAR(191) NULL;
CREATE TABLE `ArtifactBlob` (
    `id` VARCHAR(191) NOT NULL,
    `artifactId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `encryptionMode` VARCHAR(191) NOT NULL,
    `storedSizeBytes` BIGINT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `ArtifactBlob_storageKey_key` (`storageKey`),
    INDEX `ArtifactBlob_artifactId_idx` (`artifactId`),
    CONSTRAINT `ArtifactBlob_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
