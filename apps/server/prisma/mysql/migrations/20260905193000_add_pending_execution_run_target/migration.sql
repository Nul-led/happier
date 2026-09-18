ALTER TABLE `SessionPendingMessage` ADD COLUMN `targetExecutionRunId` VARCHAR(191) NULL;
CREATE INDEX `SessionPendingMessage_sid_target_status_dstate_position_idx` ON `SessionPendingMessage`(`sessionId`, `targetExecutionRunId`, `status`, `deliveryState`, `position`);
