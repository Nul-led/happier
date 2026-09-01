-- CreateIndex
-- Covers Automation Run history keyset scans without a temporary order B-tree.
CREATE INDEX "AutomationRun_automationId_createdAt_id_idx"
    ON "AutomationRun"("automationId", "createdAt" DESC, "id" DESC);
