-- CreateTable
CREATE TABLE `SessionDiscussion` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `creationLocalId` VARCHAR(191) NOT NULL,
    `creationEqualityEvidenceV1` JSON NOT NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `titleContent` JSON NOT NULL,
    `messageSeq` INTEGER NOT NULL DEFAULT 0,
    `lastMessageAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SessionDiscussion_sessionId_archivedAt_lastMessageAt_id_idx`(`sessionId`, `archivedAt`, `lastMessageAt`, `id`),
    UNIQUE INDEX `SessionDiscussion_id_sessionId_key`(`id`, `sessionId`),
    UNIQUE INDEX `SessionDiscussion_sessionId_creationLocalId_key`(`sessionId`, `creationLocalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionDiscussionMessage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `discussionId` VARCHAR(191) NOT NULL,
    `localId` VARCHAR(191) NOT NULL,
    `requestEqualityEvidenceV1` JSON NOT NULL,
    `seq` INTEGER NOT NULL,
    `authorAccountId` VARCHAR(191) NULL,
    `producerV1` JSON NULL,
    `content` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SessionDiscussionMessage_discussionId_seq_idx`(`discussionId`, `seq`),
    INDEX `SessionDiscussionMessage_authorAccountId_createdAt_idx`(`authorAccountId`, `createdAt`),
    UNIQUE INDEX `SessionDiscussionMessage_discussionId_localId_key`(`discussionId`, `localId`),
    UNIQUE INDEX `SessionDiscussionMessage_discussionId_seq_key`(`discussionId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionDiscussionMessageMention` (
    `messageId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SessionDiscussionMessageMention_accountId_createdAt_idx`(`accountId`, `createdAt`),
    PRIMARY KEY (`messageId`, `accountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionDiscussionReadState` (
    `discussionId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `lastReadSeq` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SessionDiscussionReadState_accountId_discussionId_idx`(`accountId`, `discussionId`),
    PRIMARY KEY (`discussionId`, `accountId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SessionDiscussion` ADD CONSTRAINT `SessionDiscussion_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussion` ADD CONSTRAINT `SessionDiscussion_createdByAccountId_fkey` FOREIGN KEY (`createdByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionMessage` ADD CONSTRAINT `SessionDiscussionMessage_discussionId_sessionId_fkey` FOREIGN KEY (`discussionId`, `sessionId`) REFERENCES `SessionDiscussion`(`id`, `sessionId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionMessage` ADD CONSTRAINT `SessionDiscussionMessage_authorAccountId_fkey` FOREIGN KEY (`authorAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionMessageMention` ADD CONSTRAINT `SessionDiscussionMessageMention_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `SessionDiscussionMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionMessageMention` ADD CONSTRAINT `SessionDiscussionMessageMention_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionReadState` ADD CONSTRAINT `SessionDiscussionReadState_discussionId_fkey` FOREIGN KEY (`discussionId`) REFERENCES `SessionDiscussion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionDiscussionReadState` ADD CONSTRAINT `SessionDiscussionReadState_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

