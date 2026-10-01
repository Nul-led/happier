ALTER TABLE "Account" ADD COLUMN "terminalPresentUserPolicy" TEXT NOT NULL DEFAULT 'allowed';
ALTER TABLE "AccountApiToken" ADD COLUMN "accessGrant" JSONB,
    ADD COLUMN "embedConfig" JSONB,
    ADD COLUMN "parentTokenId" TEXT;
ALTER TABLE "Session" ADD COLUMN "createdByApiTokenId" TEXT;
CREATE INDEX "AccountApiToken_parentTokenId_idx" ON "AccountApiToken"("parentTokenId");
CREATE INDEX "Session_createdByApiTokenId_idx" ON "Session"("createdByApiTokenId");
ALTER TABLE "AccountApiToken" ADD CONSTRAINT "AccountApiToken_parentTokenId_fkey"
    FOREIGN KEY ("parentTokenId") REFERENCES "AccountApiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_createdByApiTokenId_fkey"
    FOREIGN KEY ("createdByApiTokenId") REFERENCES "AccountApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
