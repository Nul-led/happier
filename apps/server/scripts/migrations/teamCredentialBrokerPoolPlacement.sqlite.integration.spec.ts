import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { applySqliteMigrations } from "../prismaMigrations";

const serverRoot = join(import.meta.dirname, "../..");
const sourceMigrationsDir = join(serverRoot, "prisma/sqlite/migrations");
const placementMigration = "20260911210000_add_team_credential_broker_pool_placement";
const predecessorMigrations = [
    "20260122190000_baseline",
    "20260410103000_add_usage_event",
    "20260517190000_add_session_turns",
    "20260905220000_add_team_home_governance",
    "20260905233000_add_machine_pools",
    "20260906220000_add_team_credential_resources",
    "20260907000000_add_team_credential_usage_limits",
    "20260907010000_add_team_credential_recipient_material",
    "20260907090000_add_saved_secret_resources",
    "20260907100000_add_team_credential_external_api_keys",
] as const;

describe("Team credential broker Pool placement SQLite migration", () => {
    let directory: string | null = null;

    afterEach(async () => {
        if (directory !== null) {
            await rm(directory, { recursive: true, force: true });
            directory = null;
        }
    });

    it("preserves the resource aggregate while adding Pool placement with SET NULL", async () => {
        directory = await mkdtemp(join(tmpdir(), "happier-broker-pool-placement-"));
        const migrationsDir = join(directory, "migrations");
        const databasePath = join(directory, "test.sqlite");

        const addMigration = async (name: string) => {
            const destination = join(migrationsDir, name);
            await mkdir(destination, { recursive: true });
            await writeFile(
                join(destination, "migration.sql"),
                await readFile(join(sourceMigrationsDir, name, "migration.sql")),
            );
        };

        for (const migration of predecessorMigrations) await addMigration(migration);
        await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({
            applied: [...predecessorMigrations],
        });

        const database = new DatabaseSync(databasePath);
        try {
            database.exec("PRAGMA foreign_keys=ON");
            database.exec(`
                INSERT INTO "Account" ("id", "publicKey", "updatedAt") VALUES
                    ('custodian', 'custodian-key', CURRENT_TIMESTAMP),
                    ('recipient', 'recipient-key', CURRENT_TIMESTAMP);
                INSERT INTO "Team" ("id", "name", "updatedAt") VALUES
                    ('team', 'Team', CURRENT_TIMESTAMP);
                INSERT INTO "TeamMembership" ("id", "teamId", "accountId", "role") VALUES
                    ('membership', 'team', 'recipient', 'member');
                INSERT INTO "TeamGroup" ("id", "teamId", "name", "nameKey", "updatedAt") VALUES
                    ('group', 'team', 'Group', 'group', CURRENT_TIMESTAMP);
                INSERT INTO "Machine" ("id", "accountId", "metadata", "updatedAt") VALUES
                    ('machine', 'custodian', '{}', CURRENT_TIMESTAMP);
                INSERT INTO "MachinePool" ("id", "accountId", "name", "updatedAt") VALUES
                    ('pool', 'custodian', 'Provider Pool', CURRENT_TIMESTAMP);
                INSERT INTO "Session" ("id", "tag", "accountId", "metadata", "updatedAt") VALUES
                    ('session', 'session', 'recipient', '{}', CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialResource" (
                    "id", "teamId", "custodianAccountId", "displayName", "enabled", "revision",
                    "disclosureCeiling", "sessionUsePolicy", "sourceBindingJson",
                    "directSourceVersionsJson", "requestPolicyJson", "brokerMachineId",
                    "allMembersDeliveryMode", "createdAt", "updatedAt"
                ) VALUES (
                    'resource', 'team', 'custodian', 'Shared provider', false, 7,
                    'brokered_only', 'team_required', '{"source":"opaque"}',
                    '{"version":2}', '{"approval":"always"}', 'machine',
                    'brokered', '2026-09-01 12:34:56', '2026-09-02 12:34:56'
                );
                INSERT INTO "TeamCredentialMemberGrant" (
                    "resourceId", "teamMembershipId", "deliveryMode", "updatedAt"
                ) VALUES ('resource', 'membership', 'brokered', CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialGroupGrant" (
                    "resourceId", "teamGroupId", "deliveryMode", "updatedAt"
                ) VALUES ('resource', 'group', 'brokered', CURRENT_TIMESTAMP);
                INSERT INTO "SessionTeamCredentialBinding" (
                    "sessionId", "slotKind", "slotKey", "resourceId", "resourceRevision", "updatedAt"
                ) VALUES ('session', 'provider_model', X'00017FFF', 'resource', 7, CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialUsageLimit" (
                    "id", "resourceId", "subjectKind", "subjectId", "period", "metric", "maximum", "updatedAt"
                ) VALUES ('limit', 'resource', 'account', 'recipient', 'month', 'requests', '1234', CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialRecipientMaterial" (
                    "id", "resourceId", "recipientAccountId", "sourceMemberKey", "sourceVersion",
                    "recipientMode", "recipientContentPublicKeyFingerprint", "storedMaterial", "updatedAt"
                ) VALUES (
                    'material', 'resource', 'recipient', 'member-key', 'v1',
                    'e2ee', 'fingerprint', X'00FF0180', CURRENT_TIMESTAMP
                );
                INSERT INTO "TeamCredentialExternalApiKey" (
                    "id", "resourceId", "teamMembershipId", "label", "displayPrefix", "secretDigest"
                ) VALUES ('external', 'resource', 'membership', 'CI', 'hpk_12345678', 'digest');
            `);

            await addMigration(placementMigration);
            await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({
                applied: [placementMigration],
            });
            await expect(applySqliteMigrations({ databasePath, migrationsDir })).resolves.toEqual({ applied: [] });

            expect(database.prepare(`
                SELECT "id", "teamId", "custodianAccountId", "displayName", "enabled", "revision",
                       "disclosureCeiling", "sessionUsePolicy", "sourceBindingJson",
                       "directSourceVersionsJson", "requestPolicyJson", "brokerMachineId",
                       "brokerPoolId", "allMembersDeliveryMode", "createdAt", "updatedAt"
                FROM "TeamCredentialResource" WHERE "id" = 'resource'
            `).get()).toEqual({
                id: "resource",
                teamId: "team",
                custodianAccountId: "custodian",
                displayName: "Shared provider",
                enabled: 0,
                revision: 7,
                disclosureCeiling: "brokered_only",
                sessionUsePolicy: "team_required",
                sourceBindingJson: '{"source":"opaque"}',
                directSourceVersionsJson: '{"version":2}',
                requestPolicyJson: '{"approval":"always"}',
                brokerMachineId: "machine",
                brokerPoolId: null,
                allMembersDeliveryMode: "brokered",
                createdAt: "2026-09-01 12:34:56",
                updatedAt: "2026-09-02 12:34:56",
            });
            expect(database.prepare(`
                SELECT hex("slotKey") AS "slotKey", "resourceId", "resourceRevision"
                FROM "SessionTeamCredentialBinding"
            `).get()).toEqual({ slotKey: "00017FFF", resourceId: "resource", resourceRevision: 7 });
            expect(database.prepare(`
                SELECT hex("storedMaterial") AS "storedMaterial", "resourceId", "recipientAccountId"
                FROM "TeamCredentialRecipientMaterial"
            `).get()).toEqual({ storedMaterial: "00FF0180", resourceId: "resource", recipientAccountId: "recipient" });
            expect(database.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM "TeamCredentialMemberGrant" WHERE "resourceId" = 'resource') AS "memberGrants",
                    (SELECT COUNT(*) FROM "TeamCredentialGroupGrant" WHERE "resourceId" = 'resource') AS "groupGrants",
                    (SELECT COUNT(*) FROM "TeamCredentialUsageLimit" WHERE "resourceId" = 'resource') AS "usageLimits",
                    (SELECT COUNT(*) FROM "TeamCredentialExternalApiKey" WHERE "resourceId" = 'resource') AS "externalKeys"
            `).get()).toEqual({ memberGrants: 1, groupGrants: 1, usageLimits: 1, externalKeys: 1 });

            const indexNames = database.prepare(`PRAGMA index_list("TeamCredentialResource")`).all()
                .map((row) => String((row as { name: unknown }).name));
            expect(indexNames).toEqual(expect.arrayContaining([
                "TeamCredentialResource_teamId_enabled_updatedAt_idx",
                "TeamCredentialResource_custodianAccountId_updatedAt_idx",
                "TeamCredentialResource_brokerMachineId_idx",
                "TeamCredentialResource_brokerPoolId_idx",
            ]));
            expect(database.prepare(`PRAGMA foreign_key_list("TeamCredentialResource")`).all()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        table: "MachinePool",
                        from: "brokerPoolId",
                        to: "id",
                        on_delete: "SET NULL",
                    }),
                ]),
            );

            database.prepare(`UPDATE "TeamCredentialResource" SET "brokerPoolId" = 'pool' WHERE "id" = 'resource'`).run();
            expect(database.prepare(`SELECT "brokerPoolId" FROM "TeamCredentialResource" WHERE "id" = 'resource'`).get())
                .toEqual({ brokerPoolId: "pool" });
            database.prepare(`DELETE FROM "MachinePool" WHERE "id" = 'pool'`).run();
            expect(database.prepare(`
                SELECT "brokerMachineId", "brokerPoolId" FROM "TeamCredentialResource" WHERE "id" = 'resource'
            `).get()).toEqual({ brokerMachineId: "machine", brokerPoolId: null });
            database.prepare(`DELETE FROM "Machine" WHERE "id" = 'machine'`).run();
            expect(database.prepare(`
                SELECT "brokerMachineId", "brokerPoolId" FROM "TeamCredentialResource" WHERE "id" = 'resource'
            `).get()).toEqual({ brokerMachineId: null, brokerPoolId: null });
            expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
            expect(database.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
        } finally {
            database.close();
        }
    }, 60_000);
});
