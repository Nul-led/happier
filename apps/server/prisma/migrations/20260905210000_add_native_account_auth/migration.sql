CREATE TABLE "AccountEmail" (
    "accountId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    CONSTRAINT "AccountEmail_pkey" PRIMARY KEY ("accountId", "normalizedEmail"),
    CONSTRAINT "AccountEmail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AccountEmail_normalizedEmail_idx" ON "AccountEmail" ("normalizedEmail");

CREATE TABLE "AccountPasswordCredential" (
    "accountId" TEXT NOT NULL,
    "credential" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AccountPasswordCredential_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "AccountPasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Password-backed Account encryption-mode transitions stage the prepared
-- replacement credential on the existing transition row so the mode flip and
-- the credential conversion commit together.
ALTER TABLE "AccountEncryptionTransition" ADD COLUMN "targetPasswordCredential" JSONB;
ALTER TABLE "AccountEncryptionTransition" ADD COLUMN "targetPasswordRevision" INTEGER;
