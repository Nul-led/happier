-- CreateTable
CREATE TABLE `TeamCredentialExternalApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,
    `teamMembershipId` VARCHAR(191) NOT NULL,
    `label` LONGTEXT NOT NULL,
    `displayPrefix` VARCHAR(191) NOT NULL,
    `secretDigest` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    INDEX `TeamCredentialExternalApiKey_resourceId_createdAt_idx`(`resourceId`, `createdAt`),
    INDEX `TeamCredentialExternalApiKey_teamMembershipId_resourceId_idx`(`teamMembershipId`, `resourceId`),
    UNIQUE INDEX `TeamCredentialExternalApiKey_secretDigest_key`(`secretDigest`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TeamCredentialExternalApiKey` ADD CONSTRAINT `TeamCredentialExternalApiKey_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TeamCredentialExternalApiKey` ADD CONSTRAINT `TeamCredentialExternalApiKey_teamMembershipId_fkey` FOREIGN KEY (`teamMembershipId`) REFERENCES `TeamMembership`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
