ALTER TABLE "SessionTurn" ADD COLUMN "usageActorAccountId" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "teamCredentialResourceId" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "credentialDeliveryMode" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "teamCredentialResourceId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "teamCredentialActorAccountId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "teamCredentialExternalApiKeyId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "teamCredentialSourceCredentialId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "brokerMachineId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "credentialDeliveryMode" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "executionRunId" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "requestCount" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "UsageEventTeamCredentialGroupAttribution" (
    "usageEventId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    PRIMARY KEY ("usageEventId", "teamGroupId"),
    CONSTRAINT "UsageEventTeamCredentialGroupAttribution_usageEventId_fkey"
      FOREIGN KEY ("usageEventId") REFERENCES "UsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "TeamCredentialUsageLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "maximum" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamCredentialUsageLimit_resourceId_fkey"
      FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TeamCredentialUsageLimit_identity_key" ON "TeamCredentialUsageLimit"("resourceId", "subjectKind", "subjectId", "period", "metric");
CREATE INDEX "TeamCredentialUsageLimit_resourceId_enabled_idx" ON "TeamCredentialUsageLimit"("resourceId", "enabled");
CREATE INDEX "UETCGA_group_event_idx" ON "UsageEventTeamCredentialGroupAttribution"("teamGroupId", "usageEventId");
CREATE INDEX "UsageEvent_teamCredentialResourceId_observedAt_idx" ON "UsageEvent"("teamCredentialResourceId", "observedAt");
CREATE INDEX "UsageEvent_resource_actor_observed_idx" ON "UsageEvent"("teamCredentialResourceId", "teamCredentialActorAccountId", "observedAt");
CREATE INDEX "UsageEvent_teamCredentialExternalApiKeyId_observedAt_idx" ON "UsageEvent"("teamCredentialExternalApiKeyId", "observedAt");
