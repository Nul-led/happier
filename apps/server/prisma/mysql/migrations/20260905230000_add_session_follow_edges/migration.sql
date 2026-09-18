-- CreateTable
CREATE TABLE `SessionFollowEdge` (
    `sourceSessionId` VARCHAR(191) NOT NULL,
    `destinationSessionId` VARCHAR(191) NOT NULL,
    `mode` ENUM('next_turn', 'wake_on_human_change') NOT NULL DEFAULT 'next_turn',
    `deliveredTranscriptSeq` INTEGER NOT NULL DEFAULT 0,
    `deliveredReadyEventSeq` INTEGER NOT NULL DEFAULT 0,
    `deliveredAgentStateVersion` INTEGER NOT NULL DEFAULT 0,
    `deliveredTurnId` VARCHAR(191) NULL,
    `deliveredTurnStatus` ENUM('completed', 'failed', 'cancelled') NULL,

    INDEX `SessionFollowEdge_sourceSessionId_idx`(`sourceSessionId`),
    PRIMARY KEY (`destinationSessionId`, `sourceSessionId`),
    CONSTRAINT `SessionFollowEdge_deliveredTurn_pair_check` CHECK (
        (`deliveredTurnId` IS NULL AND `deliveredTurnStatus` IS NULL)
        OR (`deliveredTurnId` IS NOT NULL AND `deliveredTurnStatus` IS NOT NULL)
    ),
    CONSTRAINT `SessionFollowEdge_frontier_nonnegative_check` CHECK (
        `deliveredTranscriptSeq` >= 0
        AND `deliveredReadyEventSeq` >= 0
        AND `deliveredAgentStateVersion` >= 0
    )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SessionFollowEdge` ADD CONSTRAINT `SessionFollowEdge_sourceSessionId_fkey` FOREIGN KEY (`sourceSessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionFollowEdge` ADD CONSTRAINT `SessionFollowEdge_destinationSessionId_fkey` FOREIGN KEY (`destinationSessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- MySQL rejects a CHECK over a column participating in a cascading foreign
-- key (error 3823). Preserve the provider-independent no-self-edge invariant
-- with an explicit provider error while retaining both endpoint cascades.
CREATE TRIGGER `SessionFollowEdge_distinct_sessions_insert`
BEFORE INSERT ON `SessionFollowEdge`
FOR EACH ROW
BEGIN
    IF NEW.`sourceSessionId` = NEW.`destinationSessionId` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SessionFollowEdge source and destination must differ';
    END IF;
END;

CREATE TRIGGER `SessionFollowEdge_distinct_sessions_update`
BEFORE UPDATE ON `SessionFollowEdge`
FOR EACH ROW
BEGIN
    IF NEW.`sourceSessionId` = NEW.`destinationSessionId` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SessionFollowEdge source and destination must differ';
    END IF;
END;
