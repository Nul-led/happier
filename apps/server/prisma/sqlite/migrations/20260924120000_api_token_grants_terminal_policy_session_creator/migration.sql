ALTER TABLE "Account" ADD COLUMN "terminalPresentUserPolicy" TEXT NOT NULL DEFAULT 'allowed';
ALTER TABLE "AccountApiToken" ADD COLUMN "accessGrant" JSONB;
ALTER TABLE "AccountApiToken" ADD COLUMN "embedConfig" JSONB;
ALTER TABLE "AccountApiToken" ADD COLUMN "parentTokenId" TEXT
    CONSTRAINT "AccountApiToken_parentTokenId_fkey" REFERENCES "AccountApiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD COLUMN "createdByApiTokenId" TEXT
    CONSTRAINT "Session_createdByApiTokenId_fkey" REFERENCES "AccountApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AccountApiToken_parentTokenId_idx" ON "AccountApiToken"("parentTokenId");
CREATE INDEX "Session_createdByApiTokenId_idx" ON "Session"("createdByApiTokenId");
