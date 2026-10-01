-- CreateTable
CREATE TABLE `HomeSettings` (
    `id` VARCHAR(191) NOT NULL,
    `values` JSON NULL,
    `encryptedSecrets` LONGBLOB NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HomeAdministrationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorKind` VARCHAR(191) NOT NULL,
    `actorAccountId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetKind` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `summary` JSON NOT NULL,

    INDEX `HomeAdministrationEvent_at_id_idx`(`at`, `id`),
    INDEX `HomeAdministrationEvent_targetId_at_idx`(`targetId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

