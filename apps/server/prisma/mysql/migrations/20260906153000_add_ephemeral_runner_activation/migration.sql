CREATE TABLE `EphemeralRunnerActivation` (
    `id` VARCHAR(191) NOT NULL,
    `creatorAccountId` VARCHAR(191) NOT NULL,
    `creatorTokenEpoch` INTEGER NOT NULL,
    `draftId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `closeReason` VARCHAR(191),
    `progressPhase` VARCHAR(191),
    `activationExpiresAt` DATETIME(3),
    `workspacePolicy` VARCHAR(191) NOT NULL,
    `homeServerIdentityId` VARCHAR(191) NOT NULL,
    `activationSigningPublicKey` VARCHAR(191) NOT NULL,
    `authoringCommitment` VARCHAR(191) NOT NULL,
    `artifact` JSON NOT NULL,
    `endpointFactsRecipient` JSON NOT NULL,
    `authenticationEvidence` JSON,
    `claim` JSON,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `EphemeralRunnerActivation_pkey` PRIMARY KEY (`id`),
    CONSTRAINT `EphemeralRunnerActivation_creatorAccountId_fkey` FOREIGN KEY (`creatorAccountId`) REFERENCES `Account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE UNIQUE INDEX `EphemeralRunnerActivation_sessionId_key` ON `EphemeralRunnerActivation`(`sessionId`);
CREATE UNIQUE INDEX `EphemeralRunnerActivation_machineId_key` ON `EphemeralRunnerActivation`(`machineId`);
CREATE INDEX `EphemeralRunnerActivation_creatorAccountId_draftId_idx` ON `EphemeralRunnerActivation`(`creatorAccountId`, `draftId`);
