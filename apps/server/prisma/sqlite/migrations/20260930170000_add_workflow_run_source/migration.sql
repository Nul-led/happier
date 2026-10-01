ALTER TABLE "AutomationRun" ADD COLUMN "sourceArtifactId" TEXT;
CREATE INDEX "AutomationRun_source_created_id_idx" ON "AutomationRun"("sourceArtifactId", "createdAt" DESC, "id" DESC);
