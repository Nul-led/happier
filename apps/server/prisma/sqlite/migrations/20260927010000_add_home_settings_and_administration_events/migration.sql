-- CreateTable
CREATE TABLE "HomeSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "values" JSONB,
    "encryptedSecrets" BLOB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HomeAdministrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorKind" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "action" TEXT NOT NULL,
    "targetKind" TEXT,
    "targetId" TEXT,
    "summary" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "HomeAdministrationEvent_at_id_idx" ON "HomeAdministrationEvent"("at", "id");

-- CreateIndex
CREATE INDEX "HomeAdministrationEvent_targetId_at_idx" ON "HomeAdministrationEvent"("targetId", "at");

