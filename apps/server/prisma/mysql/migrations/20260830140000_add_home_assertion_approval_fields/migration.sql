ALTER TABLE `AuthPairingSession`
    ADD COLUMN `flow` VARCHAR(32) NOT NULL DEFAULT 'direct_qr',
    ADD COLUMN `requesterIssuerServerIdentityId` VARCHAR(191) NULL,
    ADD COLUMN `requesterIssuerSubjectId` VARCHAR(256) NULL,
    ADD COLUMN `approvalStatus` VARCHAR(16) NULL,
    ADD COLUMN `decidedAt` DATETIME(3) NULL;
