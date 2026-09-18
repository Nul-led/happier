ALTER TABLE "TeamCredentialResource" ADD COLUMN "brokerPoolId" TEXT;

CREATE INDEX "TeamCredentialResource_brokerPoolId_idx" ON "TeamCredentialResource"("brokerPoolId");

ALTER TABLE "TeamCredentialResource" ADD CONSTRAINT "TeamCredentialResource_brokerPoolId_fkey" FOREIGN KEY ("brokerPoolId") REFERENCES "MachinePool"("id") ON DELETE SET NULL ON UPDATE CASCADE;
