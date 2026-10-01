-- CreateTable
CREATE TABLE "HomeSettings" (
    "id" TEXT NOT NULL,
    "values" JSONB,
    "encryptedSecrets" BYTEA,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeAdministrationEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorKind" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "action" TEXT NOT NULL,
    "targetKind" TEXT,
    "targetId" TEXT,
    "summary" JSONB NOT NULL,

    CONSTRAINT "HomeAdministrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeAdministrationEvent_at_id_idx" ON "HomeAdministrationEvent"("at", "id");

-- CreateIndex
CREATE INDEX "HomeAdministrationEvent_targetId_at_idx" ON "HomeAdministrationEvent"("targetId", "at");

