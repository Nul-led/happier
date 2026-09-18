-- CreateEnum
CREATE TYPE "IdentityProviderKind" AS ENUM ('oidc', 'workos_sso', 'github_app_identity');

-- CreateEnum
CREATE TYPE "TeamDirectorySourceKind" AS ENUM ('workos_directory', 'github_organization');

-- CreateEnum
CREATE TYPE "TeamDirectorySourceState" AS ENUM ('initializing', 'active', 'paused', 'needs_attention');

-- CreateEnum
CREATE TYPE "TeamProvisionedIdentityState" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "TeamDirectoryGroupState" AS ENUM ('active', 'deleted');

-- CreateTable
CREATE TABLE "IdentityProviderInstance" (
    "id" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "kind" "IdentityProviderKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstEnabledAt" TIMESTAMP(3),
    "securityRevision" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "encryptedSecrets" BYTEA,
    "githubAppInstallationId" TEXT,
    "lastSuccessfulTestAt" TIMESTAMP(3),
    "lastSuccessfulTestRuntimeFingerprint" TEXT,
    "lastSuccessfulTestSecurityRevision" INTEGER,
    "createdByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityProviderInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamIdentityConnection" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "externalReference" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstEnabledAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastObservation" JSONB,
    "lastSuccessfulTestAt" TIMESTAMP(3),
    "createdByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamIdentityConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembershipIdentityConnectionManagement" (
    "teamMembershipId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamIdentityConnectionId" TEXT NOT NULL,

    CONSTRAINT "TeamMembershipIdentityConnectionManagement_pkey" PRIMARY KEY ("teamMembershipId")
);

-- CreateTable
CREATE TABLE "GitHubAppRegistration" (
    "id" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "githubHost" TEXT NOT NULL,
    "githubAppId" BIGINT NOT NULL,
    "githubClientId" TEXT NOT NULL,
    "githubAppSlug" TEXT,
    "githubOwnerId" BIGINT,
    "githubOwnerLogin" TEXT,
    "config" JSONB NOT NULL,
    "encryptedSecrets" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "securityRevision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "verificationHealth" JSONB,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAppRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubAppInstallation" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "githubOrganizationId" BIGINT NOT NULL,
    "githubOrganizationLogin" TEXT NOT NULL,
    "repositorySelection" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'unverified',
    "verifiedPermissions" JSONB,
    "verifiedEvents" JSONB,
    "suspendedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamDirectorySource" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "kind" "TeamDirectorySourceKind" NOT NULL,
    "state" "TeamDirectorySourceState" NOT NULL DEFAULT 'initializing',
    "displayName" TEXT NOT NULL,
    "externalSourceKey" TEXT NOT NULL,
    "bindingConfig" JSONB NOT NULL,
    "teamIdentityConnectionId" TEXT,
    "githubAppInstallationId" TEXT,
    "eventCursor" TEXT,
    "eventRangeStart" TIMESTAMP(3),
    "manualSyncRequestedAt" TIMESTAMP(3),
    "activeReconcileRunId" TEXT,
    "activeReconcileStartedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFullReconcileAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    "retryNotBefore" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamDirectorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamProvisionedIdentity" (
    "id" TEXT NOT NULL,
    "directorySourceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "externalSubjectId" TEXT,
    "normalizedEmail" TEXT,
    "displayName" TEXT,
    "externalLogin" TEXT,
    "state" "TeamProvisionedIdentityState" NOT NULL,
    "boundAccountId" TEXT,
    "teamMembershipId" TEXT,
    "teamMembershipTeamId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastSeenReconcileRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamProvisionedIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamDirectoryGroup" (
    "id" TEXT NOT NULL,
    "directorySourceId" TEXT NOT NULL,
    "externalGroupId" TEXT NOT NULL,
    "externalDisplayName" TEXT NOT NULL,
    "state" "TeamDirectoryGroupState" NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastSeenReconcileRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamDirectoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamDirectoryGroupMember" (
    "directorySourceId" TEXT NOT NULL,
    "externalGroupId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "lastSeenReconcileRunId" TEXT,

    CONSTRAINT "TeamDirectoryGroupMember_pkey" PRIMARY KEY ("directorySourceId","externalGroupId","externalUserId")
);

-- CreateIndex
CREATE INDEX "IdentityProviderInstance_ownerTeamId_createdAt_id_idx" ON "IdentityProviderInstance"("ownerTeamId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "IdentityProviderInstance_githubAppInstallationId_idx" ON "IdentityProviderInstance"("githubAppInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamIdentityConnection_teamId_providerInstanceId_key" ON "TeamIdentityConnection"("teamId", "providerInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamIdentityConnection_id_teamId_key" ON "TeamIdentityConnection"("id", "teamId");

-- CreateIndex
CREATE INDEX "TeamMembershipIdentityConnectionManagement_connection_idx" ON "TeamMembershipIdentityConnectionManagement"("teamIdentityConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembershipIdentityConnectionManagement_membership_team_key" ON "TeamMembershipIdentityConnectionManagement"("teamMembershipId", "teamId");

-- CreateIndex
CREATE INDEX "GitHubAppRegistration_ownerTeamId_createdAt_id_idx" ON "GitHubAppRegistration"("ownerTeamId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAppRegistration_githubHost_githubAppId_key" ON "GitHubAppRegistration"("githubHost", "githubAppId");

-- CreateIndex
CREATE INDEX "GitHubAppInstallation_registrationId_state_id_idx" ON "GitHubAppInstallation"("registrationId", "state", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAppInstallation_registrationId_githubInstallationId_key" ON "GitHubAppInstallation"("registrationId", "githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAppInstallation_registrationId_githubOrganizationId_key" ON "GitHubAppInstallation"("registrationId", "githubOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamDirectorySource_externalSourceKey_key" ON "TeamDirectorySource"("externalSourceKey");

-- CreateIndex
CREATE INDEX "TeamDirectorySource_teamId_state_idx" ON "TeamDirectorySource"("teamId", "state");

-- CreateIndex
CREATE INDEX "TeamDirectorySource_githubAppInstallationId_idx" ON "TeamDirectorySource"("githubAppInstallationId");

-- CreateIndex
CREATE INDEX "TeamDirectorySource_state_manualSyncRequestedAt_idx" ON "TeamDirectorySource"("state", "manualSyncRequestedAt");

-- CreateIndex
CREATE INDEX "TeamDirectorySource_state_retryNotBefore_lastAttemptAt_id_idx" ON "TeamDirectorySource"("state", "retryNotBefore", "lastAttemptAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TeamDirectorySource_id_teamId_key" ON "TeamDirectorySource"("id", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProvisionedIdentity_teamMembershipId_key" ON "TeamProvisionedIdentity"("teamMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProvisionedIdentity_membership_team_key" ON "TeamProvisionedIdentity"("teamMembershipId", "teamMembershipTeamId");

-- CreateIndex
CREATE INDEX "TeamProvisionedIdentity_boundAccountId_idx" ON "TeamProvisionedIdentity"("boundAccountId");

-- CreateIndex
CREATE INDEX "TeamProvisionedIdentity_directorySourceId_state_idx" ON "TeamProvisionedIdentity"("directorySourceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProvisionedIdentity_directorySourceId_externalUserId_key" ON "TeamProvisionedIdentity"("directorySourceId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamDirectoryGroup_directorySourceId_externalGroupId_key" ON "TeamDirectoryGroup"("directorySourceId", "externalGroupId");

-- CreateIndex
CREATE INDEX "TeamDirectoryGroupMember_directorySourceId_externalUserId_idx" ON "TeamDirectoryGroupMember"("directorySourceId", "externalUserId");

-- AddForeignKey
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_githubAppInstallationId_fkey" FOREIGN KEY ("githubAppInstallationId") REFERENCES "GitHubAppInstallation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamIdentityConnection" ADD CONSTRAINT "TeamIdentityConnection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamIdentityConnection" ADD CONSTRAINT "TeamIdentityConnection_providerInstanceId_fkey" FOREIGN KEY ("providerInstanceId") REFERENCES "IdentityProviderInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamIdentityConnection" ADD CONSTRAINT "TeamIdentityConnection_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembershipIdentityConnectionManagement" ADD CONSTRAINT "TeamMembershipIdentityConnectionManagement_membership_fkey" FOREIGN KEY ("teamMembershipId", "teamId") REFERENCES "TeamMembership"("id", "teamId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMembershipIdentityConnectionManagement" ADD CONSTRAINT "TeamMembershipIdentityConnectionManagement_connection_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection"("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GitHubAppRegistration" ADD CONSTRAINT "GitHubAppRegistration_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppRegistration" ADD CONSTRAINT "GitHubAppRegistration_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppInstallation" ADD CONSTRAINT "GitHubAppInstallation_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "GitHubAppRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_teamIdentityConnectionId_teamId_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection"("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_githubAppInstallationId_fkey" FOREIGN KEY ("githubAppInstallationId") REFERENCES "GitHubAppInstallation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamProvisionedIdentity" ADD CONSTRAINT "TeamProvisionedIdentity_directorySourceId_fkey" FOREIGN KEY ("directorySourceId", "teamId") REFERENCES "TeamDirectorySource"("id", "teamId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamProvisionedIdentity" ADD CONSTRAINT "TeamProvisionedIdentity_boundAccountId_fkey" FOREIGN KEY ("boundAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProvisionedIdentity" ADD CONSTRAINT "TeamProvisionedIdentity_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId", "teamMembershipTeamId") REFERENCES "TeamMembership"("id", "teamId") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamDirectoryGroup" ADD CONSTRAINT "TeamDirectoryGroup_directorySourceId_fkey" FOREIGN KEY ("directorySourceId") REFERENCES "TeamDirectorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDirectoryGroupMember" ADD CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_fkey" FOREIGN KEY ("directorySourceId") REFERENCES "TeamDirectorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDirectoryGroupMember" ADD CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_externalGroupId_fkey" FOREIGN KEY ("directorySourceId", "externalGroupId") REFERENCES "TeamDirectoryGroup"("directorySourceId", "externalGroupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamDirectoryGroupMember" ADD CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_externalUserId_fkey" FOREIGN KEY ("directorySourceId", "externalUserId") REFERENCES "TeamProvisionedIdentity"("directorySourceId", "externalUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamExternalGroupBinding" ADD CONSTRAINT "TeamExternalGroupBinding_teamIdentityConnectionId_teamId_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection"("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamExternalGroupBinding" ADD CONSTRAINT "TeamExternalGroupBinding_directorySourceId_teamId_fkey" FOREIGN KEY ("directorySourceId", "teamId") REFERENCES "TeamDirectorySource"("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Provider and directory invariants that Prisma cannot express.
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_revision_check" CHECK ("revision" > 0 AND "securityRevision" > 0);
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_test_revision_check" CHECK ("lastSuccessfulTestSecurityRevision" IS NULL OR "lastSuccessfulTestSecurityRevision" > 0);
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_test_fields_check" CHECK (("lastSuccessfulTestAt" IS NULL) = ("lastSuccessfulTestRuntimeFingerprint" IS NULL) AND ("lastSuccessfulTestAt" IS NULL) = ("lastSuccessfulTestSecurityRevision" IS NULL));
ALTER TABLE "IdentityProviderInstance" ADD CONSTRAINT "IdentityProviderInstance_github_reference_check" CHECK (("kind" = 'github_app_identity') = ("githubAppInstallationId" IS NOT NULL));
ALTER TABLE "TeamIdentityConnection" ADD CONSTRAINT "TeamIdentityConnection_revision_check" CHECK ("revision" > 0);
ALTER TABLE "GitHubAppRegistration" ADD CONSTRAINT "GitHubAppRegistration_values_check" CHECK ("revision" > 0 AND "securityRevision" > 0 AND "githubAppId" > 0 AND ("githubOwnerId" IS NULL OR "githubOwnerId" > 0) AND length("githubHost") > 0 AND length("githubClientId") > 0 AND octet_length("encryptedSecrets") > 0 AND "state" IN ('draft', 'verified', 'disabled', 'needs_attention'));
ALTER TABLE "GitHubAppInstallation" ADD CONSTRAINT "GitHubAppInstallation_values_check" CHECK ("revision" > 0 AND "githubInstallationId" > 0 AND "githubOrganizationId" > 0 AND length("githubOrganizationLogin") > 0 AND "repositorySelection" IN ('all', 'selected') AND "state" IN ('unverified', 'verified', 'suspended', 'needs_attention'));
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_kind_reference_check" CHECK (("kind" = 'workos_directory' AND "teamIdentityConnectionId" IS NOT NULL AND "githubAppInstallationId" IS NULL) OR ("kind" = 'github_organization' AND "teamIdentityConnectionId" IS NULL AND "githubAppInstallationId" IS NOT NULL));
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_github_cursor_check" CHECK ("kind" <> 'github_organization' OR ("eventCursor" IS NULL AND "eventRangeStart" IS NULL));
ALTER TABLE "TeamDirectorySource" ADD CONSTRAINT "TeamDirectorySource_reconcile_pair_check" CHECK (("activeReconcileRunId" IS NULL) = ("activeReconcileStartedAt" IS NULL));
ALTER TABLE "TeamProvisionedIdentity" ADD CONSTRAINT "TeamProvisionedIdentity_membership_team_check" CHECK (("teamMembershipId" IS NULL) = ("teamMembershipTeamId" IS NULL) AND ("teamMembershipId" IS NULL OR "teamMembershipTeamId" = "teamId"));
