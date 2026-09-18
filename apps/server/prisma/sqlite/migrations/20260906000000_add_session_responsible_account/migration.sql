-- One nullable human Account is currently expected to handle a Session.
-- Existing Sessions are truthfully unassigned, so there is no backfill.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "responsibleAccountId" TEXT REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Session_responsibleAccountId_idx" ON "Session"("responsibleAccountId");
