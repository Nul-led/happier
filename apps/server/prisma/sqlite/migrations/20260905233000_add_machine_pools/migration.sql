-- CreateTable
CREATE TABLE "MachinePool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MachinePool_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachinePoolMember" (
    "poolId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "priorityTier" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY ("poolId", "machineId"),
    CONSTRAINT "MachinePoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "MachinePool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MachinePoolMember_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MachinePool_accountId_id_idx" ON "MachinePool"("accountId", "id");

-- CreateIndex
CREATE INDEX "MachinePoolMember_machineId_idx" ON "MachinePoolMember"("machineId");
