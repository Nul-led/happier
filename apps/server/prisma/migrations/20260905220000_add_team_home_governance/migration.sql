-- CreateEnum
CREATE TYPE "HomeRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'disabled');

-- CreateEnum
CREATE TYPE "TeamCreationPolicy" AS ENUM ('self_service', 'managed_only', 'disabled');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('owner', 'admin', 'member', 'guest');

-- CreateEnum
CREATE TYPE "TeamMembershipStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "TeamSessionCreationPolicy" AS ENUM ('private_default', 'team_default', 'team_required');

-- CreateEnum
CREATE TYPE "TeamExternalSharingPolicy" AS ENUM ('allowed', 'team_admins_only', 'disabled');

-- CreateEnum
CREATE TYPE "SessionHistoryAccess" AS ENUM ('all_existing', 'from_membership');

-- CreateEnum
CREATE TYPE "TeamAdmissionMode" AS ENUM ('invite_only', 'provisioned', 'jit');

-- CreateEnum
CREATE TYPE "TeamExternalGroupBindingMode" AS ENUM ('directory_created', 'native_target');

-- CreateEnum
CREATE TYPE "TeamInvitationEmailDeliveryStatus" AS ENUM ('sent', 'failed');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "homeRole" "HomeRole" NOT NULL DEFAULT 'member',
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "HomeGovernancePolicy" (
    "id" TEXT NOT NULL,
    "teamCreationPolicy" "TeamCreationPolicy" NOT NULL DEFAULT 'managed_only',
    "authenticationPolicy" JSONB,
    "teamProviderPolicy" JSONB,
    "identityNetworkPolicy" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeGovernancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo" JSONB,
    "sessionCreationPolicy" "TeamSessionCreationPolicy" NOT NULL DEFAULT 'private_default',
    "externalSharingPolicy" "TeamExternalSharingPolicy" NOT NULL DEFAULT 'allowed',
    "defaultSessionHistoryAccess" "SessionHistoryAccess" NOT NULL DEFAULT 'from_membership',
    "admissionMode" "TeamAdmissionMode" NOT NULL DEFAULT 'invite_only',
    "authenticationPolicy" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "status" "TeamMembershipStatus" NOT NULL DEFAULT 'active',
    "sessionAccessStartsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroup" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroupMembership" (
    "teamId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "nativeContribution" BOOLEAN NOT NULL DEFAULT false,
    "sessionAccessStartsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamGroupMembership_pkey" PRIMARY KEY ("teamGroupId","teamMembershipId")
);

-- CreateTable
CREATE TABLE "TeamExternalGroupBinding" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamGroupId" TEXT NOT NULL,
    "directorySourceId" TEXT,
    "teamIdentityConnectionId" TEXT,
    "externalGroupId" TEXT NOT NULL,
    "bindingMode" "TeamExternalGroupBindingMode" NOT NULL,

    CONSTRAINT "TeamExternalGroupBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroupMembershipExternalContribution" (
    "teamGroupId" TEXT NOT NULL,
    "teamMembershipId" TEXT NOT NULL,
    "externalGroupBindingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamGroupContribution_pkey" PRIMARY KEY ("teamGroupId","teamMembershipId","externalGroupBindingId")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "recipientEmailNormalized" TEXT,
    "role" "TeamRole" NOT NULL,
    "historyAccess" "SessionHistoryAccess" NOT NULL,
    "createdByAccountId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByAccountId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastEmailDeliveryStatus" "TeamInvitationEmailDeliveryStatus",
    "lastEmailDeliveryAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroup" ADD CONSTRAINT "TeamGroup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMembership" ADD CONSTRAINT "TeamGroupMembership_teamGroupId_teamId_fkey" FOREIGN KEY ("teamGroupId", "teamId") REFERENCES "TeamGroup"("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMembership" ADD CONSTRAINT "TeamGroupMembership_teamMembershipId_teamId_fkey" FOREIGN KEY ("teamMembershipId", "teamId") REFERENCES "TeamMembership"("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamExternalGroupBinding" ADD CONSTRAINT "TeamExternalGroupBinding_teamGroupId_teamId_fkey" FOREIGN KEY ("teamGroupId", "teamId") REFERENCES "TeamGroup"("id", "teamId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMembershipExternalContribution" ADD CONSTRAINT "TeamGroupContribution_membership_fkey" FOREIGN KEY ("teamGroupId", "teamMembershipId") REFERENCES "TeamGroupMembership"("teamGroupId", "teamMembershipId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMembershipExternalContribution" ADD CONSTRAINT "TeamGroupContribution_binding_fkey" FOREIGN KEY ("externalGroupBindingId", "teamGroupId") REFERENCES "TeamExternalGroupBinding"("id", "teamGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_acceptedByAccountId_fkey" FOREIGN KEY ("acceptedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Contract the exact legacy Account-disable namespace after preserving effective markers.
UPDATE "Account" SET "status" = 'disabled'
WHERE EXISTS (SELECT 1 FROM "RepeatKey" WHERE "key" = 'auth_disabled_' || "Account"."id" AND "expiresAt" > CURRENT_TIMESTAMP);
DELETE FROM "RepeatKey" WHERE left("key", 14) = 'auth_disabled_';

-- A native mapping always names exactly one external owner.
ALTER TABLE "TeamExternalGroupBinding" ADD CONSTRAINT "TeamExternalGroupBinding_owner_check" CHECK (("directorySourceId" IS NULL) <> ("teamIdentityConnectionId" IS NULL));
