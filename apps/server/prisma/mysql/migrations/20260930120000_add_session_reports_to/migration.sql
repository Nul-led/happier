CREATE TABLE `SessionReportsTo` (
    `sessionId` VARCHAR(191) NOT NULL,
    `leadSessionId` VARCHAR(191) NOT NULL,
    `attachedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredTranscriptSeq` INTEGER NOT NULL DEFAULT 0,
    `deliveredReadyEventSeq` INTEGER NOT NULL DEFAULT 0,
    `deliveredAgentStateVersion` INTEGER NOT NULL DEFAULT 0,
    `deliveredTurnId` VARCHAR(191) NULL,
    `deliveredTurnStatus` ENUM('completed', 'failed', 'cancelled') NULL,
    PRIMARY KEY (`sessionId`),
    INDEX `SessionReportsTo_leadSessionId_idx` (`leadSessionId`),
    CONSTRAINT `SessionReportsTo_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `SessionReportsTo_leadSessionId_fkey` FOREIGN KEY (`leadSessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
