-- Explicit Team context is independent of access grants. Existing Sessions have none.
ALTER TABLE "Session" ADD COLUMN "primaryTeamId" TEXT REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Session_primaryTeamId_idx" ON "Session"("primaryTeamId");

-- CreateTable
CREATE TABLE "SessionTeamGrant" (
    "sessionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'view',
    "canApprovePermissions" BOOLEAN NOT NULL DEFAULT false,
    "requiredByTeamPolicy" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" DATETIME NOT NULL,

    PRIMARY KEY ("sessionId", "teamId"),
    CONSTRAINT "SessionTeamGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionTeamGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionGroupGrant" (
    "sessionId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'view',
    "canApprovePermissions" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" DATETIME NOT NULL,

    PRIMARY KEY ("sessionId", "teamGroupId"),
    CONSTRAINT "SessionGroupGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionTeamGrant_teamId_sessionId_idx" ON "SessionTeamGrant"("teamId", "sessionId");

-- CreateIndex
CREATE INDEX "SessionGroupGrant_teamGroupId_sessionId_idx" ON "SessionGroupGrant"("teamGroupId", "sessionId");
