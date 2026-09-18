-- Offline forward cutover only: stop predecessor writers before either migration.
-- Preserve all non-null bytes; structural admission applies to new writes only.
CREATE TEMPORARY TABLE `session_envelope_conflicting_legacy_bytes` (`ok` INTEGER NOT NULL PRIMARY KEY);
INSERT INTO `session_envelope_conflicting_legacy_bytes` (`ok`)
SELECT 1 UNION ALL SELECT 1 FROM DUAL WHERE EXISTS (
    SELECT 1 FROM `Session` s
    JOIN `SessionShare` r ON r.`sessionId` = s.`id` AND r.`sharedWithUserId` = s.`accountId`
    WHERE s.`dataEncryptionKey` IS NOT NULL AND r.`encryptedDataKey` IS NOT NULL
      AND s.`dataEncryptionKey` <> r.`encryptedDataKey`
);
DROP TEMPORARY TABLE `session_envelope_conflicting_legacy_bytes`;

CREATE TABLE `SessionDataKeyEnvelope` (
    `sessionId` VARCHAR(191) NOT NULL,
    `recipientAccountId` VARCHAR(191) NOT NULL,
    `encryptedDataKey` LONGBLOB NOT NULL,
    CONSTRAINT `SessionDataKeyEnvelope_pkey` PRIMARY KEY (`sessionId`, `recipientAccountId`),
    CONSTRAINT `SessionDataKeyEnvelope_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `SessionDataKeyEnvelope_recipientAccountId_fkey` FOREIGN KEY (`recipientAccountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX `SessionDataKeyEnvelope_recipientAccountId_sessionId_idx`
    ON `SessionDataKeyEnvelope` (`recipientAccountId`, `sessionId`);

INSERT INTO `SessionDataKeyEnvelope` (`sessionId`, `recipientAccountId`, `encryptedDataKey`)
SELECT `id` AS `sessionId`, `accountId` AS `recipientAccountId`, `dataEncryptionKey` AS `encryptedDataKey`
    FROM `Session` WHERE `dataEncryptionKey` IS NOT NULL
UNION
SELECT `sessionId`, `sharedWithUserId`, `encryptedDataKey`
    FROM `SessionShare` WHERE `encryptedDataKey` IS NOT NULL;

CREATE TEMPORARY TABLE `session_envelope_backfill_mismatch` (`ok` INTEGER NOT NULL PRIMARY KEY);
INSERT INTO `session_envelope_backfill_mismatch` (`ok`)
SELECT 1 UNION ALL SELECT 1 FROM DUAL WHERE EXISTS (
    SELECT 1 FROM (SELECT `id` AS `sessionId`, `accountId` AS `recipientAccountId`, `dataEncryptionKey` AS `encryptedDataKey`
    FROM `Session` WHERE `dataEncryptionKey` IS NOT NULL
UNION
SELECT `sessionId`, `sharedWithUserId`, `encryptedDataKey`
    FROM `SessionShare` WHERE `encryptedDataKey` IS NOT NULL) legacy
    LEFT JOIN `SessionDataKeyEnvelope` e
      ON e.`sessionId` = legacy.`sessionId` AND e.`recipientAccountId` = legacy.`recipientAccountId`
    WHERE e.`sessionId` IS NULL OR e.`encryptedDataKey` <> legacy.`encryptedDataKey`
) OR (SELECT COUNT(*) FROM `SessionDataKeyEnvelope`) <> (SELECT COUNT(*) FROM (SELECT `id` AS `sessionId`, `accountId` AS `recipientAccountId`, `dataEncryptionKey` AS `encryptedDataKey`
    FROM `Session` WHERE `dataEncryptionKey` IS NOT NULL
UNION
SELECT `sessionId`, `sharedWithUserId`, `encryptedDataKey`
    FROM `SessionShare` WHERE `encryptedDataKey` IS NOT NULL) legacy);
DROP TEMPORARY TABLE `session_envelope_backfill_mismatch`;
