-- CreateTable
CREATE TABLE "IdentityProviderInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerTeamId" TEXT,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstEnabledAt" DATETIME,
    "securityRevision" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "encryptedSecrets" BLOB,
    "githubAppInstallationId" TEXT,
    "lastSuccessfulTestAt" DATETIME,
    "lastSuccessfulTestRuntimeFingerprint" TEXT,
    "lastSuccessfulTestSecurityRevision" INTEGER,
    "createdByAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IdentityProviderInstance_kind_check" CHECK ("kind" IN ('oidc', 'workos_sso', 'github_app_identity')),
    CONSTRAINT "IdentityProviderInstance_revision_check" CHECK ("revision" > 0 AND "securityRevision" > 0),
    CONSTRAINT "IdentityProviderInstance_test_revision_check" CHECK ("lastSuccessfulTestSecurityRevision" IS NULL OR "lastSuccessfulTestSecurityRevision" > 0),
    CONSTRAINT "IdentityProviderInstance_test_fields_check" CHECK (("lastSuccessfulTestAt" IS NULL) = ("lastSuccessfulTestRuntimeFingerprint" IS NULL) AND ("lastSuccessfulTestAt" IS NULL) = ("lastSuccessfulTestSecurityRevision" IS NULL)),
    CONSTRAINT "IdentityProviderInstance_github_reference_check" CHECK (("kind" = 'github_app_identity') = ("githubAppInstallationId" IS NOT NULL)),
    CONSTRAINT "IdentityProviderInstance_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdentityProviderInstance_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IdentityProviderInstance_githubAppInstallationId_fkey" FOREIGN KEY ("githubAppInstallationId") REFERENCES "GitHubAppInstallation" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "TeamIdentityConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "externalReference" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstEnabledAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastObservation" JSONB,
    "lastSuccessfulTestAt" DATETIME,
    "createdByAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamIdentityConnection_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "TeamIdentityConnection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamIdentityConnection_providerInstanceId_fkey" FOREIGN KEY ("providerInstanceId") REFERENCES "IdentityProviderInstance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamIdentityConnection_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamMembershipIdentityConnectionManagement" (
    "teamMembershipId" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "teamIdentityConnectionId" TEXT NOT NULL,
    CONSTRAINT "TeamMembershipIdentityConnectionManagement_membership_fkey" FOREIGN KEY ("teamMembershipId", "teamId") REFERENCES "TeamMembership" ("id", "teamId") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "TeamMembershipIdentityConnectionManagement_connection_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection" ("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "GitHubAppRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerTeamId" TEXT,
    "githubHost" TEXT NOT NULL,
    "githubAppId" BIGINT NOT NULL,
    "githubClientId" TEXT NOT NULL,
    "githubAppSlug" TEXT,
    "githubOwnerId" BIGINT,
    "githubOwnerLogin" TEXT,
    "config" JSONB NOT NULL,
    "encryptedSecrets" BLOB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "securityRevision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "verificationHealth" JSONB,
    "lastVerifiedAt" DATETIME,
    "createdByAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GitHubAppRegistration_values_check" CHECK ("revision" > 0 AND "securityRevision" > 0 AND "githubAppId" > 0 AND ("githubOwnerId" IS NULL OR "githubOwnerId" > 0) AND length("githubHost") > 0 AND length("githubClientId") > 0 AND length("encryptedSecrets") > 0 AND "state" IN ('draft', 'verified', 'disabled', 'needs_attention')),
    CONSTRAINT "GitHubAppRegistration_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GitHubAppRegistration_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GitHubAppInstallation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registrationId" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "githubOrganizationId" BIGINT NOT NULL,
    "githubOrganizationLogin" TEXT NOT NULL,
    "repositorySelection" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'unverified',
    "verifiedPermissions" JSONB,
    "verifiedEvents" JSONB,
    "suspendedAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GitHubAppInstallation_values_check" CHECK ("revision" > 0 AND "githubInstallationId" > 0 AND "githubOrganizationId" > 0 AND length("githubOrganizationLogin") > 0 AND "repositorySelection" IN ('all', 'selected') AND "state" IN ('unverified', 'verified', 'suspended', 'needs_attention')),
    CONSTRAINT "GitHubAppInstallation_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "GitHubAppRegistration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamDirectorySource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'initializing',
    "displayName" TEXT NOT NULL,
    "externalSourceKey" TEXT NOT NULL,
    "bindingConfig" JSONB NOT NULL,
    "teamIdentityConnectionId" TEXT,
    "githubAppInstallationId" TEXT,
    "eventCursor" TEXT,
    "eventRangeStart" DATETIME,
    "manualSyncRequestedAt" DATETIME,
    "activeReconcileRunId" TEXT,
    "activeReconcileStartedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastFullReconcileAt" DATETIME,
    "lastErrorCode" TEXT,
    "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    "retryNotBefore" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamDirectorySource_kind_check" CHECK ("kind" IN ('workos_directory', 'github_organization')),
    CONSTRAINT "TeamDirectorySource_state_check" CHECK ("state" IN ('initializing', 'active', 'paused', 'needs_attention')),
    CONSTRAINT "TeamDirectorySource_kind_reference_check" CHECK (("kind" = 'workos_directory' AND "teamIdentityConnectionId" IS NOT NULL AND "githubAppInstallationId" IS NULL) OR ("kind" = 'github_organization' AND "teamIdentityConnectionId" IS NULL AND "githubAppInstallationId" IS NOT NULL)),
    CONSTRAINT "TeamDirectorySource_github_cursor_check" CHECK ("kind" <> 'github_organization' OR ("eventCursor" IS NULL AND "eventRangeStart" IS NULL)),
    CONSTRAINT "TeamDirectorySource_reconcile_pair_check" CHECK (("activeReconcileRunId" IS NULL) = ("activeReconcileStartedAt" IS NULL)),
    CONSTRAINT "TeamDirectorySource_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamDirectorySource_teamIdentityConnectionId_teamId_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection" ("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TeamDirectorySource_githubAppInstallationId_fkey" FOREIGN KEY ("githubAppInstallationId") REFERENCES "GitHubAppInstallation" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "TeamProvisionedIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "directorySourceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "externalSubjectId" TEXT,
    "normalizedEmail" TEXT,
    "displayName" TEXT,
    "externalLogin" TEXT,
    "state" TEXT NOT NULL,
    "boundAccountId" TEXT,
    "teamMembershipId" TEXT,
    "teamMembershipTeamId" TEXT,
    "externalUpdatedAt" DATETIME,
    "lastSeenReconcileRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamProvisionedIdentity_state_check" CHECK ("state" IN ('active', 'suspended', 'deleted')),
    CONSTRAINT "TeamProvisionedIdentity_membership_team_check" CHECK (("teamMembershipId" IS NULL) = ("teamMembershipTeamId" IS NULL) AND ("teamMembershipId" IS NULL OR "teamMembershipTeamId" = "teamId")),
    CONSTRAINT "TeamProvisionedIdentity_directorySourceId_fkey" FOREIGN KEY ("directorySourceId", "teamId") REFERENCES "TeamDirectorySource" ("id", "teamId") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "TeamProvisionedIdentity_boundAccountId_fkey" FOREIGN KEY ("boundAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TeamProvisionedIdentity_teamMembershipId_fkey" FOREIGN KEY ("teamMembershipId", "teamMembershipTeamId") REFERENCES "TeamMembership" ("id", "teamId") ON DELETE SET NULL ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "TeamDirectoryGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "directorySourceId" TEXT NOT NULL,
    "externalGroupId" TEXT NOT NULL,
    "externalDisplayName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "externalUpdatedAt" DATETIME,
    "lastSeenReconcileRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamDirectoryGroup_state_check" CHECK ("state" IN ('active', 'deleted')),
    CONSTRAINT "TeamDirectoryGroup_directorySourceId_fkey" FOREIGN KEY ("directorySourceId") REFERENCES "TeamDirectorySource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamDirectoryGroupMember" (
    "directorySourceId" TEXT NOT NULL,
    "externalGroupId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "lastSeenReconcileRunId" TEXT,

    PRIMARY KEY ("directorySourceId", "externalGroupId", "externalUserId"),
    CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_fkey" FOREIGN KEY ("directorySourceId") REFERENCES "TeamDirectorySource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_externalGroupId_fkey" FOREIGN KEY ("directorySourceId", "externalGroupId") REFERENCES "TeamDirectoryGroup" ("directorySourceId", "externalGroupId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamDirectoryGroupMember_directorySourceId_externalUserId_fkey" FOREIGN KEY ("directorySourceId", "externalUserId") REFERENCES "TeamProvisionedIdentity" ("directorySourceId", "externalUserId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TeamExternalGroupBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "directorySourceId" TEXT,
    "teamIdentityConnectionId" TEXT,
    "externalGroupId" TEXT NOT NULL,
    "bindingMode" TEXT NOT NULL CHECK ("bindingMode" IN ('directory_created', 'native_target')),
    CONSTRAINT "TeamExternalGroupBinding_owner_check" CHECK (("directorySourceId" IS NULL) <> ("teamIdentityConnectionId" IS NULL)),
    CONSTRAINT "TeamExternalGroupBinding_teamGroupId_teamId_fkey" FOREIGN KEY ("teamGroupId", "teamId") REFERENCES "TeamGroup" ("id", "teamId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamExternalGroupBinding_teamIdentityConnectionId_teamId_fkey" FOREIGN KEY ("teamIdentityConnectionId", "teamId") REFERENCES "TeamIdentityConnection" ("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "TeamExternalGroupBinding_directorySourceId_teamId_fkey" FOREIGN KEY ("directorySourceId", "teamId") REFERENCES "TeamDirectorySource" ("id", "teamId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO "new_TeamExternalGroupBinding" ("bindingMode", "directorySourceId", "externalGroupId", "id", "teamGroupId", "teamId", "teamIdentityConnectionId") SELECT "bindingMode", "directorySourceId", "externalGroupId", "id", "teamGroupId", "teamId", "teamIdentityConnectionId" FROM "TeamExternalGroupBinding";
DROP TABLE "TeamExternalGroupBinding";
ALTER TABLE "new_TeamExternalGroupBinding" RENAME TO "TeamExternalGroupBinding";
CREATE INDEX "TeamExternalGroupBinding_teamGroupId_idx" ON "TeamExternalGroupBinding"("teamGroupId");
CREATE UNIQUE INDEX "TeamExternalGroupBinding_id_teamGroupId_key" ON "TeamExternalGroupBinding"("id", "teamGroupId");
CREATE UNIQUE INDEX "TeamExternalGroupBinding_directory_key" ON "TeamExternalGroupBinding"("directorySourceId", "externalGroupId");
CREATE UNIQUE INDEX "TeamExternalGroupBinding_connection_key" ON "TeamExternalGroupBinding"("teamIdentityConnectionId", "externalGroupId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
