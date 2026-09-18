ALTER TABLE `Machine` ADD COLUMN `kind` ENUM('persistent', 'ephemeral_session_runner') NOT NULL DEFAULT 'persistent';
