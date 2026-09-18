-- CreateTable
CREATE TABLE "TeamCredentialResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "custodianAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "disclosureCeiling" TEXT NOT NULL,
    "sessionUsePolicy" TEXT NOT NULL,
    "sourceBindingJson" TEXT NOT NULL,
    "directSourceVersionsJson" TEXT,
    "requestPolicyJson" TEXT,
    "brokerMachineId" TEXT,
    "allMembersDeliveryMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamCredentialResource_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialResource_custodianAccountId_fkey" FOREIGN KEY ("custodianAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialResource_brokerMachineId_fkey" FOREIGN KEY ("brokerMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamCredentialGroupGrant" (
    "resourceId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("resourceId", "teamGroupId"),
    CONSTRAINT "TeamCredentialGroupGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamCredentialMemberGrant" (
    "resourceId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("resourceId", "teamMembershipId"),
    CONSTRAINT "TeamCredentialMemberGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialMemberGrant_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId") REFERENCES "TeamMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionTeamCredentialBinding" (
    "sessionId" TEXT NOT NULL,
    "slotKind" TEXT NOT NULL,
    "slotKey" BLOB NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceRevision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("sessionId", "slotKind", "slotKey"),
    CONSTRAINT "SessionTeamCredentialBinding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionTeamCredentialBinding_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamCredentialResource_teamId_enabled_updatedAt_idx" ON "TeamCredentialResource"("teamId", "enabled", "updatedAt");

-- CreateIndex
CREATE INDEX "TeamCredentialResource_custodianAccountId_updatedAt_idx" ON "TeamCredentialResource"("custodianAccountId", "updatedAt");

-- CreateIndex
CREATE INDEX "TeamCredentialResource_brokerMachineId_idx" ON "TeamCredentialResource"("brokerMachineId");

-- CreateIndex
CREATE INDEX "TeamCredentialGroupGrant_teamGroupId_resourceId_idx" ON "TeamCredentialGroupGrant"("teamGroupId", "resourceId");

-- CreateIndex
CREATE INDEX "TeamCredentialMemberGrant_teamMembershipId_resourceId_idx" ON "TeamCredentialMemberGrant"("teamMembershipId", "resourceId");

-- CreateIndex
CREATE INDEX "SessionTeamCredentialBinding_resourceId_sessionId_idx" ON "SessionTeamCredentialBinding"("resourceId", "sessionId");

-- CreateTable
CREATE TABLE "TeamCredentialActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "subjectDisplayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamCredentialActivityEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialActivityEvent_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamCredentialActivityEvent_teamId_resourceId_createdAt_idx" ON "TeamCredentialActivityEvent"("teamId", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamCredentialActivityEvent_actorAccountId_idx" ON "TeamCredentialActivityEvent"("actorAccountId");
