import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { encodeSessionTeamCredentialSlotKeyV1 } from '@happier-dev/protocol';

import { applyPostgresMigrations, applySqliteMigrations } from '../prismaMigrations';

const serverRoot = join(import.meta.dirname, '../..');
const laneTenMigrations = [
    '20260906220000_add_team_credential_resources',
    '20260907000000_add_team_credential_usage_limits',
    '20260907010000_add_team_credential_recipient_material',
    '20260907090000_add_saved_secret_resources',
    '20260907100000_add_team_credential_external_api_keys',
] as const;

describe('Team credential resource persistence', () => {
    it.each(['sqlite', 'postgres'] as const)('preserves source custody and retires audience/witness relations on %s', async (provider) => {
        const directory = await mkdtemp(join(tmpdir(), 'happier-team-credentials-'));
        const migrationsDir = join(directory, 'migrations');
        const databasePath = join(directory, 'test.sqlite');
        const sqlite = provider === 'sqlite' ? new DatabaseSync(databasePath) : null;
        const postgres = provider === 'postgres' ? new PGlite() : null;
        const exec = async (sql: string) => { if (sqlite) sqlite.exec(sql); else await postgres!.exec(sql); };
        const query = async (sql: string) => sqlite ? sqlite.prepare(sql).all() : (await postgres!.query(sql)).rows;
        const root = provider === 'sqlite' ? 'prisma/sqlite' : 'prisma';
        const deploy = () => sqlite
            ? applySqliteMigrations({ databasePath, migrationsDir })
            : applyPostgresMigrations({ db: postgres!, migrationsDir });
        const addMigration = async (name: string, optional = false) => {
            const sql = await readFile(join(serverRoot, root, 'migrations', name, 'migration.sql'), 'utf8').catch((error: NodeJS.ErrnoException) => {
                if (optional && error.code === 'ENOENT') return null;
                throw error;
            });
            if (sql === null) return;
            await mkdir(join(migrationsDir, name), { recursive: true });
            await writeFile(join(migrationsDir, name, 'migration.sql'), sql);
        };
        try {
            // Existing immutable baseline used by the governance migration harness.
            await addMigration(sqlite ? '20260122190000_baseline' : '20250713002718_initial');
            if (postgres) {
                await addMigration('20250713004156_add_sessions');
                await addMigration('20250812092041_add_machine_model');
            }
            await addMigration('20260410103000_add_usage_event');
            await addMigration('20260517190000_add_session_turns');
            await addMigration('20260905220000_add_team_home_governance');
            await deploy();
            if (sqlite) sqlite.exec('PRAGMA foreign_keys=ON');
            await exec(`INSERT INTO "Account" ("id","publicKey","updatedAt") VALUES ('custodian','custodian',CURRENT_TIMESTAMP),('member','member',CURRENT_TIMESTAMP);
                INSERT INTO "Team" ("id","name","updatedAt") VALUES ('team','Team',CURRENT_TIMESTAMP);
                INSERT INTO "TeamMembership" ("id","teamId","accountId","role") VALUES ('membership','team','member','member');
                INSERT INTO "TeamGroup" ("id","teamId","name","nameKey","updatedAt") VALUES ('group','team','Group','group',CURRENT_TIMESTAMP);
                INSERT INTO "Machine" ("id","accountId","metadata","updatedAt") VALUES ('broker','custodian','{}',CURRENT_TIMESTAMP);
                ${sqlite ? `INSERT INTO "Session" ("id","tag","accountId","metadata","updatedAt") VALUES ('session','session','member','{}',CURRENT_TIMESTAMP);` : `INSERT INTO "Session" ("id","accountId","updatedAt") VALUES ('session','member',CURRENT_TIMESTAMP);`}
                INSERT INTO "UsageEvent" ("id","accountId","sessionId","observedAt","agentId","source","scope","updatedAt") VALUES ('pre-lane-10-usage','member','session',CURRENT_TIMESTAMP,'codex','session','turn',CURRENT_TIMESTAMP);`);
            for (const migration of laneTenMigrations) await addMigration(migration);
            await deploy();
            expect(await query(`SELECT "id","executionRunId","teamCredentialResourceId","teamCredentialActorAccountId","requestCount" FROM "UsageEvent" WHERE "id"='pre-lane-10-usage'`))
                .toEqual([{ id: 'pre-lane-10-usage', executionRunId: null, teamCredentialResourceId: null, teamCredentialActorAccountId: null, requestCount: 0 }]);
            await exec(`INSERT INTO "TeamCredentialResource" ("id","teamId","custodianAccountId","displayName","disclosureCeiling","sessionUsePolicy","sourceBindingJson","directSourceVersionsJson","brokerMachineId","updatedAt")
                VALUES ('resource','team','custodian','Shared','brokered_only','personal_allowed','{}','{}','broker',CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialMemberGrant" ("resourceId","teamMembershipId","deliveryMode","updatedAt") VALUES ('resource','membership','brokered',CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialGroupGrant" ("resourceId","teamGroupId","deliveryMode","updatedAt") VALUES ('resource','group','brokered',CURRENT_TIMESTAMP);
                INSERT INTO "TeamCredentialRecipientMaterial" ("id","resourceId","recipientAccountId","sourceMemberKey","sourceVersion","recipientMode","storedMaterial","updatedAt") VALUES ('material','resource','member','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','v1','plain',${sqlite ? "X'01'" : "decode('01','hex')"},CURRENT_TIMESTAMP);
                INSERT INTO "SavedSecretResource" ("id","ownerAccountId","displayName","kind","encryptionMode","storedContent","updatedAt") VALUES ('saved','custodian','Saved','opaque','plain','{}',CURRENT_TIMESTAMP);
                INSERT INTO "SavedSecretAccountGrant" ("resourceId","accountId","createdByAccountId") VALUES ('saved','member','custodian');
                INSERT INTO "TeamCredentialExternalApiKey" ("id","resourceId","teamMembershipId","label","displayPrefix","secretDigest") VALUES ('external','resource','membership','CI','hpk_12345678','digest');
                INSERT INTO "SessionTeamCredentialBinding" ("sessionId","slotKind","slotKey","resourceId","resourceRevision","updatedAt") VALUES ('session','provider_model',${sqlite ? "X'70726f76696465725f6d6f64656c'" : "decode('70726f76696465725f6d6f64656c','hex')"},'resource',0,CURRENT_TIMESTAMP);`);
            expect(await query(`SELECT "resourceId","resourceRevision" FROM "SessionTeamCredentialBinding" WHERE "slotKind"='provider_model'`))
                .toEqual([{ resourceId: 'resource', resourceRevision: 0 }]);
            expect(await query(`SELECT "authenticationEvidence" FROM "TeamCredentialExternalApiKey" WHERE "id"='external'`))
                .toEqual([{ authenticationEvidence: null }]);
            const authenticationEvidence = { v: 1, evidence: [{ kind: 'home_method', methodId: 'key_challenge' }] };
            await exec(`UPDATE "TeamCredentialExternalApiKey" SET "authenticationEvidence"='${JSON.stringify(authenticationEvidence)}' WHERE "id"='external'`);
            const evidenceRows = await query(`SELECT "authenticationEvidence" FROM "TeamCredentialExternalApiKey" WHERE "id"='external'`);
            expect(sqlite ? JSON.parse(String(evidenceRows[0].authenticationEvidence)) : evidenceRows[0].authenticationEvidence)
                .toEqual(authenticationEvidence);
            // The binding writer persists the prefixed canonical slot encoding
            // (encodeSessionTeamCredentialSlotKeyV1), not the unprefixed purpose key.
            const purpose = { consumer: { pluginId: `${'a'.repeat(254)}.a`, localId: 'b'.repeat(256) }, purpose: '\u0001'.repeat(128) };
            const slotKeys = [purpose, { ...purpose, purpose: `${'\u0001'.repeat(127)}\u0002` }]
                .map((value) => Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'connected_service_purpose', purpose: value }), 'utf8'));
            expect(slotKeys[0].byteLength).toBe(1318);
            const insertSlot = (key: Uint8Array) => {
                const hex = Buffer.from(key).toString('hex');
                const literal = sqlite ? `X'${hex}'` : `decode('${hex}','hex')`;
                return exec(`INSERT INTO "SessionTeamCredentialBinding" ("sessionId","slotKind","slotKey","resourceId","resourceRevision","updatedAt") VALUES ('session','connected_service_purpose',${literal},'resource',0,CURRENT_TIMESTAMP)`);
            };
            for (const key of slotKeys) await insertSlot(key);
            await expect(insertSlot(slotKeys[0])).rejects.toThrow();
            const storedKeys = await query('SELECT "slotKey" FROM "SessionTeamCredentialBinding" WHERE "slotKind"=\'connected_service_purpose\'');
            expect(storedKeys.map((row) => Buffer.from(row.slotKey as Uint8Array).toString('hex')).sort())
                .toEqual(slotKeys.map((key) => key.toString('hex')).sort());
            await exec(`INSERT INTO "TeamCredentialActivityEvent" ("id","teamId","resourceId","kind","actorAccountId","subjectDisplayName") VALUES ('activity','team','resource','resource_created','custodian','Shared');`);
            await expect(deploy()).resolves.toEqual({ applied: [] });
            await expect(exec(`DELETE FROM "TeamMembership" WHERE "id"='membership'`)).rejects.toThrow();
            await exec(`DELETE FROM "TeamCredentialExternalApiKey" WHERE "id"='external'`);
            await exec(`DELETE FROM "TeamMembership" WHERE "id"='membership';
                INSERT INTO "TeamMembership" ("id","teamId","accountId","role") VALUES ('reinvited','team','member','member');
                DELETE FROM "Machine" WHERE "id"='broker';`);
            expect(await query('SELECT "resourceId" FROM "TeamCredentialMemberGrant"')).toEqual([]);
            expect(await query('SELECT "brokerMachineId","revision" FROM "TeamCredentialResource"')).toEqual([{ brokerMachineId: null, revision: 0 }]);
            await exec(`DELETE FROM "TeamGroup" WHERE "id"='group'`);
            expect(await query('SELECT "resourceId" FROM "TeamCredentialGroupGrant"')).toEqual([]);
            await exec(`DELETE FROM "Account" WHERE "id"='custodian'`);
            expect(await query('SELECT "id" FROM "TeamCredentialResource"')).toEqual([]);
            expect(await query('SELECT "resourceId" FROM "SessionTeamCredentialBinding"')).toEqual([]);
            expect(await query('SELECT "id" FROM "Team"')).toEqual([{ id: 'team' }]);
            expect(await query('SELECT "resourceId","actorAccountId","subjectDisplayName" FROM "TeamCredentialActivityEvent"'))
                .toEqual([{ resourceId: 'resource', actorAccountId: null, subjectDisplayName: 'Shared' }]);
            await exec(`DELETE FROM "Team" WHERE "id"='team'`);
            expect(await query('SELECT "id" FROM "TeamCredentialActivityEvent"')).toEqual([]);
            if (sqlite) expect(await query('PRAGMA foreign_key_check')).toEqual([]);
        } finally {
            sqlite?.close();
            await postgres?.close();
            await rm(directory, { recursive: true, force: true });
        }
    }, 60_000);

    it('sizes the MySQL slot-key column for every producible canonical slot key', async () => {
        // Worst schema-valid purpose: ASCII identifiers at their byte cap plus a
        // purpose whose control characters JSON-escape to six bytes per unit.
        const extreme = {
            kind: 'connected_service_purpose' as const,
            purpose: { consumer: { pluginId: `${'a'.repeat(254)}.a`, localId: 'b'.repeat(256) }, purpose: '\u0001'.repeat(128) },
        };
        const maxProducibleKeyBytes = Buffer.from(encodeSessionTeamCredentialSlotKeyV1(extreme), 'utf8').byteLength;
        expect(maxProducibleKeyBytes).toBe(1318);
        const migration = await readFile(
            join(serverRoot, 'prisma', 'mysql', 'migrations', '20260906220000_add_team_credential_resources', 'migration.sql'),
            'utf8',
        );
        const declared = /`slotKey` VARBINARY\((\d+)\)/.exec(migration);
        expect(declared).not.toBeNull();
        const declaredWidth = Number(declared![1]);
        // PostgreSQL and SQLite store unbounded BYTEA/BLOB; MySQL must accept the
        // same schema-valid protocol values instead of failing at insert time.
        expect(declaredWidth).toBeGreaterThanOrEqual(maxProducibleKeyBytes);
        // The compound primary key must stay within InnoDB's 3072-byte limit
        // (VARCHAR(191) utf8mb4 = 764 bytes per identity column).
        expect(764 + 764 + declaredWidth).toBeLessThanOrEqual(3072);
    });

    it('keeps Execution Run usage attribution nullable and scalar on MySQL', async () => {
        const migration = await readFile(
            join(serverRoot, 'prisma', 'mysql', 'migrations', '20260907000000_add_team_credential_usage_limits', 'migration.sql'),
            'utf8',
        );
        expect(migration).toContain('ADD COLUMN `executionRunId` VARCHAR(191) NULL');
        expect(migration).not.toMatch(/FOREIGN KEY \(`executionRunId`\)|INDEX [^\n]*executionRunId/);
    });
});
