-- CreateTable
CREATE TABLE `TeamCredentialResource` (
    `id` VARCHAR(256) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `custodianAccountId` VARCHAR(191) NOT NULL,
    `displayName` LONGTEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `disclosureCeiling` VARCHAR(191) NOT NULL,
    `sessionUsePolicy` VARCHAR(191) NOT NULL,
    `sourceBindingJson` LONGTEXT NOT NULL,
    `directSourceVersionsJson` LONGTEXT NULL,
    `requestPolicyJson` LONGTEXT NULL,
    `brokerMachineId` VARCHAR(191) NULL,
    `allMembersDeliveryMode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamCredentialResource_teamId_enabled_updatedAt_idx`(`teamId`, `enabled`, `updatedAt`),
    INDEX `TeamCredentialResource_custodianAccountId_updatedAt_idx`(`custodianAccountId`, `updatedAt`),
    INDEX `TeamCredentialResource_brokerMachineId_idx`(`brokerMachineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamCredentialGroupGrant` (
    `resourceId` VARCHAR(256) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    `deliveryMode` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamCredentialGroupGrant_teamGroupId_resourceId_idx`(`teamGroupId`, `resourceId`),
    PRIMARY KEY (`resourceId`, `teamGroupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamCredentialMemberGrant` (
    `resourceId` VARCHAR(256) NOT NULL,
    `teamMembershipId` VARCHAR(191) NOT NULL,
    `deliveryMode` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TeamCredentialMemberGrant_teamMembershipId_resourceId_idx`(`teamMembershipId`, `resourceId`),
    PRIMARY KEY (`resourceId`, `teamMembershipId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionTeamCredentialBinding` (
    `sessionId` VARCHAR(191) NOT NULL,
    `slotKind` VARCHAR(191) NOT NULL,
    `slotKey` VARBINARY(1536) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,
    `resourceRevision` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SessionTeamCredentialBinding_resourceId_sessionId_idx`(`resourceId`, `sessionId`),
    PRIMARY KEY (`sessionId`, `slotKind`, `slotKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TeamCredentialResource` ADD CONSTRAINT `TeamCredentialResource_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialResource` ADD CONSTRAINT `TeamCredentialResource_custodianAccountId_fkey` FOREIGN KEY (`custodianAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialResource` ADD CONSTRAINT `TeamCredentialResource_brokerMachineId_fkey` FOREIGN KEY (`brokerMachineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialGroupGrant` ADD CONSTRAINT `TeamCredentialGroupGrant_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialGroupGrant` ADD CONSTRAINT `TeamCredentialGroupGrant_teamGroupId_fkey` FOREIGN KEY (`teamGroupId`) REFERENCES `TeamGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialMemberGrant` ADD CONSTRAINT `TeamCredentialMemberGrant_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialMemberGrant` ADD CONSTRAINT `TeamCredentialMemberGrant_teamMembershipId_fkey` FOREIGN KEY (`teamMembershipId`) REFERENCES `TeamMembership`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionTeamCredentialBinding` ADD CONSTRAINT `SessionTeamCredentialBinding_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionTeamCredentialBinding` ADD CONSTRAINT `SessionTeamCredentialBinding_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `TeamCredentialActivityEvent` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `actorAccountId` VARCHAR(191) NULL,
    `subjectDisplayName` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamCredentialActivityEvent_teamId_resourceId_createdAt_idx`(`teamId`, `resourceId`, `createdAt`),
    INDEX `TeamCredentialActivityEvent_actorAccountId_idx`(`actorAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TeamCredentialActivityEvent` ADD CONSTRAINT `TeamCredentialActivityEvent_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamCredentialActivityEvent` ADD CONSTRAINT `TeamCredentialActivityEvent_actorAccountId_fkey` FOREIGN KEY (`actorAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
