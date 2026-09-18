PRAGMA foreign_keys=OFF;

CREATE TABLE "new_TeamCredentialResource" (
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
    "brokerPoolId" TEXT,
    "allMembersDeliveryMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamCredentialResource_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialResource_custodianAccountId_fkey" FOREIGN KEY ("custodianAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialResource_brokerMachineId_fkey" FOREIGN KEY ("brokerMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialResource_brokerPoolId_fkey" FOREIGN KEY ("brokerPoolId") REFERENCES "MachinePool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_TeamCredentialResource" ("id", "teamId", "custodianAccountId", "displayName", "enabled", "revision", "disclosureCeiling", "sessionUsePolicy", "sourceBindingJson", "directSourceVersionsJson", "requestPolicyJson", "brokerMachineId", "allMembersDeliveryMode", "createdAt", "updatedAt")
SELECT "id", "teamId", "custodianAccountId", "displayName", "enabled", "revision", "disclosureCeiling", "sessionUsePolicy", "sourceBindingJson", "directSourceVersionsJson", "requestPolicyJson", "brokerMachineId", "allMembersDeliveryMode", "createdAt", "updatedAt" FROM "TeamCredentialResource";

DROP TABLE "TeamCredentialResource";
ALTER TABLE "new_TeamCredentialResource" RENAME TO "TeamCredentialResource";
CREATE INDEX "TeamCredentialResource_teamId_enabled_updatedAt_idx" ON "TeamCredentialResource"("teamId", "enabled", "updatedAt");
CREATE INDEX "TeamCredentialResource_custodianAccountId_updatedAt_idx" ON "TeamCredentialResource"("custodianAccountId", "updatedAt");
CREATE INDEX "TeamCredentialResource_brokerMachineId_idx" ON "TeamCredentialResource"("brokerMachineId");
CREATE INDEX "TeamCredentialResource_brokerPoolId_idx" ON "TeamCredentialResource"("brokerPoolId");

PRAGMA foreign_keys=ON;
