-- Provider and directory identity columns use utf8mb4_0900_bin so exact opaque
-- values that differ only by trailing spaces remain distinct.
-- CreateTable
CREATE TABLE `IdentityProviderInstance` (
    `id` VARCHAR(191) NOT NULL,
    `ownerTeamId` VARCHAR(191) NULL,
    `kind` ENUM('oidc', 'workos_sso', 'github_app_identity') NOT NULL,
    `displayName` VARCHAR(256) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `firstEnabledAt` DATETIME(3) NULL,
    `securityRevision` INTEGER NOT NULL DEFAULT 1,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NOT NULL,
    `encryptedSecrets` LONGBLOB NULL,
    `githubAppInstallationId` VARCHAR(191) NULL,
    `lastSuccessfulTestAt` DATETIME(3) NULL,
    `lastSuccessfulTestRuntimeFingerprint` VARCHAR(1024) NULL,
    `lastSuccessfulTestSecurityRevision` INTEGER NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IdentityProviderInstance_ownerTeamId_createdAt_id_idx`(`ownerTeamId`, `createdAt`, `id`),
    INDEX `IdentityProviderInstance_githubAppInstallationId_idx`(`githubAppInstallationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamIdentityConnection` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `providerInstanceId` VARCHAR(191) NOT NULL,
    `externalReference` JSON NOT NULL,
    `settings` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `firstEnabledAt` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `lastObservation` JSON NULL,
    `lastSuccessfulTestAt` DATETIME(3) NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeamIdentityConnection_teamId_providerInstanceId_key`(`teamId`, `providerInstanceId`),
    UNIQUE INDEX `TeamIdentityConnection_id_teamId_key`(`id`, `teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamMembershipIdentityConnectionManagement` (
    `teamMembershipId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `teamIdentityConnectionId` VARCHAR(191) NOT NULL,

    INDEX `TeamMembershipIdentityConnectionManagement_connection_idx`(`teamIdentityConnectionId`),
    UNIQUE INDEX `TeamMembershipIdentityConnectionManagement_membership_team_key`(`teamMembershipId`, `teamId`),
    INDEX `TeamMembershipIdentityConnectionManagement_connection_team_idx`(`teamIdentityConnectionId`, `teamId`),
    PRIMARY KEY (`teamMembershipId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GitHubAppRegistration` (
    `id` VARCHAR(191) NOT NULL,
    `ownerTeamId` VARCHAR(191) NULL,
    `githubHost` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `githubAppId` BIGINT NOT NULL,
    `githubClientId` VARCHAR(256) NOT NULL,
    `githubAppSlug` VARCHAR(256) NULL,
    `githubOwnerId` BIGINT NULL,
    `githubOwnerLogin` VARCHAR(256) NULL,
    `config` JSON NOT NULL,
    `encryptedSecrets` LONGBLOB NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `securityRevision` INTEGER NOT NULL DEFAULT 1,
    `state` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `verificationHealth` JSON NULL,
    `lastVerifiedAt` DATETIME(3) NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GitHubAppRegistration_ownerTeamId_createdAt_id_idx`(`ownerTeamId`, `createdAt`, `id`),
    UNIQUE INDEX `GitHubAppRegistration_githubHost_githubAppId_key`(`githubHost`, `githubAppId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GitHubAppInstallation` (
    `id` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `githubInstallationId` BIGINT NOT NULL,
    `githubOrganizationId` BIGINT NOT NULL,
    `githubOrganizationLogin` VARCHAR(256) NOT NULL,
    `repositorySelection` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `state` VARCHAR(191) NOT NULL DEFAULT 'unverified',
    `verifiedPermissions` JSON NULL,
    `verifiedEvents` JSON NULL,
    `suspendedAt` DATETIME(3) NULL,
    `lastVerifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GitHubAppInstallation_registrationId_state_id_idx`(`registrationId`, `state`, `id`),
    UNIQUE INDEX `GitHubAppInstallation_registrationId_githubInstallationId_key`(`registrationId`, `githubInstallationId`),
    UNIQUE INDEX `GitHubAppInstallation_registrationId_githubOrganizationId_key`(`registrationId`, `githubOrganizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamDirectorySource` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `kind` ENUM('workos_directory', 'github_organization') NOT NULL,
    `state` ENUM('initializing', 'active', 'paused', 'needs_attention') NOT NULL DEFAULT 'initializing',
    `displayName` VARCHAR(256) NOT NULL,
    `externalSourceKey` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `bindingConfig` JSON NOT NULL,
    `teamIdentityConnectionId` VARCHAR(191) NULL,
    `githubAppInstallationId` VARCHAR(191) NULL,
    `eventCursor` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `eventRangeStart` DATETIME(3) NULL,
    `manualSyncRequestedAt` DATETIME(3) NULL,
    `activeReconcileRunId` VARCHAR(36) NULL,
    `activeReconcileStartedAt` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFullReconcileAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(64) NULL,
    `consecutiveFailureCount` INTEGER NOT NULL DEFAULT 0,
    `retryNotBefore` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeamDirectorySource_externalSourceKey_key`(`externalSourceKey`),
    INDEX `TeamDirectorySource_teamId_state_idx`(`teamId`, `state`),
    INDEX `TeamDirectorySource_githubAppInstallationId_idx`(`githubAppInstallationId`),
    INDEX `TeamDirectorySource_state_manualSyncRequestedAt_idx`(`state`, `manualSyncRequestedAt`),
    INDEX `TeamDirectorySource_state_retryNotBefore_lastAttemptAt_id_idx`(`state`, `retryNotBefore`, `lastAttemptAt`, `id`),
    UNIQUE INDEX `TeamDirectorySource_id_teamId_key`(`id`, `teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamProvisionedIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `directorySourceId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `externalUserId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `externalSubjectId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `normalizedEmail` VARCHAR(512) NULL,
    `displayName` VARCHAR(512) NULL,
    `externalLogin` VARCHAR(512) NULL,
    `state` ENUM('active', 'suspended', 'deleted') NOT NULL,
    `boundAccountId` VARCHAR(191) NULL,
    `teamMembershipId` VARCHAR(191) NULL,
    `teamMembershipTeamId` VARCHAR(191) NULL,
    `externalUpdatedAt` DATETIME(3) NULL,
    `lastSeenReconcileRunId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeamProvisionedIdentity_teamMembershipId_key`(`teamMembershipId`),
    UNIQUE INDEX `TeamProvisionedIdentity_membership_team_key`(`teamMembershipId`, `teamMembershipTeamId`),
    INDEX `TeamProvisionedIdentity_boundAccountId_idx`(`boundAccountId`),
    INDEX `TeamProvisionedIdentity_directorySourceId_state_idx`(`directorySourceId`, `state`),
    UNIQUE INDEX `TeamProvisionedIdentity_directorySourceId_externalUserId_key`(`directorySourceId`, `externalUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamDirectoryGroup` (
    `id` VARCHAR(191) NOT NULL,
    `directorySourceId` VARCHAR(191) NOT NULL,
    `externalGroupId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `externalDisplayName` VARCHAR(512) NOT NULL,
    `state` ENUM('active', 'deleted') NOT NULL,
    `externalUpdatedAt` DATETIME(3) NULL,
    `lastSeenReconcileRunId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeamDirectoryGroup_directorySourceId_externalGroupId_key`(`directorySourceId`, `externalGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamDirectoryGroupMember` (
    `directorySourceId` VARCHAR(191) NOT NULL,
    `externalGroupId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `externalUserId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `lastSeenReconcileRunId` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,

    INDEX `TeamDirectoryGroupMember_directorySourceId_externalUserId_idx`(`directorySourceId`, `externalUserId`),
    PRIMARY KEY (`directorySourceId`, `externalGroupId`, `externalUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_ownerTeamId_fkey` FOREIGN KEY (`ownerTeamId`) REFERENCES `Team`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_githubAppInstallationId_fkey` FOREIGN KEY (`githubAppInstallationId`) REFERENCES `GitHubAppInstallation`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamIdentityConnection` ADD CONSTRAINT `TeamIdentityConnection_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamIdentityConnection` ADD CONSTRAINT `TeamIdentityConnection_providerInstanceId_fkey` FOREIGN KEY (`providerInstanceId`) REFERENCES `IdentityProviderInstance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamIdentityConnection` ADD CONSTRAINT `TeamIdentityConnection_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamMembershipIdentityConnectionManagement` ADD CONSTRAINT `TeamMembershipIdentityConnectionManagement_membership_fkey` FOREIGN KEY (`teamMembershipId`, `teamId`) REFERENCES `TeamMembership`(`id`, `teamId`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamMembershipIdentityConnectionManagement` ADD CONSTRAINT `TeamMembershipIdentityConnectionManagement_connection_fkey` FOREIGN KEY (`teamIdentityConnectionId`, `teamId`) REFERENCES `TeamIdentityConnection`(`id`, `teamId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `GitHubAppRegistration` ADD CONSTRAINT `GitHubAppRegistration_ownerTeamId_fkey` FOREIGN KEY (`ownerTeamId`) REFERENCES `Team`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GitHubAppRegistration` ADD CONSTRAINT `GitHubAppRegistration_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GitHubAppInstallation` ADD CONSTRAINT `GitHubAppInstallation_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `GitHubAppRegistration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_teamIdentityConnectionId_teamId_fkey` FOREIGN KEY (`teamIdentityConnectionId`, `teamId`) REFERENCES `TeamIdentityConnection`(`id`, `teamId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_githubAppInstallationId_fkey` FOREIGN KEY (`githubAppInstallationId`) REFERENCES `GitHubAppInstallation`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamProvisionedIdentity` ADD CONSTRAINT `TeamProvisionedIdentity_directorySourceId_fkey` FOREIGN KEY (`directorySourceId`, `teamId`) REFERENCES `TeamDirectorySource`(`id`, `teamId`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamProvisionedIdentity` ADD CONSTRAINT `TeamProvisionedIdentity_boundAccountId_fkey` FOREIGN KEY (`boundAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamProvisionedIdentity` ADD CONSTRAINT `TeamProvisionedIdentity_teamMembershipId_fkey` FOREIGN KEY (`teamMembershipId`, `teamMembershipTeamId`) REFERENCES `TeamMembership`(`id`, `teamId`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamDirectoryGroup` ADD CONSTRAINT `TeamDirectoryGroup_directorySourceId_fkey` FOREIGN KEY (`directorySourceId`) REFERENCES `TeamDirectorySource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDirectoryGroupMember` ADD CONSTRAINT `TeamDirectoryGroupMember_directorySourceId_fkey` FOREIGN KEY (`directorySourceId`) REFERENCES `TeamDirectorySource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDirectoryGroupMember` ADD CONSTRAINT `TeamDirectoryGroupMember_directorySourceId_externalGroupId_fkey` FOREIGN KEY (`directorySourceId`, `externalGroupId`) REFERENCES `TeamDirectoryGroup`(`directorySourceId`, `externalGroupId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamDirectoryGroupMember` ADD CONSTRAINT `TeamDirectoryGroupMember_directorySourceId_externalUserId_fkey` FOREIGN KEY (`directorySourceId`, `externalUserId`) REFERENCES `TeamProvisionedIdentity`(`directorySourceId`, `externalUserId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamExternalGroupBinding` ADD CONSTRAINT `TeamExternalGroupBinding_teamIdentityConnectionId_teamId_fkey` FOREIGN KEY (`teamIdentityConnectionId`, `teamId`) REFERENCES `TeamIdentityConnection`(`id`, `teamId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TeamExternalGroupBinding` ADD CONSTRAINT `TeamExternalGroupBinding_directorySourceId_teamId_fkey` FOREIGN KEY (`directorySourceId`, `teamId`) REFERENCES `TeamDirectorySource`(`id`, `teamId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- External provider identifiers are opaque. Preserve exact comparison on the
-- pre-existing Lane 01 binding column without changing its accepted length.
ALTER TABLE `TeamExternalGroupBinding` MODIFY `externalGroupId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL;


-- Provider and directory invariants that Prisma cannot express.
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_revision_check` CHECK (`revision` > 0 AND `securityRevision` > 0);
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_test_revision_check` CHECK (`lastSuccessfulTestSecurityRevision` IS NULL OR `lastSuccessfulTestSecurityRevision` > 0);
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_test_fields_check` CHECK ((`lastSuccessfulTestAt` IS NULL) = (`lastSuccessfulTestRuntimeFingerprint` IS NULL) AND (`lastSuccessfulTestAt` IS NULL) = (`lastSuccessfulTestSecurityRevision` IS NULL));
ALTER TABLE `IdentityProviderInstance` ADD CONSTRAINT `IdentityProviderInstance_github_reference_check` CHECK ((`kind` = 'github_app_identity') = (`githubAppInstallationId` IS NOT NULL));
ALTER TABLE `TeamIdentityConnection` ADD CONSTRAINT `TeamIdentityConnection_revision_check` CHECK (`revision` > 0);
ALTER TABLE `GitHubAppRegistration` ADD CONSTRAINT `GitHubAppRegistration_values_check` CHECK (`revision` > 0 AND `securityRevision` > 0 AND `githubAppId` > 0 AND (`githubOwnerId` IS NULL OR `githubOwnerId` > 0) AND CHAR_LENGTH(`githubHost`) > 0 AND CHAR_LENGTH(`githubClientId`) > 0 AND OCTET_LENGTH(`encryptedSecrets`) > 0 AND `state` IN ('draft', 'verified', 'disabled', 'needs_attention'));
ALTER TABLE `GitHubAppInstallation` ADD CONSTRAINT `GitHubAppInstallation_values_check` CHECK (`revision` > 0 AND `githubInstallationId` > 0 AND `githubOrganizationId` > 0 AND CHAR_LENGTH(`githubOrganizationLogin`) > 0 AND `repositorySelection` IN ('all', 'selected') AND `state` IN ('unverified', 'verified', 'suspended', 'needs_attention'));
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_kind_reference_check` CHECK ((`kind` = 'workos_directory' AND `teamIdentityConnectionId` IS NOT NULL AND `githubAppInstallationId` IS NULL) OR (`kind` = 'github_organization' AND `teamIdentityConnectionId` IS NULL AND `githubAppInstallationId` IS NOT NULL));
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_github_cursor_check` CHECK (`kind` <> 'github_organization' OR (`eventCursor` IS NULL AND `eventRangeStart` IS NULL));
ALTER TABLE `TeamDirectorySource` ADD CONSTRAINT `TeamDirectorySource_reconcile_pair_check` CHECK ((`activeReconcileRunId` IS NULL) = (`activeReconcileStartedAt` IS NULL));
-- MySQL rejects a CHECK that reads columns participating in an FK with a
-- referential action (error 3823). Preserve the same invariant at the
-- provider write boundary while retaining ON DELETE SET NULL on the FK.
CREATE TRIGGER `TeamProvisionedIdentity_membership_team_insert`
BEFORE INSERT ON `TeamProvisionedIdentity`
FOR EACH ROW
BEGIN
    IF NOT ((NEW.`teamMembershipId` IS NULL) = (NEW.`teamMembershipTeamId` IS NULL) AND (NEW.`teamMembershipId` IS NULL OR NEW.`teamMembershipTeamId` = NEW.`teamId`)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TeamProvisionedIdentity membership must belong to the same Team';
    END IF;
END;

CREATE TRIGGER `TeamProvisionedIdentity_membership_team_update`
BEFORE UPDATE ON `TeamProvisionedIdentity`
FOR EACH ROW
BEGIN
    IF NOT ((NEW.`teamMembershipId` IS NULL) = (NEW.`teamMembershipTeamId` IS NULL) AND (NEW.`teamMembershipId` IS NULL OR NEW.`teamMembershipTeamId` = NEW.`teamId`)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TeamProvisionedIdentity membership must belong to the same Team';
    END IF;
END;
