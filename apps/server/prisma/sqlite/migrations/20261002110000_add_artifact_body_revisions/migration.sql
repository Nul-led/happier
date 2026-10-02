CREATE TABLE "ArtifactRevision" (
    "artifactId" TEXT NOT NULL,
    "bodyVersion" INTEGER NOT NULL,
    "body" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("artifactId", "bodyVersion"),
    CONSTRAINT "ArtifactRevision_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
