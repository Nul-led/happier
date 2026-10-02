CREATE TABLE "ArtifactRevision" (
    "artifactId" TEXT NOT NULL,
    "bodyVersion" INTEGER NOT NULL,
    "body" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactRevision_pkey" PRIMARY KEY ("artifactId", "bodyVersion"),
    CONSTRAINT "ArtifactRevision_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
