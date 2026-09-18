ALTER TABLE `AuthPairingSession`
    ADD COLUMN `flow` VARCHAR(32) NOT NULL DEFAULT 'direct_qr',
    ADD COLUMN `requesterIssuerServerIdentityId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN `requesterIssuerSubjectId` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN `approvalStatus` VARCHAR(16) NULL,
    ADD COLUMN `decidedAt` DATETIME(3) NULL;
