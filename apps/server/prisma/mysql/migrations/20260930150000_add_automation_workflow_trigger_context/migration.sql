ALTER TABLE `Automation` ADD COLUMN `workflowDefinitionId` LONGTEXT NULL;
ALTER TABLE `Automation` ADD COLUMN `scopeSessionId` VARCHAR(191) NULL;
CREATE INDEX `Automation_account_workflow_idx` ON `Automation`(`accountId`, `workflowDefinitionId`(191));
CREATE INDEX `Automation_account_scope_idx` ON `Automation`(`accountId`, `scopeSessionId`);
