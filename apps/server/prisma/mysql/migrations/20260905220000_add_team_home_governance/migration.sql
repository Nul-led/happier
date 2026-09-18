-- AlterTable
ALTER TABLE `Account` ADD COLUMN `homeRole` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
    ADD COLUMN `status` ENUM('active', 'suspended', 'disabled') NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE `HomeGovernancePolicy` (
    `id` VARCHAR(191) NOT NULL,
    `teamCreationPolicy` ENUM('self_service', 'managed_only', 'disabled') NOT NULL DEFAULT 'managed_only',
    `authenticationPolicy` JSON NULL,
    `teamProviderPolicy` JSON NULL,
    `identityNetworkPolicy` JSON NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Team` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NULL,
    `logo` JSON NULL,
    `sessionCreationPolicy` ENUM('private_default', 'team_default', 'team_required') NOT NULL DEFAULT 'private_default',
    `externalSharingPolicy` ENUM('allowed', 'team_admins_only', 'disabled') NOT NULL DEFAULT 'allowed',
    `defaultSessionHistoryAccess` ENUM('all_existing', 'from_membership') NOT NULL DEFAULT 'from_membership',
    `admissionMode` ENUM('invite_only', 'provisioned', 'jit') NOT NULL DEFAULT 'invite_only',
    `authenticationPolicy` JSON NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Team_name_id_idx`(`name`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamMembership` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `role` ENUM('owner', 'admin', 'member', 'guest') NOT NULL,
    `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    `sessionAccessStartsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamMembership_accountId_status_teamId_idx`(`accountId`, `status`, `teamId`),
    INDEX `TeamMembership_teamId_createdAt_id_idx`(`teamId`, `createdAt`, `id`),
    UNIQUE INDEX `TeamMembership_teamId_accountId_key`(`teamId`, `accountId`),
    UNIQUE INDEX `TeamMembership_id_teamId_key`(`id`, `teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamGroup` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameKey` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `description` LONGTEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeamGroup_id_teamId_key`(`id`, `teamId`),
    UNIQUE INDEX `TeamGroup_teamId_nameKey_key`(`teamId`, `nameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamGroupMembership` (
    `teamId` VARCHAR(191) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    `teamMembershipId` VARCHAR(191) NOT NULL,
    `nativeContribution` BOOLEAN NOT NULL DEFAULT false,
    `sessionAccessStartsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamGroupMembership_teamMembershipId_teamId_idx`(`teamMembershipId`, `teamId`),
    INDEX `TeamGroupMembership_page_idx`(`teamGroupId`, `createdAt`, `teamMembershipId`),
    PRIMARY KEY (`teamGroupId`, `teamMembershipId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamExternalGroupBinding` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    `directorySourceId` VARCHAR(191) NULL,
    `teamIdentityConnectionId` VARCHAR(191) NULL,
    `externalGroupId` VARCHAR(256) NOT NULL,
    `bindingMode` ENUM('directory_created', 'native_target') NOT NULL,

    INDEX `TeamExternalGroupBinding_teamGroupId_idx`(`teamGroupId`),
    UNIQUE INDEX `TeamExternalGroupBinding_id_teamGroupId_key`(`id`, `teamGroupId`),
    UNIQUE INDEX `TeamExternalGroupBinding_directory_key`(`directorySourceId`, `externalGroupId`),
    UNIQUE INDEX `TeamExternalGroupBinding_connection_key`(`teamIdentityConnectionId`, `externalGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamGroupMembershipExternalContribution` (
    `teamGroupId` VARCHAR(191) NOT NULL,
    `teamMembershipId` VARCHAR(191) NOT NULL,
    `externalGroupBindingId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamGroupContribution_binding_idx`(`externalGroupBindingId`),
    PRIMARY KEY (`teamGroupId`, `teamMembershipId`, `externalGroupBindingId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `tokenHash` VARBINARY(32) NOT NULL,
    `recipientEmailNormalized` VARCHAR(320) NULL,
    `role` ENUM('owner', 'admin', 'member', 'guest') NOT NULL,
    `historyAccess` ENUM('all_existing', 'from_membership') NOT NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedByAccountId` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastEmailDeliveryStatus` ENUM('sent', 'failed') NULL,
    `lastEmailDeliveryAttemptAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TeamInvitation_tokenHash_key`(`tokenHash`),
    INDEX `TeamInvitation_teamId_createdAt_id_idx`(`teamId`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TeamMembership` ADD CONSTRAINT `TeamMembership_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamMembership` ADD CONSTRAINT `TeamMembership_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroup` ADD CONSTRAINT `TeamGroup_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMembership` ADD CONSTRAINT `TeamGroupMembership_teamGroupId_teamId_fkey` FOREIGN KEY (`teamGroupId`, `teamId`) REFERENCES `TeamGroup`(`id`, `teamId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMembership` ADD CONSTRAINT `TeamGroupMembership_teamMembershipId_teamId_fkey` FOREIGN KEY (`teamMembershipId`, `teamId`) REFERENCES `TeamMembership`(`id`, `teamId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamExternalGroupBinding` ADD CONSTRAINT `TeamExternalGroupBinding_teamGroupId_teamId_fkey` FOREIGN KEY (`teamGroupId`, `teamId`) REFERENCES `TeamGroup`(`id`, `teamId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMembershipExternalContribution` ADD CONSTRAINT `TeamGroupContribution_membership_fkey` FOREIGN KEY (`teamGroupId`, `teamMembershipId`) REFERENCES `TeamGroupMembership`(`teamGroupId`, `teamMembershipId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamGroupMembershipExternalContribution` ADD CONSTRAINT `TeamGroupContribution_binding_fkey` FOREIGN KEY (`externalGroupBindingId`, `teamGroupId`) REFERENCES `TeamExternalGroupBinding`(`id`, `teamGroupId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamInvitation` ADD CONSTRAINT `TeamInvitation_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamInvitation` ADD CONSTRAINT `TeamInvitation_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamInvitation` ADD CONSTRAINT `TeamInvitation_acceptedByAccountId_fkey` FOREIGN KEY (`acceptedByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Binary comparison preserves the literal namespace and exact Account identity.
UPDATE `Account` SET `status` = 'disabled'
WHERE EXISTS (SELECT 1 FROM `RepeatKey` WHERE BINARY `key` = BINARY CONCAT('auth_disabled_', `Account`.`id`) AND `expiresAt` > CURRENT_TIMESTAMP(3));
DELETE FROM `RepeatKey` WHERE BINARY LEFT(`key`, 14) = BINARY 'auth_disabled_';

-- A native mapping always names exactly one external owner.
ALTER TABLE `TeamExternalGroupBinding` ADD CONSTRAINT `TeamExternalGroupBinding_owner_check` CHECK ((`directorySourceId` IS NULL) <> (`teamIdentityConnectionId` IS NULL));
