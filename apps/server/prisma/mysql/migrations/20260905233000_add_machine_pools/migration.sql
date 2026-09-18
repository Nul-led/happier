-- CreateTable
CREATE TABLE `MachinePool` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `description` LONGTEXT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MachinePool_accountId_id_idx`(`accountId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MachinePoolMember` (
    `poolId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `priorityTier` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MachinePoolMember_machineId_idx`(`machineId`),
    PRIMARY KEY (`poolId`, `machineId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MachinePool` ADD CONSTRAINT `MachinePool_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MachinePoolMember` ADD CONSTRAINT `MachinePoolMember_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `MachinePool`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MachinePoolMember` ADD CONSTRAINT `MachinePoolMember_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
