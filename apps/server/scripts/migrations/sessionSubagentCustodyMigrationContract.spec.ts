import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const serverRoot = join(import.meta.dirname, '..', '..');
const migrationId = '20260713210000_add_session_subagent_custody';
const sourceCustodyMigrationId = '20260920230000_migrate_session_subagent_source_custody';

async function read(relativePath: string): Promise<string> {
    return await readFile(join(serverRoot, relativePath), 'utf8');
}

describe('durable subagent custody schema and migration contract', () => {
    it.each([
        'prisma/schema.prisma',
        'prisma/sqlite/schema.prisma',
        'prisma/mysql/schema.prisma',
    ])('keeps the three Prisma schemas on the dedicated record-and-receipt owner: %s', async (schemaPath) => {
        const schema = await read(schemaPath);
        expect(schema).toContain('model SessionSubagentCustody {');
        expect(schema).toContain('model SessionSubagentCustodyReceipt {');
        expect(schema).toContain('@@unique([accountId, sessionId, custodyKey, subagentKey]');
        expect(schema).toContain('@@unique([accountId, sessionId, custodyKey, operationId]');
        expect(schema).toContain('@@index([accountId, sessionId, custodyKey, expiresAt]');
        expect(schema).not.toMatch(/resultContent|resultCiphertext/);
    });

    it.each([
        ['prisma/migrations', 'COLLATE "C"'],
        ['prisma/sqlite/migrations', null],
        ['prisma/mysql/migrations', 'COLLATE utf8mb4_0900_bin'],
    ])('uses ordinal opaque identity without trimming or case folding: %s', async (migrationRoot, expectedCollation) => {
        const sql = await read(`${migrationRoot}/${migrationId}/migration.sql`);
        if (expectedCollation) {
            expect(sql).toContain(expectedCollation);
            expect(sql).toMatch(/custodyKey[^\n]*COLLATE/);
            expect(sql).toMatch(/subagentKey[^\n]*COLLATE/);
            expect(sql).toMatch(/operationId[^\n]*COLLATE/);
        } else {
            // SQLite text comparisons use BINARY by default. Keep the already-applied
            // migration immutable instead of editing it to spell out the default.
            expect(sql).not.toMatch(/\bCOLLATE\s+(?:NOCASE|RTRIM)\b/i);
        }
    });

    it('uses MySQL NO PAD identity and keeps public identifiers out of indexes', async () => {
        const sql = await read(`prisma/mysql/migrations/${migrationId}/migration.sql`);
        expect(sql).not.toContain('COLLATE utf8mb4_bin');
        expect(sql.match(/COLLATE utf8mb4_0900_bin/g) ?? []).toHaveLength(12);
        expect(sql).toMatch(/`subagentId` LONGTEXT NOT NULL/);
        expect(sql).toMatch(/`groupId` LONGTEXT NULL/);
        expect(sql).not.toMatch(/(?:UNIQUE )?INDEX[^\n]*(?:subagentId|groupId)/);
    });

    it.each([
        'prisma/migrations',
        'prisma/sqlite/migrations',
        'prisma/mysql/migrations',
    ])('cascades custody, receipt, and retired-source rows with their owning session or account: %s', async (migrationRoot) => {
        const sql = await read(`${migrationRoot}/${migrationId}/migration.sql`);
        expect(sql.match(/ON DELETE CASCADE/g) ?? []).toHaveLength(5);
    });

    it.each([
        ['prisma/migrations', '5cf2269aaa3e2c580050848eb8022dc2f29dc78cecd8dd8cb19fae7424d24e9e'],
        ['prisma/sqlite/migrations', '22c00d35c0f73f2a8b50e256c85185162e5d7d4f64c4ad92d5942c6f012beaa4'],
        ['prisma/mysql/migrations', '87cba25a24755a1bc1c765971ea3e2cda654679bf14e4b7f08c30d081b276cda'],
    ])('pins the append-only migration bytes: %s', async (migrationRoot, expectedSha256) => {
        const sql = await read(`${migrationRoot}/${migrationId}/migration.sql`);
        expect(createHash('sha256').update(sql).digest('hex')).toBe(expectedSha256);
    });

    it.each([
        'prisma/migrations',
        'prisma/sqlite/migrations',
        'prisma/mysql/migrations',
    ])('migrates generation-only ownership to discriminated source custody: %s', async (migrationRoot) => {
        const sql = await read(`${migrationRoot}/${sourceCustodyMigrationId}/migration.sql`);
        for (const table of ['SessionSubagentCustody', 'SessionSubagentCustodyReceipt']) {
            for (const column of ['sourceCustodyKind', 'sourceCustodyId']) {
                expect(sql).toContain(column);
            }
            expect(sql).toMatch(new RegExp(`${table}[\\s\\S]*sourceCustodyKind`));
            expect(sql).toMatch(new RegExp(`${table}[\\s\\S]*sourceCustodyId`));
        }
        expect(sql).toContain('SubagentCustody_source_retirement_idx');
        expect(sql).toContain('SubagentCustodyReceipt_source_retirement_idx');
        expect(sql).toMatch(/SessionSubagentCustodyRetiredSource[\s\S]*sourceCustodyKind[\s\S]*sourceCustodyId[\s\S]*capacitySlot/);
        expect(sql).toContain('SubagentCustodyRetiredSource_capacity_slot_key');
        expect(sql).toMatch(/managed/);
        expect(sql).not.toMatch(/CREATE TABLE ["\`]SessionSubagentCustodyRetiredGeneration["\`]/);
        if (migrationRoot === 'prisma/migrations') {
            expect(sql.match(/sourceCustody(?:Kind|Id)" TEXT COLLATE "C"/g) ?? []).toHaveLength(6);
        } else if (migrationRoot === 'prisma/mysql/migrations') {
            expect(sql.match(/sourceCustody(?:Kind|Id)` VARCHAR\(191\) COLLATE utf8mb4_0900_bin/g) ?? []).toHaveLength(12);
        }
    });

    it.each([
        'prisma/schema.prisma',
        'prisma/sqlite/schema.prisma',
        'prisma/mysql/schema.prisma',
    ])('stores source custody without a generation-only parallel owner: %s', async (schemaPath) => {
        const schema = await read(schemaPath);
        expect(schema).toContain('model SessionSubagentCustodyRetiredSource {');
        expect(schema.match(/sourceCustodyKind\s+String/g) ?? []).toHaveLength(3);
        expect(schema.match(/sourceCustodyId\s+String/g) ?? []).toHaveLength(3);
        expect(schema).not.toContain('model SessionSubagentCustodyRetiredGeneration {');
        const custodyModels = schema.slice(
            schema.indexOf('model SessionSubagentCustody {'),
            schema.indexOf('model SessionDiscussion {'),
        );
        expect(custodyModels).not.toContain('immutableGenerationId');
    });
});
