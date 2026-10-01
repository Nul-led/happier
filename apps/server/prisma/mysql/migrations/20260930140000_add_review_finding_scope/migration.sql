ALTER TABLE `review_comments`
    MODIFY COLUMN `project_id` VARCHAR(191) NULL,
    ADD COLUMN `workspace_json` LONGTEXT NULL,
    ADD COLUMN `finding_identity` VARCHAR(191) NULL,
    ADD COLUMN `finding_severity` VARCHAR(191) NULL,
    ADD COLUMN `reviewed_fingerprint` VARCHAR(191) NULL,
    ADD COLUMN `review_triage_status` VARCHAR(191) NULL,
    ADD COLUMN `finding_scope_key` VARCHAR(191) NULL;

ALTER TABLE `review_comment_events`
    MODIFY COLUMN `project_id` VARCHAR(191) NULL,
    ADD COLUMN `workspace_json` LONGTEXT NULL;

CREATE UNIQUE INDEX `review_comments_account_finding_scope_key`
    ON `review_comments`(`account_id`, `finding_scope_key`);
