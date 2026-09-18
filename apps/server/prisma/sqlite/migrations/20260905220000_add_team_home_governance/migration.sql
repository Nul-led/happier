-- CreateTable
CREATE TABLE "HomeGovernancePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamCreationPolicy" TEXT NOT NULL DEFAULT 'managed_only' CHECK ("teamCreationPolicy" IN ('self_service', 'managed_only', 'disabled')),
    "authenticationPolicy" JSONB,
    "teamProviderPolicy" JSONB,
    "identityNetworkPolicy" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo" JSONB,
    "sessionCreationPolicy" TEXT NOT NULL DEFAULT 'private_default' CHECK ("sessionCreationPolicy" IN ('private_default', 'team_default', 'team_required')),
    "externalSharingPolicy" TEXT NOT NULL DEFAULT 'allowed' CHECK ("externalSharingPolicy" IN ('allowed', 'team_admins_only', 'disabled')),
    "defaultSessionHistoryAccess" TEXT NOT NULL DEFAULT 'from_membership' CHECK ("defaultSessionHistoryAccess" IN ('all_existing', 'from_membership')),
    "admissionMode" TEXT NOT NULL DEFAULT 'invite_only' CHECK ("admissionMode" IN ('invite_only', 'provisioned', 'jit')),
    "authenticationPolicy" JSONB,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('owner', 'admin', 'member', 'guest')),
    "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
    "sessionAccessStartsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamGroup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamGroupMembership" (
    "teamId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "nativeContribution" BOOLEAN NOT NULL DEFAULT false,
    "sessionAccessStartsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("teamGroupId", "teamMembershipId"),
    CONSTRAINT "TeamGroupMembership_teamGroupId_teamId_fkey" FOREIGN KEY ("teamGroupId", "teamId") REFERENCES "TeamGroup" ("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamGroupMembership_teamMembershipId_teamId_fkey" FOREIGN KEY ("teamMembershipId", "teamId") REFERENCES "TeamMembership" ("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamExternalGroupBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "directorySourceId" TEXT,
    "teamIdentityConnectionId" TEXT,
    "externalGroupId" TEXT NOT NULL,
    "bindingMode" TEXT NOT NULL CHECK ("bindingMode" IN ('directory_created', 'native_target')),
    CONSTRAINT "TeamExternalGroupBinding_owner_check" CHECK (("directorySourceId" IS NULL) <> ("teamIdentityConnectionId" IS NULL)),
    CONSTRAINT "TeamExternalGroupBinding_teamGroupId_teamId_fkey" FOREIGN KEY ("teamGroupId", "teamId") REFERENCES "TeamGroup" ("id", "teamId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamGroupMembershipExternalContribution" (
    "teamGroupId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "externalGroupBindingId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("teamGroupId", "teamMembershipId", "externalGroupBindingId"),
    CONSTRAINT "TeamGroupContribution_membership_fkey" FOREIGN KEY ("teamGroupId", "teamMembershipId") REFERENCES "TeamGroupMembership" ("teamGroupId", "teamMembershipId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamGroupContribution_binding_fkey" FOREIGN KEY ("externalGroupBindingId", "teamGroupId") REFERENCES "TeamExternalGroupBinding" ("id", "teamGroupId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "tokenHash" BLOB NOT NULL,
    "recipientEmailNormalized" TEXT,
    "role" TEXT NOT NULL CHECK ("role" IN ('owner', 'admin', 'member', 'guest')),
    "historyAccess" TEXT NOT NULL CHECK ("historyAccess" IN ('all_existing', 'from_membership')),
    "createdByAccountId" TEXT,
    "acceptedAt" DATETIME,
    "acceptedByAccountId" TEXT,
    "revokedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "lastEmailDeliveryStatus" TEXT CHECK ("lastEmailDeliveryStatus" IN ('sent', 'failed')),
    "lastEmailDeliveryAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TeamInvitation_acceptedByAccountId_fkey" FOREIGN KEY ("acceptedByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Additive columns preserve all existing Account fields and relations.
ALTER TABLE "Account" ADD COLUMN "homeRole" TEXT NOT NULL DEFAULT 'member' CHECK ("homeRole" IN ('owner', 'admin', 'member'));
ALTER TABLE "Account" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended', 'disabled'));

-- CreateIndex
CREATE INDEX "Team_name_id_idx" ON "Team"("name", "id");

-- CreateIndex
CREATE INDEX "TeamMembership_accountId_status_teamId_idx" ON "TeamMembership"("accountId", "status", "teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_createdAt_id_idx" ON "TeamMembership"("teamId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_accountId_key" ON "TeamMembership"("teamId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_id_teamId_key" ON "TeamMembership"("id", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroup_id_teamId_key" ON "TeamGroup"("id", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroup_teamId_nameKey_key" ON "TeamGroup"("teamId", "nameKey");

-- CreateIndex
CREATE INDEX "TeamGroupMembership_teamMembershipId_teamId_idx" ON "TeamGroupMembership"("teamMembershipId", "teamId");

-- CreateIndex
CREATE INDEX "TeamGroupMembership_page_idx" ON "TeamGroupMembership"("teamGroupId", "createdAt", "teamMembershipId");

-- CreateIndex
CREATE INDEX "TeamExternalGroupBinding_teamGroupId_idx" ON "TeamExternalGroupBinding"("teamGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamExternalGroupBinding_id_teamGroupId_key" ON "TeamExternalGroupBinding"("id", "teamGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamExternalGroupBinding_directory_key" ON "TeamExternalGroupBinding"("directorySourceId", "externalGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamExternalGroupBinding_connection_key" ON "TeamExternalGroupBinding"("teamIdentityConnectionId", "externalGroupId");

-- CreateIndex
CREATE INDEX "TeamGroupContribution_binding_idx" ON "TeamGroupMembershipExternalContribution"("externalGroupBindingId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_tokenHash_key" ON "TeamInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_createdAt_id_idx" ON "TeamInvitation"("teamId", "createdAt", "id");

-- Prisma SQLite DateTime writes are epoch milliseconds; older SQL timestamps remain readable.
UPDATE "Account" SET "status" = 'disabled'
WHERE EXISTS (
    SELECT 1 FROM "RepeatKey"
    WHERE "key" = 'auth_disabled_' || "Account"."id"
      AND CASE WHEN typeof("expiresAt") IN ('integer', 'real')
          THEN "expiresAt" > CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)
          ELSE julianday("expiresAt") > julianday('now') END
);
DELETE FROM "RepeatKey" WHERE substr("key", 1, 14) = 'auth_disabled_';
