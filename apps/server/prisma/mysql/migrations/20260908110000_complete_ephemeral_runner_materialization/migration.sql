ALTER TABLE `Machine` ADD COLUMN `runnerContentKeyBinding` JSON NULL;
ALTER TABLE `EphemeralRunnerActivation`
    ADD COLUMN `credentialSelection` JSON NULL,
    ADD COLUMN `review` JSON NULL,
    ADD COLUMN `consent` JSON NULL,
    ADD COLUMN `readiness` JSON NULL,
    ADD COLUMN `sealedBootstrap` JSON NULL;
