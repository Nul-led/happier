import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, initDbMysql } from "@/storage/db";

const provider = String(process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "")
    .trim()
    .toLowerCase();

function uniqueId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
}

describe.skipIf(provider !== "mysql")("MySQL trigger invariant enforcement", () => {
    let dbConnected = false;

    beforeAll(async () => {
        if (!process.env.DATABASE_URL) {
            throw new Error("Missing DATABASE_URL for the MySQL trigger invariant contract.");
        }
        await initDbMysql();
        await db.$connect();
        dbConnected = true;
    });

    afterAll(async () => {
        if (!dbConnected) return;
        await db.$disconnect();
    });

    it("rejects Session Follow self-edge inserts and updates independently of sql_mode", async () => {
        await db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET SESSION sql_mode = ''");
            try {
                const account = await tx.account.create({
                    data: { publicKey: uniqueId("mysql-follow-trigger-account") },
                    select: { id: true },
                });
                const emptyIdSession = await tx.session.create({
                    data: {
                        id: "",
                        accountId: account.id,
                        tag: uniqueId("mysql-follow-trigger-empty"),
                        metadata: "{}",
                    },
                    select: { id: true },
                });
                expect(emptyIdSession.id).toBe("");
                const source = await tx.session.create({
                    data: {
                        accountId: account.id,
                        tag: uniqueId("mysql-follow-trigger-source"),
                        metadata: "{}",
                    },
                    select: { id: true },
                });
                const destination = await tx.session.create({
                    data: {
                        accountId: account.id,
                        tag: uniqueId("mysql-follow-trigger-destination"),
                        metadata: "{}",
                    },
                    select: { id: true },
                });

                await tx.sessionFollowEdge.create({
                    data: {
                        sourceSessionId: source.id,
                        destinationSessionId: destination.id,
                    },
                });
                await expect(tx.sessionFollowEdge.create({
                    data: {
                        sourceSessionId: destination.id,
                        destinationSessionId: destination.id,
                    },
                })).rejects.toThrow("SessionFollowEdge source and destination must differ");
                await expect(tx.sessionFollowEdge.update({
                    where: {
                        destinationSessionId_sourceSessionId: {
                            destinationSessionId: destination.id,
                            sourceSessionId: source.id,
                        },
                    },
                    data: { destinationSessionId: source.id },
                })).rejects.toThrow("SessionFollowEdge source and destination must differ");
                await expect(tx.sessionFollowEdge.findMany({
                    select: { sourceSessionId: true, destinationSessionId: true },
                })).resolves.toEqual([{
                    sourceSessionId: source.id,
                    destinationSessionId: destination.id,
                }]);
            } finally {
                await tx.$executeRawUnsafe("SET SESSION sql_mode = @@GLOBAL.sql_mode");
            }
        });
    });

    it("rejects invalid provisioned-membership inserts and updates independently of sql_mode", async () => {
        await db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET SESSION sql_mode = ''");
            try {
                const suffix = randomUUID();
                const accountId = `mysql-identity-trigger-account-${suffix}`;
                const teamId = `mysql-identity-trigger-team-${suffix}`;
                const membershipId = `mysql-identity-trigger-membership-${suffix}`;
                const providerId = `mysql-identity-trigger-provider-${suffix}`;
                const connectionId = `mysql-identity-trigger-connection-${suffix}`;
                const sourceId = `mysql-identity-trigger-source-${suffix}`;
                await tx.$executeRawUnsafe(
                    "INSERT INTO `Account` (`id`,`publicKey`,`updatedAt`) VALUES (?,?,CURRENT_TIMESTAMP(3))",
                    accountId,
                    uniqueId("mysql-identity-trigger-key"),
                );
                await tx.$executeRawUnsafe(
                    "INSERT INTO `Team` (`id`,`name`,`updatedAt`) VALUES (?, 'Trigger Team', CURRENT_TIMESTAMP(3))",
                    teamId,
                );
                await tx.$executeRawUnsafe(
                    "INSERT INTO `TeamMembership` (`id`,`teamId`,`accountId`,`role`) VALUES (?,?,?,'owner')",
                    membershipId,
                    teamId,
                    accountId,
                );
                await tx.$executeRawUnsafe(
                    "INSERT INTO `IdentityProviderInstance` (`id`,`ownerTeamId`,`kind`,`displayName`,`config`,`updatedAt`) VALUES (?,?,'workos_sso','WorkOS','{}',CURRENT_TIMESTAMP(3))",
                    providerId,
                    teamId,
                );
                await tx.$executeRawUnsafe(
                    "INSERT INTO `TeamIdentityConnection` (`id`,`teamId`,`providerInstanceId`,`externalReference`,`settings`,`updatedAt`) VALUES (?,?,?,'{}','{}',CURRENT_TIMESTAMP(3))",
                    connectionId,
                    teamId,
                    providerId,
                );
                await tx.$executeRawUnsafe(
                    "INSERT INTO `TeamDirectorySource` (`id`,`teamId`,`kind`,`displayName`,`externalSourceKey`,`bindingConfig`,`teamIdentityConnectionId`,`updatedAt`) VALUES (?,?, 'workos_directory','Directory',?,'{}',?,CURRENT_TIMESTAMP(3)),('',?,'workos_directory','Empty sentinel',?,'{}',?,CURRENT_TIMESTAMP(3))",
                    sourceId,
                    teamId,
                    uniqueId("mysql-identity-trigger-source-key"),
                    connectionId,
                    teamId,
                    uniqueId("mysql-identity-trigger-empty-key"),
                    connectionId,
                );

                const linkedId = `mysql-identity-trigger-linked-${suffix}`;
                await tx.$executeRawUnsafe(
                    "INSERT INTO `TeamProvisionedIdentity` (`id`,`directorySourceId`,`teamId`,`externalUserId`,`state`,`teamMembershipId`,`teamMembershipTeamId`,`updatedAt`) VALUES (?,?,?,?,'active',?,?,CURRENT_TIMESTAMP(3))",
                    linkedId,
                    sourceId,
                    teamId,
                    uniqueId("mysql-identity-trigger-valid-user"),
                    membershipId,
                    teamId,
                );
                await expect(tx.$executeRawUnsafe(
                    "INSERT INTO `TeamProvisionedIdentity` (`id`,`directorySourceId`,`teamId`,`externalUserId`,`state`,`teamMembershipId`,`teamMembershipTeamId`,`updatedAt`) VALUES (?,?,?,?,'active',?,NULL,CURRENT_TIMESTAMP(3))",
                    uniqueId("mysql-identity-trigger-invalid"),
                    sourceId,
                    teamId,
                    uniqueId("mysql-identity-trigger-invalid-user"),
                    membershipId,
                )).rejects.toThrow("TeamProvisionedIdentity membership must belong to the same Team");
                await expect(tx.$executeRawUnsafe(
                    "UPDATE `TeamProvisionedIdentity` SET `teamMembershipTeamId`=NULL WHERE `id`=?",
                    linkedId,
                )).rejects.toThrow("TeamProvisionedIdentity membership must belong to the same Team");
                await expect(tx.teamProvisionedIdentity.findUniqueOrThrow({
                    where: { id: linkedId },
                    select: {
                        directorySourceId: true,
                        teamMembershipId: true,
                        teamMembershipTeamId: true,
                    },
                })).resolves.toEqual({
                    directorySourceId: sourceId,
                    teamMembershipId: membershipId,
                    teamMembershipTeamId: teamId,
                });
            } finally {
                await tx.$executeRawUnsafe("SET SESSION sql_mode = @@GLOBAL.sql_mode");
            }
        });
    });

    it("rejects invalid Workflow Run origin inserts and updates independently of sql_mode", async () => {
        await db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET SESSION sql_mode = ''");
            try {
                const account = await tx.account.create({
                    data: { publicKey: uniqueId("mysql-workflow-trigger-account") },
                    select: { id: true },
                });
                const runId = uniqueId("mysql-workflow-trigger-valid");
                const insertDirectRun = async (id: string, causeKind: "manual" | null) =>
                    await tx.$executeRawUnsafe(
                        "INSERT INTO `AutomationRun` (`id`,`originKind`,`automationId`,`accountId`,`causeKind`,`workflowAcceptedSnapshotEnvelope`,`workflowCustodyState`,`scheduledAt`,`dueAt`,`updatedAt`) VALUES (?,'direct',NULL,?,?, '{}','pending',CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))",
                        id,
                        account.id,
                        causeKind,
                    );

                await insertDirectRun(runId, null);
                await expect(insertDirectRun("", "manual"))
                    .rejects.toThrow("AutomationRun origin shape is invalid");
                await expect(tx.$executeRawUnsafe(
                    "UPDATE `AutomationRun` SET `causeKind`='manual' WHERE `id`=?",
                    runId,
                )).rejects.toThrow("AutomationRun origin shape is invalid");
                await expect(tx.automationRun.findUniqueOrThrow({
                    where: { id: runId },
                    select: { id: true, originKind: true, automationId: true, causeKind: true },
                })).resolves.toEqual({
                    id: runId,
                    originKind: "direct",
                    automationId: null,
                    causeKind: null,
                });
            } finally {
                await tx.$executeRawUnsafe("SET SESSION sql_mode = @@GLOBAL.sql_mode");
            }
        });
    });
});
