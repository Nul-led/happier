-- CreateTable
CREATE TABLE "TeamCredentialExternalApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayPrefix" TEXT NOT NULL,
    "secretDigest" TEXT NOT NULL,
    "authenticationEvidence" JSONB,
    "currentBrokerOperationJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "TeamCredentialExternalApiKey_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialExternalApiKey_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId") REFERENCES "TeamMembership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamCredentialExternalApiKey_secretDigest_key" ON "TeamCredentialExternalApiKey"("secretDigest");
CREATE INDEX "TeamCredentialExternalApiKey_resourceId_createdAt_idx" ON "TeamCredentialExternalApiKey"("resourceId", "createdAt");
CREATE INDEX "TeamCredentialExternalApiKey_teamMembershipId_resourceId_idx" ON "TeamCredentialExternalApiKey"("teamMembershipId", "resourceId");
