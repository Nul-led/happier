CREATE TABLE "EphemeralRunnerActivation" (
    "id" TEXT NOT NULL,
    "creatorAccountId" TEXT NOT NULL,
    "creatorTokenEpoch" INTEGER NOT NULL,
    "draftId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "closeReason" TEXT,
    "progressPhase" TEXT,
    "activationExpiresAt" DATETIME,
    "workspacePolicy" TEXT NOT NULL,
    "homeServerIdentityId" TEXT NOT NULL,
    "activationSigningPublicKey" TEXT NOT NULL,
    "authoringCommitment" TEXT NOT NULL,
    "artifact" JSONB NOT NULL,
    "endpointFactsRecipient" JSONB NOT NULL,
    "authenticationEvidence" JSONB,
    "claim" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EphemeralRunnerActivation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EphemeralRunnerActivation_creatorAccountId_fkey" FOREIGN KEY ("creatorAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EphemeralRunnerActivation_sessionId_key" ON "EphemeralRunnerActivation"("sessionId");
CREATE UNIQUE INDEX "EphemeralRunnerActivation_machineId_key" ON "EphemeralRunnerActivation"("machineId");
CREATE INDEX "EphemeralRunnerActivation_creatorAccountId_draftId_idx" ON "EphemeralRunnerActivation"("creatorAccountId", "draftId");
