-- Live workflow references and session scope belong to the existing Automation store.
ALTER TABLE "Automation" ADD COLUMN "workflowDefinitionId" TEXT;
ALTER TABLE "Automation" ADD COLUMN "scopeSessionId" TEXT;
CREATE INDEX "Automation_account_workflow_idx" ON "Automation"("accountId", "workflowDefinitionId");
CREATE INDEX "Automation_account_scope_idx" ON "Automation"("accountId", "scopeSessionId");
