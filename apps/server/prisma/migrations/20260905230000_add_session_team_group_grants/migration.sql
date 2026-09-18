-- Explicit Team context is independent of access grants. Existing Sessions have none.
ALTER TABLE "Session" ADD COLUMN "primaryTeamId" TEXT;
CREATE INDEX "Session_primaryTeamId_idx" ON "Session"("primaryTeamId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_primaryTeamId_fkey" FOREIGN KEY ("primaryTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SessionTeamGrant" (
    "sessionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accessLevel" "ShareAccessLevel" NOT NULL DEFAULT 'view',
    "canApprovePermissions" BOOLEAN NOT NULL DEFAULT false,
    "requiredByTeamPolicy" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionTeamGrant_pkey" PRIMARY KEY ("sessionId","teamId")
);

-- CreateTable
CREATE TABLE "SessionGroupGrant" (
    "sessionId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "accessLevel" "ShareAccessLevel" NOT NULL DEFAULT 'view',
    "canApprovePermissions" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionGroupGrant_pkey" PRIMARY KEY ("sessionId","teamGroupId")
);

-- CreateIndex
CREATE INDEX "SessionTeamGrant_teamId_sessionId_idx" ON "SessionTeamGrant"("teamId", "sessionId");

-- CreateIndex
CREATE INDEX "SessionGroupGrant_teamGroupId_sessionId_idx" ON "SessionGroupGrant"("teamGroupId", "sessionId");

-- AddForeignKey
ALTER TABLE "SessionTeamGrant" ADD CONSTRAINT "SessionTeamGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeamGrant" ADD CONSTRAINT "SessionTeamGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionGroupGrant" ADD CONSTRAINT "SessionGroupGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionGroupGrant" ADD CONSTRAINT "SessionGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
