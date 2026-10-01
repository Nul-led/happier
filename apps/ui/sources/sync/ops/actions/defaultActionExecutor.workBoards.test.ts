import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { encodeBase64StoredJsonContentEnvelope, decodeBase64StoredJsonContentEnvelope } from '@/sync/encryption/base64StoredJsonContent';
import { createDefaultActionExecutor } from './defaultActionExecutor';

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
const mutationSchema = z.object({ mutations: z.array(z.object({ key: z.string(), value: z.string(), version: z.number() })) });
const currentness = { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 };

describe('Board Actions through captured Home Account KV', () => {
    beforeEach(async () => { await harness.reset(); });
    afterEach(() => { standardCleanup(); });

    it('rebases a conflicting Board record without sending unrelated Account settings or borrowing the focused Home', async () => {
        const { createWorkBoardV1, WorkBoardsV1Schema, WORK_BOARDS_ACCOUNT_KV_KEY_V1: key } = await import('@happier-dev/protocol');
        const target = await harness.addHome({ name: 'Board Home', serverUrl: 'https://board-target.test', accountId: 'board-owner' });
        await harness.addHome({ name: 'Focused Home', serverUrl: 'https://board-focused.test', accountId: 'focused-owner' });
        let record: unknown = { v: 1, boards: [] };
        let version = 0;
        let conflict = true;
        const plain = () => encodeBase64StoredJsonContentEnvelope({ t: 'plain', v: record });
        harness.answer(target, '/v2/account/settings', { body: { content: { t: 'plain', v: { unrelated: 'x'.repeat(600_000) } }, version: 1 } });
        harness.answer(target, '/v1/account/encryption/currentness', { body: currentness });
        harness.answer(target, `/v1/kv/${encodeURIComponent(key)}`, { select: () => ({ body: { key, value: plain(), version } }) });
        harness.answer(target, 'POST /v1/kv', { select: input => {
            const mutation = mutationSchema.parse(input).mutations[0]!;
            expect(mutation.key).toBe(key);
            expect(mutation.version).toBe(version);
            if (conflict) {
                conflict = false;
                record = { v: 1, boards: [createWorkBoardV1({ id: 'other', name: 'Concurrent Board' })] };
                return { status: 409, body: { success: false, errors: [{ key, error: 'version-mismatch', version: ++version, value: plain() }] } };
            }
            const envelope = decodeBase64StoredJsonContentEnvelope(mutation.value);
            if (envelope?.t !== 'plain') throw new Error('Plain Account must remain keyless');
            record = envelope.v;
            return { body: { success: true, results: [{ key, version: ++version }] } };
        } });
        const executor = createDefaultActionExecutor();
        const context = { serverId: target, surface: 'ui', bypassApprovals: true } as const;
        expect(await executor.execute('boards.apply', { intent: { kind: 'create', board: { id: 'mine', name: 'My Board' } } }, context))
            .toMatchObject({ ok: true, result: { board: { id: 'mine' } } });
        expect(WorkBoardsV1Schema.parse(record).boards.map(board => board.id)).toEqual(['other', 'mine']);
        expect(await executor.execute('boards.list', {}, context)).toMatchObject({ ok: true, result: { boards: [{ id: 'other' }, { id: 'mine' }] } });
        expect(harness.requestsFor('/v1/kv').every(request => request.serverId === target)).toBe(true);
        expect(harness.requestsFor('/v2/account/settings').filter(request => request.method === 'POST')).toEqual([]);
        expect(JSON.stringify(record)).not.toContain('unrelated');
    });
});
