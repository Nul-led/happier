ALTER TABLE `PublicSessionShare` MODIFY `sessionId` VARCHAR(191) NULL;
ALTER TABLE `PublicSessionShare` ADD COLUMN `artifactId` VARCHAR(191) NULL;
ALTER TABLE `PublicSessionShare` ADD COLUMN `keyDerivation` VARCHAR(191) NOT NULL DEFAULT 'legacy_token_v1';
ALTER TABLE `PublicSessionShare` ADD CONSTRAINT `PublicSessionShare_subject_check` CHECK ((`sessionId` IS NOT NULL) <> (`artifactId` IS NOT NULL));
ALTER TABLE `PublicSessionShare` ADD CONSTRAINT `PublicSessionShare_keyDerivation_check` CHECK (`keyDerivation` IN ('legacy_token_v1', 'fragment_v1'));
CREATE UNIQUE INDEX `PublicSessionShare_artifactId_key` ON `PublicSessionShare`(`artifactId`);
ALTER TABLE `PublicSessionShare` ADD CONSTRAINT `PublicSessionShare_artifactId_fkey` FOREIGN KEY (`artifactId`) REFERENCES `Artifact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
