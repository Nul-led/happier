-- CreateTable
CREATE TABLE `AccountSessionReadState` (
    `accountId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `lastViewedSessionSeq` INTEGER NOT NULL,
    `unreadSince` DATETIME(3) NULL,

    INDEX `AccountSessionReadState_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`accountId`, `sessionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountSessionReadState` ADD CONSTRAINT `AccountSessionReadState_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountSessionReadState` ADD CONSTRAINT `AccountSessionReadState_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the Session owner only. The shared cursor cannot prove which non-owner
-- ever saw the Session, so direct recipients, Team members and Group members get
-- no row: absence means quiet, and fabricating recipient baselines would either
-- invent history or erase somebody's manual unread. A NULL legacy cursor becomes
-- 0, preserving the incumbent owner rule that "never viewed" is unread.
-- Keep this one-time transition aligned with sessionTranscriptPublicationPolicy.
-- Unknown historical entry time remains NULL; caught-up owners have no unread entry.
INSERT INTO `AccountSessionReadState` (`accountId`, `sessionId`, `lastViewedSessionSeq`, `unreadSince`)
SELECT `accountId`, `id`, LEAST(GREATEST(COALESCE(`lastViewedSessionSeq`, 0), 0), `visibleSeq`),
    CASE WHEN GREATEST(COALESCE(`lastViewedSessionSeq`, 0), 0) < `visibleSeq` THEN `unreadSince` ELSE NULL END
FROM (
    SELECT `accountId`, `id`, `lastViewedSessionSeq`, `unreadSince`,
        GREATEST(0, LEAST(`seq`, CASE
        WHEN `currentStorageState` = 'hosted' THEN `seq`
        WHEN `currentStorageState` = 'server_partial'
            THEN GREATEST(COALESCE(`acceptedThroughServerSeq`, 0), 0)
        WHEN `currentStorageState` = 'snapshot_complete'
            AND LENGTH(TRIM(`materializationPublicationId`)) > 0
            AND `materializedThroughSourceAt` BETWEEN 0 AND 9007199254740991
            AND `publishedThroughServerSeq` BETWEEN 0 AND `seq`
            THEN `publishedThroughServerSeq`
        ELSE 0
    END)) AS `visibleSeq`
    FROM `Session`
) AS `ownerReadBaseline`;

-- Session owners are implicitly tracked. Establish every existing Discussion
-- at its current ceiling in the same migration so an upgrade cannot turn
-- historical Discussion activity into unread work. Non-owners are deliberately
-- absent: readable access alone is not tracking entry.
INSERT INTO `SessionDiscussionReadState` (`discussionId`, `accountId`, `lastReadSeq`, `updatedAt`)
SELECT `SessionDiscussion`.`id`, `Session`.`accountId`, `SessionDiscussion`.`messageSeq`, CURRENT_TIMESTAMP(3)
FROM `SessionDiscussion`
INNER JOIN `Session` ON `Session`.`id` = `SessionDiscussion`.`sessionId`;
