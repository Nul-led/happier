-- CreateTable
CREATE TABLE "MachinePool" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachinePool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachinePoolMember" (
    "poolId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "priorityTier" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MachinePoolMember_pkey" PRIMARY KEY ("poolId","machineId")
);

-- CreateIndex
CREATE INDEX "MachinePool_accountId_id_idx" ON "MachinePool"("accountId", "id");

-- CreateIndex
CREATE INDEX "MachinePoolMember_machineId_idx" ON "MachinePoolMember"("machineId");

-- AddForeignKey
ALTER TABLE "MachinePool" ADD CONSTRAINT "MachinePool_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePoolMember" ADD CONSTRAINT "MachinePoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "MachinePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePoolMember" ADD CONSTRAINT "MachinePoolMember_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
