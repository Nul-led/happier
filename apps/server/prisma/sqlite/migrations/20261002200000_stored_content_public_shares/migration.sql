PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PublicSessionShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "artifactId" TEXT,
    "keyDerivation" TEXT NOT NULL DEFAULT 'legacy_token_v1',
    "createdByUserId" TEXT NOT NULL,
    "tokenHash" BLOB NOT NULL,
    "encryptedDataKey" BLOB,
    "expiresAt" DATETIME,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "isConsentRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublicSessionShare_subject_check" CHECK (("sessionId" IS NOT NULL) <> ("artifactId" IS NOT NULL)),
    CONSTRAINT "PublicSessionShare_keyDerivation_check" CHECK ("keyDerivation" IN ('legacy_token_v1', 'fragment_v1')),
    CONSTRAINT "PublicSessionShare_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicSessionShare_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicSessionShare_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PublicSessionShare" ("id", "sessionId", "createdByUserId", "tokenHash", "encryptedDataKey", "expiresAt", "maxUses", "useCount", "isConsentRequired", "createdAt", "updatedAt")
SELECT "id", "sessionId", "createdByUserId", "tokenHash", "encryptedDataKey", "expiresAt", "maxUses", "useCount", "isConsentRequired", "createdAt", "updatedAt" FROM "PublicSessionShare";
DROP TABLE "PublicSessionShare";
ALTER TABLE "new_PublicSessionShare" RENAME TO "PublicSessionShare";
CREATE UNIQUE INDEX "PublicSessionShare_sessionId_key" ON "PublicSessionShare"("sessionId");
CREATE UNIQUE INDEX "PublicSessionShare_artifactId_key" ON "PublicSessionShare"("artifactId");
CREATE UNIQUE INDEX "PublicSessionShare_tokenHash_key" ON "PublicSessionShare"("tokenHash");
CREATE INDEX "PublicSessionShare_tokenHash_idx" ON "PublicSessionShare"("tokenHash");
CREATE INDEX "PublicSessionShare_sessionId_idx" ON "PublicSessionShare"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
