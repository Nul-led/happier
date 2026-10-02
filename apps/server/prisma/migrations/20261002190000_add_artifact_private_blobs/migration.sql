ALTER TABLE "Artifact" ADD COLUMN "currentBlobId" TEXT;
ALTER TABLE "Artifact" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ArtifactRevision" ADD COLUMN "blobId" TEXT;
CREATE TABLE "ArtifactBlob" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "encryptionMode" TEXT NOT NULL,
    "storedSizeBytes" BIGINT NOT NULL,
    CONSTRAINT "ArtifactBlob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArtifactBlob_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArtifactBlob_storageKey_key" ON "ArtifactBlob"("storageKey");
CREATE INDEX "ArtifactBlob_artifactId_idx" ON "ArtifactBlob"("artifactId");
