ALTER TABLE "Account" ADD COLUMN "remoteAlertPolicy" JSONB;
ALTER TABLE "AccountPushToken" ADD COLUMN "remoteAlerts" JSONB;
