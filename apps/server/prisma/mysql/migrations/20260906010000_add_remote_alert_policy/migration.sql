ALTER TABLE `Account` ADD COLUMN `remoteAlertPolicy` JSON NULL;
ALTER TABLE `AccountPushToken` ADD COLUMN `remoteAlerts` JSON NULL;
