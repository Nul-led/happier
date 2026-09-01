-- CreateIndex
-- Covers Automation Run history keyset scans without sorting retained history.
CREATE INDEX "AutomationRun_automationId_createdAt_id_idx"
    ON "AutomationRun"("automationId", "createdAt" DESC, "id" DESC);
