-- Documents share through Artifact grants; workflow runs have no per-run grants.

CREATE TABLE "ArtifactAccountGrant" (
    "artifactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessLevel" "ShareAccessLevel" NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactAccountGrant_pkey" PRIMARY KEY ("artifactId", "accountId")
);

CREATE TABLE "ArtifactTeamGrant" (
    "artifactId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accessLevel" "ShareAccessLevel" NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactTeamGrant_pkey" PRIMARY KEY ("artifactId", "teamId")
);

CREATE TABLE "ArtifactGroupGrant" (
    "artifactId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "accessLevel" "ShareAccessLevel" NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactGroupGrant_pkey" PRIMARY KEY ("artifactId", "teamGroupId")
);

CREATE TABLE "ArtifactKeyEnvelope" (
    "artifactId" TEXT NOT NULL,
    "recipientAccountId" TEXT NOT NULL,
    "encryptedDataKey" BYTEA NOT NULL,
    "recipientContentPublicKeyFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArtifactKeyEnvelope_pkey" PRIMARY KEY ("artifactId", "recipientAccountId")
);

CREATE INDEX "ArtifactAccountGrant_accountId_artifactId_idx" ON "ArtifactAccountGrant"("accountId", "artifactId");

CREATE INDEX "ArtifactTeamGrant_teamId_artifactId_idx" ON "ArtifactTeamGrant"("teamId", "artifactId");

CREATE INDEX "ArtifactGroupGrant_teamGroupId_artifactId_idx" ON "ArtifactGroupGrant"("teamGroupId", "artifactId");

CREATE INDEX "ArtifactKeyEnvelope_recipientAccountId_artifactId_idx" ON "ArtifactKeyEnvelope"("recipientAccountId", "artifactId");

ALTER TABLE "ArtifactAccountGrant" ADD CONSTRAINT "ArtifactAccountGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactAccountGrant" ADD CONSTRAINT "ArtifactAccountGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactAccountGrant" ADD CONSTRAINT "ArtifactAccountGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArtifactTeamGrant" ADD CONSTRAINT "ArtifactTeamGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactTeamGrant" ADD CONSTRAINT "ArtifactTeamGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactTeamGrant" ADD CONSTRAINT "ArtifactTeamGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArtifactGroupGrant" ADD CONSTRAINT "ArtifactGroupGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactGroupGrant" ADD CONSTRAINT "ArtifactGroupGrant_teamGroupId_fkey" FOREIGN KEY ("teamGroupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactGroupGrant" ADD CONSTRAINT "ArtifactGroupGrant_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArtifactKeyEnvelope" ADD CONSTRAINT "ArtifactKeyEnvelope_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactKeyEnvelope" ADD CONSTRAINT "ArtifactKeyEnvelope_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
