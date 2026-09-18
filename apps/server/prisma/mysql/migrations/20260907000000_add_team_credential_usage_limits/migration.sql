ALTER TABLE `SessionTurn`
    ADD COLUMN `usageActorAccountId` VARCHAR(191) NULL,
    ADD COLUMN `teamCredentialResourceId` VARCHAR(256) NULL,
    ADD COLUMN `credentialDeliveryMode` VARCHAR(32) NULL;
ALTER TABLE `UsageEvent`
    ADD COLUMN `executionRunId` VARCHAR(191) NULL,
    ADD COLUMN `teamCredentialResourceId` VARCHAR(256) NULL,
    ADD COLUMN `teamCredentialActorAccountId` VARCHAR(191) NULL,
    ADD COLUMN `teamCredentialExternalApiKeyId` VARCHAR(191) NULL,
    ADD COLUMN `teamCredentialSourceCredentialId` VARCHAR(191) NULL,
    ADD COLUMN `brokerMachineId` VARCHAR(191) NULL,
    ADD COLUMN `credentialDeliveryMode` VARCHAR(32) NULL,
    ADD COLUMN `requestCount` INT NOT NULL DEFAULT 0;
CREATE TABLE `UsageEventTeamCredentialGroupAttribution` (
    `usageEventId` VARCHAR(191) NOT NULL,
    `teamGroupId` VARCHAR(191) NOT NULL,
    PRIMARY KEY (`usageEventId`, `teamGroupId`),
    CONSTRAINT `UsageEventTeamCredentialGroupAttribution_usageEventId_fkey`
      FOREIGN KEY (`usageEventId`) REFERENCES `UsageEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `TeamCredentialUsageLimit` (
    `id` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(256) NOT NULL,
    `subjectKind` VARCHAR(32) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL DEFAULT '',
    `period` VARCHAR(16) NOT NULL,
    `metric` VARCHAR(32) NOT NULL,
    `maximum` LONGTEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    CONSTRAINT `TeamCredentialUsageLimit_resourceId_fkey`
      FOREIGN KEY (`resourceId`) REFERENCES `TeamCredentialResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY `TeamCredentialUsageLimit_identity_key` (`resourceId`, `subjectKind`, `subjectId`, `period`, `metric`),
    KEY `TeamCredentialUsageLimit_resourceId_enabled_idx` (`resourceId`, `enabled`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX `UETCGA_group_event_idx` ON `UsageEventTeamCredentialGroupAttribution` (`teamGroupId`, `usageEventId`);
CREATE INDEX `UsageEvent_teamCredentialResourceId_observedAt_idx` ON `UsageEvent` (`teamCredentialResourceId`, `observedAt`);
CREATE INDEX `UsageEvent_resource_actor_observed_idx` ON `UsageEvent` (`teamCredentialResourceId`, `teamCredentialActorAccountId`, `observedAt`);
CREATE INDEX `UsageEvent_teamCredentialExternalApiKeyId_observedAt_idx` ON `UsageEvent` (`teamCredentialExternalApiKeyId`, `observedAt`);
