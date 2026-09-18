CREATE TABLE `TeamCredentialRecipientMaterial` (
    `id` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,
    `recipientAccountId` VARCHAR(191) NOT NULL,
    `sourceMemberKey` CHAR(43) NOT NULL,
    `sourceVersion` VARCHAR(256) NOT NULL,
    `recipientMode` VARCHAR(32) NOT NULL,
    `recipientContentPublicKeyFingerprint` VARCHAR(256) NULL,
    `storedMaterial` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    CONSTRAINT `TeamCredentialRecipientMaterial_resourceId_fkey`
      FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `TeamCredentialRecipientMaterial_recipientAccountId_fkey`
      FOREIGN KEY (`recipientAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY `TCRM_resource_recipient_member_key`
      (`resourceId`, `recipientAccountId`, `sourceMemberKey`),
    KEY `TCRM_recipient_resource_idx`
      (`recipientAccountId`, `resourceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
