ALTER TABLE "SessionTurn"
    ADD COLUMN "usageActorAccountId" TEXT,
    ADD COLUMN "teamCredentialResourceId" TEXT,
    ADD COLUMN "credentialDeliveryMode" TEXT;

ALTER TABLE "UsageEvent"
    ADD COLUMN "executionRunId" TEXT,
    ADD COLUMN "teamCredentialResourceId" TEXT,
    ADD COLUMN "teamCredentialActorAccountId" TEXT,
    ADD COLUMN "teamCredentialExternalApiKeyId" TEXT,
    ADD COLUMN "teamCredentialSourceCredentialId" TEXT,
    ADD COLUMN "brokerMachineId" TEXT,
    ADD COLUMN "credentialDeliveryMode" TEXT,
    ADD COLUMN "requestCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UsageEventTeamCredentialGroupAttribution" (
    "usageEventId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    CONSTRAINT "UsageEventTeamCredentialGroupAttribution_pkey" PRIMARY KEY ("usageEventId", "teamGroupId"),
    CONSTRAINT "UsageEventTeamCredentialGroupAttribution_usageEventId_fkey"
      FOREIGN KEY ("usageEventId") REFERENCES "UsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TeamCredentialUsageLimit" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "maximum" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamCredentialUsageLimit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamCredentialUsageLimit_resourceId_fkey"
      FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TeamCredentialUsageLimit_identity_key"
  ON "TeamCredentialUsageLimit"("resourceId", "subjectKind", "subjectId", "period", "metric");
CREATE INDEX "TeamCredentialUsageLimit_resourceId_enabled_idx"
  ON "TeamCredentialUsageLimit"("resourceId", "enabled");
CREATE INDEX "UETCGA_group_event_idx"
  ON "UsageEventTeamCredentialGroupAttribution"("teamGroupId", "usageEventId");
CREATE INDEX "UsageEvent_teamCredentialResourceId_observedAt_idx"
  ON "UsageEvent"("teamCredentialResourceId", "observedAt");
CREATE INDEX "UsageEvent_resource_actor_observed_idx"
  ON "UsageEvent"("teamCredentialResourceId", "teamCredentialActorAccountId", "observedAt");
CREATE INDEX "UsageEvent_teamCredentialExternalApiKeyId_observedAt_idx"
  ON "UsageEvent"("teamCredentialExternalApiKeyId", "observedAt");
