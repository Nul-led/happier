-- Preserve the remote-dev migration ledger and move its physical schema to the
-- current canonical names and widths through an append-only transition.

-- The supported 0.2 predecessor dropped this released compatibility table,
-- while 0.3 still reads it until each service/profile is replaced or deleted.
-- Recreate only the missing storage; an existing table and its rows stay intact.
CREATE TABLE IF NOT EXISTS `ServiceAccountQuotaSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `snapshot` LONGBLOB NOT NULL,
    `status` VARCHAR(191) NULL,
    `fetchedAt` DATETIME(3) NULL,
    `staleAfterMs` INTEGER NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceAccountQuotaSnapshot_accountId_idx`(`accountId`),
    UNIQUE INDEX `ServiceAccountQuotaSnapshot_accountId_vendor_profileId_key`(`accountId`, `vendor`, `profileId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ServiceAccountQuotaSnapshot_accountId_fkey`
        FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SessionTurn`
    RENAME COLUMN `provider` TO `agentId`,
    RENAME COLUMN `providerTurnId` TO `agentTurnId`,
    RENAME COLUMN `providerRollbackOrdinal` TO `agentRollbackOrdinal`,
    RENAME INDEX `SessionTurn_sessionId_provider_providerTurnId_idx`
    TO `SessionTurn_sessionId_agentId_agentTurnId_idx`;

ALTER TABLE `ConnectedServiceUsageSource`
    DROP FOREIGN KEY `csus_paur_fkey`,
    ADD CONSTRAINT `csus_record_fkey`
        FOREIGN KEY (`accountId`, `providerAccountUsageRecordId`)
        REFERENCES `ProviderAccountUsageRecord`(`accountId`, `recordId`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    RENAME INDEX `csus_paur_idx` TO `csus_record_idx`;

ALTER TABLE `SessionSystemRecord`
    MODIFY COLUMN `namespace` VARCHAR(64) NOT NULL,
    MODIFY COLUMN `kind` VARCHAR(64) NOT NULL,
    RENAME INDEX `ssr_account_session_kind_updated_id_idx`
    TO `SessionSystemRecord_account_kind_updated_idx`;

ALTER TABLE `SessionOrganizationOrderEntry`
    MODIFY COLUMN `scopeKind` VARCHAR(64) NOT NULL,
    MODIFY COLUMN `itemKind` VARCHAR(64) NOT NULL;
ALTER TABLE `SessionOrganizationLabel`
    MODIFY COLUMN `labelKind` VARCHAR(191) NOT NULL;
