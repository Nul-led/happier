-- CreateTable
CREATE TABLE "TeamCredentialResource" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCredentialResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCredentialGroupGrant" (
    "resourceId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCredentialGroupGrant_pkey" PRIMARY KEY ("resourceId","teamGroupId")
);

-- CreateTable
CREATE TABLE "TeamCredentialMemberGrant" (
    "resourceId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCredentialMemberGrant_pkey" PRIMARY KEY ("resourceId","teamMembershipId")
);

-- CreateTable
CREATE TABLE "SessionTeamCredentialBinding" (
    "sessionId" TEXT NOT NULL,
    "slotKind" TEXT NOT NULL,
    "slotKey" BYTEA NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionTeamCredentialBinding_pkey" PRIMARY KEY ("sessionId","slotKind","slotKey")
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

-- AddForeignKey
ALTER TABLE "TeamCredentialResource" ADD CONSTRAINT "TeamCredentialResource_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialResource" ADD CONSTRAINT "TeamCredentialResource_custodianAccountId_fkey" FOREIGN KEY ("custodianAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialResource" ADD CONSTRAINT "TeamCredentialResource_brokerMachineId_fkey" FOREIGN KEY ("brokerMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialGroupGrant" ADD CONSTRAINT "TeamCredentialGroupGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialGroupGrant" ADD CONSTRAINT "TeamCredentialGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialMemberGrant" ADD CONSTRAINT "TeamCredentialMemberGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialMemberGrant" ADD CONSTRAINT "TeamCredentialMemberGrant_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId") REFERENCES "TeamMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeamCredentialBinding" ADD CONSTRAINT "SessionTeamCredentialBinding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeamCredentialBinding" ADD CONSTRAINT "SessionTeamCredentialBinding_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TeamCredentialActivityEvent" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "subjectDisplayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamCredentialActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamCredentialActivityEvent_teamId_resourceId_createdAt_idx" ON "TeamCredentialActivityEvent"("teamId", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamCredentialActivityEvent_actorAccountId_idx" ON "TeamCredentialActivityEvent"("actorAccountId");

-- AddForeignKey
ALTER TABLE "TeamCredentialActivityEvent" ADD CONSTRAINT "TeamCredentialActivityEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCredentialActivityEvent" ADD CONSTRAINT "TeamCredentialActivityEvent_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
