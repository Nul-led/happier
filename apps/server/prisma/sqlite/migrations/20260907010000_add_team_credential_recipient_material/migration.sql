CREATE TABLE "TeamCredentialRecipientMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "recipientAccountId" TEXT NOT NULL,
    "sourceMemberKey" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "recipientMode" TEXT NOT NULL,
    "recipientContentPublicKeyFingerprint" TEXT,
    "storedMaterial" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamCredentialRecipientMaterial_resourceId_fkey"
      FOREIGN KEY ("resourceId") REFERENCES "TeamCredentialResource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamCredentialRecipientMaterial_recipientAccountId_fkey"
      FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TCRM_resource_recipient_member_key"
  ON "TeamCredentialRecipientMaterial"("resourceId", "recipientAccountId", "sourceMemberKey");
CREATE INDEX "TCRM_recipient_resource_idx"
  ON "TeamCredentialRecipientMaterial"("recipientAccountId", "resourceId");
