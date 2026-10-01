-- Documents share through Artifact grants; workflow runs have no per-run grants.

CREATE TABLE "ArtifactAccountGrant" (
    "artifactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("artifactId", "accountId"),
    CONSTRAINT "ArtifactAccountGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactAccountGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactAccountGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ArtifactTeamGrant" (
    "artifactId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("artifactId", "teamId"),
    CONSTRAINT "ArtifactTeamGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactTeamGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactTeamGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ArtifactGroupGrant" (
    "artifactId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("artifactId", "teamGroupId"),
    CONSTRAINT "ArtifactGroupGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactGroupGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ArtifactKeyEnvelope" (
    "artifactId" TEXT NOT NULL,
    "recipientAccountId" TEXT NOT NULL,
    "encryptedDataKey" BLOB NOT NULL,
    "recipientContentPublicKeyFingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("artifactId", "recipientAccountId"),
    CONSTRAINT "ArtifactKeyEnvelope_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtifactKeyEnvelope_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ArtifactAccountGrant_accountId_artifactId_idx" ON "ArtifactAccountGrant"("accountId", "artifactId");

CREATE INDEX "ArtifactTeamGrant_teamId_artifactId_idx" ON "ArtifactTeamGrant"("teamId", "artifactId");

CREATE INDEX "ArtifactGroupGrant_teamGroupId_artifactId_idx" ON "ArtifactGroupGrant"("teamGroupId", "artifactId");

CREATE INDEX "ArtifactKeyEnvelope_recipientAccountId_artifactId_idx" ON "ArtifactKeyEnvelope"("recipientAccountId", "artifactId");
